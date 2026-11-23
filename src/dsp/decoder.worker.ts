import type { Settings } from "../model";
import { createDecoder, type DecoderPlugin } from "./plugins";
import type { DecoderRequest, DecoderReply } from "./decoder-protocol";
import { createTestSource, type TestSource } from "./test-source";

let settings: Settings;
let decoder: DecoderPlugin | undefined;
let source: TestSource | undefined;
let loading = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<DecoderRequest & { id: number }>) => {
  loading = loading
    .then(async () => {
      switch (data.type) {
        case "configure":
          decoder?.dispose();
          decoder = undefined;
          decoder = await createDecoder(
            data.settings,
            data.policy,
            data.monitor,
          );
          settings = data.settings;
          break;
        case "recenter":
          if (!decoder?.recenter)
            throw Error(
              "This decoder cannot preserve state while recentering.",
            );
          decoder.recenter(data.settings);
          settings = data.settings;
          break;
        case "armer-policy":
          decoder?.setPolicy?.(data.policy);
          break;
        case "nfm-hold":
          decoder?.setHold?.(data.holdId);
          break;
        case "test":
        case "process": {
          const iq =
            data.type === "test"
              ? (source ??= await createTestSource(settings.decoder)).process(
                  settings.center,
                )
              : new Uint8Array(data.data);
          const events = decoder?.process(iq, data.firstSample) ?? [];
          const block = { data: iq.buffer as ArrayBuffer, events };
          postMessage(
            { type: "done", id: data.id, block } satisfies DecoderReply,
            [
              block.data,
              ...events.flatMap((e) =>
                e.type === "audio" ? [e.samples.buffer] : [],
              ),
            ],
          );
          return;
        }
      }
      postMessage({ type: "done", id: data.id } satisfies DecoderReply);
    })
    .catch((error) =>
      postMessage({
        type: "error",
        id: data.id,
        message: error instanceof Error ? error.message : String(error),
      } satisfies DecoderReply),
    );
};
