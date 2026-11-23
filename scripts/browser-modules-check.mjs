import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
});
const url = process.env.APP_URL || "http://127.0.0.1:5176";
const expected = {
  none: [],
  wfm: ["dsp_core", "wfm"],
  am: ["am", "dsp_core"],
  wwv: ["dsp_core", "wwv"],
  ook: ["dsp_core", "ook"],
  nfm: ["nfm"],
  armer: ["armer"],
  rtl433: ["dsp_core", "rtl433"],
};
const results = [];
function moduleName(url) {
  const file = new URL(url).pathname.split("/").at(-1);
  return file.startsWith("rtl433") ? "rtl433" : file.split("_bg")[0];
}
async function setup() {
  const context = await browser.newContext(),
    page = await context.newPage();
  const fetched = [],
    errors = [];
  page.on("request", (request) => {
    if (/\.wasm(?:\?|$)/.test(request.url()))
      fetched.push(moduleName(request.url()));
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "processed")
            window.__moduleFrame = {
              count: (window.__moduleFrame?.count ?? 0) + 1,
              revision: data.revision,
              samples: data.samples,
              events: data.events.map((e) => e.protocol ?? e.type),
            };
        });
      }
      postMessage(message, ...args) {
        // The UI's FM demo explicitly selects WFM. Override its worker config
        // only for the spectrum-only case; the real capture/FFT path still runs.
        if (window.__forceSpectrumOnly && message.type === "init")
          message = {
            ...message,
            settings: { ...message.settings, decoder: "none" },
          };
        if (window.__moduleQuiet && message.type === "test") {
          const data = new Uint8Array(131072).fill(128).buffer;
          super.postMessage({ type: "iq", revision: message.revision, data }, [
            data,
          ]);
          return;
        }
        if (message.settings)
          window.__moduleSettings = {
            ...message.settings,
            revision: message.revision,
          };
        super.postMessage(message, ...args);
      }
    };
  });
  await page.goto(url);
  return { context, page, fetched, errors };
}
async function select(page, decoder) {
  await page.getByLabel("Decoder", { exact: true }).selectOption(decoder);
}
async function frame(page, decoder) {
  await expect
    .poll(
      () =>
        page.evaluate((decoder) => {
          const s = window.__moduleSettings,
            f = window.__moduleFrame;
          return (
            s?.decoder === decoder &&
            f?.revision === s.revision &&
            f.samples > 0
          );
        }, decoder),
      { timeout: 12000 },
    )
    .toBe(true);
}
try {
  for (const [decoder, modules] of Object.entries(expected)) {
    console.log("Checking decoder dependencies:", decoder);
    const { context, page, fetched, errors } = await setup();
    await select(page, decoder);
    assert.deepEqual(
      fetched,
      [],
      "Metadata/selection before reception must not fetch WASM",
    );
    if (decoder === "none")
      await page.evaluate(() => {
        window.__forceSpectrumOnly = true;
      });
    await page.getByRole("button", { name: /^Try .*test signal$/ }).click();
    await frame(page, decoder);
    assert.deepEqual(
      [...new Set(fetched)].sort(),
      modules,
      `Unexpected dependencies for ${decoder}`,
    );
    assert.equal(page.workers().length, 2);
    await page
      .getByRole("button", { name: "Stop test signal", exact: true })
      .click();
    await expect.poll(() => page.workers().length).toBe(0);
    assert.deepEqual(errors, []);
    results.push({
      decoder,
      modules: [...new Set(fetched)].sort(),
      stoppedWorkers: true,
    });
    await context.close();
  }
  const { context, page, errors } = await setup();
  await page
    .getByRole("button", { name: "Try FM test signal", exact: true })
    .click();
  await frame(page, "wfm");
  const capture = page
    .workers()
    .find((worker) => /capture\.worker/.test(worker.url()));
  assert(capture);
  for (const decoder of [
    "nfm",
    "ook",
    "armer",
    "rtl433",
    "am",
    "wwv",
    "none",
    "wfm",
  ]) {
    const previous = page.workers().find((worker) => worker !== capture);
    const closed = previous.waitForEvent("close");
    await select(page, decoder);
    await frame(page, decoder);
    await closed;
    assert(
      page.workers().includes(capture),
      "Capture worker must survive protocol changes",
    );
    assert.equal(
      page.workers().length,
      2,
      "Old decoder workers must not accumulate",
    );
  }
  await page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect.poll(() => page.workers().length).toBe(0);
  assert.deepEqual(errors, []);
  await context.close();

  // Hold the first NFM download open while delivering live-shaped CU8 blocks.
  // A slow optional decoder must not freeze capture or accumulate USB backlog.
  const delayed = await setup();
  let releaseDownload, downloadStarted;
  const release = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const arrived = new Promise((resolve) => {
    downloadStarted = resolve;
  });
  await delayed.context.route(
    /\/nfm_bg[^/]*\.wasm(?:\?.*)?$/,
    async (route) => {
      downloadStarted();
      await release;
      await route.continue();
    },
  );
  await delayed.page
    .getByRole("button", { name: "Try FM test signal", exact: true })
    .click();
  await frame(delayed.page, "wfm");
  await delayed.page.evaluate(() => {
    window.__moduleQuiet = true;
  });
  await select(delayed.page, "nfm");
  await arrived;
  const before = await delayed.page.evaluate(() => window.__moduleFrame.count);
  try {
    await expect
      .poll(() => delayed.page.evaluate(() => window.__moduleFrame.count), {
        timeout: 3000,
      })
      .toBeGreaterThan(before + 12);
    assert.deepEqual(
      await delayed.page.evaluate(() => window.__moduleFrame.events),
      [],
    );
  } finally {
    releaseDownload();
  }
  await expect
    .poll(
      () =>
        delayed.page.evaluate(() =>
          window.__moduleFrame.events.includes("nfm"),
        ),
      { timeout: 12000 },
    )
    .toBe(true);
  await delayed.page
    .getByRole("button", { name: "Stop test signal", exact: true })
    .click();
  await expect.poll(() => delayed.page.workers().length).toBe(0);
  assert.deepEqual(delayed.errors, []);
  await delayed.context.close();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/modules-browser-results.json",
    JSON.stringify(
      {
        results,
        switching:
          "All decoder transitions retained capture and closed the previous decoder worker",
        delayedDownload:
          "Capture continued while NFM was blocked; decoding began after download",
      },
      null,
      2,
    ),
  );
  console.log("Lazy WASM modules and worker disposal:", results);
} finally {
  await browser.close();
}
