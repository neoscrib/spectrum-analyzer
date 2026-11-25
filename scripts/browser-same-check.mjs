import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { sameFixture, TEST_HEADER } from "../src/same/fixtures.ts";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1300, height: 1000 },
  timezoneId: "America/Chicago",
  serviceWorkers: "block",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const requests = [];
page.context().on("request", (r) => requests.push(r.url()));
let delayed = false;
await page.context().route(/same_bg.*\.wasm/, async (route) => {
  if (!delayed) {
    delayed = true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await route.continue();
});
await page.addInitScript(() => {
  const Audio = window.AudioContext;
  window.AudioContext = class extends Audio {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      gain.connect(analyser);
      window.__sameAudio = { analyser, context: this };
      return gain;
    }
  };
  const Worker = window.Worker;
  window.Worker = class extends Worker {
    postMessage(data, ...args) {
      window.__sameControls ??= [];
      window.__sameControls.push(data.type);
      super.postMessage(data, ...args);
    }
  };
  localStorage.setItem("spectrum-show-rf-plots", "false");
});
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  const panel = page.getByRole("region", { name: "EAS/SAME reception" });
  await expect(panel).toBeVisible();
  assert(
    !requests.some((u) => /same_bg.*\.wasm/.test(u)),
    "SAME disabled must not load its WASM",
  );
  await page
    .getByRole("button", { name: "Try FM test signal", exact: true })
    .click();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  const rms = () =>
    page.evaluate(() => {
      if (!window.__sameAudio) return 0;
      const a = window.__sameAudio.analyser,
        x = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(x);
      return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    });
  await expect.poll(rms).toBeGreaterThan(0.05);
  const before = await page.evaluate(
    () => window.__sameControls.filter((x) => x === "configure").length,
  );
  await panel.getByLabel("Decode EAS/SAME", { exact: true }).check();
  await expect
    .poll(() => requests.some((u) => /same_bg.*\.wasm/.test(u)))
    .toBe(true);
  // Even a slow optional-module download must leave RF and playback flowing.
  for (let n = 0; n < 18; n++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert((await rms()) > 0.03, "SAME loading interrupted audio");
  }
  await expect.poll(rms).toBeGreaterThan(0.05);
  await expect(
    page.getByText("Stereo · pilot locked", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("rds-state")).toHaveText("Receiving", {
    timeout: 20000,
  });
  assert.equal(
    await page.evaluate(
      () => window.__sameControls.filter((x) => x === "configure").length,
    ),
    before,
    "SAME toggle must not reconfigure the RF/audio demodulator",
  );
  await panel.getByLabel("Decode EAS/SAME", { exact: true }).uncheck();
  await expect.poll(rms).toBeGreaterThan(0.05);
  await panel
    .getByText("Recorded audio, IQ replay & generated test", { exact: true })
    .click();
  await panel
    .getByLabel("SAME capture reference UTC", { exact: true })
    .fill("2026-11-24T18:30");
  await panel
    .getByRole("button", {
      name: "Decode generated SAME test audio",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("Repeated headers agree", { exact: true }).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    panel.getByText("RWT · Required Weekly Test", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("NNNN · End of message", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("NOAA · 1050 Hz tone", { exact: true }),
  ).toBeVisible();
  const alert = panel
    .getByTestId("same-record")
    .filter({ hasText: "RWT · Required Weekly Test" });
  await alert.locator("summary").click();
  await expect(
    alert.getByText("027065 · Kanabec County, Minnesota", { exact: true }),
  ).toBeVisible();
  await expect(
    alert.getByText("2026-11-24 18:30:00 UTC", { exact: true }),
  ).toBeVisible();
  await expect(alert.getByText(/TEST/).first()).toBeVisible();
  await panel.getByLabel("SAME geographic filter").fill("027001");
  await expect(
    panel.getByText("RWT · Required Weekly Test", { exact: true }),
  ).toHaveCount(0);
  await panel.getByLabel("SAME geographic filter").fill("027065");
  await expect(
    panel.getByText("RWT · Required Weekly Test", { exact: true }),
  ).toBeVisible();
  await panel.getByLabel("SAME event filter").fill("TOR");
  await expect(
    panel.getByText("RWT · Required Weekly Test", { exact: true }),
  ).toHaveCount(0);
  await panel.getByLabel("SAME event filter").fill("");
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Export SAME history", exact: true })
    .click();
  assert.equal((await download).suggestedFilename(), "same-session.json");
  // A second, arbitrary-rate recorded WAV with EAS dual tones; no RF mode change.
  const audio = sameFixture(
    44100,
    [
      TEST_HEADER.replace("RWT", "RMT"),
      TEST_HEADER.replace("RWT", "RMT"),
      TEST_HEADER.replace("RWT", "RMT"),
    ],
    { attention: "easDual" },
  );
  const wav = Buffer.alloc(44 + audio.length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(audio.length * 2, 40);
  for (let n = 0; n < audio.length; n++)
    wav.writeInt16LE(Math.round(audio[n] * 28000), 44 + n * 2);
  await panel.getByLabel("SAME audio WAV").setInputFiles({
    name: "recorded-same-test.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(
    panel.getByText("RMT · Required Monthly Test", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    panel.getByText("EAS · 853 + 960 Hz tones", { exact: true }),
  ).toBeVisible();
  await expect.poll(rms).toBeGreaterThan(0.05);
  await mkdir("artifacts", { recursive: true });
  await panel.screenshot({ path: "artifacts/same-desktop.png" });
  await page.setViewportSize({ width: 393, height: 852 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "SAME must not overflow the mobile viewport",
  );
  await panel.screenshot({ path: "artifacts/same-mobile.png" });
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  // Replay an actual recorded CU8 file through the selected WFM demodulator.
  await panel.getByLabel("SAME capture reference UTC").fill("2026-11-24T18:30");
  const replayAudio = sameFixture(48000, [TEST_HEADER], { eom: false });
  const frames = (replayAudio.length - 48000 * 5) * 50,
    iq = Buffer.alloc(frames * 2);
  let phase = 0;
  for (let n = 0; n < frames; n++) {
    const index = n / 50,
      lo = Math.floor(index),
      f = index - lo;
    const sample =
      replayAudio[lo] * (1 - f) +
      replayAudio[Math.min(lo + 1, replayAudio.length - 1)] * f;
    phase += (2 * Math.PI * (100000 + 65000 * sample)) / 2400000;
    iq[n * 2] = Math.round(127.5 + 70 * Math.cos(phase));
    iq[n * 2 + 1] = Math.round(127.5 + 70 * Math.sin(phase));
  }
  await panel.getByLabel("SAME IQ recording").setInputFiles({
    name: "GENERATED-same.cu8",
    mimeType: "application/octet-stream",
    buffer: iq,
  });
  const meta = {
    global: { "core:datatype": "cu8", "core:sample_rate": 2400000 },
    captures: [
      {
        "core:sample_start": 0,
        "core:frequency": 100000000,
        "core:datetime": "2018-11-24T18:30:00Z",
      },
    ],
  };
  await panel.getByLabel("SAME IQ metadata").setInputFiles({
    name: "GENERATED-same.sigmf-meta",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(meta)),
  });
  await panel
    .getByRole("button", { name: "Replay IQ through WFM + SAME", exact: true })
    .click();
  await expect(
    panel.getByText("Single header · unconfirmed", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const replayRow = panel
    .getByTestId("same-record")
    .filter({ hasText: "RWT · Required Weekly Test" });
  await replayRow.locator("summary").click();
  await expect(
    replayRow.getByText("2018-11-24 18:30:00 UTC", { exact: true }),
  ).toBeVisible();
  await expect(replayRow.getByText(/IQ replay/)).toBeVisible();
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/same-browser-validation.json",
    JSON.stringify(
      {
        lazy: true,
        hotToggle: true,
        slowModuleLoadPreservesAudio: true,
        stereo: true,
        rds: true,
        generated: true,
        wav44100: true,
        iqReplay: true,
        metadataYear: true,
        tones: true,
        filters: true,
        export: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "SAME browser: lazy module, hot enable/disable, stereo/RDS/audio, generated and 44.1 kHz recorded WAV, both tones, metadata, filtering, export, mobile: passed.",
  );
} finally {
  await browser.close();
}
