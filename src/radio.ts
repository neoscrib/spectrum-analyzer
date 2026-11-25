import type { MeteorBiasCommand } from "./meteor/bias";
import { liveInput, type DecoderInput } from "./meteor/model";
import type { ReplayOptions } from "./meteor/types";
import type { SameOptions } from "./same/model";
import { replayRange } from "./meteor/replay";
import type { IqSource } from "./meteor/iq";
import { openSource } from "./sources";
import {
  defaultSource,
  validateSourceDecoder,
  type RadioSource,
  type SourceOptions,
  type ReceiverInfo,
} from "./sources/model";
import { SAMPLE_RATE, validateSettings, type Settings } from "./model";
import type { Frame, WorkerIn, WorkerOut } from "./types";
import type { ArmerPolicy } from "./armer/model";
import type { NfmMonitorConfig } from "./presets/model";

import { IqRecorder } from "./recording/recorder";
import {
  idleRecording,
  type RecordingSink,
  type RecordingState,
} from "./recording/model";
export function usbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/No device selected|cancelled|canceled/i.test(message))
    return "Connection canceled. Click Connect to choose a receiver.";
  if (/claim|access denied|busy|interface|Could not connect/i.test(message))
    return "USB interface unavailable. Close other SDR apps. If Linux’s TV driver owns the dongle, run bash scripts/prepare-usb.sh, then reconnect.";
  if (/not found|disconnect|transfer/i.test(message))
    return (
      "Reception stopped. Check the receiver connection and reconnect. " +
      message
    );
  return message;
}

