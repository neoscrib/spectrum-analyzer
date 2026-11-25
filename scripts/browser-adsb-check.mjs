import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
});
const context = await browser.newContext({
  serviceWorkers: "block",
  viewport: { width: 1400, height: 1100 },
});
// Never send automated map panning / tile requests to OSM's community servers.
await context.route("https://tile.openstreetmap.org/**", (r) =>
  r.fulfill({
    contentType: "image/png",
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  }),
);
await context.addInitScript(() => {
  localStorage.setItem("spectrum-show-rf-plots", "false");
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("adsb");
  const panel = page.getByRole("region", { name: "ADS-B aircraft tracking" });
  await expect(panel).toBeVisible();
  await expect(page.locator("#center")).toHaveValue("1090.0000");
  await page
    .getByRole("button", { name: "Try ADS-B test signal", exact: true })
    .click();
  await expect(panel.getByTestId("adsb-aircraft")).toHaveCount(6, {
    timeout: 20000,
  });
  await expect(panel.locator(".leaflet-marker-icon")).toHaveCount(6);
  await panel
    .getByRole("button", { name: "Fit aircraft", exact: true })
    .click();
  await panel.getByRole("button", { name: "A00001", exact: true }).click();
  const detail = panel.getByRole("region", {
    name: "Selected aircraft details",
  });
  await expect(detail).toContainText("TEST1");
  await detail
    .getByText("Recent raw Mode S frames · latest 12", { exact: true })
    .click();
  await expect(detail.locator("code").first()).toContainText("8D");
  await panel.getByRole("button", { name: "Sort by Altitude ft" }).click();
  await panel.getByLabel("Follow selected aircraft").check();
  await panel.getByLabel("Aircraft trail duration").selectOption("600");
  await expect(
    panel.getByText("Generated IQ · synthetic aircraft", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await panel
    .getByText("Receiver location & decoder options", { exact: true })
    .click();
  await panel.getByLabel("ADS-B receiver latitude").fill("45.9");
  await panel.getByLabel("ADS-B receiver longitude").fill("-93.3");
  await panel
    .getByRole("button", { name: "Save receiver location", exact: true })
    .click();
  await panel.getByText("Recorded IQ & SigMF replay", { exact: true }).click();
  await panel.getByLabel("ADS-B IQ file").setInputFiles({
    name: "fixture.cu8",
    mimeType: "application/octet-stream",
    buffer: await readFile("artifacts/adsb-fixture.cu8"),
  });
  await panel.getByLabel("ADS-B SigMF metadata").setInputFiles({
    name: "fixture.sigmf-meta",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        global: { "core:datatype": "cu8", "core:sample_rate": 2400000 },
        captures: [
          {
            "core:sample_start": 0,
            "core:frequency": 1090000000,
            "core:datetime": "2020-01-02T03:04:05Z",
          },
        ],
      }),
    ),
  });
  await panel
    .getByRole("button", { name: "Replay ADS-B IQ", exact: true })
    .click();
  await expect(panel.getByTestId("adsb-aircraft")).toHaveCount(6, {
    timeout: 15000,
  });
  await expect(panel.getByText(/fixture.cu8 · complete/)).toBeVisible();
  await expect(panel).toContainText("Recorded IQ replay");
  await expect(panel.getByTestId("adsb-aircraft")).toHaveCount(6);
  await page.waitForTimeout(1000);
  await expect(panel.getByTestId("adsb-aircraft")).toHaveCount(6);
  await expect(panel.locator(".adsb-marker")).toHaveCount(6);
  await panel.getByLabel("OpenStreetMap tiles").uncheck();
  await expect(panel.locator(".leaflet-tile-pane img")).toHaveCount(0);
  await page.setViewportSize({ width: 393, height: 851 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile layout overflow",
  );
  await mkdir("artifacts", { recursive: true });
  await panel.screenshot({ path: "artifacts/adsb-mobile.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/adsb-browser-results.json",
    JSON.stringify(
      {
        syntheticAircraft: 6,
        ppmDecode: true,
        cpr: true,
        map: true,
        selection: true,
        rawFrames: true,
        sorting: true,
        sigmfReplay: true,
        mobile: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "ADS-B browser: synthetic RF → WASM → CPR → list/map, selection, raw frames, sorting, SigMF IQ replay and mobile layout passed.",
  );
} catch (e) {
  await page.screenshot({
    path: "artifacts/adsb-browser-failure.png",
    fullPage: true,
  });
  console.error((await page.locator("body").innerText()).slice(-5000));
  throw e;
} finally {
  await browser.close();
}
