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
  // Keep the real OOK IQ/WASM pipeline. Inject one explicitly generated stored
  // burst at its output so exact fan timings and missing final gaps are testable.
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data.type !== "processed" || !window.__inspectionBurst) return;
        data.events = data.events.filter(
          (event) => event.type !== "message" || event.protocol !== "ook",
        );
        data.events.push({
          type: "message",
          protocol: "ook",
          burst: window.__inspectionBurst,
        });
        window.__inspectionBurst = null;
      });
    }
  };
});
const wave = page.getByRole("img", {
  name: "Sliced OOK pulse train",
  exact: true,
});
const binary = page.getByTestId("ook-bits"),
  hex = page.getByTestId("ook-hex");
const tooltip = page.getByTestId("ook-timing-tooltip");
const fanBits = "10010010".repeat(4) + "0";
const fanDurations = fanBits
  .split("")
  .flatMap((bit, index) =>
    index === 32 ? [280] : [bit === "1" ? 840 : 280, 740],
  );

async function inject(durations) {
  const select = page.getByLabel("Inspect OOK burst", { exact: true });
  const matching = select
    .locator("option")
    .filter({ hasText: `${Math.ceil(durations.length / 2)} pulses` });
  const before = (await matching.count())
    ? await matching.first().getAttribute("value")
    : null;
  await page.evaluate((durations) => {
    const startSeconds = performance.now() / 1000;
    window.__inspectionBurst = {
      startSeconds,
      endSeconds: startSeconds + durations.reduce((a, b) => a + b, 0) / 1e6,
      durations,
      gapLowerBound: false,
    };
  }, durations);
  await expect
    .poll(() => page.evaluate(() => window.__inspectionBurst === null))
    .toBe(true);
  // Only our fixture ends with the distinctive missing-low (odd) duration list.
  await expect(
    select
      .locator("option")
      .filter({ hasText: `${Math.ceil(durations.length / 2)} pulses` })
      .first(),
  ).toBeAttached();
  await expect
    .poll(() => matching.first().getAttribute("value"))
    .not.toBe(before);
  await select.selectOption(
    await select
      .locator("option")
      .filter({ hasText: `${Math.ceil(durations.length / 2)} pulses` })
      .first()
      .getAttribute("value"),
  );
}
async function atTime(us, total, height = 0.5) {
  await page.locator(".ook-waveform").scrollIntoViewIfNeeded();
  const box = await wave.boundingBox();
  await page.mouse.move(
    box.x + ((12 + (976 * us) / total) / 1000) * box.width,
    box.y + box.height * height,
  );
}
const activeBits = () => binary.locator('.ook-bit[data-highlighted="true"]');
const activeSymbols = () =>
  wave.locator('.ook-symbol[data-highlighted="true"]');
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
  await page.getByLabel("Decoder", { exact: true }).selectOption("ook");
  await page
    .getByRole("button", { name: "Try OOK / ASK test signal", exact: true })
    .click();
  await page
    .getByLabel("OOK bit interpretation", { exact: true })
    .selectOption("pwm");
  await page.getByLabel("OOK short duration µs", { exact: true }).fill("280");
  await page.getByLabel("OOK long duration µs", { exact: true }).fill("840");
  await page
    .getByRole("button", { name: "Apply OOK settings", exact: true })
    .click();
  await inject(fanDurations);
  const total = fanDurations.reduce((a, b) => a + b, 0);
  await expect(binary).toHaveText("10010010 10010010 10010010 10010010\n0");
  await expect(hex).toHaveText("92 92 92 92\n[0]");
  await expect(wave.locator(".ook-symbol")).toHaveCount(33);
  await expect(wave.locator(".ook-byte-boundary")).toHaveCount(4);
  const edgeTimes = await wave
    .locator(".ook-byte-boundary")
    .evaluateAll((lines) => lines.map((line) => Number(line.dataset.timeUs)));
  assert.deepEqual(edgeTimes, [9840, 19680, 29520, 39360]);
  // Full-height hit testing, well away from the trace's high and low y levels.
  await atTime(1720, total, 0.04);
  await expect(tooltip).toHaveText("High pulse · 280 µs · Bit 2 = 0");
  await expect(page.getByTestId("ook-measured-interval")).toHaveAttribute(
    "data-start-us",
    "1580",
  );
  await expect(page.getByTestId("ook-measured-interval")).toHaveAttribute(
    "data-end-us",
    "1860",
  );
  await expect(activeBits()).toHaveCount(1);
  await expect(activeBits()).toHaveAttribute("data-bit-index", "1");
  await expect(
    hex.locator('.ook-hex-group[data-highlighted="true"]'),
  ).toHaveAttribute("data-byte-index", "0");
  await atTime(2230, total, 0.55);
  await expect(tooltip).toHaveText("Low gap · 740 µs · Bit 2 = 0");
  await expect(page.getByTestId("ook-measured-interval")).toHaveAttribute(
    "data-start-us",
    "1860",
  );
  await expect(page.getByTestId("ook-measured-interval")).toHaveAttribute(
    "data-end-us",
    "2600",
  );
  await page.screenshot({
    path: "artifacts/ook-timing-gap.png",
    clip: await page.locator(".ook-waveform").boundingBox(),
  });
  await binary.locator('.ook-bit[data-bit-index="1"]').hover();
  await expect(activeSymbols()).toHaveCount(1);
  await expect(activeSymbols()).toHaveAttribute("data-start-us", "1580");
  await expect(activeSymbols()).toHaveAttribute("data-end-us", "2600");
  await hex.locator('[data-byte-index="1"]').hover();
  await expect(activeBits()).toHaveCount(8);
  await expect(activeSymbols()).toHaveCount(8);
  const indices = await activeBits().evaluateAll((bits) =>
    bits.map((bit) => Number(bit.dataset.bitIndex)),
  );
  assert.deepEqual(indices, [8, 9, 10, 11, 12, 13, 14, 15]);
  await page
    .locator(".ook-bits")
    .screenshot({ path: "artifacts/ook-linked-byte.png" });
  await hex.locator('[data-byte-index="4"]').hover();
  await expect(activeBits()).toHaveCount(1);
  await expect(activeSymbols()).toHaveAttribute("data-bit-index", "32");
  await expect(activeSymbols()).toHaveAttribute("data-start-us", "39360");
  await expect(activeSymbols()).toHaveAttribute("data-end-us", "39640");
  await atTime(39500, total, 0.95);
  await expect(tooltip).toHaveText("High pulse · 280 µs · Bit 33 = 0");
  await binary.locator('[data-bit-index="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(activeBits()).toHaveAttribute("data-bit-index", "1");
  await expect(activeSymbols()).toHaveAttribute("data-start-us", "1580");
  await hex.locator('[data-byte-index="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(activeBits()).toHaveCount(8);
  await expect(activeBits().first()).toHaveAttribute("data-bit-index", "8");
  await page.getByLabel("Show byte boundaries", { exact: true }).uncheck();
  await expect(wave.locator(".ook-byte-boundary")).toHaveCount(0);
  await page.getByLabel("Show byte boundaries", { exact: true }).check();
  await expect(wave.locator(".ook-byte-boundary")).toHaveCount(4);
  await page
    .getByText("Raw pulse / gap durations (µs)", { exact: true })
    .click();
  await expect(page.locator(".ook-raw tbody tr").last()).toHaveText("33280.0—");
  const uncertain = [...fanDurations];
  uncertain[4] = 500;
  await inject(uncertain);
  await expect(binary.locator('[data-bit-index="2"]')).toHaveText("?");
  await atTime(2850, total + 220, 0.5);
  await expect(tooltip).toHaveText("High pulse · 500 µs · Bit 3 = ?");
  await expect(activeSymbols()).toHaveAttribute("data-start-us", "2600");
  await expect(activeSymbols()).toHaveAttribute("data-end-us", "3840");
  await expect(wave.locator('[data-after-bit="8"]')).toHaveAttribute(
    "data-time-us",
    "10060",
  );
  // A raw view still measures original timings without inventing bit values.
  await page
    .getByLabel("OOK bit interpretation", { exact: true })
    .selectOption("raw");
  await page
    .getByRole("button", { name: "Apply OOK settings", exact: true })
    .click();
  await atTime(2850, total + 220, 0.5);
  await expect(tooltip).toHaveText("High pulse · 500 µs");
  await expect(wave.locator(".ook-symbol")).toHaveCount(0);
  // Return to PWM, and show that symbols beyond the old 64-pulse cutoff link.
  await page
    .getByLabel("OOK bit interpretation", { exact: true })
    .selectOption("pwm");
  await page
    .getByRole("button", { name: "Apply OOK settings", exact: true })
    .click();
  const long = "10010010"
    .repeat(64)
    .split("")
    .flatMap((bit, i) =>
      i === 511 ? [bit === "1" ? 840 : 280] : [bit === "1" ? 840 : 280, 740],
    );
  await inject(long);
  await expect(wave.locator(".ook-symbol")).toHaveCount(512);
  await hex.locator('[data-byte-index="63"]').hover();
  await expect(activeSymbols()).toHaveCount(8);
  await expect(activeBits()).toHaveCount(8);
  await expect(activeBits().last()).toHaveAttribute("data-bit-index", "511");
  assert(
    await binary.evaluate((pre) => pre.scrollTop > 0),
    "Late bits must scroll into the binary dump's own viewport",
  );
  await inject(fanDurations);
  await page.setViewportSize({ width: 390, height: 1120 });
  await atTime(1720, total, 0.5);
  await expect(tooltip).toHaveText("High pulse · 280 µs · Bit 2 = 0");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "artifacts/ook-timing-mobile.png",
    clip: await page.locator(".ook-waveform").boundingBox(),
  });
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  assert.deepEqual(errors, []);
  const result = {
    fanBits: 33,
    hex: "92 92 92 92 [0]",
    pulseUs: 280,
    gapUs: 740,
    byteBoundariesUs: edgeTimes,
    missingFinalGap: true,
    uncertainTimingsRetained: true,
    linksBeyond64Pulses: true,
    keyboardInspection: true,
    offline: process.env.CHECK_OFFLINE === "1",
    errors,
  };
  await writeFile(
    "artifacts/ook-inspection-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
