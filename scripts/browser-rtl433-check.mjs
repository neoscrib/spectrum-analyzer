import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 } }),
  errors = [],
  assets = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (response) => {
  if (response.url().includes("rtl433") && response.url().includes("wasm"))
    assets.push({ url: response.url(), status: response.status() });
});
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("rtl433");
  await expect(
    page.getByLabel("rtl_433 reception", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Channel width", { exact: true })).toHaveValue(
    "200000",
  );
  await page
    .getByRole("button", { name: "Try rtl_433 test signal", exact: true })
    .click();
  await expect(
    page.getByLabel("Decoder frequency", { exact: true }),
  ).toHaveValue("433.9200");
  await expect(page.getByTestId("rtl433-messages")).toContainText("Nexus-TH", {
    timeout: 15000,
  });
  await expect(page.getByTestId("rtl433-messages")).toContainText(
    "SimpliSafe-Gen3",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("rtl433-stats")).toContainText("253 / 284");
  await expect(
    page.getByRole("button", { name: "Play audio", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Search rtl_433 messages", { exact: true })
    .fill("Nexus");
  await expect(page.getByTestId("rtl433-messages")).not.toContainText(
    "SimpliSafe",
  );
  await expect(page.getByTestId("rtl433-messages")).toContainText(
    '"temperature_C": 21.5',
  );
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export messages JSONL", exact: true })
    .click();
  await (await downloading).saveAs("artifacts/rtl433-messages.jsonl");
  const messages = (await readFile("artifacts/rtl433-messages.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  assert(
    messages.every(
      (m) =>
        m.source === "test" &&
        m.frequency === 433920000 &&
        m.engine === "rtl_433 25.12",
    ),
  );
  assert(messages.some((m) => m.data.model === "SimpliSafe-Gen3")); // Export includes all history, not just search.
  // Actual registry config: selecting Nexus excludes FSK; recreates native state.
  await page.getByLabel("Search rtl_433 messages", { exact: true }).fill("");
  await page
    .getByLabel("rtl_433 protocol set", { exact: true })
    .selectOption("single");
  await page.getByLabel("rtl_433 protocol", { exact: true }).selectOption("19");
  await page
    .getByRole("button", { name: "Apply rtl_433 settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear messages", exact: true })
    .click();
  await expect(page.getByTestId("rtl433-stats")).toContainText("1 / 284");
  await expect(page.getByTestId("rtl433-messages")).toContainText("Nexus-TH", {
    timeout: 12000,
  });
  await page.waitForTimeout(3300);
  await expect(page.getByTestId("rtl433-messages")).not.toContainText(
    "SimpliSafe-Gen3",
  );
  // Retune across the hardware center and narrow the decoder filter.
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("434.1000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(page.getByLabel("Decoder frequency", { exact: true })).toHaveValue("434.2700");
  await page.getByLabel("Decoder frequency", { exact: true }).fill("433.9200");
  await page.getByRole("button", { name: "Tune decoder", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("spectrum-settings")).channel)).toBe(433920000);
  await page
    .getByLabel("Channel width", { exact: true })
    .selectOption("100000");
  await page
    .getByRole("button", { name: "Clear messages", exact: true })
    .click();
  await expect(page.getByTestId("rtl433-messages")).toContainText("Nexus-TH", {
    timeout: 12000,
  });
  await page
    .getByLabel("rtl_433 protocol set", { exact: true })
    .selectOption("all");
  await page
    .getByRole("button", { name: "Apply rtl_433 settings", exact: true })
    .click();
  await expect(page.getByTestId("rtl433-stats")).toContainText("284 / 284");
  await expect(page.getByTestId("rtl433-messages")).toContainText(
    "SimpliSafe-Gen3",
    { timeout: 12000 },
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1120 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow at ${width}`,
    );
    await page.screenshot({
      path: `artifacts/rtl433-${width}.png`,
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect(page.getByTestId("rtl433-messages")).toContainText(
    "GENERATED TEST",
  );
  await page.getByLabel("Decoder", { exact: true }).selectOption("am");
  await page
    .getByRole("button", { name: "Try AM test signal", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play audio", exact: true }),
  ).toBeEnabled();
  // Switching into/out of the lazy engine in the same live worker must work.
  await page.getByLabel("Decoder", { exact: true }).selectOption("rtl433");
  await expect(page.getByTestId("rtl433-stats")).toContainText("284 / 284");
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByLabel("rtl_433 protocol set", { exact: true }),
  ).toHaveValue("all");
  await expect(page.getByTestId("rtl433-messages")).toContainText(
    "No decoded messages yet",
  );
  assert(assets.some((a) => a.url.includes("rtl433") && a.status === 200));
  assert.deepEqual(errors, []);
  const result = {
    source:
      "Generated CU8 -> worker -> Rust channelizer -> rtl_433 WASM -> React JSON",
    messages: messages.length,
    models: [...new Set(messages.map((m) => m.data.model))],
    errors,
    assets,
  };
  await writeFile(
    "artifacts/rtl433-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} catch (error) {
  await page.screenshot({ path: "artifacts/rtl433-browser-failure.png", fullPage: true });
  await writeFile("artifacts/rtl433-browser-failure.txt", await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
