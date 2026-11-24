import { fft } from "../dsp/fft";
export type MeteorBiasCommand =
  | { action: "estimate"; enabled: boolean }
  | { action: "auto"; enabled: boolean }
  | { action: "apply"; biasHz: number };
export interface BiasEstimate {
  hz: number | null;
  confidence: "collecting" | "high" | "uncertain";
  contrastDb: number;
  spreadHz: number;
  accepted: number;
  windows: number;
  ageSeconds: number | null;
  fresh: boolean;
  reason: string;
}
export interface MeteorBiasStatus extends BiasEstimate {
  enabled: boolean;
  automatic: boolean;
  appliedHz: number;
  configuredHz: number;
  dopplerRemoved: boolean;
  replay: boolean;
  adjustments: number;
}
const N = 32768,
  AVERAGES = 16;
const median = (values: number[]) => {
  const v = values.sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
/** Averaged fourth-power spectrum of actual pre-demodulation baseband. No PLL
 * readout enters the estimate. Buffers and the recent observation history are bounded. */
export class BiasEstimator {
  private re = new Float64Array(N);
  private im = new Float64Array(N);
  private fourthRe = new Float64Array(N);
  private fourthIm = new Float64Array(N);
  private power = new Float64Array(N);
  private rawPower = new Float64Array(N);
  private hann = Float64Array.from(
    { length: N },
    (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)),
  );
  private scratch = new Float64Array(N);
  private filled = 0;
  private averages = 0;
  private bias = NaN;
  private points: { hz: number; db: number; time: number }[] = [];
  private windows = 0;
  private accepted = 0;
  private lastGood: number | null = null;
  private reason = "Collecting signal windows";
  private validWindow = false;
  constructor(readonly sampleRate: number) {
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate < 180000 ||
      sampleRate > 600000
    )
      throw Error("Unsupported estimator baseband sample rate.");
  }
  resetWindow() {
    this.filled = 0;
    this.averages = 0;
    this.power.fill(0);
    this.rawPower.fill(0);
  }
  feed(iq: Float32Array, appliedBiasHz: number, endSeconds: number): boolean {
    if (iq.length % 2) throw Error("Incomplete estimator IQ pair.");
    if (this.bias !== appliedBiasHz) {
      this.resetWindow();
      this.bias = appliedBiasHz;
    }
    let updated = false;
    for (let n = 0; n < iq.length; n += 2) {
      this.re[this.filled] = iq[n];
      this.im[this.filled] = iq[n + 1];
      this.filled++;
      if (this.filled === N) {
        const time = endSeconds - (iq.length - n - 2) / 2 / this.sampleRate;
        this.transform();
        this.filled = 0;
        if (++this.averages === AVERAGES) {
          this.measure(time);
          this.averages = 0;
          this.power.fill(0);
          this.rawPower.fill(0);
          updated = true;
        }
      }
    }
    return updated;
  }
  private transform() {
    let meanI = 0,
      meanQ = 0;
    for (let n = 0; n < N; n++) {
      meanI += this.re[n];
      meanQ += this.im[n];
    }
    meanI /= N;
    meanQ /= N;
    for (let n = 0; n < N; n++) {
      const i = this.re[n] - meanI,
        q = this.im[n] - meanQ,
        w = this.hann[n],
        a = i * i - q * q,
        b = 2 * i * q;
      this.fourthRe[n] = (a * a - b * b) * w;
      this.fourthIm[n] = 2 * a * b * w;
      this.re[n] = i * w;
      this.im[n] = q * w;
    }
    fft(this.fourthRe, this.fourthIm);
    fft(this.re, this.im);
    for (let n = 0; n < N; n++) {
      this.power[n] += this.fourthRe[n] ** 2 + this.fourthIm[n] ** 2;
      this.rawPower[n] += this.re[n] ** 2 + this.im[n] ** 2;
    }
  }
  private measure(time: number) {
    this.windows++;
    this.validWindow = false;
    const radius = Math.floor(
      (Math.min(48000, this.sampleRate / 2 - 100) / this.sampleRate) * N,
    );
    let peak = 0,
      peakPower = 0,
      used = 0,
      total = 0,
      rawPeak = 0;
    for (let k = -radius; k <= radius; k++) {
      const at = (k + N) % N,
        p = this.power[at];
      this.scratch[used++] = p;
      if (p > peakPower) {
        peakPower = p;
        peak = k;
      }
    }
    this.scratch.subarray(0, used).sort();
    const noise = this.scratch[Math.floor(used / 2)],
      db = 10 * Math.log10((peakPower + 1e-60) / (noise + 1e-60));
    for (let n = 0; n < N; n++) {
      const p = this.rawPower[n];
      total += p;
      rawPeak = Math.max(rawPeak, p);
    }
    let cumulative = 0,
      low = -this.sampleRate / 2,
      high = this.sampleRate / 2,
      found = false;
    for (let k = -N / 2; k < N / 2; k++) {
      cumulative += this.rawPower[(k + N) % N];
      if (!found && cumulative >= total * 0.1) {
        low = (k * this.sampleRate) / N;
        found = true;
      }
      if (cumulative >= total * 0.9) {
        high = (k * this.sampleRate) / N;
        break;
      }
    }
    const width = high - low;
    if (total < 1e-15 || !Number.isFinite(db) || db < 8) {
      this.reason = "No reliable carrier peak";
      return;
    }
    if (width < 35000 || rawPeak / total > 0.02) {
      this.reason = "Narrow signal rejected; waiting for LRPT bandwidth";
      return;
    }
    if (Math.abs(peak) >= radius - 2) {
      this.reason = "Carrier peak is outside the search margin";
      return;
    }
    const center = (peak + N) % N,
      a = Math.log(this.power[(center - 1 + N) % N] + 1e-60),
      b = Math.log(this.power[center] + 1e-60),
      c = Math.log(this.power[(center + 1) % N] + 1e-60);
    const d = a - 2 * b + c,
      sub = d ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * d))) : 0;
    const residual = ((peak + sub) * this.sampleRate) / N / 4;
    let inner = 0,
      outer = 0,
      innerBins = 0,
      outerBins = 0;
    for (let k = -N / 2; k < N / 2; k++) {
      const distance = Math.abs((k * this.sampleRate) / N - residual),
        p = this.rawPower[(k + N) % N];
      if (distance < 30000) {
        inner += p;
        innerBins++;
      }
      if (distance >= 65000 && distance <= 80000) {
        outer += p;
        outerBins++;
      }
    }
    if (
      !innerBins ||
      !outerBins ||
      10 *
        Math.log10((inner / innerBins + 1e-60) / (outer / outerBins + 1e-60)) <
        1.5
    ) {
      this.reason = "No LRPT-shaped signal above the background";
      return;
    }
    const hz = this.bias + residual;
    this.validWindow = true;
    this.points.push({ hz, db, time });
    this.points = this.points.slice(-9);
    this.accepted++;
    this.lastGood = time;
    this.reason = "Consistent carrier measurements";
  }
  snapshot(nowSeconds: number): BiasEstimate {
    const recent = this.points.slice(-5),
      hz = recent.length ? median(recent.map((p) => p.hz)) : null;
    const spread = recent.length
      ? Math.max(...recent.map((p) => Math.abs(p.hz - hz!)))
      : 0;
    const high = recent.length >= 3 && spread <= 60;
    const age =
      this.lastGood === null ? null : Math.max(0, nowSeconds - this.lastGood);
    return {
      hz,
      confidence: high
        ? "high"
        : recent.length >= 3
          ? "uncertain"
          : "collecting",
      contrastDb: recent.length ? Math.min(...recent.map((p) => p.db)) : 0,
      spreadHz: spread,
      accepted: this.accepted,
      windows: this.windows,
      ageSeconds: age,
      fresh: this.validWindow && age !== null && age < 4.5,
      reason: high
        ? this.reason
        : recent.length >= 3
          ? "Measurements disagree; correction held"
          : this.reason,
    };
  }
}
/** Initial acquisition can move coarsely; a working carrier loop receives only
 * small handoffs. Each new independent estimate can cause at most one update. */
export function automaticBiasStep(
  estimate: BiasEstimate,
  appliedHz: number,
  trackingFrames: boolean,
): number | null {
  if (
    estimate.hz === null ||
    estimate.confidence !== "high" ||
    !estimate.fresh ||
    estimate.contrastDb < 10 ||
    estimate.spreadHz > 40
  )
    return null;
  const delta = estimate.hz - appliedHz;
  if (Math.abs(delta) < 20) return null;
  return Math.round(
    appliedHz +
      Math.max(
        trackingFrames ? -100 : -12000,
        Math.min(trackingFrames ? 100 : 12000, delta),
      ),
  );
}
