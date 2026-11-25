import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tmpdir } from "node:os";
await mkdir("artifacts", { recursive: true });

const root = resolve("dist");
const originalSw = await readFile(resolve(root, "sw.js"), "utf8");
let version = 1,
  requests = 0,
  failDecoder = false;
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  requests++;
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (failDecoder && /nfm_bg.*\.wasm$/.test(path)) {
      res.writeHead(503).end();
      return;
    }
    if (path.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"private":true}');
      return;
    }
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(root + "/")) {
      res.writeHead(404).end();
      return;
    }
    let contents = await readFile(file);
    if (path === "/sw.js" && version === 2)
      contents = Buffer.from(originalSw + "\n/* test-update */");
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Permissions-Policy": "usb=(self)",
    });
    res.end(contents);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port,
  url = `http://127.0.0.1:${port}`;
const profile = await mkdtemp(join(tmpdir(), "spectrum-pwa-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  viewport: { width: 1440, height: 1100 },
  args: ["--bypass-app-banner-engagement-checks"],
});
await context.addInitScript(() => {
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", ({ data }) => {
        if (data.type === "processed") {
          const events = data.events.map((event) => ({
            ...event,
            samples: event.samples?.length,
          }));
          window.__offlineFrame = { ...data, events };
          window.__offlineEvents = [
            ...(window.__offlineEvents ?? []),
            ...events,
          ].slice(-256);
        }
      });
    }
  };
  const Audio = window.AudioContext;
  window.AudioContext = class extends Audio {
    createGain() {
      const gain = super.createGain(),
        analyser = this.createAnalyser();
      gain.connect(analyser);
      window.__offlineAudio = analyser;
      return gain;
    }
  };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function options() {
  await page.getByRole("button", { name: "Install app", exact: true }).click();
}
async function closeOptions() {
  await page.getByRole("button", { name: "Close app options" }).click();
}
try {
  await page.goto(url);
  await options();
  await expect(
    page
      .getByRole("status", { name: "Offline app availability" })
      .filter({ hasText: "Offline ready" }),
  ).toBeVisible({ timeout: 20000 });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  assert.deepEqual(manifest.errors, []);
  const metadata = JSON.parse(manifest.data);
  assert.equal(metadata.display, "standalone");
  assert(metadata.icons.some((icon) => icon.sizes === "192x192"));
  assert(metadata.icons.some((icon) => icon.sizes === "512x512"));
  const installability = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors, []);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys(),
      cache = await caches.open(
        names.find((name) => name.startsWith("spectrum-precache-")),
      );
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  assert.equal(cached.filter((path) => path.endsWith(".wasm")).length, 10);
  assert(cached.some((path) => /same_bg.*\.wasm$/.test(path)));
  assert(cached.includes("/audio-worklet.js"));
  assert(cached.some((path) => path.includes("capture.worker")));
  assert(cached.some((path) => path.includes("decoder.worker")));
  assert(cached.includes("/licenses/rtl_433-25.12-source.tar.gz"));
  await closeOptions();
  await page.evaluate(async () => {
    await fetch("/api/private", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"password":"test-only"}',
    });
    await fetch("/api/private");
  });
  // Fresh page and cold decoder workers, while both the browser network and
  // origin server are unavailable. Every decoder starts from cached files.
  await context.setOffline(true);
  await new Promise((resolve) => server.close(resolve));
  const count = requests;
  await page.reload();
  await options();
  await expect(
    page
      .getByRole("status", { name: "Offline app availability" })
      .filter({ hasText: "Offline ready" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Offline app availability" }),
  ).toContainText("You’re offline");
  await page.screenshot({ path: "artifacts/pwa-offline-desktop.png" });
  await closeOptions();
  assert(await page.evaluate(() => !!navigator.usb));
  const decoded = [];
  for (const decoder of [
    "meteor",
    "rtl433",
    "armer",
    "ook",
    "nfm",
    "am",
    "wwv",
    "wfm",
  ]) {
    console.log("Starting cold decoder offline:", decoder);
    await page.getByLabel("Decoder", { exact: true }).selectOption(decoder);
    await page.evaluate(() => {
      window.__offlineFrame = null;
      window.__offlineEvents = [];
    });
    await page.getByRole("button", { name: /^Try .*test signal$/ }).click();
    await expect
      .poll(
        () =>
          page.evaluate((kind) => {
            return window.__offlineEvents?.some((event) => {
              if (kind === "am")
                return event.type === "audio" && event.samples > 0;
              if (event.protocol !== kind) return false;
              if (kind === "meteor")
                return (
                  event.protocol === "meteor" && event.type === "telemetry"
                );
              if (kind === "rtl433" || kind === "ook")
                return event.type === "message";
              if (kind === "armer") return event.status?.valid > 0;
              if (kind === "nfm")
                return event.status?.channels.some(
                  (channel) => channel.carrier,
                );
              if (kind === "wfm") return event.stereo;
              return event.status?.samples > 0;
            });
          }, decoder),
        { timeout: 12000 },
      )
      .toBe(true);
    if (decoder === "wfm") {
      const play = page.getByRole("button", {
        name: "Play audio",
        exact: true,
      });
      if (await play.isEnabled()) await play.click();
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const analyser = window.__offlineAudio;
              if (!analyser) return 0;
              const data = new Float32Array(analyser.fftSize);
              analyser.getFloatTimeDomainData(data);
              return Math.sqrt(
                data.reduce((sum, value) => sum + value * value, 0) /
                  data.length,
              );
            }),
          { timeout: 6000 },
        )
        .toBeGreaterThan(0.02);
      await page
        .getByLabel("Save destination", { exact: true })
        .selectOption("download");
      await page
        .getByLabel("Recording duration", { exact: true })
        .selectOption("2");
      await page
        .getByRole("button", { name: "Record IQ", exact: true })
        .click();
      await expect(page.getByTestId("iq-recording-status")).toHaveText(
        "Ready to download",
        { timeout: 10000 },
      );
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download IQ (.cu8)", exact: true })
        .click();
      await (await download).saveAs("artifacts/pwa-offline-recording.cu8");
      assert.equal(
        (await readFile("artifacts/pwa-offline-recording.cu8")).length,
        9600000,
      );
    }
    decoded.push(decoder);
    await page
      .getByRole("button", { name: "Stop test signal", exact: true })
      .click();
  }
  const same = page.getByRole("region", { name: "EAS/SAME reception" });
  await same
    .getByText("Recorded audio, IQ replay & generated test", { exact: true })
    .click();
  await same
    .getByRole("button", {
      name: "Decode generated SAME test audio",
      exact: true,
    })
    .click();
  await expect(
    same.getByText("Repeated headers agree", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(requests, count, "Offline decoding must not contact the origin");
  // Verify that credential-bearing API requests are never added to the cache.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const name of await caches.keys())
          for (const request of await (await caches.open(name)).keys())
            if (new URL(request.url).pathname.startsWith("/api/")) return false;
        return true;
      }),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await options();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "artifacts/pwa-offline-mobile.png" });
  await closeOptions();
  // Serve a new SW version and prove updates wait during reception and while
  // another window is open; only an explicit idle update changes controllers.
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  await context.setOffline(false);
  await page.evaluate(async () => {
    const name = (await caches.keys()).find((name) =>
      name.startsWith("spectrum-precache-"),
    );
    await (
      await caches.open(name)
    ).put("/obsolete-asset", new Response("old version"));
  });
  version = 2;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting,
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Try FM test signal", exact: true })
    .click();
  await options();
  await expect(
    page.getByRole("button", { name: "Update and reload" }),
  ).toBeDisabled();
  await closeOptions();
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  const second = await context.newPage();
  await second.goto(url);
  await options();
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Close other Spectrum windows",
  );
  await second.close();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Update and reload" }).click(),
  ]);
  const cacheNames = await page.evaluate(() => caches.keys());
  assert.equal(
    cacheNames.filter((name) => name.startsWith("spectrum-precache-")).length,
    1,
  );
  assert(
    await page.evaluate(async () => {
      const name = (await caches.keys()).find((name) =>
        name.startsWith("spectrum-precache-"),
      );
      return !(await (await caches.open(name)).match("/obsolete-asset"));
    }),
  );
  assert.deepEqual(errors, []);
  // A missing decoder must prevent a misleading "offline ready" result. Once
  // the connection recovers, a retry must complete the complete cache install.
  failDecoder = true;
  const failedContext = await context.browser().newContext();
  const failedPage = await failedContext.newPage();
  await failedPage.goto(url);
  await failedPage
    .getByRole("button", { name: "Install app", exact: true })
    .click();
  await expect(
    failedPage.getByRole("status", { name: "Offline app availability" }),
  ).toContainText("Offline setup incomplete", { timeout: 15000 });
  assert(
    !(await failedPage.evaluate(
      async () => !!navigator.serviceWorker.controller,
    )),
  );
  failDecoder = false;
  await failedPage.getByRole("button", { name: "Retry offline setup" }).click();
  await expect(
    failedPage.getByRole("status", { name: "Offline app availability" }),
  ).toContainText("Offline ready", { timeout: 20000 });
  await failedContext.close();
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  const restarted = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
  });
  try {
    await restarted.setOffline(true);
    const reopened = await restarted.newPage();
    await reopened.goto(url);
    await reopened
      .getByRole("button", { name: "Install app", exact: true })
      .click();
    await expect(
      reopened.getByRole("status", { name: "Offline app availability" }),
    ).toContainText("Offline ready", { timeout: 15000 });
  } finally {
    await restarted.close();
  }
  const result = {
    installability,
    cachedFiles: cached.length,
    offlineDecoders: decoded,
    offlineAudio: true,
    offlineSame: true,
    offlineRecordingBytes: 9600000,
    browserRestart: true,
    serverStoppedReload: true,
    deferredUpdate: true,
    multiWindowUpdateGuard: true,
    incompleteCacheRetry: true,
    errors,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/pwa-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log("Installable/offline app:", result);
} catch (error) {
  if (!page.isClosed())
    console.error(
      "PWA failure details:",
      await page.evaluate(() => ({
        alerts: [...document.querySelectorAll('[role="alert"]')].map(
          (node) => node.textContent,
        ),
        frame: window.__offlineFrame
          ? {
              revision: window.__offlineFrame.revision,
              samples: window.__offlineFrame.samples,
              events: window.__offlineFrame.events.map((event) => ({
                type: event.type,
                protocol: event.protocol,
              })),
            }
          : null,
      })),
    );
  await page.screenshot({ path: "artifacts/pwa-failure.png", fullPage: true });
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
