import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const context = await browser.newContext({
  serviceWorkers: process.env.CHECK_OFFLINE ? "allow" : "block",
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [],
  fetched = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (/\.wasm(?:\?|$)/.test(request.url())) fetched.push(request.url());
});
await page.addInitScript(() => {
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data.type === "processed") {
          window.__meteorFrame = { ...data, events: undefined };
          window.__meteorCpu ??= [];
          if (data.samples)
            window.__meteorCpu.push(
              (data.elapsed /
                ((data.samples / (data.sampleRate ?? 2400000)) * 1000)) *
                100,
            );
          window.__meteorCpu = window.__meteorCpu.slice(-100);
        }
      });
    }
  };
});
const hashCanvas = () =>
  page.getByLabel(/Decoded satellite image APID/).evaluate(async (canvas) => {
    const rgba = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let n = 0; n < gray.length; n++) gray[n] = rgba[n * 4];
    return {
      width: canvas.width,
      height: canvas.height,
      hash: [...new Uint8Array(await crypto.subtle.digest("SHA-256", gray))]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join(""),
    };
  });
const expected = [
  [64, 656, "261a1e920279c9990a1473cf52fae0f70545cdec3d186967333515b5fcddca57"],
  [65, 664, "852ac3c0184098790814df882b746707cc81a0deb0289801081001561fe8f881"],
  [68, 656, "348a42a18e009d0a3564decfd5dc1d1fd8d9fa389b27afad5faeea811949532c"],
];
async function startReplay() {
  await page
    .getByRole("button", { name: "Replay Meteor IQ", exact: true })
    .click();
  await expect(page.getByTestId("meteor-replay-status")).toContainText(
    "Replaying",
    { timeout: 15000 },
  );
}
async function complete() {
  await expect(page.getByTestId("meteor-replay-status")).toContainText(
    "Replay complete",
    { timeout: 60000 },
  );
  await expect(page.getByTestId("meteor-frames")).toHaveText("903 / 17");
  await expect(page.getByTestId("meteor-strips")).toHaveText("3519 / 3437");
  await expect.poll(() => page.workers().length).toBe(0);
}
try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:5176");
  if (process.env.CHECK_OFFLINE) {
    await page.getByRole("button", { name: /^Install app$/ }).click();
    await expect(page.getByRole("dialog")).toContainText(/Offline ready/i, {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Close app options" }).click();
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
  }
  await page.getByLabel("Decoder", { exact: true }).selectOption("meteor");
  await expect(
    page.getByRole("region", { name: "Meteor-M decoder" }),
  ).toBeVisible();
  if (!process.env.CHECK_OFFLINE)
    assert.equal(fetched.length, 0, "Selecting metadata/UI must not load WASM");
  await page.getByText("Replay recorded I/Q", { exact: true }).click();
  await page
    .getByLabel("Meteor IQ recording", { exact: true })
    .setInputFiles("fixtures/meteor_m2_72k.wav");
  const start = performance.now();
  await startReplay();
  await complete();
  const replaySeconds = (performance.now() - start) / 1000;
  let modern;
  const channels = [];
  for (const [apid, height, hash] of expected) {
    await page
      .getByRole("button", { name: new RegExp(`^CH ${apid - 63} ·`) })
      .click();
    await expect.poll(async () => (await hashCanvas()).hash).toBe(hash);
    channels.push({ apid, ...(await hashCanvas()) });
  }
  assert.equal(await page.getByLabel("Audio volume").isVisible(), true);
  await expect(
    page.getByRole("button", { name: "Play audio", exact: true }),
  ).toBeDisabled();
  if (!process.env.CHECK_OFFLINE)
    assert.equal(
      fetched.filter((url) => !/meteor[^/]*\.wasm/.test(url)).length,
      0,
      "Meteor must not load another decoder",
    );
  await page.getByLabel("Enhance display contrast", { exact: true }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export APID 68 PNG" }).click();
  const png = await downloadPromise;
  await png.saveAs("artifacts/meteor-browser-raw.png");
  const base64 = (await readFile(await png.path())).toString("base64");
  const rawHash = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      gray = new Uint8Array(canvas.width * canvas.height);
    for (let n = 0; n < gray.length; n++) gray[n] = rgba[n * 4];
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", gray))]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }, base64);
  assert.equal(
    rawHash,
    expected[2][2],
    "Enhancement must not change exported pixels",
  );
  await page.getByLabel("Satellite image zoom").selectOption("1");
  const viewport = page.locator(".meteor-image-scroll");
  await viewport.scrollIntoViewIfNeeded();
  assert(await viewport.evaluate((e) => e.scrollWidth > e.clientWidth));
  const bounds = await viewport.boundingBox();
  await page.mouse.move(bounds.x + 220, bounds.y + 50);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 50, { steps: 5 });
  await page.mouse.up();
  assert(await viewport.evaluate((e) => e.scrollLeft > 0));
  await page.getByLabel("Satellite image zoom").selectOption("fit");
  await page.screenshot({
    path: "artifacts/meteor-browser.png",
    fullPage: true,
  });
  await page
    .locator(".meteor-diagnostics")
    .screenshot({ path: "artifacts/meteor-diagnostics.png" });
  await page
    .locator(".meteor-channel")
    .screenshot({ path: "artifacts/meteor-image.png" });
  await page.getByLabel("Enhance display contrast", { exact: true }).uncheck();
  // Fresh replay must reset all DSP and image state, with identical pixels.
  await startReplay();
  await complete();
  await page.getByRole("button", { name: /^CH 1 ·/ }).click();
  await expect.poll(async () => (await hashCanvas()).hash).toBe(expected[0][2]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "artifacts/meteor-imagery-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  if (process.env.METEOR_PRIVATE_TESTS) {
    const profilePath =
      "/home/tanner/code/meteor-m/artifacts/nov20-recovered/replay-settings.json";
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    await page
      .getByLabel("Meteor replay metadata", { exact: true })
      .setInputFiles(profilePath);
    await expect(
      page.getByLabel("Meteor replay adjustment", { exact: true }),
    ).toHaveValue("-2607");
    await page
      .getByLabel("Meteor IQ recording", { exact: true })
      .setInputFiles(
        process.env.METEOR_CAPTURE ||
          "/home/tanner/meteor-m/2026-11-20T15-57-20.118Z/" +
            profile.source.name,
      );
    const started = performance.now();
    await startReplay();
    await expect(page.getByTestId("meteor-replay-status")).toContainText(
      "Replay complete",
      { timeout: 120000 },
    );
    await expect(page.getByTestId("meteor-frames")).toContainText("1891 /");
    await expect(page.getByTestId("meteor-strips")).toHaveText("7467 / 7295");
    for (const image of profile.expected.channels) {
      await page
        .getByRole("button", { name: new RegExp(`^CH ${image.apid - 63} ·`) })
        .click();
      await expect
        .poll(async () => (await hashCanvas()).hash)
        .toBe(image.sha256);
    }
    modern = {
      frames: 1891,
      strips: 7295,
      seconds: (performance.now() - started) / 1000,
    };
    console.log("Modern real browser replay matched all hashes:", modern);
    await page.screenshot({
      path: "artifacts/meteor-modern-browser.png",
      fullPage: true,
    });
  }
  // Interrupt and restart the same source; no orphaned workers or sample queue.
  await page
    .getByRole("button", { name: "Replay Meteor IQ", exact: true })
    .click();
  await expect(page.getByTestId("meteor-replay-status")).toContainText(
    "Replaying",
  );
  await page.getByRole("button", { name: "Stop replay", exact: true }).click();
  await expect.poll(() => page.workers().length).toBe(0);
  await page.evaluate(() => {
    window.__meteorCpu = [];
  });
  await page
    .getByRole("button", { name: "Try Meteor noise test signal", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__meteorCpu.length))
    .toBeGreaterThan(10);
  await expect(page.getByTestId("meteor-frames")).toHaveText(/^0 \/ \d+$/);
  await expect(page.getByTestId("meteor-strips")).toHaveText("0 / 0");
  await expect(page.getByLabel(/Decoded satellite image APID/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  const cpu = await page.evaluate(() => window.__meteorCpu.slice(-10));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "artifacts/meteor-browser-mobile.png",
    fullPage: true,
  });
  await mkdir("artifacts", { recursive: true });
  const result = {
    offline: Boolean(process.env.CHECK_OFFLINE),
    replaySeconds,
    frames: 903,
    packets: 3519,
    strips: 3437,
    channels,
    modern,
    rawExportUnchanged: true,
    repeatReplay: true,
    interruptedReplay: true,
    noiseCpuPercent: cpu,
    errors,
  };
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/meteor-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
