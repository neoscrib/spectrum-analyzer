// Interleaved 48 kHz L/R PCM -> hardware sample rate. Indices/counts are frames.
// A short prebuffer prevents block-arrival jitter from becoming audible gaps.
class SpectrumAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000;
    this.buffer = new Float32Array(this.capacity * 2);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.phase = 0;
    this.playing = false;
    this.port.onmessage = ({ data }) => {
      if (data === "clear") {
        this.read = this.write = this.count = this.phase = 0;
        this.playing = false;
        return;
      }
      // Trim excessive latency after a suspended/backgrounded tab.
      if (this.count + data.length / 2 > 12000) {
        this.read = this.write = this.count = this.phase = 0;
        this.playing = false;
      }
      for (let i = 0; i + 1 < data.length; i += 2) {
        this.buffer[this.write * 2] = data[i];
        this.buffer[this.write * 2 + 1] = data[i + 1];
        this.write = (this.write + 1) % this.capacity;
        this.count++;
      }
      if (this.count >= 2880) this.playing = true;
    };
  }
  process(_inputs, outputs) {
    const left = outputs[0][0],
      right = outputs[0][1];
    const step = 48000 / sampleRate;
    for (let i = 0; i < left.length; i++) {
      if (!this.playing || this.count < Math.ceil(step) + 1) {
        left[i] = right[i] = 0;
        if (this.count < 2) this.playing = false;
        continue;
      }
      const a = this.read * 2,
        b = ((this.read + 1) % this.capacity) * 2;
      left[i] = this.buffer[a] + (this.buffer[b] - this.buffer[a]) * this.phase;
      right[i] =
        this.buffer[a + 1] +
        (this.buffer[b + 1] - this.buffer[a + 1]) * this.phase;
      this.phase += step;
      while (this.phase >= 1 && this.count > 1) {
        this.phase--;
        this.read = (this.read + 1) % this.capacity;
        this.count--;
      }
    }
    return true;
  }
}
registerProcessor("spectrum-audio", SpectrumAudio);
