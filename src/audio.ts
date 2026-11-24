import type { ArmerAudioChunk, ArmerPolicy } from "./armer/model";
import { policyBitmap } from "./armer/model";
import { DEFAULT_ARMER_MIX, type ArmerMix } from "./armer/audio";
export class BrowserAudio {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private gain?: GainNode;
  private volume = 0.5;
  private enabled = false;
  private mix: ArmerMix = DEFAULT_ARMER_MIX;
  private armerEnabled?: Uint8Array;
  async start() {
    if (!this.context) {
      const context = new AudioContext({ latencyHint: "interactive" });
      this.context = context;
      // resume synchronously from the Play audio gesture, before addModule awaits.
      const resumed = context.resume();
      try {
        await context.audioWorklet.addModule(
          `${import.meta.env.BASE_URL}audio-worklet.js`,
        );
        this.node = new AudioWorkletNode(context, "spectrum-audio", {
          outputChannelCount: [2],
        });
        this.node.port.postMessage({ type: "armer-mix", mix: this.mix });
        if (this.armerEnabled)
          this.node.port.postMessage({
            type: "armer-policy",
            enabled: this.armerEnabled,
          });
        this.gain = context.createGain();
        this.gain.gain.value = this.volume;
        this.node.connect(this.gain).connect(context.destination);
        await resumed;
      } catch (e) {
        await this.close();
        throw e;
      }
    } else await this.context.resume();
    this.enabled = true;
  }
  push(samples: Float32Array, stream?: ArmerAudioChunk) {
    if (this.enabled && samples.length)
      this.node?.port.postMessage(
        stream ? { type: "armer-audio", samples, ...stream } : samples,
        [samples.buffer],
      );
  }
  setArmerMix(mix: ArmerMix) {
    this.mix = mix;
    this.node?.port.postMessage({ type: "armer-mix", mix });
  }
  setArmerPolicy(policy: ArmerPolicy) {
    this.armerEnabled = policyBitmap(policy);
    this.node?.port.postMessage({
      type: "armer-policy",
      enabled: this.armerEnabled,
    });
  }
  setVolume(value: number) {
    this.volume = value;
    this.gain?.gain.setTargetAtTime(value, this.context!.currentTime, 0.015);
  }
  clear() {
    this.node?.port.postMessage("clear");
  }
  pause() {
    this.enabled = false;
    this.clear();
  }
  async close() {
    this.enabled = false;
    await this.context?.close();
    this.context = undefined;
    this.node = undefined;
    this.gain = undefined;
  }
}
