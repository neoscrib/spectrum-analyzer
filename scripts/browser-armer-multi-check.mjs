import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { receiverModule } from "./wasm-receivers.mjs";

const { ArmerTestSource } = await receiverModule("armer");
const source = new ArmerTestSource();
assert(source.set_voice_count(4));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
try {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1440, height: 1120 },
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("__nextArmerIq", (center) =>
    Buffer.from(source.process(center, 65536)).toString("base64"),
  );
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) {
        // The asynchronous Node RF fixture must preserve the same send order as
        // real synchronous Worker.postMessage, including revision/policy changes.
        this.sends ??= Promise.resolve();
        this.sends = this.sends.then(async () => {
          if (message.settings) this.center = message.settings.center;
          if (message.type === "test") {
            const encoded = await window.__nextArmerIq(this.center);
            const data = Uint8Array.from(atob(encoded), (c) =>
              c.charCodeAt(0),
            ).buffer;
            super.postMessage(
              { type: "iq", data, revision: message.revision },
              [data],
            );
          } else super.postMessage(message, ...rest);
        });
      }
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type !== "processed") return;
          window.__cpu ??= [];
          window.__cpu.push((data.elapsed / (data.samples / 2400)) * 100);
          for (const event of data.events)
            if (event.protocol === "armer" && event.type === "telemetry")
              window.__armerStatus = event.status;
        });
      }
    };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      createGain() {
        const gain = super.createGain(),
          split = this.createChannelSplitter(2),
          sink = super.createGain();
        sink.gain.value = 0;
        sink.connect(this.destination);
        gain.connect(split);
        window.__analyzers = [0, 1].map((channel) => {
          const a = this.createAnalyser();
          a.fftSize = 4096;
          split.connect(a, channel);
          a.connect(sink);
          return a;
        });
        return gain;
      }
    };
  });
  const rms = (channel) =>
    page.evaluate((channel) => {
      const a = window.__analyzers?.[channel];
      if (!a) return 0;
      const x = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(x);
      return Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
    }, channel);
  const streamId = (tg) =>
    page.evaluate(
      (tg) =>
        window.__armerStatus.audioStreams.find((s) => s.talkgroup === tg)?.id,
      tg,
    );
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("armer");
  await expect(page.getByLabel("Simultaneous voice channels")).toHaveValue("4");
  await page
    .getByRole("button", { name: "Try ARMER test signal", exact: true })
    .click();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  const now = page.getByRole("region", { name: "Now Playing", exact: true });
  await expect(now.locator('[data-state="playing"]')).toHaveCount(4, {
    timeout: 20000,
  });
  await expect(page.getByTestId("armer-control-row")).toBeVisible();
  const initial = [await streamId(6620), await streamId(6640)];
  for (const tg of [6660, 6680])
    await now
      .getByRole("button", {
        name: `Mute audio for talkgroup ${tg}`,
        exact: true,
      })
      .click();
  await now
    .getByLabel("Pan for talkgroup 6620", { exact: true })
    .selectOption("-1");
  await now
    .getByLabel("Pan for talkgroup 6640", { exact: true })
    .selectOption("1");
  await expect.poll(() => rms(0)).toBeGreaterThan(0.00001);
  await expect.poll(() => rms(1)).toBeGreaterThan(0.00001);
  await now
    .getByRole("button", { name: "Mute audio for talkgroup 6620", exact: true })
    .click();
  await expect.poll(() => rms(0)).toBeLessThan(0.000001);
  await expect.poll(() => rms(1)).toBeGreaterThan(0.00001);
  await now
    .getByRole("button", { name: "Solo talkgroup 6620", exact: true })
    .click();
  await expect.poll(() => rms(0)).toBeGreaterThan(0.00001);
  await expect.poll(() => rms(1)).toBeLessThan(0.000001);
  await now
    .getByRole("button", { name: "Clear solo · TG 6620", exact: true })
    .click();
  await expect.poll(() => rms(1)).toBeGreaterThan(0.00001);
  await now.getByLabel("Volume for talkgroup 6620", { exact: true }).focus();
  await now
    .getByLabel("Volume for talkgroup 6620", { exact: true })
    .press("Home");
  await expect.poll(() => rms(0)).toBeLessThan(0.000001);
  await now
    .getByLabel("Volume for talkgroup 6620", { exact: true })
    .press("End");
  await expect.poll(() => rms(0)).toBeGreaterThan(0.00001);
  assert.deepEqual(
    [await streamId(6620), await streamId(6640)],
    initial,
    "Mix controls must never restart voice decoding",
  );
  await page.getByLabel("Listen to 6640", { exact: true }).uncheck();
  await expect.poll(() => rms(1)).toBeLessThan(0.000001);
  await expect.poll(() => rms(0)).toBeGreaterThan(0.00001);
  assert.equal(
    await streamId(6620),
    initial[0],
    "Listen policy must preserve other calls",
  );
  await page.getByLabel("Simultaneous voice channels").selectOption("1");
  await expect
    .poll(() => page.evaluate(() => window.__armerStatus.channels))
    .toBe(1);
  await page.getByLabel("Listen to 6640", { exact: true }).check();
  await page.getByLabel("Simultaneous voice channels").selectOption("4");
  await now.getByRole("button", { name: "Reset mix", exact: true }).click();
  await expect(now.locator('[data-state="playing"]')).toHaveCount(4);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1120 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await mkdir("artifacts", { recursive: true });
    await now.screenshot({ path: `artifacts/armer-multi-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.getByLabel("Simultaneous voice channels").selectOption("2");
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect(now).toContainText("Receiver stopped.");
  await expect.poll(() => rms(0)).toBeLessThan(0.000001);
  const cpu = await page.evaluate(() => window.__cpu);
  const sorted = cpu.slice().sort((a, b) => a - b);
  await page.reload();
  await expect(page.getByLabel("Simultaneous voice channels")).toHaveValue("2");
  assert.deepEqual(errors, []);
  const result = {
    frames: cpu.length,
    meanCpuPercent: cpu.reduce((a, b) => a + b, 0) / cpu.length,
    p95CpuPercent: sorted[Math.floor(sorted.length * 0.95)],
    errors,
  };
  await writeFile(
    "artifacts/armer-multi-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log("ARMER simultaneous browser audio passed", result);
} finally {
  source.free();
  await browser.close();
}
