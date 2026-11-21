import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("433.7500");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await page.getByLabel("Decoder", { exact: true }).selectOption("ook");
  await expect(
    page.getByLabel("CENTER FREQUENCY", { exact: true }),
  ).toHaveValue("433.7500");
  await expect(
    page.getByLabel("OOK / ASK reception", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Channel width", { exact: true })).toHaveValue(
    "50000",
  );
  await page
    .getByRole("button", { name: "Try OOK / ASK test signal", exact: true })
    .click();
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("433.9200");
  await expect(
    page.getByText("Generated OOK / ASK IQ · PWM test payload A6", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play audio", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("img", { name: "Sliced OOK pulse train", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("ook-bits")).toContainText("Select PWM");
  await page
    .getByLabel("OOK bit interpretation", { exact: true })
    .selectOption("pwm");
  await page
    .getByRole("button", { name: "Apply OOK settings", exact: true })
    .click();
  await expect(page.getByTestId("ook-bits")).toHaveText("10100110");
  await expect(page.getByTestId("ook-hex")).toHaveText("HEX A6");
  // Await both an OOK burst and nonzero-low ASK burst after reconfiguration.
  await expect
    .poll(
      async () =>
        page
          .getByLabel("Inspect OOK burst", { exact: true })
          .locator("option")
          .count(),
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(4);
  const select = page.getByLabel("Inspect OOK burst", { exact: true });
  const ids = await select
    .locator("option")
    .evaluateAll((opts) =>
      opts.map((o) => o.value).filter((s) => s !== "latest"),
    );
  await select.selectOption(ids.at(-1));
  await page.getByLabel("Invert OOK bits", { exact: true }).check();
  await page
    .getByRole("button", { name: "Apply OOK settings", exact: true })
    .click();
  await expect(page.getByTestId("ook-bits")).toHaveText("01011001");
  await expect(page.getByTestId("ook-hex")).toHaveText("HEX 59");
  // Interpreting history must retain raw timings; export carries test provenance.
  let pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export pulse data (.ook)", exact: true })
    .click();
  await (await pending).saveAs("artifacts/test-burst.ook");
  const pulse = await readFile("artifacts/test-burst.ook", "utf8");
  assert(pulse.includes(";timescale 1us"));
  assert(pulse.includes("; Generated test: yes"));
  const pairs = pulse
    .split("\n")
    .filter((s) => /^\d/.test(s))
    .map((s) => s.split(" ").map(Number));
  assert.equal(pairs.length, 8);
  assert(pairs.at(-1)[1] >= 5000);
  // Bad configuration is blocked before it resets the decoder.
  await page.getByLabel("OOK burst gap µs", { exact: true }).fill("1000");
  await page.getByLabel("OOK minimum pulse µs", { exact: true }).fill("1000");
  await page
    .getByRole("button", { name: "Apply OOK settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("more than twice");
  await page.getByLabel("OOK minimum pulse µs", { exact: true }).fill("50");
  await page.getByLabel("OOK burst gap µs", { exact: true }).fill("5000");
  await page
    .getByLabel("OOK threshold mode", { exact: true })
    .selectOption("manual");
  await page.getByLabel("OOK threshold dBFS", { exact: true }).fill("-15");
  await page
    .getByRole("button", { name: "Apply OOK settings", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("ook-threshold")).toHaveText("-15.0 dBFS");
  await select.selectOption("latest");
  await expect(page.getByTestId("ook-hex")).toHaveText("HEX 59");
  // Both tuning offset signs still recover the data; spectrum zoom is independent.
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("434.1000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await page.getByLabel("Decoder frequency", { exact: true }).fill("433.9200");
  await page.getByRole("button", { name: "Tune decoder", exact: true }).click();
  await page.getByLabel("Channel width", { exact: true }).selectOption("25000");
  const previous = await select.locator("option").count();
  await expect
    .poll(async () => select.locator("option").count(), { timeout: 6000 })
    .toBeGreaterThan(previous);
  await expect(page.getByTestId("ook-hex")).toHaveText("HEX 59");
  pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export captures JSON", exact: true })
    .click();
  await (await pending).saveAs("artifacts/ook-captures.json");
  const json = JSON.parse(
    await readFile("artifacts/ook-captures.json", "utf8"),
  );
  assert.equal(json.version, 1);
  assert(json.captures.length >= 4);
  assert(json.captures.every((c) => c.test && c.durations.length === 16));
  assert.equal(json.captures.at(-1).frequency, 433920000);
  assert.equal(json.captures.at(-1).bandwidth, 25000);
  await page
    .getByText("Raw pulse / gap durations (µs)", { exact: true })
    .click();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1120 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `artifacts/ook-${width}.png`,
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect(
    page.getByText("GENERATED TEST · 433.9200 MHz · 25 kHz", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("OOK threshold dBFS", { exact: true }),
  ).toHaveValue("-15");
  await expect(
    page.getByLabel("OOK bit interpretation", { exact: true }),
  ).toHaveValue("pwm");
  await expect(
    page.getByRole("img", { name: "Sliced OOK pulse train", exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  const result = {
    source: "Actual generated CU8 OOK/ASK -> worker WASM -> pulse UI",
    bursts: json.captures.length,
    pwm: "A6",
    inverted: "59",
    pairs,
    errors,
  };
  await writeFile(
    "artifacts/ook-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
