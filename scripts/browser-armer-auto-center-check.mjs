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
  const Original = window.Worker;
  window.__autoMoves = [];
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data.type !== "processed") return;
        const status = data.events.find(
          (e) => e.type === "telemetry" && e.protocol === "armer",
        )?.status;
        if (!status) return;
        window.__autoStatus = status;
        const move = window.__autoMoves.find(
          (m) => m.revision === data.revision && !m.after,
        );
        if (move) move.after = status;
      });
    }
    postMessage(message, ...rest) {
      if (message.type === "recording") window.__autoRecording = message.id > 0;
      if (message.type === "recenter")
        window.__autoMoves.push({
          center: message.settings.center,
          control: message.settings.channel,
          revision: message.revision,
          recording: window.__autoRecording === true,
          before: window.__autoStatus,
        });
      super.postMessage(message, ...rest);
    }
  };
});
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  await page.getByLabel("Decoder", { exact: true }).selectOption("armer");
  const auto = page.getByLabel("Auto-center active talkgroups", {
    exact: true,
  });
  await expect(auto).toBeChecked();
  await auto.uncheck();
  await page
    .getByRole("button", { name: "Try ARMER test signal", exact: true })
    .click();
  const center = page.getByLabel("CENTER FREQUENCY", { exact: true });
  await center.fill("854.1000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await expect(page.getByTestId("armer-control-row")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Now Playing", exact: true }),
  ).toContainText("Outside capture");
  await auto.check();
  await expect(center).not.toHaveValue("854.1000", { timeout: 18000 });
  await expect(
    page.getByLabel("Control frequency", { exact: true }),
  ).toHaveValue("853.0750");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Now Playing", exact: true })
      .getByText("Playing", { exact: true }),
  ).toBeVisible({ timeout: 14000 });
  const first = await page.evaluate(() => window.__autoMoves[0]);
  assert.equal(first.control, 853075000);
  assert(first.after.valid >= first.before.valid);
  assert(first.after.seconds >= first.before.seconds);
  assert.equal(
    first.after.information.site.site,
    first.before.information.site.site,
  );
  assert.equal(
    first.after.information.bands.length,
    first.before.information.bands.length,
  );
  assert(first.after.calls.some((c) => c.inCapture && c.talkgroup !== 43216));
  // Display zoom is independent of the RF optimizer and does not restart it.
  const tuned = await center.inputValue();
  await page.getByLabel("DISPLAY SPAN", { exact: true }).selectOption("300000");
  await expect(center).toHaveValue(tuned);
  // A recording must retain one RF center throughout, then optimization resumes.
  await auto.uncheck();
  await center.fill("854.1000");
  await page.getByRole("button", { name: "Tune", exact: true }).click();
  await page
    .getByLabel("Save destination", { exact: true })
    .selectOption("download");
  await page
    .getByLabel("Recording duration", { exact: true })
    .selectOption("10");
  await page.getByRole("button", { name: "Record IQ", exact: true }).click();
  await auto.check();
  await expect(
    page.getByText("Auto-centering paused while recording IQ.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download SigMF metadata", exact: true }),
  ).toBeVisible({ timeout: 22000 });
  const moves = await page.evaluate(() => window.__autoMoves);
  assert(moves.every((m) => !m.recording));
  await expect(page.getByRole("alert")).toHaveCount(0);
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download SigMF metadata", exact: true })
    .click();
  await (await downloading).saveAs("artifacts/armer-auto-center.sigmf-meta");
  const metadata = JSON.parse(
    await readFile("artifacts/armer-auto-center.sigmf-meta", "utf8"),
  );
  assert.equal(metadata.captures[0]["core:frequency"], 854100000);
  assert.equal(metadata.annotations[0]["core:sample_count"], 24000000);
  await expect(center).not.toHaveValue("854.1000", { timeout: 18000 });
  assert((await page.evaluate(() => window.__autoMoves.length)) >= 2);
  await expect(page.getByTestId("armer-control-row")).toBeVisible();
  await page.screenshot({
    path: "artifacts/armer-auto-center.png",
    fullPage: true,
  });
  await auto.uncheck();
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await page.reload();
  await expect(auto).not.toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  assert.deepEqual(errors, []);
  const result = {
    firstMove: first,
    recordingFrequency: metadata.captures[0]["core:frequency"],
    samples: metadata.annotations[0]["core:sample_count"],
    errors,
  };
  await writeFile(
    "artifacts/armer-auto-center-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log("ARMER auto-centering:", {
    center: first.center,
    control: first.control,
    beforeValid: first.before.valid,
    afterValid: first.after.valid,
    recordingFrequency: result.recordingFrequency,
    errors,
  });
} catch (error) {
  await page.screenshot({
    path: "artifacts/armer-auto-center-failure.png",
    fullPage: true,
  });
  await writeFile(
    "artifacts/armer-auto-center-failure.txt",
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  await browser.close();
}
