// Independent call buffers share an absolute 48 kHz source timeline. Advancing
// that timeline even through silence/mute prevents queueing one talker after
// another or replaying old speech when a call is unmuted.
class ArmerMixer {
  constructor(rate) {
    this.rate = rate;
    this.clock = 0;
    this.capacity = 48000;
    this.streams = new Map();
    this.mix = { muted: [], solo: null, gains: {}, pans: {} };
    this.enabled = null;
    this.reset();
  }
  reset() {
    this.streams.clear();
    this.epoch = null;
    this.limiter = 1;
  }
  position() {
    return this.epoch
      ? this.epoch.source +
          ((this.clock - this.epoch.output) * 48000) / this.rate
      : 0;
  }
  push(data) {
    const { id, talkgroup, startFrame: start, samples } = data;
    const frames = samples.length / 2,
      end = start + frames;
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      !Number.isInteger(frames) ||
      frames > this.capacity
    )
      return;
    const read = this.position();
    // Recover from suspended tabs/backlogs as a group so concurrent channels
    // retain their relative timing. Never grow a queue of delayed speech.
    if (
      !this.epoch ||
      end - read > 14400 ||
      (end < read - 12000 &&
        [...this.streams.values()].every((s) => s.end <= read))
    ) {
      this.reset();
      this.epoch = { source: start, output: this.clock + this.rate * 0.06 };
    }
    if (end <= this.position()) return; // Late data must not replay in the future.
    let stream = this.streams.get(id);
    if (!stream) {
      if (this.streams.size >= 16)
        this.streams.delete(this.streams.keys().next().value);
      stream = {
        talkgroup,
        start,
        end: start,
        buffer: new Float32Array(this.capacity * 2),
        left: 0,
        right: 0,
      };
      this.streams.set(id, stream);
    }
    // Clear missing RF intervals, including a lost LDU, rather than closing the gap.
    for (let n = Math.max(stream.end, start - this.capacity); n < start; n++) {
      const at = (n % this.capacity) * 2;
      stream.buffer[at] = stream.buffer[at + 1] = 0;
    }
    for (let n = 0; n < frames; n++) {
      const at = ((start + n) % this.capacity) * 2;
      stream.buffer[at] = Number.isFinite(samples[n * 2]) ? samples[n * 2] : 0;
      stream.buffer[at + 1] = Number.isFinite(samples[n * 2 + 1])
        ? samples[n * 2 + 1]
        : 0;
    }
    stream.end = Math.max(stream.end, end);
    stream.start = Math.max(stream.start, stream.end - this.capacity);
  }
  render(left, right) {
    const step = 48000 / this.rate,
      read = this.position();
    const smooth = 1 - Math.exp(-1 / (this.rate * 0.008));
    const release = 1 - Math.exp(-1 / (this.rate * 0.15));
    for (const [id, s] of this.streams) {
      if (read > s.end + 48000) this.streams.delete(id);
      const audible =
        (!this.enabled || this.enabled[s.talkgroup]) &&
        !this.mix.muted.includes(s.talkgroup) &&
        (this.mix.solo === null || this.mix.solo === s.talkgroup);
      const gain = audible
        ? Math.max(0, Math.min(1, this.mix.gains[s.talkgroup] ?? 1))
        : 0;
      const pan = Math.max(-1, Math.min(1, this.mix.pans[s.talkgroup] ?? 0));
      s.targetLeft = gain * Math.min(1, 1 - pan);
      s.targetRight = gain * Math.min(1, 1 + pan);
    }
    for (let n = 0; n < left.length; n++) {
      const time = read + n * step,
        frame = Math.floor(time),
        fraction = time - frame;
      let l = 0,
        r = 0;
      for (const s of this.streams.values()) {
        s.left += (s.targetLeft - s.left) * smooth;
        s.right += (s.targetRight - s.right) * smooth;
        if (!this.epoch || time < s.start || frame >= s.end) continue;
        const a = (frame % this.capacity) * 2,
          b = ((frame + 1) % this.capacity) * 2;
        const nextLeft = frame + 1 < s.end ? s.buffer[b] : 0;
        const nextRight = frame + 1 < s.end ? s.buffer[b + 1] : 0;
        l += (s.buffer[a] + (nextLeft - s.buffer[a]) * fraction) * s.left;
        r +=
          (s.buffer[a + 1] + (nextRight - s.buffer[a + 1]) * fraction) *
          s.right;
      }
      const target = Math.min(
        1,
        0.95 / Math.max(Math.abs(l), Math.abs(r), 1e-12),
      );
      this.limiter =
        target < this.limiter
          ? target
          : this.limiter + (target - this.limiter) * release;
      left[n] += l * this.limiter;
      right[n] += r * this.limiter;
    }
    this.clock += left.length;
  }
}

// Interleaved 48 kHz L/R PCM -> hardware sample rate. Indices/counts are frames.
// A short prebuffer prevents block-arrival jitter from becoming audible gaps.
class SpectrumAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mixer = new ArmerMixer(sampleRate);
    this.capacity = 48000;
    this.buffer = new Float32Array(this.capacity * 2);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.phase = 0;
    this.playing = false;
    this.port.onmessage = ({ data }) => {
      if (data === "clear") {
        this.mixer.reset();
        this.read = this.write = this.count = this.phase = 0;
        this.playing = false;
        return;
      }
      if (data.type === "armer-audio") {
        this.mixer.push(data);
        return;
      }
      if (data.type === "armer-mix") {
        this.mixer.mix = data.mix;
        return;
      }
      if (data.type === "armer-policy") {
        this.mixer.enabled = data.enabled;
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
    this.mixer.render(left, right);
    return true;
  }
}
registerProcessor("spectrum-audio", SpectrumAudio);
