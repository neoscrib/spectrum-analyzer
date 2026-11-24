import { SAMPLE_RATE } from "../model";
import { receiverCapabilities } from "../decoders";
import { resolver, type ActiveCall, type ArmerPolicy } from "./model";

// Leave room for the receiver's 24 kHz channel-filter guard at both edges.
export const AUTO_HALF_BAND = SAMPLE_RATE / 2 - 32000;
const RECEIVER_HALF_BAND = SAMPLE_RATE / 2 - 24000;
const GRID = 1000;
export interface CenterProposal {
  center: number;
  covered: number;
  current: number;
  groups: number[];
}
export function chooseArmerCenter(
  center: number,
  control: number,
  calls: ActiveCall[],
  policy: ArmerPolicy,
  protectedFrequency?: number | readonly number[],
): CenterProposal | null {
  if (!Number.isFinite(center) || !Number.isFinite(control)) return null;
  const resolve = resolver(policy);
  const protectedFrequencies =
    typeof protectedFrequency === "number"
      ? [protectedFrequency]
      : (protectedFrequency ?? []);
  const eligible = calls.filter(
    (c) =>
      Number.isFinite(c.frequency) &&
      c.frequency >= receiverCapabilities.minHz &&
      c.frequency <= receiverCapabilities.maxHz &&
      c.age < 1.5 &&
      !c.phase2 &&
      c.encrypted !== true &&
      (resolve(c.talkgroup)?.listen ?? policy.defaultListen),
  );
  let lo = Math.max(receiverCapabilities.minHz, control - AUTO_HALF_BAND),
    hi = Math.min(receiverCapabilities.maxHz, control + AUTO_HALF_BAND);
  for (const frequency of protectedFrequencies) {
    lo = Math.max(lo, frequency - AUTO_HALF_BAND);
    hi = Math.min(hi, frequency + AUTO_HALF_BAND);
  }
  lo = Math.ceil(lo / GRID) * GRID;
  hi = Math.floor(hi / GRID) * GRID;
  if (lo > hi || !eligible.length) return null;
  const current = new Set(
    eligible
      .filter((c) => Math.abs(c.frequency - center) < RECEIVER_HALF_BAND)
      .map((c) => c.talkgroup),
  ).size;
  const reachable = eligible.filter(
    (c) =>
      c.frequency + AUTO_HALF_BAND >= lo && c.frequency - AUTO_HALF_BAND <= hi,
  );
  if (new Set(reachable.map((c) => c.talkgroup)).size <= current) return null;
  const clamp = (c: number, low = lo, high = hi) =>
    Math.max(low, Math.min(high, Math.round(c / GRID) * GRID));
  const seeds = new Set<number>([lo, hi, clamp(center)]);
  for (const c of reachable) {
    const a = Math.max(
        lo,
        Math.ceil((c.frequency - AUTO_HALF_BAND) / GRID) * GRID,
      ),
      b = Math.min(
        hi,
        Math.floor((c.frequency + AUTO_HALF_BAND) / GRID) * GRID,
      );
    if (a <= b) {
      seeds.add(a);
      seeds.add(b);
    }
  }
  const sorted = [...seeds].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++)
    seeds.add(clamp((sorted[i - 1] + sorted[i]) / 2));
  // For each coverage interval, balance its outer signals and avoid placing a
  // real channel on the tuner's DC spike when an equally good offset is possible.
  for (const candidate of [...seeds]) {
    const covered = reachable.filter(
      (c) => Math.abs(c.frequency - candidate) <= AUTO_HALF_BAND,
    );
    const frequencies = [
      control,
      ...covered.map((c) => c.frequency),
      ...protectedFrequencies,
    ];
    const min = Math.min(...frequencies),
      max = Math.max(...frequencies);
    const low = Math.max(lo, Math.ceil((max - AUTO_HALF_BAND) / GRID) * GRID),
      high = Math.min(hi, Math.floor((min + AUTO_HALF_BAND) / GRID) * GRID);
    if (low > high) continue;
    const balanced = clamp((min + max) / 2, low, high);
    for (const value of [balanced, balanced - 50000, balanced + 50000])
      seeds.add(clamp(value, low, high));
  }
  let best: {
    proposal: CenterProposal;
    clear: number;
    dc: number;
    margin: number;
    movement: number;
  } | null = null;
  for (const candidate of seeds) {
    const covered = reachable.filter(
      (c) => Math.abs(c.frequency - candidate) <= AUTO_HALF_BAND,
    );
    const groups = [...new Set(covered.map((c) => c.talkgroup))].sort(
      (a, b) => a - b,
    );
    if (groups.length <= current || candidate === center) continue;
    const frequencies = [
      control,
      ...covered.map((c) => c.frequency),
      ...protectedFrequencies,
    ];
    const score = {
      proposal: { center: candidate, covered: groups.length, current, groups },
      clear: new Set(
        covered.filter((c) => c.encrypted === false).map((c) => c.talkgroup),
      ).size,
      dc: Number(
        Math.min(...frequencies.map((f) => Math.abs(f - candidate))) >= 40000,
      ),
      margin:
        AUTO_HALF_BAND -
        Math.max(...frequencies.map((f) => Math.abs(f - candidate))),
      movement: Math.abs(candidate - center),
    };
    if (
      !best ||
      score.proposal.covered > best.proposal.covered ||
      (score.proposal.covered === best.proposal.covered &&
        (score.clear > best.clear ||
          (score.clear === best.clear &&
            (score.dc > best.dc ||
              (score.dc === best.dc &&
                (score.margin > best.margin ||
                  (score.margin === best.margin &&
                    score.movement < best.movement)))))))
    )
      best = score;
  }
  return best?.proposal ?? null;
}

export class AutoCenterTiming {
  private candidate: { key: string; since: number } | null = null;
  private blockedUntil = 0;
  reset() {
    this.candidate = null;
    this.blockedUntil = 0;
  }
  defer(now: number) {
    this.candidate = null;
    this.blockedUntil = now + 5000;
  }
  observe(proposal: CenterProposal | null, now: number): number | null {
    if (!proposal || now < this.blockedUntil) {
      this.candidate = null;
      return null;
    }
    const key = `${proposal.center}:${proposal.groups.join(",")}`;
    if (this.candidate?.key !== key) {
      this.candidate = { key, since: now };
      return null;
    }
    if (now - this.candidate.since < 800) return null;
    this.defer(now);
    return proposal.center;
  }
}
