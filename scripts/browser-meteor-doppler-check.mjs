import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const tle =
  "METEOR-M2 4\n1 59051U 24039A   26323.63845458  .00000023  00000+0  30271-4 0  9998\n2 59051  98.7252 281.1433 0008139  81.1004 279.1095 14.22443947141360";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const errors = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block" }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-11-25T15:38:28Z"));
  await context.route("**/api/tle?id=59051", (r) =>
    r.fulfill({ contentType: "text/plain", body: tle }),
  );
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("meteor");
  await page
    .getByText("Transmission and Doppler settings", { exact: true })
    .click();
  const control = page.getByLabel("Live orbital Doppler correction", {
    exact: true,
  });
  await expect(control).not.toBeChecked();
  await page.getByLabel("Meteor orbital elements", { exact: true }).fill(tle);
  await expect(control).toBeChecked();
  await page
    .getByLabel("Meteor orbital elements", { exact: true })
    .fill(tle.replace("9998", "9999"));
  await expect(control).not.toBeChecked();
  await page.getByRole("button", { name: "Refresh TLE", exact: true }).click();
  await expect(control).toBeChecked();
  // An upstream outage must explain the failure and retain the user's TLE.
  const unavailable =
    "TLE refresh unavailable: CelesTrak returned HTTP 503; SatNOGS returned HTTP 503. Your existing elements are unchanged. Try again later or paste a TLE.";
  await context.route("**/api/tle?id=59051", (r) =>
    r.fulfill({ status: 502, contentType: "text/plain", body: unavailable }),
  );
  await page.getByRole("button", { name: "Refresh TLE", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(unavailable);
  await expect(
    page.getByLabel("Meteor orbital elements", { exact: true }),
  ).toHaveValue(tle);
  await expect(control).toBeChecked();
  await context.route("**/api/tle?id=59051", (r) =>
    r.fulfill({
      contentType: "text/plain",
      body: tle,
      headers: { "X-TLE-Source": "SatNOGS" },
    }),
  );
  await page.getByRole("button", { name: "Refresh TLE", exact: true }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Apply Meteor settings", exact: true })
    .click();
  const saved = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("spectrum-settings")).meteor,
    );
  assert.equal((await saved()).doppler, true);
  assert.equal((await saved()).dopplerPreference, "auto");
  await control.uncheck();
  await page
    .getByRole("button", { name: "Apply Meteor settings", exact: true })
    .click();
  await page.reload();
  await page
    .getByText("Transmission and Doppler settings", { exact: true })
    .click();
  await expect(control).not.toBeChecked();
  await page.getByRole("button", { name: "Refresh TLE", exact: true }).click();
  await expect(control).not.toBeChecked();
  assert.equal((await saved()).dopplerPreference, "off");
  await control.check();
  await page
    .getByRole("button", { name: "Apply Meteor settings", exact: true })
    .click();
  assert.equal((await saved()).doppler, true);
  // Old preferences that stored the old false default migrate on page load.
  await page.evaluate((tle) => {
    const s = JSON.parse(localStorage.getItem("spectrum-settings"));
    delete s.meteor.dopplerPreference;
    s.meteor.doppler = false;
    s.meteor.tle = tle;
    localStorage.setItem("spectrum-settings", JSON.stringify(s));
  }, tle);
  await page.reload();
  await page
    .getByText("Transmission and Doppler settings", { exact: true })
    .click();
  await expect(control).toBeChecked();
  // Capture imports retain the actual historical false value despite fresh TLE.
  await page.getByText("Replay recorded I/Q", { exact: true }).click();
  await page
    .getByLabel("Meteor replay metadata", { exact: true })
    .setInputFiles({
      name: "historical.sigmf-meta",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          global: {
            "core:datatype": "cu8",
            "core:sample_rate": 2400000,
            "spectrum:meteor": {
              ...(await saved()),
              doppler: false,
              frequency: 137900000,
            },
          },
          captures: [
            {
              "core:sample_start": 0,
              "core:frequency": 137750000,
              "core:datetime": "2026-11-25T15:38:28Z",
            },
          ],
        }),
      ),
    });
  await expect(control).not.toBeChecked();
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/meteor-doppler-default-browser.json",
    JSON.stringify(
      {
        paste: true,
        refresh: true,
        invalidRejected: true,
        migration: true,
        explicitOffPersists: true,
        historicalPreserved: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Meteor Doppler defaults: pasted/refreshed TLE, invalid data, migration, explicit opt-out and historical import passed.",
  );
} finally {
  await browser.close();
}
