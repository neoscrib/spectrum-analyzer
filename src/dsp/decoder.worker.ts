import { decoderTransfers } from "./decoder-events";
import { liveInput, type DecoderInput } from "../meteor/model";
import type { Settings } from "../model";
import { createDecoder, type DecoderPlugin } from "./plugins";
import type { DecoderRequest, DecoderReply } from "./decoder-protocol";
import { createTestSource, type TestSource } from "./test-source";

let settings: Settings;
let decoder: DecoderPlugin | undefined;
let source: TestSource | undefined;
let configuration: Extract<DecoderRequest, { type: "configure" }>;
let input: DecoderInput = liveInput;
let expectedSample: number | undefined;
let loading = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<DecoderRequest & { id: number }>) => {
  loading = loading
    .then(async () => {
      switch (data.type) {
        case "same-options":
          // Optional WASM download must not block the live IQ request queue.
          // Adapter epochs cancel stale loads when disabled or disposed.
          void decoder?.setSameOptions?.(data.options);
          settings = { ...settings, same: data.options };
          break;
        case "configure":
          configuration = data;
          input = data.input ?? liveInput;
          expectedSample = undefined;
          decoder?.dispose();
          decoder = undefined;
          decoder = await createDecoder(
            data.settings,
            data.policy,
            data.monitor,
            input,
          );
          settings = data.settings;
          decoder?.setMultiplexEnabled?.(data.multiplex);
          break;
        case "meteor-bias":
          decoder?.setMeteorBias?.(data.command);
          if (data.command.action === "apply") {
            settings = {
              ...settings,
              meteor: {
                ...settings.meteor,
                frequencyBiasHz: data.command.biasHz,
              },
            };
            if (input.replay)
              input = {
                ...input,
                replay: {
                  ...input.replay,
                  frequencyOffsetHz: data.command.biasHz,
                },
              };
          }
          if (data.command.action === "auto") {
            settings = {
              ...settings,
              meteor: { ...settings.meteor, autoBias: data.command.enabled },
            };
            if (input.replay)
              input = {
                ...input,
                replay: { ...input.replay, autoBias: data.command.enabled },
              };
          }
          break;
        case "wfm-multiplex":
          decoder?.setMultiplexEnabled?.(data.enabled);
          break;
        case "wfm-stereo":
          decoder?.setStereoEnabled?.(data.enabled);
          settings = { ...settings, stereo: data.enabled };
          break;
        case "wfm-rds":
          decoder?.setRdsEnabled?.(data.enabled);
          settings = { ...settings, rds: data.enabled };
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
          if (
            settings.decoder === "meteor" &&
            expectedSample !== undefined &&
            expectedSample !== data.firstSample
          ) {
            decoder?.dispose();
            decoder = await createDecoder(
              settings,
              configuration.policy,
              configuration.monitor,
              input,
            );
          }
          const events =
            iq.length === 0 && decoder?.finish
              ? decoder.finish()
              : (decoder?.process(iq, data.firstSample) ?? []);
          expectedSample =
            data.firstSample +
            iq.byteLength /
              (input.format === "cu8" ? 2 : input.format === "cs16" ? 4 : 8);
          const block = { data: iq.buffer as ArrayBuffer, events };
          postMessage(
            { type: "done", id: data.id, block } satisfies DecoderReply,
            [block.data, ...decoderTransfers(events)],
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
