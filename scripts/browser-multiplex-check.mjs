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
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.__multiplexFrames = [];
  window.__pcmFrames = [];
  window.__commands = [];
  window.__clears = 0;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data.type !== "processed") return;
        for (const event of data.events) {
          if (event.type === "spectrum") {
            window.__multiplexFrames.push(event.multiplex);
            if (window.__multiplexFrames.length > 100)
              window.__multiplexFrames.shift();
          }
          if (event.type === "audio") {
            window.__pcmFrames.push({
              firstSample: event.firstSample,
              count: data.samples,
              revision: data.revision,
            });
          }
        }
      });
    }
    postMessage(message, ...transfer) {
      if (message.type !== "test" && message.type !== "iq")
        window.__commands.push(message.type);
      super.postMessage(message, ...transfer);
    }
  };
  const NativeNode = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends NativeNode {
    constructor(...args) {
      super(...args);
      const send = this.port.postMessage.bind(this.port);
      this.port.postMessage = (data, ...transfer) => {
        if (data === "clear") window.__clears++;
        send(data, ...transfer);
      };
    }
  };
  const NativeAudio = window.AudioContext;
  window.AudioContext = class extends NativeAudio {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(analyser);
      window.__audio = { context: this, analyser };
      return gain;
    }
  };
});

const pcmCount = () => page.evaluate(() => window.__pcmFrames.length);
async function waitPcm(count) {
  const before = await pcmCount();
  await expect.poll(pcmCount).toBeGreaterThanOrEqual(before + count);
}
async function verifyPeaks() {
  const frame = await page.evaluate(() => {
    const frame = window.__multiplexFrames.at(-1);
    return frame && { ...frame, bins: Array.from(frame.bins) };
  });
  assert(frame, "Expected a real multiplex spectrum from the WFM worker");
  assert.equal(frame.sampleRate, 240000);
  assert.equal(frame.fftSize, 4096);
  const peaks = [19000, 55800, 58200].map((expected) => {
    const center = (expected * frame.fftSize) / frame.sampleRate;
    let best = Math.round(center);
    for (let bin = Math.floor(center) - 6; bin <= Math.ceil(center) + 6; bin++)
      if (frame.bins[bin] > frame.bins[best]) best = bin;
    const hz = (best * frame.sampleRate) / frame.fftSize;
    assert(
      Math.abs(hz - expected) < frame.sampleRate / frame.fftSize,
      `Wrong peak for ${expected} Hz: ${hz}`,
    );
    assert(frame.bins[best] > (expected === 19000 ? -25 : -45));
    return { expected, hz, db: frame.bins[best] };
  });
  return {
    sampleRate: frame.sampleRate,
    fftSize: frame.fftSize,
    averages: frame.averages,
    peaks,
  };
}

