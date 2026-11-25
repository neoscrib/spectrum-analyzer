import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir("artifacts", { recursive: true });
const profile = await mkdtemp(resolve("artifacts/high-rate-profile-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  serviceWorkers: "block",
  viewport: { width: 1400, height: 1000 },
});
const errors = [],
  results = {};
try {
  await context.addInitScript(() => {
    localStorage.setItem(
      "spectrum-settings",
      JSON.stringify({
        decoder: "wfm",
        sampleRate: 2400000,
        center: 600000000,
        channel: 600000000,
        bandwidth: 200000,
        gain: 24,
        ppm: 0,
        span: 2400000,
      }),
    );
    window.__wide = { samples: 0, frames: 0, rate: 0, peaks: [] };
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type !== "processed") return;
          window.__wide.samples += data.samples;
          window.__wide.frames++;
          window.__wide.rate = data.sampleRate;
          if (data.spectrum) {
            const spectrum = data.spectrum,
              half = spectrum.length / 2;
            window.__wide.peaks = [
              [0, half - 1],
              [half + 1, spectrum.length - 1],
            ].map(([lo, hi]) => {
              let peak = lo;
              for (let i = lo + 1; i <= hi; i++)
                if (spectrum[i] > spectrum[peak]) peak = i;
              return {
                hz: (peak / spectrum.length - 0.5) * data.sampleRate,
                db: spectrum[peak],
              };
            });
          }
        });
      }
    };
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return (window.__wideFolder = await root.getDirectoryHandle(
        "wideband-test",
        { create: true },
      ));
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let rate = 2400000,
      sample = 0,
      target = performance.now();
    window.__highCommands = [];
    const pattern = Int8Array.from({ length: 20 }, (_, i) => {
      const n = Math.floor(i / 2),
        p = 2 * Math.PI * 0.3 * n;
      return Math.round(
        i % 2
          ? 50 * Math.sin(p) + 30 * Math.sin(-p)
          : 50 * Math.cos(p) + 30 * Math.cos(-p),
      );
    });
    const device = {
      opened: false,
      configuration: { configurationValue: 1 },
      productName: "HackRF Pro",
      async open() {
        this.opened = true;
      },
      async close() {
        this.opened = false;
      },
      async claimInterface() {},
      async releaseInterface() {},
      async selectConfiguration() {},
      async controlTransferOut(s, data) {
        window.__highCommands.push({
          request: s.request,
          value: s.value,
          index: s.index,
        });
        if (s.request === 6) rate = new DataView(data).getUint32(0, true);
        if (s.request === 1 && s.value === 1) {
          target = performance.now();
          sample = 0;
        }
        return { status: "ok", bytesWritten: data?.byteLength ?? 0 };
      },
      async controlTransferIn(s) {
        return {
          status: "ok",
          data: new DataView(new Uint8Array([s.request === 14 ? 5 : 1]).buffer),
        };
      },
      async transferIn(endpoint, length) {
        target += (length / 2 / rate) * 1000;
        const iq = new Int8Array(length);
        for (let i = 0; i < length; i += 2) {
          const n = sample++ % 10;
          iq[i] = pattern[n * 2];
          iq[i + 1] = pattern[n * 2 + 1];
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, target - performance.now())),
        );
        return { status: "ok", data: new DataView(iq.buffer) };
      },
    };
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: {
        async requestDevice() {
          return device;
        },
      },
    });
  });
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Radio source", { exact: true }).selectOption("hackrf");
  await page
    .getByLabel("Capture sample rate", { exact: true })
    .selectOption("20000000");
  await expect(page.getByLabel("Decoder", { exact: true })).toHaveValue("none");
  await expect(
    page.getByLabel("Decoder", { exact: true }).locator('option[value="wfm"]'),
  ).toBeDisabled();
  await expect(page.getByLabel("DISPLAY SPAN", { exact: true })).toHaveValue(
    "20000000",
  );
  await page
    .getByRole("button", { name: "Connect HackRF", exact: true })
    .click();
  await expect(
    page.getByText("HackRF Pro connected", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__wide.samples), { timeout: 15000 })
    .toBeGreaterThan(20000000);
  const live = await page.evaluate(() => window.__wide);
  assert.equal(live.rate, 20000000);
  assert(Math.abs(live.peaks[0].hz + 6000000) < 5000);
  assert(Math.abs(live.peaks[1].hz - 6000000) < 5000);
  assert(live.peaks.every((p) => p.db > -25));
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page
    .getByLabel("Save destination", { exact: true })
    .selectOption("disk");
  await page
    .getByLabel("Recording duration", { exact: true })
    .selectOption("2");
  await page.getByRole("button", { name: "Record IQ", exact: true }).click();
  await expect(page.getByTestId("iq-recording-status")).toHaveText(
    "Saved to chosen folder",
    { timeout: 20000 },
  );
  await expect(page.getByTestId("iq-recording-size")).toHaveText(
    "2.000 s · 80.0 MB",
  );
  const recorded = await page.evaluate(async () => {
    const files = [];
    for await (const [name, handle] of window.__wideFolder.entries()) {
      const f = await handle.getFile();
      files.push({
        name,
        size: f.size,
        metadata: name.endsWith(".sigmf-meta")
          ? JSON.parse(await f.text())
          : null,
      });
    }
    return files;
  });
  const iq = recorded.find((f) => f.name.endsWith(".cu8")),
    meta = recorded.find((f) => f.metadata).metadata;
  assert.equal(iq.size, 80000000);
  assert.equal(meta.global["core:sample_rate"], 20000000);
  assert.equal(meta.global["spectrum:receiver"].sampleRate, 20000000);
  assert.equal(meta.annotations[0]["core:sample_count"], 40000000);
  assert.match(iq.name, /20000k/);
  await page
    .locator(".spectrum-canvas")
    .screenshot({ path: "artifacts/high-rate-spectrum.png" });
  await page
    .getByRole("button", { name: "Stop receiver", exact: true })
    .click();
  await page.evaluate(async () => {
    for (const [label, suffix] of [
      ["Spectrum IQ recording", ".cu8"],
      ["Spectrum replay metadata", ".sigmf-meta"],
    ]) {
      for await (const [name, handle] of window.__wideFolder.entries())
        if (name.endsWith(suffix)) {
          const transfer = new DataTransfer();
          transfer.items.add(await handle.getFile());
          const field = document.querySelector(`input[aria-label="${label}"]`);
          field.files = transfer.files;
          field.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }
    window.__wide.samples = 0;
  });
  const replayStarted = Date.now();
  await page
    .getByRole("button", { name: "Replay spectrum IQ", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Replay complete" }),
  ).toContainText("2.000 s · 20 MSPS", { timeout: 20000 });
  const replayed = await page.evaluate(() => window.__wide);
  assert(
    Date.now() - replayStarted < 10000,
    "Replay pacing must use 20 MSPS instead of the old 2.4 MSPS clock",
  );
  assert.equal(replayed.samples, 40000000);
  assert.equal(replayed.rate, 20000000);
  assert(Math.abs(replayed.peaks[0].hz + 6000000) < 5000);
  assert(Math.abs(replayed.peaks[1].hz - 6000000) < 5000);
  assert.deepEqual(errors, []);
  results.direct = {
    simulatedHackrfPro: true,
    live,
    recordedBytes: iq.size,
    metadataRate: meta.global["core:sample_rate"],
    replayedSamples: replayed.samples,
    errors,
  };
  await page.close();

  // Real local WebSocket transport, with an explicitly generated bridge source.
  const bp = await context.newPage();
  bp.on("pageerror", (error) => errors.push(error.message));
  await bp.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await bp.getByLabel("Radio source", { exact: true }).selectOption("soapy");
  await bp
    .getByLabel("SDR bridge URL", { exact: true })
    .fill(process.env.BRIDGE_URL || "ws://127.0.0.1:18092");
  await bp
    .getByLabel("Capture sample rate", { exact: true })
    .selectOption("20000000");
  await bp
    .getByRole("button", { name: "Connect SDR bridge", exact: true })
    .click();
  await expect(
    bp.getByText("GENERATED wideband test source connected", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => bp.evaluate(() => window.__wide.samples), { timeout: 15000 })
    .toBeGreaterThan(40000000);
  const bridge = await bp.evaluate(() => window.__wide);
  assert.equal(bridge.rate, 20000000);
  assert(Math.abs(bridge.peaks[0].hz + 6000000) < 5000);
  assert(Math.abs(bridge.peaks[1].hz - 6000000) < 5000);
  await expect(bp.getByRole("alert")).not.toBeVisible();
  await bp.getByRole("button", { name: "Stop receiver", exact: true }).click();
  results.bridge = { generatedIq: true, ...bridge };
  await bp.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      bp.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await bp
    .locator(".receiver-panel")
    .screenshot({ path: "artifacts/high-rate-mobile.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/high-rate-browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(results);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
