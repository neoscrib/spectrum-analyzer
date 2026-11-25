import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const url = process.env.APP_URL || "http://127.0.0.1:5176";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error")
    errors.push(`${message.text()} ${message.location().url}`);
});
await page.addInitScript(() => {
  // Observe actual Web Audio output and Worker messages; the decoder stays unmodified.
  window.__workers = [];
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args);
      window.__workers.push(this);
    }
    postMessage(message, ...args) {
      window.__messages ??= [];
      window.__messages.push({
        type: message.type,
        settings: message.settings,
      });
      if (window.__messages.length > 100) window.__messages.shift();
      super.postMessage(message, ...args);
    }
  };
  const OriginalAudioContext = window.AudioContext;
  window.AudioContext = class extends OriginalAudioContext {
    createGain() {
      const node = super.createGain();
      const splitter = this.createChannelSplitter(2);
      node.connect(splitter);
      const analysers = [0, 1].map((channel) => {
        const analyser = this.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0; // Observe current mono/stereo output.
        splitter.connect(analyser, channel);
        return analyser;
      });
      window.__audio = { context: this, analysers };
      return node;
    }
  };
});
const probe = () =>
  page.evaluate(() => {
    if (!window.__audio) return { peakHz: 0, rms: 0, state: "absent" };
    const { context, analysers } = window.__audio;
    const channels = analysers.map((analyser, ch) => {
      const values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      let peak = 1;
      for (let i = 2; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
      const rms = Math.sqrt(
        values.reduce((sum, v) => sum + v * v, 0) / values.length,
      );
      const signal = Math.round(
        ((ch === 0 ? 1000 : 2000) / context.sampleRate) * analyser.fftSize,
      );
      const leak = Math.round(
        ((ch === 0 ? 2000 : 1000) / context.sampleRate) * analyser.fftSize,
      );
      return {
        peakHz: (peak * context.sampleRate) / analyser.fftSize,
        rms,
        separationDb: bins[signal] - bins[leak],
      };
    });
    return {
      ...channels[0],
      right: channels[1],
      state: context.state,
    };
  });

try {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Explore the airwaves." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try FM test signal" }).click();
  await expect(
    page.getByRole("button", { name: "Stop test signal" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Synthetic IQ · L 1 kHz / R 2 kHz"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect
    .poll(async () => (await probe()).rms, { timeout: 15000 })
    .toBeGreaterThan(0.15);
  const audio = await probe();
  assert(
    Math.abs(audio.peakHz - 1000) < 15,
    `Expected real 1 kHz audio; got ${JSON.stringify(audio)}`,
  );
  assert.equal(audio.state, "running");
  await expect(
    page.getByText("Stereo · pilot locked", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await probe()).right.peakHz)
    .toBeGreaterThan(1980);
  await expect
    .poll(async () => (await probe()).separationDb)
    .toBeGreaterThan(25);
  await expect
    .poll(async () => (await probe()).right.separationDb)
    .toBeGreaterThan(25);
  const stereoAudio = await probe();
  assert(
    Math.abs(stereoAudio.right.peakHz - 2000) < 15,
    "Right channel must contain the 2 kHz tone",
  );
  await page.getByLabel("Audio mode", { exact: true }).selectOption("mono");
  await expect(page.getByText("Mono · forced", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        const audio = await probe();
        // Mono has identical channel spectra. Its 1/2 kHz levels need not be
        // equal: de-emphasis and FFT-bin placement both favor the lower tone.
        return Math.abs(audio.separationDb + audio.right.separationDb);
      },
      {
        timeout: 10000,
      },
    )
    .toBeLessThan(1);
  await expect
    .poll(
      async () => {
        const audio = await probe();
        return Math.max(
          Math.abs(audio.separationDb),
          Math.abs(audio.right.separationDb),
        );
      },
      { timeout: 10000 },
    )
    .toBeLessThan(8); // Both test tones remain audible in both mono channels.
  await page.getByLabel("Audio mode", { exact: true }).selectOption("auto");
  await expect(
    page.getByText("Stereo · pilot locked", { exact: true }),
  ).toBeVisible();

  const messagesBeforeZoom = await page.evaluate(
    () => window.__messages.filter((m) => m.type === "configure").length,
  );
  await page.getByLabel("DISPLAY SPAN", { exact: true }).selectOption("300000");
  await expect(
    page.getByLabel("CENTER FREQUENCY", { exact: true }),
  ).toHaveValue("100.0000");
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("100.1000");
  const messagesAfterZoom = await page.evaluate(
    () => window.__messages.filter((m) => m.type === "configure").length,
  );
  assert.equal(
    messagesBeforeZoom,
    messagesAfterZoom,
    "Display zoom must not reconfigure tuner or decoder",
  );

  await page.getByLabel("De-emphasis", { exact: true }).selectOption("50");
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.15);
  await page.getByRole("button", { name: "Freeze view" }).click();
  await expect(page.getByRole("button", { name: "Resume view" })).toBeVisible();
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.15);
  await page.getByRole("button", { name: "Resume view" }).click();

  await page
    .getByLabel("DISPLAY SPAN", { exact: true })
    .selectOption("2400000");
  const canvas = page.getByRole("slider", {
    name: "Decoder frequency on spectrum",
  });
  const box = await canvas.boundingBox();
  await canvas.click({
    position: { x: 52 + (box.width - 68) * (0.5 - 650000 / 2400000), y: 150 },
  });
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("99.3500");
  await expect
    .poll(async () => (await probe()).rms, { timeout: 10000 })
    .toBeLessThan(0.01);

  await page.getByLabel("Decoder frequency", { exact: true }).fill("100.1000");
  await page.getByRole("button", { name: "Tune decoder", exact: true }).click();
  await expect
    .poll(async () => (await probe()).rms, { timeout: 10000 })
    .toBeGreaterThan(0.15);

  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("100.2000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("100.3000");
  await page.getByLabel("Decoder frequency", { exact: true }).fill("100.1000");
  await page.getByRole("button", { name: "Tune decoder", exact: true }).click();
  await expect
    .poll(async () => (await probe()).rms, { timeout: 10000 })
    .toBeGreaterThan(0.15);
  let afterRetune = await probe();
  assert(
    Math.abs(afterRetune.peakHz - 1000) < 15,
    "Digital down-conversion must work at negative offsets",
  );
  await expect(
    page.getByText("Stereo · pilot locked", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await probe()).right.separationDb)
    .toBeGreaterThan(25);
  afterRetune = await probe();

  await page.getByLabel("Decoder", { exact: true }).selectOption("none");
  await expect(
    page.getByRole("button", { name: "Play audio", exact: true }),
  ).toBeDisabled();
  await expect.poll(async () => (await probe()).rms).toBeLessThan(0.001);
  await page.getByLabel("Decoder", { exact: true }).selectOption("wfm");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.15);

  await page.getByLabel("Peak hold", { exact: true }).check();
  // A historical waterfall row must fill as new FFTs arrive, not just its first row.
  await expect
    .poll(
      () =>
        canvas.evaluate((c) => {
          const x = Math.round(52 + (c.width - 68) * (0.5 - 100000 / 2400000));
          // Exclude the amber decoder cursor, which extends through empty history.
          const pixels = c
            .getContext("2d")
            .getImageData(x - 12, Math.round(c.height * 0.78), 9, 1).data;
          return Math.max(...Array.from(pixels).filter((_, n) => n % 4 === 0));
        }),
      { timeout: 10000 },
    )
    .toBeGreaterThan(100);
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save spectrum PNG" }).click();
  assert((await downloadPromise).suggestedFilename().endsWith(".png"));
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Horizontal overflow at ${width}px`,
    );
    await page.screenshot({
      path: `artifacts/viewport-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Stop test signal" }).click();
  await expect(
    page.getByRole("button", { name: "Connect RTL-SDR", exact: true }),
  ).toBeEnabled();
  await expect.poll(async () => (await probe()).rms).toBeLessThan(0.001);
  await page.getByRole("button", { name: "Try FM test signal" }).click();
  await expect(
    page.getByRole("button", { name: "Stop test signal" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Stop test signal" }).click();
  assert.deepEqual(errors, [], "No browser or Worker errors");
  const result = {
    source: "generated CU8 FM IQ through actual Worker/WASM/AudioWorklet",
    audio,
    stereoAudio,
    afterRetune,
    checks:
      "Stereo pilot lock; independent L/R tones and separation; forced mono; spectrum zoom independent; digital selection; positive/negative offsets; de-emphasis; freeze; decoder lifecycle; stop/reconnect; PNG export; responsive layouts",
    errors,
  };
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
