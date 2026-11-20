import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const NativeAudio = window.AudioContext;
  window.AudioContext = class extends NativeAudio {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      analyser.fftSize = 8192;
      // Measure the current station, without retaining the previous channel's FFT.
      analyser.smoothingTimeConstant = 0;
      gain.connect(analyser);
      window.__amAudio = { context: this, analyser };
      return gain;
    }
  };
});
const probe = () =>
  page.evaluate(() => {
    if (!window.__amAudio) return { rms: 0, peakHz: 0 };
    const { context, analyser } = window.__amAudio;
    const time = new Float32Array(analyser.fftSize),
      bins = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(time);
    analyser.getFloatFrequencyData(bins);
    let peak = 1;
    for (let i = 2; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
    const one = Math.round((1000 / context.sampleRate) * analyser.fftSize),
      three = Math.round((3000 / context.sampleRate) * analyser.fftSize);
    return {
      rms: Math.sqrt(time.reduce((s, v) => s + v * v, 0) / time.length),
      peakHz: (peak * context.sampleRate) / analyser.fftSize,
      rejectionDb: bins[one] - bins[three],
    };
  });
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("126.0000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await page.getByLabel("Decoder", { exact: true }).selectOption("am");
  await expect(
    page.getByLabel("CENTER FREQUENCY", { exact: true }),
  ).toHaveValue("126.0000");
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("126.1000");
  await expect(page.getByLabel("Channel width", { exact: true })).toHaveValue(
    "10000",
  );
  await expect(page.getByLabel("Audio mode", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("WWV digital time code", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Try AM test signal", exact: true })
    .click();
  await expect(page.getByLabel("Decoder", { exact: true })).toHaveValue("am");
  await expect(
    page.getByText("Synthetic AM IQ · 1 kHz tone + adjacent station", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Mono · AM envelope", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect
    .poll(async () => (await probe()).rms, { timeout: 10000 })
    .toBeGreaterThan(0.09);
  await expect
    .poll(async () => (await probe()).rejectionDb)
    .toBeGreaterThan(30);
  await expect
    .poll(async () => Math.abs((await probe()).peakHz - 1000))
    .toBeLessThan(15);
  const first = await probe();
  assert(Math.abs(first.peakHz - 1000) < 15);
  await page.getByLabel("Channel width", { exact: true }).selectOption("6000");
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.09);
  await page.getByLabel("Channel width", { exact: true }).selectOption("16000");
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.09);
  await page.getByLabel("Decoder frequency", { exact: true }).fill("120.1400");
  await page.getByRole("button", { name: "Tune decoder", exact: true }).click();
  await expect.poll(async () => (await probe()).peakHz).toBeGreaterThan(2980);
  await expect.poll(async () => (await probe()).rejectionDb).toBeLessThan(-30);
  const adjacent = await probe();
  assert(Math.abs(adjacent.peakHz - 3000) < 15);
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("120.2000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await page.getByLabel("Decoder frequency", { exact: true }).fill("120.1000");
  await page.getByRole("button", { name: "Tune decoder", exact: true }).click();
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.09);
  await expect
    .poll(async () => Math.abs((await probe()).peakHz - 1000))
    .toBeLessThan(15);
  await expect
    .poll(async () => (await probe()).rejectionDb)
    .toBeGreaterThan(30);
  const afterRetune = await probe();
  await page.getByLabel("Audio volume", { exact: true }).fill("0");
  await expect.poll(async () => (await probe()).rms).toBeLessThan(0.001);
  await page.getByLabel("Audio volume", { exact: true }).fill("50");
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.09);
  await page.screenshot({ path: "artifacts/am-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "artifacts/am-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Pause audio", exact: true }).click();
  await expect.poll(async () => (await probe()).rms).toBeLessThan(0.001);
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect.poll(async () => (await probe()).rms).toBeGreaterThan(0.09);
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect.poll(async () => (await probe()).rms).toBeLessThan(0.001);
  assert.deepEqual(errors, []);
  const result = {
    source: "Actual CU8 AM IQ -> WASM envelope decoder -> AudioWorklet",
    first,
    adjacent,
    afterRetune,
    checks:
      "Preserved live tuning; selectable bandwidths; neighboring station selection/rejection; positive/negative offsets; volume; pause/resume; stop; responsive layout",
    errors,
  };
  await writeFile(
    "artifacts/am-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
