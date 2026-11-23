import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      gain.connect(analyser);
      window.__nfmAudio = { analyser, context: this };
      return gain;
    }
  };
  const Original = window.Worker;
  window.__nfm = { status: null, activity: [], audioStreams: 0 };
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data.type !== "processed") return;
        window.__nfm.audioStreams = Math.max(
          window.__nfm.audioStreams,
          data.events.filter((e) => e.type === "audio").length,
        );
        for (const event of data.events) {
          if (event.type === "telemetry" && event.protocol === "nfm")
            window.__nfm.status = event.status;
          if (event.type === "activity" && event.protocol === "nfm")
            window.__nfm.activity.push(event.event);
        }
      });
    }
  };
});
const probe = () =>
  page.evaluate(() => {
    const a = window.__nfmAudio;
    if (!a) return { rms: 0, peakHz: 0, codeSuppressionDb: 0 };
    const x = new Float32Array(a.analyser.fftSize),
      bins = new Float32Array(a.analyser.frequencyBinCount);
    a.analyser.getFloatTimeDomainData(x);
    a.analyser.getFloatFrequencyData(bins);
    let peak = 1;
    for (let i = 2; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
    const at = (hz) =>
      Math.round((hz / a.context.sampleRate) * a.analyser.fftSize);
    return {
      rms: Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length),
      peakHz: (peak * a.context.sampleRate) / a.analyser.fftSize,
      codeSuppressionDb: bins[at(1000)] - bins[at(100)],
    };
  });
const row = (name) =>
  page
    .locator(".preset-table tbody tr")
    .filter({ has: page.getByText(name, { exact: true }) });
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("nfm");
  await expect(page.locator(".preset-table tbody tr")).toHaveCount(22);
  await row("Channel 1")
    .getByRole("button", { name: "Tune Channel 1", exact: true })
    .click();
  await expect(page.getByLabel("Decoder", { exact: true })).toHaveValue("nfm");
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("462.5625");
  await expect(page.getByLabel("Channel width", { exact: true })).toHaveValue(
    "12500",
  );
  await page
    .getByRole("button", { name: "Try NFM test signal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Monitor / scan bank", exact: true })
    .click();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(page.getByTestId("preset-monitor-status")).toContainText(
    "15 parallel receivers",
  );
  await expect(page.getByTestId("nfm-code")).toContainText("100.0 Hz", {
    timeout: 12000,
  });
  await expect(
    page.getByLabel("Selected audio frequency", { exact: true }),
  ).toHaveValue("462.5625");
  await expect
    .poll(async () => (await probe()).peakHz, { timeout: 10000 })
    .toBeGreaterThan(980);
  const first = await probe();
  assert(Math.abs(first.peakHz - 1000) < 20);
  assert(first.rms > 0.01);
  assert(
    first.codeSuppressionDb > 25,
    `Subaudible tone leaked: ${first.codeSuppressionDb} dB`,
  );
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.__nfm.status?.channels.some(
            (c) =>
              c.id === "frs-2" &&
              c.dcs.some((d) => d.code === "023" && !d.inverted),
          ),
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect
    .poll(async () => (await probe()).peakHz, { timeout: 10000 })
    .toBeGreaterThan(1480);
  const second = await probe();
  assert(Math.abs(second.peakHz - 1500) < 20);
  await expect(page.getByTestId("preset-monitor-status")).toContainText(
    "window 2 / 2",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("nfm-code")).toContainText("88.5 Hz", {
    timeout: 10000,
  });
  const third = await probe();
  assert(Math.abs(third.peakHz - 2000) < 20);
  await page.getByRole("button", { name: "Hold channel", exact: true }).click();
  await expect(page.getByTestId("preset-monitor-status")).toContainText(
    "Holding channel",
  );
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.__nfm.status?.channels.some((c) => c.carrier),
        ),
      { timeout: 10000 },
    )
    .toBe(false);
  await expect(page.getByTestId("preset-monitor-status")).toContainText(
    "window 2 / 2",
  );
  await expect.poll(async () => (await probe()).rms).toBeLessThan(0.00001);
  await page.getByRole("button", { name: "Resume scan", exact: true }).click();
  await expect(page.getByTestId("preset-monitor-status")).toContainText(
    "window 1 / 2",
    { timeout: 10000 },
  );
  await page
    .getByRole("button", { name: "Stop monitoring", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.__nfm.audioStreams),
    1,
    "Mixed unrelated audio streams",
  );
  const activity = await page.evaluate(() => window.__nfm.activity);
  for (const id of ["frs-1", "frs-2", "frs-8"])
    assert(
      activity.some((e) => e.id === id && e.open),
      `Missing activity ${id}`,
    );
  assert(
    !activity.some(
      (e) => e.open && !["frs-1", "frs-2", "frs-8"].includes(e.id),
    ),
    `Spurious carrier activity: ${JSON.stringify(activity.filter((e) => e.open))}`,
  );
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export activity CSV" }).click();
  await (await csvPromise).saveAs("artifacts/nfm-activity.csv");
  const csv = await readFile("artifacts/nfm-activity.csv", "utf8");
  assert(csv.includes("generated test"));
  assert(csv.includes("023N"));
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("spectrum-activity-v1") ?? "[]"),
    ),
    [],
    "Test history persisted as RF activity",
  );
  await page.getByLabel("New bank name").fill("Local handhelds");
  await page.getByRole("button", { name: "Create bank", exact: true }).click();
  await page
    .getByRole("button", { name: "Save frequency", exact: true })
    .click();
  await page.getByLabel("Preset name", { exact: true }).fill("Handheld A");
  await page
    .getByLabel("Preset frequency MHz", { exact: true })
    .fill("462.5625");
  await page
    .getByLabel("Preset filter width", { exact: true })
    .selectOption("25000");
  await page
    .getByLabel("Preset FM deviation", { exact: true })
    .selectOption("5000");
  await page.getByLabel("Preset squelch", { exact: true }).selectOption("-55");
  await page
    .getByLabel("Preset code filter", { exact: true })
    .selectOption("ctcss:162.2");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await expect(row("Handheld A")).toContainText("25 kHz");
  const jsonPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export banks", exact: true }).click();
  await (await jsonPromise).saveAs("artifacts/nfm-presets.json");
  const library = JSON.parse(
    await readFile("artifacts/nfm-presets.json", "utf8"),
  );
  const custom = library.banks.find((b) => b.name === "Local handhelds");
  assert(custom);
  assert.equal(custom.presets[0].frequency, 462562500);
  assert.equal(custom.presets[0].squelch, -55);
  assert.deepEqual(custom.presets[0].tone, { type: "ctcss", hz: 162.2 });
  await page.reload();
  await page
    .getByLabel("Radio service / bank", { exact: true })
    .selectOption(custom.id);
  await expect(row("Handheld A")).toContainText("162.2 Hz filter");
  await page.getByLabel("Import preset banks", { exact: true }).setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99,"banks":[]}'),
  });
  await expect(page.getByRole("alert")).toContainText("version 1");
  await page
    .getByLabel("Import preset banks", { exact: true })
    .setInputFiles("artifacts/nfm-presets.json");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByLabel("Radio service / bank", { exact: true })
    .selectOption("frs-gmrs");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1120 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `artifacts/nfm-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  const results = { first, second, third, activity, errors };
  await writeFile(
    "artifacts/nfm-browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log("NFM browser passed:", results);
} finally {
  await browser.close();
}