type Command = {
  recenter?: boolean;
  settings: Settings;
  monitor: NfmMonitorConfig | null;
  resolve: () => void;
  reject: (e: Error) => void;
};
export interface ReplayState {
  phase: "idle" | "playing" | "complete" | "stopped";
  name: string;
  bytes: number;
  total: number;
  seconds: number;
  sampleRate: number;
}
export class RadioSession {
  onReplay: (state: ReplayState) => void = () => {};
  private replayState?: ReplayState;
  onFrame: (frame: Frame, backlog: number) => void = () => {};
  onError: (message: string) => void = () => {};
  onRecording: (state: RecordingState) => void = () => {};
  private recorder?: IqRecorder;
  private recordingId = 0;
  private recentering = false;
  startRecording(sink: RecordingSink, seconds: number) {
    if (
      !this.running ||
      !this.settings ||
      this.commands.length ||
      this.recentering
    )
      throw Error("Start a source and finish tuning before recording IQ.");
    if (
      this.recorder &&
      ["recording", "saving"].includes(this.recorder.state.phase)
    )
      throw Error("Finish the current IQ recording first.");
    if (this.source === "replay")
      throw Error(
        "Replay reads the original IQ file; stop replay before recording a source.",
      );
    const recorder = new IqRecorder(
      sink,
      {
        filename: sink.filename,
        source: this.source,
        receiver:
          this.source === "live"
            ? structuredClone(this.device?.info)
            : undefined,
        settings:
          this.settings.decoder === "meteor" &&
          this.meteorAppliedBias !== undefined
            ? {
                ...this.settings,
                meteor: {
                  ...this.settings.meteor,
                  frequencyBiasHz: this.meteorAppliedBias,
                },
              }
            : this.settings,
        startedAt: new Date().toISOString(),
      },
      seconds,
      (state) => {
        if (this.recorder !== recorder) return;
        if (state.phase !== "recording")
          this.post({ type: "recording", id: 0 });
        this.onRecording(state);
      },
    );
    this.recorder = recorder;
    this.onRecording({
      ...recorder.state,
      info: structuredClone(recorder.state.info),
    });
    this.post({ type: "recording", id: ++this.recordingId });
  }
  async stopRecording(reason = "Stopped by user") {
    const recorder = this.recorder;
    if (!recorder || ["complete", "error"].includes(recorder.state.phase))
      return;
    this.post({ type: "recording", id: 0 });
    await recorder.finish(reason);
  }
  clearRecording() {
    if (
      this.recorder &&
      ["recording", "saving"].includes(this.recorder.state.phase)
    )
      return;
    this.recorder = undefined;
    this.onRecording({ ...idleRecording });
  }
  private device?: RadioSource;
  onReceiver: (info: ReceiverInfo) => void = () => {};
  private worker?: Worker;
  private running = false;
  private source: "live" | "test" | "replay" = "live";
  private settings?: Settings;
  private revision = 0;
  private busy = false;
  private queue: ArrayBuffer[] = [];
  private commands: Command[] = [];
  private loop?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private resumeTest?: () => void;
  private testSpeed = 1;
  private meteorAppliedBias: number | undefined;
  setMeteorBias(command: MeteorBiasCommand) {
    if (this.settings?.decoder !== "meteor") return;
    if (command.action === "apply") this.meteorAppliedBias = command.biasHz;
    if (this.source !== "replay") {
      if (command.action === "apply")
        this.settings = {
          ...this.settings,
          meteor: { ...this.settings.meteor, frequencyBiasHz: command.biasHz },
        };
      if (command.action === "auto")
        this.settings = {
          ...this.settings,
          meteor: { ...this.settings.meteor, autoBias: command.enabled },
        };
    }
    if (this.worker) this.post({ type: "meteor-bias", command });
  }
  private multiplexEnabled = false;
  setWfmMultiplex(enabled: boolean) {
    this.multiplexEnabled = enabled;
    if (this.worker) this.post({ type: "wfm-multiplex", enabled });
  }
  setWfmStereo(enabled: boolean) {
    if (this.settings?.decoder === "wfm") {
      this.settings = { ...this.settings, stereo: enabled };
      if (this.worker) this.post({ type: "wfm-stereo", enabled });
    }
  }
  setSameOptions(options: SameOptions) {
    if (this.settings) this.settings = { ...this.settings, same: options };
    if (this.worker) this.post({ type: "same-options", options });
  }
  setWfmRds(enabled: boolean) {
    if (this.settings?.decoder === "wfm") {
      this.settings = { ...this.settings, rds: enabled };
      if (this.worker) this.post({ type: "wfm-rds", enabled });
    }
  }
  setTestSpeed(speed: number) {
    this.testSpeed = speed === 16 ? 16 : 1;
  }
  private readyReject?: (error: Error) => void;
  private stopping?: Promise<void>;
  private armerPolicy: ArmerPolicy = { defaultListen: true, rules: [] };
  private spectrumEnabled = true;
  setSpectrumEnabled(enabled: boolean) {
    if (this.spectrumEnabled === enabled) return;
    this.spectrumEnabled = enabled;
    if (this.worker) this.post({ type: "spectrum-visibility", enabled });
  }
  setArmerPolicy(policy: ArmerPolicy) {
    this.armerPolicy = policy;
    if (this.worker && this.settings?.decoder === "armer") {
      // Reject old-policy audio results but retain queued IQ/control state.
      this.post({ type: "armer-policy", policy, revision: ++this.revision });
    }
  }

  setNfmHold(id: string | null) {
    if (this.worker && this.settings?.decoder === "nfm")
      this.post({ type: "nfm-hold", id, revision: ++this.revision });
  }
  private async init(
    settings: Settings,
    monitor: NfmMonitorConfig | null = null,
    input: DecoderInput = liveInput,
  ) {
    this.settings = settings;
    this.meteorAppliedBias = undefined;
    this.worker = new Worker(
      new URL("./dsp/capture.worker.ts", import.meta.url),
      { type: "module" },
    );
    const worker = this.worker;
    const ready = new Promise<void>((resolve, reject) => {
      this.readyReject = reject;
      worker.onerror = (e) => {
        const message = e.message || "The DSP worker failed.";
        reject(Error(message));
        this.fail(message);
      };
      worker.onmessage = ({ data }: MessageEvent<WorkerOut>) => {
        if (this.worker !== worker) return;
        if (data.type === "ready") {
          resolve();
          return;
        }
        if (data.type === "error") {
          reject(Error(data.message));
          this.fail(data.message);
          return;
        }
        this.busy = false;
        for (const event of data.events)
          if (
            event.type === "telemetry" &&
            event.protocol === "meteor" &&
            event.status.bias
          )
            this.meteorAppliedBias = event.status.bias.appliedHz;
        if (data.recording?.id === this.recordingId)
          this.recorder?.push(data.recording.data);
        if (data.revision === this.revision)
          this.onFrame(data, this.queue.length);
        this.pump();
        const resume = this.resumeTest;
        this.resumeTest = undefined;
        resume?.();
      };
    });
    const timeout = setTimeout(
      () =>
        this.readyReject?.(
          Error(
            "WASM initialization timed out. Reload the page and try again.",
          ),
        ),
      12000,
    );
    this.post({
      type: "init",
      settings,
      revision: ++this.revision,
      armerPolicy: this.armerPolicy,
      spectrum: this.spectrumEnabled,
      multiplex: this.multiplexEnabled,
      input,
      monitor,
    });
    try {
      await ready;
    } finally {
      clearTimeout(timeout);
      this.readyReject = undefined;
    }
  }
  private post(message: WorkerIn, transfer: Transferable[] = []) {
    this.worker?.postMessage(message, transfer);
  }

