import {
  RTL2832U_Provider,
  type RtlDevice,
} from "@jtarrio/webrtlsdr/rtlsdr.js";
import { SAMPLE_RATE, validateSettings, type Settings } from "./model";
import type { Frame, WorkerIn, WorkerOut } from "./types";
import type { ArmerPolicy } from "./armer/model";
import type { NfmMonitorConfig } from "./presets/model";

export function usbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/No device selected|cancelled|canceled/i.test(message))
    return "Connection canceled. Click Connect RTL-SDR to choose a receiver.";
  if (/claim|access denied|busy|interface|Could not connect/i.test(message))
    return "USB interface unavailable. Close other SDR apps. If Linux’s TV driver owns the dongle, run bash scripts/prepare-usb.sh, then reconnect.";
  if (/not found|disconnect|transfer/i.test(message))
    return (
      "USB reception stopped. Check the receiver connection and reconnect. " +
      message
    );
  return message;
}

type Command = {
  settings: Settings;
  monitor: NfmMonitorConfig | null;
  resolve: () => void;
  reject: (e: Error) => void;
};
export class RadioSession {
  onFrame: (frame: Frame, backlog: number) => void = () => {};
  onError: (message: string) => void = () => {};
  private device?: RtlDevice;
  private provider?: RTL2832U_Provider;
  private worker?: Worker;
  private running = false;
  private source: "live" | "test" = "live";
  private settings?: Settings;
  private revision = 0;
  private busy = false;
  private queue: ArrayBuffer[] = [];
  private commands: Command[] = [];
  private loop?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private testSpeed = 1;
  setTestSpeed(speed: number) {
    this.testSpeed = speed === 16 ? 16 : 1;
  }
  private readyReject?: (error: Error) => void;
  private stopping?: Promise<void>;
  private armerPolicy: ArmerPolicy = { defaultListen: true, rules: [] };
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
  ) {
    this.settings = settings;
    this.worker = new Worker(
      new URL("./dsp/decoder.worker.ts", import.meta.url),
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
        if (data.revision === this.revision)
          this.onFrame(data, this.queue.length);
        this.pump();
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
  ): Promise<void> {
    validateSettings(settings);
    if (this.running || this.worker || this.device || this.stopping)
      throw Error("Stop the current source before connecting.");
    if (!globalThis.isSecureContext)
      throw Error(
        "WebUSB requires localhost or HTTPS. Open http://localhost:5176 in Chrome or Edge.",
      );
    if (!navigator.usb)
      throw Error(
        "WebUSB is unavailable. Use Chrome or Edge on the computer with your RTL-SDR.",
      );
    // Keep the chooser in the original user gesture, before initializing WASM/audio.
    this.provider ??= new RTL2832U_Provider();
    const opening = this.provider.get();
    try {
      this.device = await opening;
      await this.init(settings, monitor);
      const rate = await this.device.setSampleRate(SAMPLE_RATE);
      if (rate !== SAMPLE_RATE)
        throw Error(
          `Receiver returned ${rate} samples/s; this decoder requires 2.4 MSPS.`,
        );
      await this.device.setFrequencyCorrection(settings.ppm);
      await this.device.setCenterFrequency(settings.center);
      await this.device.setGain(settings.gain);
      await this.device.enableBiasTee(false);
      await this.device.resetBuffer();
      this.running = true;
      this.source = "live";
      this.loop = this.readLoop(this.device);
    } catch (error) {
      this.provider = undefined;
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
        if (!this.busy) {
          this.busy = true;
          this.post({ type: "test", revision: this.revision });
        }
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
  private async readLoop(device: RtlDevice) {
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
            if (s.ppm !== this.settings?.ppm)
              await device.setFrequencyCorrection(s.ppm);
            if (
              s.center !== this.settings?.center ||
              s.ppm !== this.settings?.ppm
            )
              await device.setCenterFrequency(s.center);
            if (s.gain !== this.settings?.gain) await device.setGain(s.gain);
            await device.resetBuffer();
            this.configure(s, command.monitor);
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
  ) {
    this.queue = [];
    this.settings = settings;
    this.post({
      type: "configure",
      settings,
      revision: ++this.revision,
      monitor,
    });
  }
  async update(
    settings: Settings,
    monitor: NfmMonitorConfig | null = null,
  ): Promise<void> {
    validateSettings(settings);
    if (!this.running) throw Error("Start a source before adjusting it.");
    if (this.source === "test") {
      this.configure(settings, monitor);
      return;
    }
    return new Promise<void>((resolve, reject) =>
      this.commands.push({ settings, monitor, resolve, reject }),
    );
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
    this.provider = undefined;
    void this.stop();
    this.onError(message);
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.running = false;
    clearTimeout(this.timer);
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
    })();
    this.stopping = cleanup;
    void cleanup.finally(() => {
      if (this.stopping === cleanup) this.stopping = undefined;
    });
    return cleanup;
  }
}
