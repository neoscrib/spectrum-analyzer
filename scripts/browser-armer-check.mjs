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
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    postMessage(message, ...rest) {
      if (window.__armerPauseSamples && message.type === "test") return;
      if (window.__armerQuietSamples && message.type === "test") {
        const data = new Uint8Array(65536 * 2).fill(128).buffer;
        super.postMessage({ type: "iq", data, revision: message.revision }, [
          data,
        ]);
        return;
      }
      super.postMessage(message, ...rest);
    }
  };
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
  const nowPlaying = page.getByRole("region", {
    name: "Now Playing",
    exact: true,
  });
  const controlRow = page.getByTestId("armer-control-row");
  await expect(controlRow).toContainText("853.075000");
  await expect(controlRow.locator('[data-state="control"]')).toHaveText(
    "Control",
  );
  await expect(nowPlaying.locator("tbody tr").first()).toHaveAttribute(
    "data-testid",
    "armer-control-row",
  );
  await expect(
    nowPlaying.getByText("Audio paused", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("40F / BEE07", { exact: true })).toBeVisible();
  await expect(page.getByText("5 / 75 · 40C", { exact: true })).toBeVisible();
  const summary = page.getByTestId("armer-system-summary");
  await expect(summary).toBeHidden();
  await page.getByText("System summary", { exact: true }).click();
  await expect(summary).toContainText("BEE07 [781831]");
  await expect(summary).toContainText("40F [1039]");
  await expect(summary).toContainText("4B [75]");
  await expect(summary).toContainText("00 [0]");
  await expect(
    page.getByRole("table", { name: "Site control channels" }),
  ).toContainText("808.075000");
  await expect(
    page.getByRole("table", { name: "Site control channels" }),
  ).toContainText("853.875000");
  await expect(
    page.getByRole("table", { name: "Neighbor sites" }),
  ).toContainText("852.462500");
  await expect(
    page.getByRole("table", { name: "Neighbor sites" }),
  ).toContainText("Active RFSS connection");
  await expect(
    page.getByRole("table", { name: "Frequency bands" }),
  ).toContainText("762.006250");
  await expect(page.getByTestId("armer-callsign")).toHaveText("TEST123");
  await expect(page.getByTestId("armer-identification-channel")).toContainText(
    "853.07500 MHz · 0-331 · 0x014B",
  );
  const broadcasts = page.getByRole("table", {
    name: "System broadcast messages",
  });
  await expect(broadcasts).toBeHidden();
  await page.getByText("System broadcasts", { exact: true }).click();
  await expect(broadcasts).toBeVisible();
  await expect(broadcasts).toContainText("NET_STS");
  await expect(broadcasts.locator("tbody tr")).toHaveCount(7);
  await page.getByText("System broadcasts", { exact: true }).click();
  await expect(broadcasts).toBeHidden();
  await expect(
    page.getByRole("region", {
      name: "Control-channel information",
      exact: true,
    }),
  ).toContainText("NET_STS");
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
  await expect(nowPlaying.getByText("Playing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause audio", exact: true }).click();
  await expect(nowPlaying.getByText("Playing", { exact: true })).toHaveCount(0);
  await expect(controlRow).toBeVisible();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  // All groups muted must flush the AudioWorklet, retaining control state.
  const beforeMute = await valid();
  await page.getByRole("button", { name: "Mute all", exact: true }).click();
  await expect(
    page.getByLabel("Listen to 6620", { exact: true }),
  ).not.toBeChecked();
  await expect.poll(rms, { timeout: 5000 }).toBeLessThan(0.000001);
  await expect.poll(valid).toBeGreaterThan(beforeMute);
  await expect(
    nowPlaying.getByText("Muted", { exact: true }).first(),
  ).toBeVisible();
  await expect(controlRow).toBeVisible();
  await expect(page.getByTestId("armer-callsign")).toHaveText("TEST123");
  // One explicit enabled ID with unlisted groups disabled.
  await page.getByLabel("Listen to 6620", { exact: true }).check();
  await expect.poll(rms, { timeout: 12000 }).toBeGreaterThan(0.00001);
  const beforeAlias = await valid();
  await page
    .getByLabel("Alias for 6620", { exact: true })
    .fill('My Dispatch & "Ops"');
  await expect.poll(valid).toBeGreaterThan(beforeAlias);
  await expect(nowPlaying.locator('[data-talkgroup="6620"]')).toContainText(
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
  await expect(controlRow).toBeVisible();
  // Keep delivering real IQ to WASM, but remove the generated transmissions.
  // Control lock and active assignments must expire on the RF sample clock.
  await page.evaluate(() => {
    window.__armerQuietSamples = true;
  });
  await expect(controlRow).toHaveCount(0, { timeout: 5000 });
  await expect(nowPlaying.locator("tr[data-talkgroup]")).toHaveCount(0, {
    timeout: 7000,
  });
  await expect(nowPlaying).toContainText(
    "Waiting for active calls or control-channel data",
  );
  await page.evaluate(() => {
    window.__armerQuietSamples = false;
  });
  await expect(controlRow).toBeVisible({ timeout: 5000 });
  // Simulate a stalled sample transport after exercising the actual worker.
  // A stale Control/Playing row must not survive without fresh telemetry.
  await page.evaluate(() => {
    window.__armerPauseSamples = true;
  });
  await expect(controlRow).toHaveCount(0, { timeout: 5000 });
  await expect(nowPlaying.locator("tr[data-talkgroup]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect(nowPlaying).toContainText("Receiver stopped.");
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
