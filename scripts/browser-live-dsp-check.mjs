import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { performanceIq } from "./check-dsp-performance.mjs";

// Uses the actual app, USB read queue, capture/decoder workers and AudioWorklet.
// Only the RTL-SDR provider is replaced. Its reads are paced at 2.4 MSPS,
// independently of DSP completion; no USB hardware is opened.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const results = [];
try {
  for (const [kind, noise] of [
    ["wfm", false],
    ["wfm", true],
    ["am", false],
    ["nfm", true],
    ["nfm", false],
  ]) {
    if (
      process.env.LIVE_DSP_DECODERS &&
      !process.env.LIVE_DSP_DECODERS.split(",").includes(kind)
    )
      continue;
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1200, height: 900 },
    });
    let providerIntercepted = false;
    await context.route(
      "**/node_modules/.vite/deps/@jtarrio_webrtlsdr_rtlsdr__js.js*",
      (route) => {
        providerIntercepted = true;
        return route.fulfill({
          contentType: "text/javascript",
          body: "export class RTL2832U_Provider { async get() { return window.__virtualRadio; } }",
        });
      },
    );
    if (process.env.DSP_BASELINE_DIR)
      await context.route(
        /\/src\/wasm\/(dsp_core|wfm|am|nfm)(?:_bg\.wasm|\.js)(?:\?|$)/,
        async (route) => {
          const file = new URL(route.request().url()).pathname.split("/").pop();
          const isJs = file.split("?")[0].endsWith(".js");
          let body = await readFile(
            resolve(process.env.DSP_BASELINE_DIR, file.split("?")[0]),
          );
          if (isJs && file.startsWith("dsp_core")) {
            // Older baselines expose the original single-stage channelizer.
            // Adapt only the new factory entry point, using that old filter.
            body = Buffer.concat([
              body,
              Buffer.from(`
              if (!Channelizer.wfm) Channelizer.wfm = (offset, bandwidth) =>
                new Channelizer(offset, Math.max(65000,
                  Math.min(220000, Math.max(150000, bandwidth)) / 2 - 5000), 401, 10);
            `),
            ]);
          }
          await route.fulfill({
            contentType: isJs ? "text/javascript" : "application/wasm",
            body,
          });
        },
      );
    await context.addInitScript(
      ({ encoded, kind, sameEnabled }) => {
        localStorage.setItem("spectrum-show-rf-plots", "false");
        const center =
          kind === "wfm" ? 100000000 : kind === "am" ? 120000000 : 462400000;
        localStorage.setItem(
          "spectrum-settings",
          JSON.stringify({
            decoder: kind,
            center,
            channel: center + 187500,
            bandwidth: kind === "wfm" ? 200000 : kind === "am" ? 10000 : 12500,
            squelch: null,
            same: { enabled: sameEnabled, attention: true },
          }),
        );
        const iq = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        let deadline;
        const noop = async () => {};
        window.__virtualRadio = {
          setSampleRate: async (r) => r,
          setFrequencyCorrection: noop,
          setCenterFrequency: noop,
          setGain: noop,
          enableBiasTee: noop,
          resetBuffer: noop,
          close: noop,
          readSamples: () => {
            deadline = (deadline ?? performance.now()) + 65536 / 2400;
            return new Promise((resolve) =>
              setTimeout(
                () => resolve({ data: iq.slice().buffer }),
                Math.max(0, deadline - performance.now()),
              ),
            );
          },
        };
        window.__live = {
          frames: 0,
          samples: 0,
          maximumBacklog: 0,
          cpu: [],
          errors: [],
          audioBlocks: 0,
        };
        const Native = window.Worker;
        window.Worker = class extends Native {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", ({ data }) => {
              if (data.type !== "processed") return;
              window.__live.frames++;
              window.__live.samples += data.samples;
              window.__live.cpu.push(
                (data.elapsed / (data.samples / 2400)) * 100,
              );
              window.__live.audioBlocks += data.events.filter(
                (e) => e.type === "audio" && e.samples.length,
              ).length;
            });
          }
        };
        const Audio = window.AudioContext;
        window.AudioContext = class extends Audio {
          createGain() {
            const gain = super.createGain(),
              analyser = this.createAnalyser();
            analyser.fftSize = 4096;
            gain.connect(analyser);
            window.__analyser = analyser;
            return gain;
          }
        };
      },
      {
        encoded: Buffer.from(performanceIq(kind, noise)).toString("base64"),
        kind,
        sameEnabled: process.env.SAME_ENABLED === "1",
      },
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
    assert(
      providerIntercepted,
      "Live DSP checks require the Vite development server so the USB provider can be replaced safely.",
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: Number(process.env.CPU_THROTTLE || 4),
    });
    await page
      .getByRole("button", { name: "Connect RTL-SDR", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Play audio", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Play audio", exact: true }).click();
    const duration = Number(process.env.LIVE_DSP_SECONDS || 12);
    const start = Date.now();
    while (Date.now() - start < duration * 1000) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const alerts = await page.getByRole("alert").allTextContents();
      if (alerts.some((t) => /could not keep up|error|failed/i.test(t))) {
        const diagnostic = await page.evaluate(() => ({
          frames: window.__live.frames,
          rfSeconds: window.__live.samples / 2400000,
          meanCpuPercent:
            window.__live.cpu.reduce((s, v) => s + v, 0) /
            window.__live.cpu.length,
          peakCpuPercent: Math.max(...window.__live.cpu),
          maximumBacklog: window.__live.maximumBacklog,
        }));
        throw Error(
          `${kind} (${noise ? "static" : "tone"}): ${alerts.join("; ")} ${JSON.stringify(diagnostic)}`,
        );
      }
      const backlog = Number.parseInt(
        await page
          .getByText("Worker backlog", { exact: true })
          .locator("..")
          .locator("strong")
          .innerText(),
      );
      await page.evaluate((value) => {
        window.__live.maximumBacklog = Math.max(
          window.__live.maximumBacklog,
          value,
        );
      }, backlog);
    }
    const metrics = await page.evaluate(() => {
      const a = window.__analyser,
        x = new Float32Array(a?.fftSize ?? 128);
      a?.getFloatTimeDomainData(x);
      return {
        ...window.__live,
        audioRms: Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length),
      };
    });
    const measurement = {
      kind,
      noise,
      sameEnabled: process.env.SAME_ENABLED === "1",
      cpuThrottle: Number(process.env.CPU_THROTTLE || 4),
      wallSeconds: (Date.now() - start) / 1000,
      rfSeconds: metrics.samples / 2400000,
      maximumBacklog: metrics.maximumBacklog,
      meanCpuPercent:
        metrics.cpu.reduce((s, v) => s + v, 0) / metrics.cpu.length,
      audioRms: metrics.audioRms,
      errors,
    };
    console.log("Continuously paced live DSP:", measurement);
    assert(
      metrics.samples / 2400000 > duration - 2,
      `${kind}: continuously paced input fell behind (${metrics.samples / 2400000} RF seconds in ${duration} seconds)`,
    );
    assert(metrics.audioBlocks > 100, `${kind}: no continuing decoded audio`);
    assert(
      metrics.audioRms > 0.00001,
      `${kind}: audio did not reach the worklet`,
    );
    assert.deepEqual(errors, []);
    results.push(measurement);
    await page
      .getByRole("button", { name: "Stop receiver", exact: true })
      .click();
    await context.close();
  }
  assert(results.length > 0, "No matching LIVE_DSP_DECODERS");
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/live-dsp-results.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await browser.close();
}
