import {
  recordingRate,
  MEMORY_LIMIT,
  QUEUE_LIMIT,
  captureMetadata,
  type CaptureInfo,
  type RecordingSink,
  type RecordingState,
} from "./model";
/** Owns every input buffer. Writes are serialized, never awaited by RF/DSP.
 * Queue overflow ends at a contiguous prefix; no skip-and-resume behavior. */
export class IqRecorder {
  state: RecordingState;
  private queue: Uint8Array[] = [];
  private draining = false;
  private closed?: Promise<void>;
  private finishResolve?: () => void;
  private lastNotify = 0;
  private first = true;
  private maxBytes: number;
  constructor(
    private sink: RecordingSink,
    info: CaptureInfo,
    seconds: number,
    private changed: (state: RecordingState) => void,
    private limits = { memory: MEMORY_LIMIT, queue: QUEUE_LIMIT },
  ) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
      throw Error(
        "Recording duration must be 0–3600 seconds (0 means until stopped).",
      );
    this.maxBytes = seconds
      ? Math.floor(seconds * recordingRate(info)) * 2
      : Infinity;
    this.state = {
      phase: "recording",
      mode: sink.mode,
      info: structuredClone(info),
      bytes: 0,
      written: 0,
      queued: 0,
      reason: "",
      dataSaved: false,
      metadataSaved: false,
    };
  }
  push(buffer: ArrayBuffer) {
    if (this.state.phase !== "recording") return;
    if (buffer.byteLength % 2) {
      void this.finish("Invalid incomplete IQ pair");
      return;
    }
    const memory =
      this.sink.mode === "download" ? this.limits.memory : Infinity;
    const available = Math.max(
      0,
      Math.min(this.maxBytes, memory) - this.state.bytes,
    );
    const count = Math.min(buffer.byteLength, available);
    if (this.state.queued + count > this.limits.queue) {
      void this.finish(
        "Storage could not keep up; saved the contiguous prefix",
      );
      return;
    }
    if (count) {
      if (this.first) {
        this.first = false;
        this.state.info!.startedAt = new Date().toISOString();
      }
      // A view retains the transferred source buffer until its write completes.
      this.queue.push(new Uint8Array(buffer, 0, count));
      this.state.bytes += count;
      this.state.queued += count;
      void this.drain();
    }
    if (this.state.bytes >= Math.min(this.maxBytes, memory))
      void this.finish(
        memory <= this.maxBytes
          ? "Download memory limit reached"
          : "Requested duration reached",
      );
    else this.notify();
  }
  finish(reason: string): Promise<void> {
    if (this.closed) return this.closed;
    this.closed = new Promise<void>((resolve) => {
      this.finishResolve = resolve;
    });
    this.state.phase = "saving";
    this.state.reason = reason;
    this.notify(true);
    void this.drain();
    return this.closed;
  }
  private notify(force = false) {
    if (!force && performance.now() - this.lastNotify < 200) return;
    this.lastNotify = performance.now();
    this.changed({
      ...this.state,
      info: this.state.info ? structuredClone(this.state.info) : undefined,
    });
  }
  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const data = this.queue.shift()!;
        await this.sink.write(data);
        this.state.written += data.byteLength;
        this.state.queued -= data.byteLength;
        this.notify();
      }
      if (this.state.phase === "saving") {
        this.state.blob = await this.sink.close();
        this.state.dataSaved = true;
        this.state.metadata = captureMetadata(
          this.state.info!,
          this.state.written,
          this.state.reason,
        );
        try {
          await this.sink.saveMetadata(this.state.metadata);
          this.state.metadataSaved = this.sink.mode === "disk";
          this.state.phase = "complete";
        } catch (error) {
          this.state.phase = "error";
          this.state.reason = `IQ saved, but metadata could not be saved. Download the metadata below. ${error instanceof Error ? error.message : String(error)}`;
        }
        this.notify(true);
        this.finishResolve?.();
      }
    } catch (error) {
      this.queue = [];
      this.state.queued = 0;
      this.state.phase = "error";
      this.state.reason = `IQ recording could not be saved; the file may be incomplete. ${error instanceof Error ? error.message : String(error)}`;
      try {
        await this.sink.abort();
      } catch {}
      // If a write failed before finish(), retain a resolved terminal promise.
      this.closed ??= Promise.resolve();
      this.notify(true);
      this.finishResolve?.();
    } finally {
      this.draining = false;
    }
  }
}
