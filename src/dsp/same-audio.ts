import type {
  SameOptions,
  SameNativeEvent,
  SameDiagnostics,
  SameBatch,
} from "../same/model";
import type { DecoderEvent } from "../types";
import type { SameDecoder } from "../wasm/same";
let loaded: Promise<typeof import("../wasm/same")> | undefined;
function loadSame() {
  return (loaded ??= (async () => {
    const module = await import("../wasm/same");
    await module.default();
    return module;
  })());
}

/** One optional, separately loaded audio modem per continuous demodulator stream.
 * No IQ, speaker gain, squelch state or RF resampling enters the SAME module. */
export class SameAudio {
  private native?: SameDecoder;
  private revision = 0;
  private failure?: string;
  get active() {
    return !!this.native;
  }
  private elapsed = 0;
  private origin?: number;
  private samples = 0;
  private reported = 0;
  constructor(
    private rate: number,
    private stream: string,
    private frequency: number | null,
  ) {}
  async configure(options: SameOptions) {
    const revision = ++this.revision;
    if (!options.enabled) {
      this.dispose();
      return;
    }
    if (!this.native) {
      let module: Awaited<ReturnType<typeof loadSame>>;
      try {
        module = await loadSame();
      } catch (error) {
        if (revision === this.revision)
          this.failure = `SAME could not load: ${String(error)}`;
        loaded = undefined;
        return;
      }
      if (revision !== this.revision) return;
      this.native = new module.SameDecoder(this.rate);
      this.origin = undefined;
      this.samples = this.reported = this.elapsed = 0;
    }
    this.native.set_attention_enabled(options.attention);
  }
  process(samples: Float32Array, firstSeconds: number): DecoderEvent[] {
    if (!this.native) {
      if (!this.failure) return [];
      const reason = this.failure;
      this.failure = undefined;
      return [
        {
          type: "same",
          batch: {
            stream: this.stream,
            frequency: this.frequency,
            sampleRate: this.rate,
            sourceSeconds: firstSeconds,
            processingMs: 0,
            events: [{ kind: "rejected", reason, seconds: 0 }],
          },
        },
      ];
    }
    if (!samples.length) return [];
    this.origin ??= firstSeconds;
    const start = performance.now();
    this.native.process_audio(samples);
    this.samples += samples.length;
    this.elapsed += performance.now() - start;
    return this.drain();
  }
  finish(): DecoderEvent[] {
    if (!this.native) return [];
    const start = performance.now();
    this.native.finish();
    this.elapsed += performance.now() - start;
    return this.drain(true);
  }
  private drain(force = false): DecoderEvent[] {
    if (!this.native) return [];
    const hasEvents = this.native.has_events();
    if (!force && !hasEvents && this.samples - this.reported < this.rate / 4)
      return [];
    const batch: SameBatch = {
      stream: `${this.stream}@${this.frequency ?? "audio"}`,
      frequency: this.frequency,
      sampleRate: this.rate,
      sourceSeconds: this.origin ?? 0,
      processingMs: this.elapsed,
      events: hasEvents
        ? (JSON.parse(this.native.take_events()) as SameNativeEvent[])
        : [],
      diagnostics: JSON.parse(this.native.status()) as SameDiagnostics,
    };
    this.reported = this.samples;
    this.elapsed = 0;
    return [{ type: "same", batch }];
  }
  dispose() {
    ++this.revision;
    this.native?.free();
    this.native = undefined;
    this.failure = undefined;
  }
}