try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  if (process.env.CHECK_OFFLINE === "1") {
    await page
      .getByRole("button", { name: "Install app", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "Offline app availability" }),
    ).toContainText("Offline ready", { timeout: 30000 });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await page.getByRole("button", { name: "Close app options" }).click();
    await page.context().setOffline(true);
    await page.reload();
  }
  const toggle = page.getByRole("button", {
    name: "Multiplex spectrum",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("region", { name: "FM multiplex spectrum" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Try FM test signal", exact: true })
    .click();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const data = new Float32Array(1024);
        window.__audio?.analyser.getFloatTimeDomainData(data);
        return Math.sqrt(
          data.reduce((sum, value) => sum + value * value, 0) / data.length,
        );
      }),
    )
    .toBeGreaterThan(0.1);
  await waitPcm(10);
  assert.equal(
    await page.evaluate(() => window.__multiplexFrames.length),
    0,
    "Closed view must not publish spectra",
  );
  const gain = await page.getByTestId("applied-rf-settings").textContent();
  const initialClears = await page.evaluate(() => window.__clears);
  const boundary = await pcmCount();
  await page.evaluate(() => {
    window.__rms = [];
    window.__gaps = [];
    window.__stage = "baseline";
    window.__audioMonitor = setInterval(() => {
      const data = new Float32Array(1024);
      window.__audio.analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(
        data.reduce((sum, value) => sum + value * value, 0) / data.length,
      );
      window.__rms.push(rms);
      if (rms < 0.035)
        window.__gaps.push({
          stage: window.__stage,
          rms,
          time: performance.now(),
        });
    }, 10);
  });
  await waitPcm(30);
  await page.evaluate(() => {
    window.__stage = "opening";
  });
  await toggle.click();
  const view = page.getByRole("region", { name: "FM multiplex spectrum" });
  await expect(view).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__multiplexFrames.length))
    .toBeGreaterThan(5);
  const stereo = await verifyPeaks();
  await page.getByLabel("Multiplex dB range").selectOption("60");
  const top = page.getByLabel("Multiplex top level");
  await top.press("End");
  for (let i = 0; i < 4; i++) await top.press("ArrowLeft");
  await expect(view.getByRole("status")).toHaveText("-80 to -20 dB");
  assert.equal(
    await page.getByTestId("applied-rf-settings").textContent(),
    gain,
  );
  await page.evaluate(() => {
    window.__stage = "mono";
  });
  const beforeMono = await page.evaluate(
    () => window.__multiplexFrames.at(-1).averages,
  );
  await page.getByLabel("Audio mode", { exact: true }).selectOption("mono");
  await expect(page.getByText("Mono · forced", { exact: true })).toBeVisible();
  await waitPcm(16);
  const mono = await verifyPeaks();
  assert(
    mono.averages > beforeMono,
    "Forcing mono must not restart multiplex averaging",
  );
  await page.evaluate(() => {
    window.__stage = "closing";
  });
  await toggle.click();
  await expect(view).toHaveCount(0);
  await waitPcm(4); // Allow the one already in-flight block to finish.
  const closedCount = await page.evaluate(
    () => window.__multiplexFrames.length,
  );
  await waitPcm(12);
  assert.equal(
    await page.evaluate(() => window.__multiplexFrames.length),
    closedCount,
  );
  await page.evaluate(() => {
    window.__stage = "reopening";
  });
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => window.__multiplexFrames.length))
    .toBeGreaterThan(closedCount);
  await verifyPeaks();
  await page.getByLabel("Audio mode", { exact: true }).selectOption("auto");
  await waitPcm(12);

  const continuity = await page.evaluate((start) => {
    clearInterval(window.__audioMonitor);
    const frames = window.__pcmFrames.slice(start);
    return {
      frames: frames.length,
      contiguous: frames.every(
        (frame, i) =>
          !i ||
          frame.firstSample === frames[i - 1].firstSample + frames[i - 1].count,
      ),
      revisions: Array.from(new Set(frames.map((frame) => frame.revision))),
      minRms: Math.min(...window.__rms),
      gaps: Object.fromEntries(
        ["baseline", "opening", "mono", "closing", "reopening"].map((stage) => [
          stage,
          window.__gaps.filter((gap) => gap.stage === stage).length,
        ]),
      ),
      sampleRate: window.__audio.context.sampleRate,
      audioState: window.__audio.context.state,
      clears: window.__clears,
      configureCommands: window.__commands.filter(
        (type) => type === "configure",
      ).length,
      initCommands: window.__commands.filter((type) => type === "init").length,
    };
  }, boundary);
  assert(
    continuity.contiguous,
    "View changes must preserve the input sample clock",
  );
  assert.equal(continuity.revisions.length, 1);
  assert.equal(continuity.clears, initialClears);
  assert.equal(continuity.configureCommands, 0);
  assert.equal(continuity.initCommands, 1);
  assert.equal(continuity.audioState, "running");
  assert(
    continuity.minRms > 0.035,
    `Playback went silent: ${continuity.minRms}`,
  );
  await view.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/multiplex-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await view.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/multiplex-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  // Keep the view open across source shutdown/startup: init must carry the flag.
  const beforeRestart = await page.evaluate(
    () => window.__multiplexFrames.length,
  );
  await page
    .getByRole("button", { name: "Try FM test signal", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__multiplexFrames.length))
    .toBeGreaterThan(beforeRestart);
  await verifyPeaks();
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  assert.deepEqual(errors, []);
  const result = {
    stereo,
    mono,
    continuity,
    offline: process.env.CHECK_OFFLINE === "1",
    errors,
  };
  await writeFile(
    "artifacts/multiplex-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
