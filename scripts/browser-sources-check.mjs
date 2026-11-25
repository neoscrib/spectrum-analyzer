import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const results = {};
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem(
      "spectrum-settings",
      JSON.stringify({
        decoder: "nfm",
        center: 462400000,
        channel: 462425000,
        bandwidth: 12500,
        gain: 24,
        ppm: 0,
        squelch: null,
      }),
    );
    window.__radio = { frames: 0, samples: 0, audioPower: 0 };
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type !== "processed") return;
          window.__radio.frames++;
          window.__radio.samples += data.samples;
          for (const event of data.events)
            if (event.type === "audio")
              for (const value of event.samples)
                window.__radio.audioPower += value * value;
        });
      }
    };
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Radio source", { exact: true }).selectOption("soapy");
  await page
    .getByLabel("SDR bridge URL", { exact: true })
    .fill(process.env.BRIDGE_URL || "ws://127.0.0.1:18092");
  await page
    .getByRole("button", { name: "Find bridge receivers", exact: true })
    .click();
  await page
    .getByLabel("Detected SDR receivers", { exact: true })
    .selectOption("test=1");
  await page
    .getByRole("button", { name: "Connect SDR bridge", exact: true })
    .click();
  await expect(
    page.getByText("GENERATED NFM test source connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__radio.samples), { timeout: 15000 })
    .toBeGreaterThan(7200000);
  assert((await page.evaluate(() => window.__radio.audioPower)) > 100);
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page
    .getByLabel("Save destination", { exact: true })
    .selectOption("download");
  await page
    .getByLabel("Recording duration", { exact: true })
    .selectOption("2");
  await page.getByRole("button", { name: "Record IQ", exact: true }).click();
  await expect(page.getByTestId("iq-recording-status")).toHaveText(
    "Ready to download",
    { timeout: 10000 },
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download SigMF metadata", exact: true })
    .click();
  const download = await downloaded;
  await download.saveAs("artifacts/bridge-recording.sigmf-meta");
  const metadata = JSON.parse(
    await readFile("artifacts/bridge-recording.sigmf-meta", "utf8"),
  );
  assert.equal(metadata.global["core:datatype"], "cu8");
  assert.equal(metadata.global["spectrum:receiver"].transport, "WebSocket");
  assert.equal(metadata.global["spectrum:receiver"].generated, true);
  assert.match(metadata.global["core:description"], /GENERATED/);
  assert.match(metadata.global["core:dataset"], /GENERATED/);
  await expect(page.getByLabel("Radio source", { exact: true })).toBeDisabled();
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("462.5");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  const before = await page.evaluate(() => window.__radio.samples);
  await expect
    .poll(() => page.evaluate(() => window.__radio.samples))
    .toBeGreaterThan(before + 2400000);
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page
    .locator(".receiver-panel")
    .screenshot({ path: "artifacts/receiver-bridge-desktop.png" });
  await page
    .getByRole("button", { name: "Stop receiver", exact: true })
    .click();
  await expect(page.getByLabel("Radio source", { exact: true })).toBeEnabled();
  await page
    .getByRole("button", { name: "Connect SDR bridge", exact: true })
    .click();
  await expect(
    page.getByText("GENERATED NFM test source connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop receiver", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page
    .locator(".receiver-panel")
    .screenshot({ path: "artifacts/receiver-bridge-mobile.png" });
  assert.deepEqual(errors, []);
  results.bridge = {
    ...(await page.evaluate(() => window.__radio)),
    retune: true,
    reconnect: true,
    recording: true,
    mobile: true,
    errors,
  };
  await context.close();

  // Simulate HackRF USB controls and signed samples, keeping the real adapter,
  // capture workers, WASM spectrum and decoder lifecycle in the browser.
  const hack = await browser.newContext({ serviceWorkers: "block" });
  await hack.addInitScript(() => {
    localStorage.setItem(
      "spectrum-settings",
      JSON.stringify({
        decoder: "none",
        center: 2400000000,
        channel: 2400000000,
        bandwidth: 200000,
        gain: 24,
        ppm: 0,
      }),
    );
    let sample = 0,
      target = performance.now();
    window.__usbCommands = [];
    const device = {
      opened: false,
      configuration: { configurationValue: 1 },
      productName: "HackRF One",
      async open() {
        this.opened = true;
      },
      async close() {
        this.opened = false;
      },
      async selectConfiguration() {},
      async claimInterface() {},
      async releaseInterface() {},
      async controlTransferOut(s, data) {
        window.__usbCommands.push([s.request, s.value, s.index]);
        return { status: "ok", bytesWritten: data?.byteLength ?? 0 };
      },
      async controlTransferIn(s) {
        window.__usbCommands.push([s.request, s.value, s.index]);
        return { status: "ok", data: new DataView(new Uint8Array([1]).buffer) };
      },
      async transferIn(endpoint, length) {
        target += length / 2 / 2400;
        const iq = new Int8Array(length);
        for (let n = 0; n < length; n += 2) {
          const phase = (2 * Math.PI * 100000 * sample++) / 2400000;
          iq[n] = Math.round(60 * Math.cos(phase));
          iq[n + 1] = Math.round(60 * Math.sin(phase));
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
        async requestDevice(options) {
          window.__usbFilters = options.filters;
          target = performance.now();
          return device;
        },
      },
    });
  });
  const hp = await hack.newPage(),
    hackErrors = [];
  hp.on("pageerror", (error) => hackErrors.push(error.message));
  await hp.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await hp.getByLabel("Radio source", { exact: true }).selectOption("hackrf");
  await expect(hp.getByLabel("Auto gain", { exact: true })).toBeDisabled();
  await hp.getByRole("button", { name: "Connect HackRF", exact: true }).click();
  await expect(
    hp.getByText("HackRF One connected", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      hp
        .getByText("Input power", { exact: true })
        .locator("..")
        .locator("strong")
        .innerText(),
    )
    .not.toContain("—");
  await hp.getByRole("button", { name: "Stop receiver", exact: true }).click();
  const commands = await hp.evaluate(() => window.__usbCommands);
  assert(commands.some((c) => c[0] === 1 && c[1] === 1));
  assert(!commands.some((c) => c[0] === 1 && c[1] === 2));
  assert.deepEqual(await hp.evaluate(() => window.__usbFilters), [
    { vendorId: 0x1d50, productId: 0x6089 },
  ]);
  assert.deepEqual(hackErrors, []);
  results.hackrf = {
    simulatedUsb: true,
    rxOnly: true,
    controls: commands.length,
    errors: hackErrors,
  };
  await hack.close();
  await writeFile(
    "artifacts/radio-sources-browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(results);
} finally {
  await browser.close();
}
