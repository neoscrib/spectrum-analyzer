export class BrowserAudio {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private gain?: GainNode;
  private volume = 0.5;
  private enabled = false;
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
  push(samples: Float32Array) {
    if (this.enabled && samples.length)
      this.node?.port.postMessage(samples, [samples.buffer]);
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
