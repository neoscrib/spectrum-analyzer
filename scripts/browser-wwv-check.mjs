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
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        for (const event of data.events ?? [])
          if (event.type === "timecode") window.__wwv = event.status;
      });
    }
  };
  const NativeAudio = window.AudioContext;
  window.AudioContext = class extends NativeAudio {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      analyser.fftSize = 8192;
      gain.connect(analyser);
      window.__wwvAudio = analyser;
      return gain;
    }
  };
});
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("wwv");
  await expect(
    page.getByLabel("CENTER FREQUENCY", { exact: true }),
  ).toHaveValue("25.0500");
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("25.0000");
  await expect(page.getByLabel("Channel width", { exact: true })).toHaveValue(
    "10000",
  );
  await expect(
    page.getByRole("button", { name: "5 MHz", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "25 MHz", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Try WWV test signal" }).click();
  await expect(
    page.getByRole("button", { name: "Play audio", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Time code confirmed", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const status = await page.evaluate(() => window.__wwv);
  assert.equal(status.confirmed, true);
  assert(status.validFrames >= 2);
  assert.equal(status.rejectedFrames, 0);
  assert.equal(status.frame.year, 2026);
  assert.equal(status.frame.dayOfYear, 324);
  assert.equal(status.frame.hour, 12);
  assert(Math.abs(status.frame.dut1 - 0.3) < 0.001);
  assert(status.frame.minute >= 35);
  await expect(page.getByTestId("wwv-time")).toContainText("2026-11-20 12:");
  await page.screenshot({ path: "artifacts/wwv-desktop.png", fullPage: true });
  await page.getByLabel("WWV test speed", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (!window.__wwvAudio) return 0;
        const x = new Float32Array(8192);
        window.__wwvAudio.getFloatTimeDomainData(x);
        return Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
      }),
    )
    .toBeGreaterThan(0.015);
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `WWV layout overflow at ${width}`,
    );
    await page.screenshot({
      path: `artifacts/wwv-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Stop test signal" }).click();
  await expect(
    page.getByText("Waiting for receiver", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Generated test transmission · fixed/),
  ).toBeVisible();
  await page.getByLabel("Decoder", { exact: true }).selectOption("wfm");
  await expect(page.getByLabel("Channel width", { exact: true })).toHaveValue(
    "200000",
  );
  await page.getByRole("button", { name: "Try FM test signal" }).click();
  await expect(
    page.getByText("Synthetic IQ · L 1 kHz / R 2 kHz", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Stereo · pilot locked", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Stop test signal" }).click();
  assert.deepEqual(errors, []);
  const result = {
    source: "Generated CU8 AM IQ through actual worker/WASM WWV decoder",
    status,
    checks:
      "Two consecutive valid frames; expected date/time/flags; AM audio; accelerated muted test; compatible presets; responsive layouts; WFM switch regression",
    errors,
  };
  await writeFile(
    "artifacts/wwv-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
