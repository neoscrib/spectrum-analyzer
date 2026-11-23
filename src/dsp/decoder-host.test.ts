import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DecoderHost } from "./decoder-host";
import { defaults } from "../model";
import type { DecoderRequest, DecoderReply } from "./decoder-protocol";

let workers: FakeWorker[];
class FakeWorker {
  onmessage?: (event: { data: DecoderReply }) => void;
  onerror?: (event: { message: string }) => void;
  messages: (DecoderRequest & { id: number })[] = [];
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
  postMessage(message: DecoderRequest & { id: number }) {
    this.messages.push(message);
    if (message.type === "configure")
      queueMicrotask(() => this.reply(message.id));
  }
  reply(id: number) {
    this.onmessage?.({ data: { type: "done", id } });
  }
}
const policy = { defaultListen: true, rules: [] };
beforeEach(() => {
  workers = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

it("keeps the worker for tuning/policy changes, but terminates it on every protocol switch", async () => {
  const host = new DecoderHost();
  await host.configure(defaults, policy, null);
  await host.configure(
    { ...defaults, center: defaults.center + 1000 },
    policy,
    null,
  );
  expect(workers).toHaveLength(1);
  expect(workers[0].terminate).not.toHaveBeenCalled();
  for (const decoder of [
    "nfm",
    "ook",
    "armer",
    "rtl433",
    "am",
    "wwv",
    "none",
    "wfm",
  ] as const) {
    const old = workers.at(-1)!;
    await host.configure({ ...defaults, decoder }, policy, null);
    expect(old.terminate).toHaveBeenCalledOnce();
  }
  host.dispose();
  expect(
    workers.every((worker) => worker.terminate.mock.calls.length === 1),
  ).toBe(true);
});

it("correlates replies and keeps a NFM hold identifier separate from the request identifier", async () => {
  const host = new DecoderHost();
  await host.configure(defaults, policy, null);
  const worker = workers[0];
  const first = host.request({ type: "nfm-hold", holdId: "frs-2" });
  const second = host.request({ type: "armer-policy", policy });
  const a = worker.messages.at(-2)!,
    b = worker.messages.at(-1)!;
  expect(a).toMatchObject({ type: "nfm-hold", holdId: "frs-2" });
  expect(a.id).not.toBe(b.id);
  let firstDone = false;
  void first.then(() => {
    firstDone = true;
  });
  worker.reply(b.id);
  await second;
  expect(firstDone).toBe(false);
  worker.reply(a.id);
  await first;
  host.dispose();
});

it("rejects pending work when a decoder fails or is terminated", async () => {
  const host = new DecoderHost();
  await host.configure(defaults, policy, null);
  const first = host.request({ type: "test", firstSample: 0 });
  const rejected = expect(first).rejects.toThrow("native failure");
  workers[0].onerror?.({ message: "native failure" });
  await rejected;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  await host.configure(defaults, policy, null);
  const second = host.request({ type: "test", firstSample: 0 });
  const replaced = expect(second).rejects.toThrow("replaced");
  host.dispose();
  await replaced;
});
