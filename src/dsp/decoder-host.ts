import type { Settings } from "../model";
import type { ArmerPolicy } from "../armer/model";
import type { NfmMonitorConfig } from "../presets/model";
import type {
  DecoderRequest,
  DecoderReply,
  DecodedBlock,
} from "./decoder-protocol";

/** Capture owns this host. A protocol change terminates the whole decoder realm:
 * glue caches, WASM instances and linear memories. FFT and recording stay here. */
export class DecoderHost {
  private worker?: Worker;
  private kind?: Settings["decoder"];
  private sequence = 0;
  private generation = 0;
  ready = false;
  private pending = new Map<
    number,
    { resolve: (block?: DecodedBlock) => void; reject: (error: Error) => void }
  >();

  async configure(
    settings: Settings,
    policy: ArmerPolicy,
    monitor: NfmMonitorConfig | null,
    multiplex = false,
  ) {
    if (this.kind !== settings.decoder) this.dispose();
    const generation = ++this.generation;
    this.ready = false;
    this.kind = settings.decoder;
    if (!this.worker) {
      const worker = new Worker(
        new URL("./decoder.worker.ts", import.meta.url),
        { type: "module", name: `decoder-${settings.decoder}` },
      );
      this.worker = worker;
      worker.onmessage = ({ data }: MessageEvent<DecoderReply>) => {
        const request = this.pending.get(data.id);
        if (!request) return;
        this.pending.delete(data.id);
        if (data.type === "error") request.reject(Error(data.message));
        else request.resolve(data.block);
      };
      worker.onerror = (event) =>
        this.dispose(Error(event.message || "The decoder worker failed."));
      worker.onmessageerror = () =>
        this.dispose(Error("The decoder returned an unreadable message."));
    }
    await this.request({
      type: "configure",
      settings,
      policy,
      monitor,
      multiplex,
    });
    if (generation === this.generation) this.ready = true;
  }

  request(message: DecoderRequest): Promise<DecodedBlock | undefined> {
    const worker = this.worker;
    if (!worker)
      return Promise.reject(Error("The decoder worker is unavailable."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage(
          { ...message, id },
          message.type === "process" ? [message.data] : [],
        );
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  dispose(error = Error("The decoder was replaced.")) {
    this.generation++;
    this.ready = false;
    this.worker?.terminate();
    this.worker = undefined;
    this.kind = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
