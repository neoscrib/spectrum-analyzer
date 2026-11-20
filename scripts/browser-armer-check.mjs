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
await page.addInitScript(() => {
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      analyser.fftSize = 4096;
      gain.connect(analyser);
      window.__armerAudio = analyser;
      return gain;
    }
  };
});
const rms = () =>
  page.evaluate(() => {
    const a = window.__armerAudio;
    if (!a) return 0;
    const x = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(x);
    return Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
  });
const valid = async () =>
  Number((await page.getByTestId("armer-valid").innerText()).split("/")[0]);
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("armer");
  await expect(page.getByLabel("Listen to unlisted talkgroups")).toBeChecked();
  await expect(
    page.getByLabel("Listen to 6620", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("CENTER FREQUENCY", { exact: true }),
  ).toHaveValue("852.4000");
  await expect(
    page.getByLabel("Control frequency", { exact: true }),
  ).toHaveValue("853.0750");
  await page.getByRole("button", { name: "Try ARMER test signal" }).click();
  await expect(page.getByText("Control locked", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("40F / BEE07", { exact: true })).toBeVisible();
  await expect(page.getByText("5 / 75 · 40C", { exact: true })).toBeVisible();
  await expect(page.getByTestId("armer-quality")).toContainText(
    "0.0% rejected",
  );
  await expect
    .poll(async () =>
      parseFloat(await page.getByTestId("armer-quality").innerText()),
    )
    .toBeGreaterThan(20);
  await page.getByLabel("CENTER FREQUENCY", { exact: true }).fill("853.8500");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(
    page.getByLabel("Control frequency", { exact: true }),
  ).toHaveValue("853.0750");
  await expect(page.getByText("Control locked", { exact: true })).toBeVisible();
  await expect(page.getByTestId("armer-quality")).toContainText(
    "0.0% rejected",
  );
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect.poll(rms, { timeout: 10000 }).toBeGreaterThan(0.00001);
  const audioRms = await rms();
  // All groups muted must flush the AudioWorklet, retaining control state.
  const beforeMute = await valid();
  await page.getByRole("button", { name: "Mute all", exact: true }).click();
  await expect(
    page.getByLabel("Listen to 6620", { exact: true }),
  ).not.toBeChecked();
  await expect.poll(rms, { timeout: 5000 }).toBeLessThan(0.000001);
  await expect.poll(valid).toBeGreaterThan(beforeMute);
  // One explicit enabled ID with unlisted groups disabled.
  await page.getByLabel("Listen to 6620", { exact: true }).check();
  await expect.poll(rms, { timeout: 12000 }).toBeGreaterThan(0.00001);
  const beforeAlias = await valid();
  await page
    .getByLabel("Alias for 6620", { exact: true })
    .fill('My Dispatch & "Ops"');
  await expect.poll(valid).toBeGreaterThan(beforeAlias);
  await expect(page.getByTestId("armer-now")).toContainText(
    'My Dispatch & "Ops"',
    { timeout: 12000 },
  );
  await page.getByRole("button", { name: "Listen all", exact: true }).click();
  await page.getByLabel("Listen to 6640", { exact: true }).uncheck();
  await page.getByLabel("New talkgroup ID").fill("65535");
  await page.getByLabel("New talkgroup alias").fill("Last ID");
  await page.getByRole("button", { name: "Add / update" }).click();
  await expect(
    page.getByLabel("Listen to 65535", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Search talkgroups").fill("");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SDRTrunk XML" }).click();
  const download = await downloadPromise;
  await download.saveAs("artifacts/armer-export.xml");
  const xml = await readFile("artifacts/armer-export.xml", "utf8");
  assert(xml.includes("My Dispatch &amp; &quot;Ops&quot;"));
  assert(xml.includes('priority="-1"'));
  assert(xml.includes('value="65535"'));
  await page.getByRole("button", { name: "Listen all", exact: true }).click();
  await page
    .getByLabel("Import SDRTrunk XML", { exact: true })
    .setInputFiles("artifacts/armer-export.xml");
  await page
    .getByRole("button", { name: "Use imported site & aliases" })
    .click();
  await expect(
    page.getByLabel("Listen to 6640", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect(page.getByText(/GENERATED P25 IQ · Test IDs/)).toBeVisible();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("spectrum-armer-seen-v1")),
    null,
    "Synthetic observations must not persist as RF traffic",
  );
  await page.reload();
  await expect(page.getByLabel("Alias for 6620", { exact: true })).toHaveValue(
    'My Dispatch & "Ops"',
  );
  await expect(
    page.getByLabel("Listen to 6640", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByText("Alias directory · RadioReference", { exact: true })
    .click();
  await expect(page.getByText(/To enable lookup, set/)).toBeVisible();
  await expect(page.getByText(/20 events/)).toHaveCount(0);
  // External lookup's browser flow with an explicitly mocked directory (no real credentials).
  await page.route("**/api/armer/aliases", async (route) =>
    route.fulfill({
      json:
        route.request().method() === "GET"
          ? { configured: true }
          : {
              rules: [
                {
                  id: 6620,
                  name: "Directory overwrite",
                  group: "API",
                  origin: "radioreference",
                },
                {
                  id: 60001,
                  name: "Directory new",
                  group: "API",
                  origin: "radioreference",
                },
              ],
            },
    }),
  );
  await page.reload();
  await page
    .getByText("Alias directory · RadioReference", { exact: true })
    .click();
  await page.getByLabel("RadioReference username").fill("test-only");
  await page.getByLabel("RadioReference password").fill("test-only");
  await page.getByRole("button", { name: "Look up ARMER aliases" }).click();
  await expect(page.getByLabel("RadioReference password")).toHaveValue("");
  await expect(page.getByLabel("Alias for 6620", { exact: true })).toHaveValue(
    'My Dispatch & "Ops"',
  );
  await page.getByLabel("Search talkgroups").fill("60001");
  await expect(page.getByLabel("Alias for 60001", { exact: true })).toHaveValue(
    "Directory new",
  );
  await expect(
    page.getByLabel("Listen to 60001", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Search talkgroups").fill("");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1120 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `artifacts/armer-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/armer-browser-results.json",
    JSON.stringify({ audioRms, xmlBytes: xml.length, errors }, null, 2),
  );
  console.log("ARMER browser passed:", {
    audioRms,
    xmlBytes: xml.length,
    errors,
  });
} finally {
  await browser.close();
}
