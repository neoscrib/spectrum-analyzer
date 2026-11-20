// Optional integration check: explicitly opens and tunes the connected RTL-SDR.
// Not part of npm test/check. Close other SDR applications before running.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

await mkdir("artifacts", { recursive: true });
console.log(
  "Select the RTL-SDR in Chrome’s USB chooser when it appears. This optional check uses real hardware.",
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: false,
  args: ["--ozone-platform=x11"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } });
await page.addInitScript(() => {
  window.__frames = 0;
  window.__samples = 0;
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data.type !== "processed") return;
        window.__frames++;
        window.__samples += data.samples;
        window.__last = {
          rms: data.rms,
          clipping: data.clipping,
          elapsed: data.elapsed,
          samples: data.samples,
          audioSamples:
            data.events.find((e) => e.type === "audio")?.samples.length ?? 0,
        };
      });
    }
  };
});
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page
    .getByRole("button", { name: "Connect RTL-SDR", exact: true })
    .click();
  await expect(
    page.getByText("RTL-SDR connected", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await expect
    .poll(() => page.evaluate(() => window.__samples), { timeout: 15000 })
    .toBeGreaterThan(7_200_000);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const initial = await page.evaluate(() => ({
    frames: window.__frames,
    samples: window.__samples,
    last: window.__last,
  }));
  assert(
    initial.last.audioSamples > 1200,
    "Live IQ is decoded into 48 kHz PCM",
  );
  await page.getByLabel("DISPLAY SPAN", { exact: true }).selectOption("600000");
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("100.2000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("100.3000");
  const beforeRetune = await page.evaluate(() => window.__frames);
  await expect
    .poll(() => page.evaluate(() => window.__frames))
    .toBeGreaterThan(beforeRetune + 30);
  await page.getByLabel("Frequency correction", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Apply RF settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply RF settings", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause audio", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/live-usb.png", fullPage: true });
  await expect(page.getByRole("alert")).toHaveCount(0);
  const final = await page.evaluate(() => ({
    frames: window.__frames,
    samples: window.__samples,
    last: window.__last,
  }));
  await page
    .getByRole("button", { name: "Stop receiver", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect RTL-SDR", exact: true }),
  ).toBeEnabled();
  // Reconnect verifies that Stop released the interface, not just the worker.
  await page
    .getByRole("button", { name: "Connect RTL-SDR", exact: true })
    .click();
  await expect(
    page.getByText("RTL-SDR connected", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => page.evaluate(() => window.__frames))
    .toBeGreaterThan(final.frames + 10);
  await page
    .getByRole("button", { name: "Stop receiver", exact: true })
    .click();
  const result = {
    initial,
    final,
    checks:
      "Real WebUSB acquisition at 2.4 MSPS; WFM PCM; independent span; hardware retune; PPM; audio start; stop/reconnect releases USB",
  };
  await writeFile(
    "artifacts/usb-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error("USB check failed:", e);
  if (!page.isClosed())
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => "Page unavailable."),
    );
  throw e;
} finally {
  await browser.close();
}