  async connect(
    settings: Settings,
    monitor: NfmMonitorConfig | null = null,
    options: SourceOptions = defaultSource,
  ): Promise<Settings> {
    validateSettings(settings);
    if (this.running || this.worker || this.device || this.stopping)
      throw Error("Stop the current source before connecting.");
    if (!globalThis.isSecureContext)
      throw Error(
        "WebUSB requires localhost or HTTPS. Open Spectrum on a secure origin in Chrome or Edge.",
      );
    if (options.kind !== "soapy" && !navigator.usb)
      throw Error(
        "WebUSB is unavailable. Use Chrome or Edge, or connect through the SoapySDR bridge.",
      );
    // Keep the chooser in the original user gesture, before initializing WASM/audio.
    const opening = openSource(options);
    try {
      this.device = await opening;
      this.onReceiver(this.device.info);
      const caps = this.device.info;
      const gain = Math.max(
        caps.gain.min,
        Math.min(caps.gain.max, settings.gain ?? caps.gain.min),
      );
      const steppedGain =
        caps.gain.min +
        Math.round((gain - caps.gain.min) / caps.gain.step) * caps.gain.step;
      settings = {
        ...settings,
        gain:
          settings.gain === null && caps.gain.auto
            ? null
            : Number(
                Math.max(
                  caps.gain.min,
                  Math.min(caps.gain.max, steppedGain),
                ).toFixed(6),
              ),
        ppm: caps.ppm ? settings.ppm : 0,
      };
      validateSourceDecoder(settings, this.device.info);
      await this.init(settings, monitor);
      await this.device.configure(settings);
      this.onReceiver(this.device.info);
      validateSourceDecoder(settings, this.device.info);
      this.running = true;
      this.source = "live";
      this.loop = this.readLoop(this.device);
      return settings;
    } catch (error) {
      await this.stop();
      throw Error(usbError(error));
    }
  }
  async test(
    settings: Settings,
    monitor: NfmMonitorConfig | null = null,
  ): Promise<void> {
    validateSettings(settings);
    if (this.running || this.worker || this.stopping)
      throw Error("Stop the current source first.");
    try {
      await this.init(settings, monitor);
      this.source = "test";
      this.running = true;
      let target = performance.now();
      const tick = () => {
        if (!this.running) return;
        if (this.busy) {
          // Resume as soon as the in-flight block returns. Skipping this tick
          // would lose an entire block's wall-clock time and starve playback.
          this.resumeTest = tick;
          return;
        }
        this.busy = true;
        this.post({ type: "test", revision: this.revision });
        target += ((65536 / SAMPLE_RATE) * 1000) / this.testSpeed;
        // Slow down rather than accumulate an unbounded synthetic sample queue.
        if (target < performance.now() - 100) target = performance.now();
        this.timer = setTimeout(tick, Math.max(0, target - performance.now()));
      };
      tick();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  /** Sequential reads and one transferable buffer in flight: no whole-file allocation. */
  async replay(
    file: File,
    source: IqSource,
    settings: Settings,
    options: ReplayOptions,
  ): Promise<void> {
    validateSettings(settings);
    if (this.running || this.worker || this.device || this.stopping)
      throw Error("Stop the current source before replaying IQ.");
    if (
      settings.decoder !== "meteor" &&
      !["am", "nfm", "wfm", "adsb"].includes(settings.decoder)
    )
      throw Error("Select Meteor-M, AM, NFM, WFM or ADS-B for IQ replay.");
    if (
      settings.decoder !== "meteor" &&
      (source.format !== "cu8" || source.sampleRate !== SAMPLE_RATE)
    )
      throw Error("This decoder's IQ replay requires CU8 at 2.4 MSPS.");
    const range = replayRange(source, options);
    try {
      await this.init(settings, null, {
        format: source.format,
        sampleRate: source.sampleRate,
        replay: options,
        referenceTime: source.referenceTime,
      });
      this.source = "replay";
      this.running = true;
      this.replayState = {
        phase: "playing",
        name: file.name,
        bytes: 0,
        total: range.length,
        seconds: 0,
        sampleRate: source.sampleRate,
      };
      this.onReplay(this.replayState);
      this.loop = this.replayLoop(file, range);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private async replayLoop(
    file: File,
    range: { offset: number; length: number; stride: number },
  ) {
    let lastProgress = performance.now();
    let deadline = performance.now();
    try {
      for (
        let at = 0;
        at < range.length && this.running;
        at += 65536 * range.stride
      ) {
        const end = Math.min(range.length, at + 65536 * range.stride);
        const data = await file
          .slice(range.offset + at, range.offset + end)
          .arrayBuffer();
        if (!this.running) break;
        await this.replayBlock(data);
        if (this.settings?.decoder !== "meteor") {
          deadline += ((end - at) / range.stride / SAMPLE_RATE) * 1000;
          const wait = deadline - performance.now();
          if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
        }
        if (!this.running) break;
        this.replayState = {
          ...this.replayState!,
          bytes: end,
          seconds: end / range.stride / this.replayState!.sampleRate,
        };
        if (performance.now() - lastProgress >= 180) {
          this.onReplay(this.replayState);
          lastProgress = performance.now();
        }
      }
      if (this.running) {
        await this.replayBlock(new ArrayBuffer(0)); // Publish the last image tail and statistics.
        if (!this.running) return;
        this.running = false;
        this.worker?.terminate();
        this.worker = undefined;
        this.replayState = { ...this.replayState!, phase: "complete" };
        this.onReplay(this.replayState);
      }
    } catch (error) {
      if (this.running)
        this.fail(error instanceof Error ? error.message : String(error));
    }
  }
  private replayBlock(data: ArrayBuffer) {
    return new Promise<void>((resolve) => {
      this.resumeTest = resolve;
      this.busy = true;
      this.post({ type: "iq", data, revision: this.revision }, [data]);
    });
  }
  private async readLoop(device: RadioSource) {
    // Keep transfers queued continuously, as in Fieldglass. Waiting for pairs
    // creates a refill barrier even when the first buffer is already available.
    type ReadResult = { data: ArrayBuffer } | { error: unknown };
    const read = (): Promise<ReadResult> =>
      device.readSamples(65536).then(
        (block) => ({ data: block.data }),
        (error) => ({ error }),
      );
    let pending: Promise<ReadResult>[] = [read(), read()];
    try {
      while (this.running) {
        const result = await pending.shift()!;
        if (!this.running) break;
        if ("error" in result) throw result.error;
        // Drain old-frequency reads before hardware writes. Configuration
        // resets the decoder and endpoint, so these old buffers are discarded.
        if (this.commands.length) {
          const drained = await Promise.all(pending);
          pending = [];
          for (const old of drained) if ("error" in old) throw old.error;
        }
        while (this.commands.length && this.running) {
          const command = this.commands.shift()!;
          try {
            const s = command.settings;
            validateSourceDecoder(s, device.info);
            await device.configure(s);
            validateSourceDecoder(s, device.info);
            this.onReceiver(device.info);
            this.configure(s, command.monitor, command.recenter);
            command.resolve();
          } catch (e) {
            command.reject(e instanceof Error ? e : Error(String(e)));
            throw e;
          }
        }
        if (!this.running) break;
        if (!pending.length) {
          pending = [read(), read()];
        } else {
          // Refill before dispatching IQ/DSP work. Results remain in request
          // order even if promise callbacks finish out of order.
          pending.push(read());
          this.enqueue(result.data);
        }
      }
    } catch (e) {
      await Promise.all(pending);
      pending = [];
      if (this.running) this.fail(usbError(e));
    } finally {
      // stop() waits for readLoop before closing the device.
      await Promise.all(pending);
    }
  }
  private configure(
    settings: Settings,
    monitor: NfmMonitorConfig | null = null,
    recenter = false,
  ) {
    this.queue = [];
    this.meteorAppliedBias = undefined;
    this.settings = settings;
    const revision = ++this.revision;
    this.post(
      recenter
        ? { type: "recenter", settings, revision }
        : { type: "configure", settings, revision, monitor },
    );
  }
  async update(
    settings: Settings,
    monitor: NfmMonitorConfig | null = null,
  ): Promise<void> {
    validateSettings(settings);
    if (this.device) validateSourceDecoder(settings, this.device.info);
    if (!this.running) throw Error("Start a source before adjusting it.");
    if (this.source === "replay")
      throw Error("Stop replay before changing receiver or decoder settings.");
    await this.stopRecording("Receiver or decoder configuration changed");
    if (!this.running) throw Error("Reception stopped.");
    if (this.source === "test") {
      this.configure(settings, monitor);
      return;
    }
    return new Promise<void>((resolve, reject) =>
      this.commands.push({ settings, monitor, resolve, reject }),
    );
  }
  async recenterArmer(center: number): Promise<void> {
    if (!this.running || this.settings?.decoder !== "armer")
      throw Error("Start ARMER reception before auto-centering.");
    if (
      this.recentering ||
      this.commands.length ||
      (this.recorder &&
        ["recording", "saving"].includes(this.recorder.state.phase))
    )
      throw Error(
        "Auto-centering pauses during recording and other receiver changes.",
      );
    const settings = { ...this.settings, center };
    validateSettings(settings);
    this.recentering = true;
    try {
      if (this.source === "test") {
        this.configure(settings, null, true);
        return;
      }
      await new Promise<void>((resolve, reject) =>
        this.commands.push({
          settings,
          monitor: null,
          recenter: true,
          resolve,
          reject,
        }),
      );
    } finally {
      this.recentering = false;
    }
  }
  private enqueue(data: ArrayBuffer) {
    if (this.queue.length >= 12) {
      this.fail(
        "DSP could not keep up with 2.4 MSPS. Reception stopped to avoid hidden sample gaps. Close busy tabs and reconnect.",
      );
      return;
    }
    if (!this.running) return;
    this.queue.push(data);
    this.pump();
  }
  private pump() {
    if (this.busy || !this.queue.length || !this.worker) return;
    const data = this.queue.shift()!;
    this.busy = true;
    this.post({ type: "iq", data, revision: this.revision }, [data]);
  }
  private fail(message: string) {
    void this.stop(message);
    this.onError(message);
  }
  stop(reason = "Receiver stopped"): Promise<void> {
    if (this.stopping) return this.stopping;
    const recording = this.stopRecording(reason);
    this.running = false;
    clearTimeout(this.timer);
    this.resumeTest?.();
    this.resumeTest = undefined;
    if (this.replayState?.phase === "playing") {
      this.replayState = { ...this.replayState, phase: "stopped" };
      this.onReplay(this.replayState);
    }
    this.queue = [];
    this.busy = false;
    for (const command of this.commands.splice(0))
      command.reject(Error("Reception stopped."));
    this.readyReject?.(Error("Reception stopped."));
    this.worker?.terminate();
    this.worker = undefined;
    const device = this.device;
    this.device = undefined;
    const loop = this.loop;
    this.loop = undefined;
    const cleanup = (async () => {
      await loop;
      if (device)
        try {
          await device.close();
        } catch {
          /* An unplugged device may already be closed. */
        }
      await recording;
    })();
    this.stopping = cleanup;
    void cleanup.finally(() => {
      if (this.stopping === cleanup) this.stopping = undefined;
    });
    return cleanup;
  }
}
