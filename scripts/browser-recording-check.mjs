import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import init, { OokDecoder } from "../src/wasm/spectrum_dsp.js";
import { interpretBurst, burstHex, ookDefaults } from "../src/ook/model.ts";
await mkdir("artifacts", { recursive: true });
await init({
  module_or_path: await readFile(
    new URL("../src/wasm/spectrum_dsp_bg.wasm", import.meta.url),
  ),
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const NativeAudio = window.AudioContext;
  window.AudioContext = class extends NativeAudio {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      gain.connect(analyser);
      window.__iqAudio = analyser;
      return gain;
    }
  };
  // Replace only the native folder chooser. Writes/close/getFile use actual
  // Chromium File System Access streams in origin-private storage.
  window.showDirectoryPicker = async () => {
    if (window.__cancelIqPicker)
      throw new DOMException("Canceled", "AbortError");
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle("iq-browser-test", {
      create: true,
    });
    window.__iqFolder = folder;
    return folder;
  };
});
const recordStatus = page.getByTestId("iq-recording-status");
const start = () =>
  page.getByRole("button", { name: /^(Record IQ|New IQ recording)$/ }).click();
const saveDownload = async (button, path) => {
  const next = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const dl = await next;
  await dl.saveAs(path);
  return dl.suggestedFilename();
};
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await expect(
    page.getByRole("button", { name: "Record IQ", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Decoder", { exact: true }).selectOption("ook");
  await page
    .getByRole("button", { name: "Try OOK / ASK test signal", exact: true })
    .click();
  // Canceling a picker never starts recording or stops the source.
  await page.evaluate(() => {
    window.__cancelIqPicker = true;
  });
  await start();
  await expect(recordStatus).toHaveText("Ready");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    window.__cancelIqPicker = false;
  });
  await page
    .getByLabel("Save destination", { exact: true })
    .selectOption("download");
  await page
    .getByLabel("Recording duration", { exact: true })
    .selectOption("2");
  await start();
  await expect(recordStatus).toHaveText("Recording");
  await expect(recordStatus).toHaveText("Ready to download", {
    timeout: 10000,
  });
  await expect(page.getByTestId("iq-recording-size")).toHaveText(
    "2.000 s · 9.6 MB",
  );
  await expect(
    page.getByRole("button", { name: "Stop test signal", exact: true }),
  ).toBeEnabled();
  const filename = await saveDownload(
    "Download IQ (.cu8)",
    "artifacts/recorded-ook.cu8",
  );
  await saveDownload(
    "Download SigMF metadata",
    "artifacts/recorded-ook.sigmf-meta",
  );
  const data = await readFile("artifacts/recorded-ook.cu8"),
    meta = JSON.parse(
      await readFile("artifacts/recorded-ook.sigmf-meta", "utf8"),
    );
  assert.equal(data.length, 9600000);
  assert(filename.includes("GENERATED"));
  assert.equal(meta.global["core:datatype"], "cu8");
  assert.equal(meta.global["core:sample_rate"], 2400000);
  assert.equal(meta.global["core:dataset"], filename);
  assert.equal(meta.captures[0]["core:frequency"], 433750000);
  assert.equal(meta.annotations[0]["core:sample_count"], data.length / 2);
  assert.match(meta.global["core:description"], /GENERATED/);
  // Decode the saved file, not the running app: proves useful original IQ,
  // correct byte format/frequency metadata, and continuity through USB-sized blocks.
  const decoder = new OokDecoder(
      433920000 - meta.captures[0]["core:frequency"],
      50000,
      -120,
      50,
      5000,
    ),
    bursts = [];
  for (let n = 0; n < data.length; n += 131072) {
    decoder.process(data.subarray(n, n + 131072));
    bursts.push(...JSON.parse(decoder.take_bursts()));
  }
  decoder.free();
  const payloads = bursts.map((b) =>
    burstHex(interpretBurst(b, { ...ookDefaults, encoding: "pwm" })),
  );
  assert(payloads.includes("A6"), `Recorded payloads: ${payloads}`);
  // Real streaming writer + automatically saved matching metadata in selected folder.
  await page
    .getByRole("button", { name: "Discard capture", exact: true })
    .click();
  await page
    .getByLabel("Save destination", { exact: true })
    .selectOption("disk");
  await start();
  await expect(recordStatus).toHaveText("Recording");
  await expect(recordStatus).toHaveText("Saved to chosen folder", {
    timeout: 10000,
  });
  const files = await page.evaluate(async () => {
    const entries = [];
    for await (const [name, handle] of window.__iqFolder.entries()) {
      const file = await handle.getFile();
      entries.push({
        name,
        size: file.size,
        text: name.endsWith(".sigmf-meta") ? await file.text() : null,
      });
    }
    return entries;
  });
  const diskMeta = files.find((f) => f.text),
    diskData = files.find((f) => f.name.endsWith(".cu8"));
  assert(diskMeta && diskData);
  assert.equal(diskData.size, 9600000);
  assert.equal(JSON.parse(diskMeta.text).global["core:dataset"], diskData.name);
  // A mid-recording retune finalizes an unmixed capture using original RF metadata.
  await page
    .getByLabel("Save destination", { exact: true })
    .selectOption("download");
  await page
    .getByLabel("Recording duration", { exact: true })
    .selectOption("0");
  await start();
  await expect(recordStatus).toHaveText("Recording");
  await expect
    .poll(async () => page.getByTestId("iq-recording-size").textContent())
    .not.toContain("0.000 s");
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("433.8000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(recordStatus).toHaveText("Ready to download");
  await expect(page.getByLabel("IQ recording", { exact: true })).toContainText(
    "configuration changed",
  );
  await saveDownload(
    "Download SigMF metadata",
    "artifacts/recorded-retune.sigmf-meta",
  );
  const retuned = JSON.parse(
    await readFile("artifacts/recorded-retune.sigmf-meta", "utf8"),
  );
  assert.equal(retuned.captures[0]["core:frequency"], 433750000);
  assert.match(retuned.global["core:description"], /configuration changed/);
  // Display-only zoom/freezing keep capture running; stopping source closes it.
  await start();
  await expect(recordStatus).toHaveText("Recording");
  await page.getByLabel("DISPLAY SPAN", { exact: true }).selectOption("150000");
  await page.getByRole("button", { name: "Freeze view", exact: true }).click();
  await expect(recordStatus).toHaveText("Recording");
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect(recordStatus).toHaveText("Ready to download");
  await expect(page.getByLabel("IQ recording", { exact: true })).toContainText(
    "Receiver stopped",
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1120 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `artifacts/iq-recording-${width}.png`,
      fullPage: true,
    });
  }
  // Record while the actual AudioWorklet continues playing a WFM signal.
  await page.getByLabel("Decoder", { exact: true }).selectOption("wfm");
  await page
    .getByRole("button", { name: "Try FM test signal", exact: true })
    .click();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  const rms = () =>
    page.evaluate(() => {
      if (!window.__iqAudio) return 0;
      const samples = new Float32Array(2048);
      window.__iqAudio.getFloatTimeDomainData(samples);
      return Math.sqrt(
        samples.reduce((sum, v) => sum + v * v, 0) / samples.length,
      );
    });
  await expect.poll(rms, { timeout: 10000 }).toBeGreaterThan(0.06);
  await page
    .getByLabel("Recording duration", { exact: true })
    .selectOption("2");
  await start();
  await expect(recordStatus).toHaveText("Recording");
  await expect.poll(rms).toBeGreaterThan(0.06);
  const recordingAudioRms = await rms();
  await expect(recordStatus).toHaveText("Ready to download", {
    timeout: 10000,
  });
  await expect.poll(rms).toBeGreaterThan(0.06);
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  // Force the quiet 467 MHz window, then capture longer than the normal scan
  // dwell. A scan retune would stop recording early if the hold did not work.
  await page.getByLabel("Decoder", { exact: true }).selectOption("nfm");
  await page
    .getByRole("button", { name: "Try NFM test signal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Monitor / scan bank", exact: true })
    .click();
  await page.getByRole("button", { name: "Next window", exact: true }).click();
  await expect(page.getByTestId("preset-monitor-status")).toContainText(
    "window 2 / 2",
  );
  await start();
  await expect(recordStatus).toHaveText("Recording");
  await expect(page.getByTestId("preset-monitor-status")).toContainText(
    "IQ recording holds RF window",
  );
  await expect(
    page.getByRole("button", { name: "Next window", exact: true }),
  ).toBeDisabled();
  await expect(recordStatus).toHaveText("Ready to download", {
    timeout: 10000,
  });
  await expect(page.getByTestId("iq-recording-size")).toHaveText(
    "2.000 s · 9.6 MB",
  );
  await expect(page.getByLabel("IQ recording", { exact: true })).toContainText(
    "467.3875 MHz",
  );
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  assert.deepEqual(errors, []);
  const result = {
    bytes: data.length,
    seconds: 2,
    offlinePayloads: payloads,
    recordingAudioRms,
    scanHeldFullDuration: true,
    diskFiles: files.map(({ name, size }) => ({ name, size })),
    errors,
  };
  await writeFile(
    "artifacts/iq-recording-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
