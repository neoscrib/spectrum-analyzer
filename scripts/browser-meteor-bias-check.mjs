import assert from "node:assert/strict";
import { mkdir, open, writeFile, readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../src/meteor/settings.ts";
import { createReplayTuning } from "../src/meteor/replay-tuning.ts";
await mkdir("artifacts", { recursive: true });
const tle =
  "METEOR-M2 4\n1 59051U 24039A   26323.63845458  .00000023  00000+0  30271-4 0  9998\n2 59051  98.7252 281.1433 0008139  81.1004 279.1095 14.22443947141360";
const now = new Date(),
  yearStart = Date.UTC(now.getUTCFullYear(), 0, 1),
  days = (now.getTime() - yearStart) / 86400000 + 1;
const epoch = `${String(now.getUTCFullYear()).slice(-2)}${Math.floor(days).toString().padStart(3, "0")}.${Math.floor(
  (days % 1) * 1e8,
)
  .toString()
  .padStart(8, "0")}`;
const lines = tle.split("\n"),
  withoutChecksum = lines[1].slice(0, 18) + epoch + lines[1].slice(32, 68);
lines[1] =
  withoutChecksum +
  ([...withoutChecksum].reduce(
    (n, c) => n + (c === "-" ? 1 : /\d/.test(c) ? Number(c) : 0),
    0,
  ) %
    10);
const currentTle = lines.join("\n");
const settings = { ...DEFAULT_SETTINGS, sampleRate: 2400000, tle: currentTle };
const replay = {
  startSeconds: 0,
  durationSeconds: null,
  frequencyOffsetHz: 0,
  autoBias: false,
  historicalDoppler: true,
  recordingStartUtc: now.toISOString(),
  reacquireSeconds: 1,
  carrierLimitHz: 200,
};
const tuning = createReplayTuning(settings, replay),
  total = settings.sampleRate * 14;
const file = "artifacts/meteor-afc-generated.cu8",
  metadata = "artifacts/meteor-afc-generated.json";
const writer = await open(file, "w");
let phase = 0,
  seed = 123456;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
const symbols = Float32Array.from({ length: 2500000 }, () =>
  random() < 0.5 ? -0.18 : 0.18,
);
try {
  for (let at = 0; at < total; at += 65536) {
    const count = Math.min(65536, total - at),
      iq = new Uint8Array(count * 2);
    const hz = tuning(at).offsetHz - 2607;
    for (let n = 0; n < count; n++) {
      const t = ((at + n) * 72000) / settings.sampleRate,
        si = Math.floor(t) * 2,
        sq = Math.max(0, Math.floor(t - 0.5)) * 2 + 1;
      const i = symbols[si % symbols.length],
        q = symbols[sq % symbols.length],
        c = Math.cos(phase),
        s = Math.sin(phase);
      iq[n * 2] = Math.round((i * c - q * s) * 128 + 127.5);
      iq[n * 2 + 1] = Math.round((i * s + q * c) * 128 + 127.5);
      phase += (2 * Math.PI * hz) / settings.sampleRate;
      if (phase > Math.PI) phase -= 2 * Math.PI;
    }
    await writer.write(iq);
  }
} finally {
  await writer.close();
}
await writeFile(
  metadata,
  JSON.stringify({
    schema: "meteor-replay-v1",
    source: { bytes: total * 2 },
    settings,
    replay,
  }),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
try {
  const context = await browser.newContext({
    serviceWorkers: process.env.CHECK_OFFLINE ? "allow" : "block",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "processed") {
            for (const e of data.events)
              if (e.protocol === "meteor" && e.type === "telemetry") {
                window.__afc = e.status;
                window.__afcHistory ??= [];
                window.__afcHistory.push(e.status.bias);
                window.__afcHistory = window.__afcHistory.slice(-500);
              }
          }
        });
      }
    };
  });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  if (process.env.CHECK_OFFLINE) {
    await page
      .getByRole("button", { name: "Install app", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Offline ready", {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Close app options" }).click();
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
  }
  await page.getByLabel("Decoder", { exact: true }).selectOption("meteor");
  await expect(
    page.getByLabel("Automatically adjust frequency bias", { exact: true }),
  ).toBeChecked();
  await expect(page.getByTestId("meteor-bias-confidence")).toHaveText(
    "Automatic · waiting for Doppler",
  );
  await expect(page.locator(".meteor-bias details")).not.toHaveAttribute(
    "open",
  );
  await page.getByText("Replay recorded I/Q", { exact: true }).click();
  await page
    .getByLabel("Meteor replay metadata", { exact: true })
    .setInputFiles(metadata);
  await expect(
    page.getByLabel("Meteor replay adjustment", { exact: true }),
  ).toHaveValue("0");
  await page
    .getByLabel("Meteor IQ recording", { exact: true })
    .setInputFiles(file);
  // One click from an idle file selection starts measurement and normal replay.
  await page.getByText("Manual bias controls", { exact: true }).click();
  await page
    .getByRole("button", { name: "Estimate frequency bias", exact: true })
    .click();
  await expect(page.getByTestId("meteor-replay-status")).toContainText(
    "Replay complete",
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("button", { name: "Apply estimated bias", exact: true }),
  ).toBeEnabled();
  const measured = await page.evaluate(() => window.__afc.bias);
  assert(Math.abs(measured.hz + 2607) < 15);
  assert.equal(measured.appliedHz, 0);
  assert.equal(measured.automatic, false);
  assert.equal(
    measured.enabled,
    false,
    "One-shot measurement should stop after reaching confidence",
  );
  await page
    .getByRole("button", { name: "Apply estimated bias", exact: true })
    .click();
  assert(
    Math.abs(
      Number(
        await page
          .getByLabel("Meteor replay adjustment", { exact: true })
          .inputValue(),
      ) + 2607,
    ) < 15,
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("spectrum-settings")).meteor
          .frequencyBiasHz,
    ),
    0,
    "Replay application must preserve live manual tuning",
  );
  // Start without the known bias; the automatically controlled path finds it.
  await page.getByLabel("Meteor replay adjustment", { exact: true }).fill("0");
  await page
    .getByLabel("Automatically adjust replay bias", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Replay Meteor IQ", exact: true })
    .click();
  await expect(page.getByTestId("meteor-replay-status")).toContainText(
    "Replaying",
  );
  await expect(page.getByTestId("meteor-replay-status")).toContainText(
    "Replay complete",
    { timeout: 30000 },
  );
  const automatic = await page.evaluate(() => window.__afc.bias);
  assert(automatic.automatic);
  assert(
    automatic.enabled,
    "Continuous measurement must remain active after correction",
  );
  assert(automatic.adjustments > 0);
  assert(Math.abs(automatic.appliedHz + 2607) < 20);
  assert.equal(automatic.configuredHz, 0);
  const automaticHistory = await page.evaluate(() => window.__afcHistory);
  const firstCorrection = automaticHistory.find(
    (b) => b.automatic && b.adjustments > 0,
  );
  assert(firstCorrection);
  assert(
    automatic.windows > firstCorrection.windows,
    "Must keep measuring after the initial correction",
  );
  await expect(page.locator(".meteor-bias details")).not.toHaveAttribute(
    "open",
  );
  await expect(page.getByTestId("meteor-bias-confidence")).toHaveText(
    "Automatic · ready",
  );
  await expect(page.getByTestId("meteor-bias-adjustments")).toHaveText(
    String(automatic.adjustments),
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("spectrum-settings")).meteor.autoBias,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.__afc.frames),
    0,
    "Generated random modulation is not a valid LRPT transport",
  );
  await expect.poll(() => page.workers().length).toBe(0);
  await page
    .locator(".meteor-bias")
    .screenshot({ path: "artifacts/meteor-bias-controls.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page
    .locator(".meteor-bias")
    .screenshot({ path: "artifacts/meteor-bias-mobile.png" });
  // Live/test hot controls retain the capture and decoder workers and freeze in noise.
  await page
    .getByText("Transmission and Doppler settings", { exact: true })
    .click();
  await page
    .getByLabel("Meteor orbital elements", { exact: true })
    .fill(currentTle);
  await page
    .getByLabel("Live orbital Doppler correction", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Apply Meteor settings", exact: true })
    .click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page
    .getByLabel("Automatically adjust frequency bias", { exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Try Meteor noise test signal", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__afc?.bias?.replay))
    .toBe(false);
  await expect.poll(() => page.workers().length).toBe(2);
  const workers = page.workers();
  await page
    .getByRole("button", { name: "Estimate frequency bias", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__afc.bias.windows), {
      timeout: 15000,
    })
    .toBeGreaterThan(2);
  assert.equal(await page.evaluate(() => window.__afc.bias.hz), null);
  assert.equal(await page.evaluate(() => window.__afc.bias.adjustments), 0);
  assert.deepEqual(page.workers(), workers);
  // Switch directly from a running one-shot. Disabling automatic later must
  // not revive the old one-shot or leave the tap doing unnecessary FFT work.
  const beforeAuto = await page.evaluate(() => window.__afc.samples);
  await page
    .getByLabel("Automatically adjust frequency bias", { exact: true })
    .check();
  await expect
    .poll(() => page.evaluate(() => window.__afc.bias.automatic))
    .toBe(true);
  await expect(page.getByTestId("meteor-bias-confidence")).toHaveText(
    "Automatic · acquiring",
  );
  await expect(page.locator(".meteor-bias details")).not.toHaveAttribute(
    "open",
  );
  await expect
    .poll(() => page.evaluate(() => window.__afc.bias.windows), {
      timeout: 15000,
    })
    .toBeGreaterThan(2);
  assert.equal(await page.evaluate(() => window.__afc.bias.adjustments), 0);
  assert.equal(await page.evaluate(() => window.__afc.bias.appliedHz), 0);
  assert((await page.evaluate(() => window.__afc.samples)) > beforeAuto);
  await page
    .getByLabel("Automatically adjust frequency bias", { exact: true })
    .uncheck();
  await expect
    .poll(() => page.evaluate(() => window.__afc.bias.enabled))
    .toBe(false);
  assert.deepEqual(page.workers(), workers);
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  assert.deepEqual(errors, []);
  const result = {
    offline: Boolean(process.env.CHECK_OFFLINE),
    measured,
    automatic,
    continuousAfterCorrection: true,
    automaticFirstControls: true,
    liveHotControls: true,
    noiseRejected: true,
    errors,
  };
  await writeFile(
    "artifacts/meteor-bias-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
