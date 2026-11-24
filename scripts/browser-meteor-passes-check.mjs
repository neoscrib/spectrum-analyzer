import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const tle = `METEOR-M2 4
1 59051U 24039A   26323.63845458  .00000023  00000+0  30271-4 0  9998
2 59051  98.7252 281.1433 0008139  81.1004 279.1095 14.22443947141360`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
try {
  const context = await browser.newContext({
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "America/Chicago",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-11-24T18:00:00Z"));
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("meteor");
  await page
    .getByText("Transmission and Doppler settings", { exact: true })
    .click();
  await page.getByLabel("Meteor orbital elements", { exact: true }).fill(tle);
  await page
    .getByRole("button", { name: "Predict passes", exact: true })
    .click();
  const list = page.getByRole("region", { name: "Predicted passes" });
  const cards = list.getByRole("article");
  await expect(cards).toHaveCount(8);
  const first = cards.first();
  await expect(first.getByRole("img")).toBeVisible();
  await expect(first).toContainText("Meteor-M2-4");
  await expect(first.locator(".meteor-pass-time")).toContainText("CST");
  assert.equal(
    new Set(
      await cards
        .locator("polyline")
        .evaluateAll((paths) => paths.map((p) => p.getAttribute("points"))),
    ).size,
    8,
    "Each card must show its own sky track",
  );
  const [start, end] = await first
    .locator("time")
    .evaluateAll((times) => times.map((t) => Date.parse(t.dateTime)));
  const timer = first.getByRole("timer");
  await page.clock.setFixedTime(new Date(start - 2500));
  await expect(timer).toHaveText("Starts in3s");
  await page.clock.setFixedTime(new Date(start - 1));
  await expect(timer).toHaveText("Starts in1s");
  // Horizon solving has sub-millisecond precision; serialized ISO times do not.
  await page.clock.setFixedTime(new Date(start + 1));
  await expect(timer).toContainText("Ends in");
  await expect(first).toHaveClass(/is-active/);
  await page.clock.setFixedTime(new Date(start + 60000));
  await expect(first.locator('svg circle[fill="#83ddbd"]')).toHaveCount(1);
  assert.equal(
    await list.locator('svg circle[fill="#83ddbd"]').count(),
    1,
    "Only the current pass may show the satellite's live position",
  );
  const position = await first
    .locator('svg circle[fill="#83ddbd"]')
    .getAttribute("cx");
  const countdown = await timer.textContent();
  await page.clock.setFixedTime(new Date(start + 65000));
  await expect(timer).not.toHaveText(countdown);
  await expect(first.locator('svg circle[fill="#83ddbd"]')).not.toHaveAttribute(
    "cx",
    position,
  );
  await mkdir("artifacts", { recursive: true });
  await list.screenshot({ path: "artifacts/meteor-pass-cards-desktop.png" });

  // Keep the sky plot on the left and all card content inside its border on mobile.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await first.evaluate((card) => {
      const bounds = card.getBoundingClientRect();
      const sky = card.querySelector("svg").getBoundingClientRect();
      const data = card
        .querySelector(".meteor-pass-data")
        .getBoundingClientRect();
      return {
        skyLeft: sky.left,
        skyRight: sky.right,
        dataLeft: data.left,
        left: bounds.left,
        right: bounds.right,
        overflow: card.scrollWidth - card.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    assert.ok(
      layout.skyLeft >= layout.left && layout.skyRight <= layout.dataLeft,
    );
    assert.ok(layout.right <= width, `Card overflows ${width}px viewport`);
    assert.ok(layout.overflow <= 1, `Card content overflows at ${width}px`);
    assert.ok(layout.pageOverflow <= 1, `Page overflows at ${width}px`);
    if (width === 390)
      await first.screenshot({ path: "artifacts/meteor-pass-card-mobile.png" });
  }
  await page.clock.setFixedTime(new Date(end - 1));
  await expect(timer).toHaveText("Ends in1s");
  await page.clock.setFixedTime(new Date(end + 1));
  await expect(timer).toHaveText("Pass ended");
  await expect(first).not.toHaveClass(/is-active/);
  await expect(first.locator('svg circle[fill="#83ddbd"]')).toHaveCount(0);

  // Editing the next prediction must not relabel the already predicted orbit.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel(/^Satellite profile/).selectOption("57166");
  await expect(first).toHaveAccessibleName(/Meteor-M2-4/);
  await page.getByLabel("Decoder", { exact: true }).selectOption("wfm");
  await expect(list).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "Meteor pass cards: unique sky tracks, live start/end countdowns, current position, snapshot identity and responsive layouts passed.",
  );
} finally {
  await browser.close();
}
