import { SameAudio } from "../dsp/same-audio";
import { inspectAudioWav, monoAudio } from "./wav";
import { sameFixture } from "./fixtures";
import type { SameBatch } from "./model";
interface Request {
  file?: File;
  generated?: boolean;
  attention: boolean;
  reference: string;
}
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  let audio: SameAudio | undefined;
  try {
    const format = data.file ? await inspectAudioWav(data.file) : undefined;
    const rate = format?.rate ?? 48000;
    audio = new SameAudio(
      rate,
      data.file ? `Audio file: ${data.file.name}` : "GENERATED test audio",
      null,
    );
    await audio.configure({ enabled: true, attention: data.attention });
    const generated = data.generated
      ? sameFixture(rate, undefined, { attention: "noaa1050" })
      : undefined;
    const length = format ? format.length / format.stride : generated!.length;
    let last = -Infinity;
    const send = (batches: ReturnType<SameAudio["process"]>, force = false) => {
      for (const event of batches)
        if (event.type === "same") {
          if (
            force ||
            event.batch.events.length ||
            performance.now() - last > 180
          ) {
            const batch: SameBatch = {
              ...event.batch,
              source: data.file ? "file" : "generated",
              referenceTime: data.reference,
            };
            postMessage({ type: "batch", batch });
            last = performance.now();
          }
        }
    };
    for (let at = 0; at < length; at += 16384) {
      const count = Math.min(16384, length - at);
      const samples = format
        ? monoAudio(
            await data
              .file!.slice(
                format.offset + at * format.stride,
                format.offset + (at + count) * format.stride,
              )
              .arrayBuffer(),
            format,
          )
        : generated!.subarray(at, at + count);
      send(audio.process(samples, 0));
      if (performance.now() - last > 180)
        postMessage({ type: "progress", fraction: (at + count) / length });
    }
    send(audio.finish(), true);
    postMessage({ type: "complete", samples: length, rate });
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    audio?.dispose();
    self.close();
  }
};
