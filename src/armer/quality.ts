import type { P25Stats } from "./model";

export interface ControlQuality {
  seconds: number;
  validPerSecond: number;
  rejectedPercent: number | null;
}
/** Stream-time window: tab scheduling and accelerated replay do not skew rates.
 * These are decoder candidates, not a measurement of BER or every RF packet. */
export class ControlQualityWindow {
  private snapshots = [{ seconds: 0, valid: 0, invalid: 0 }];
  update(
    stats: Pick<P25Stats, "seconds" | "valid" | "invalid">,
  ): ControlQuality {
    const last = this.snapshots.at(-1)!;
    if (
      stats.seconds < last.seconds ||
      stats.valid < last.valid ||
      stats.invalid < last.invalid
    )
      this.snapshots = [
        { seconds: stats.seconds, valid: stats.valid, invalid: stats.invalid },
      ];
    else
      this.snapshots.push({
        seconds: stats.seconds,
        valid: stats.valid,
        invalid: stats.invalid,
      });
    while (
      this.snapshots.length > 2 &&
      this.snapshots[1].seconds <= stats.seconds - 5
    )
      this.snapshots.shift();
    const first = this.snapshots[0],
      seconds = stats.seconds - first.seconds;
    const valid = stats.valid - first.valid,
      invalid = stats.invalid - first.invalid;
    return {
      seconds,
      validPerSecond: seconds > 0 ? valid / seconds : 0,
      rejectedPercent:
        valid + invalid > 0 ? (100 * invalid) / (valid + invalid) : null,
    };
  }
}
