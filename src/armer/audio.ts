export interface ArmerMix {
  muted: number[];
  solo: number | null;
  gains: Record<number, number>;
  pans: Record<number, number>;
}
export const DEFAULT_ARMER_MIX: ArmerMix = {
  muted: [],
  solo: null,
  gains: {},
  pans: {},
};
export function audibleTalkgroup(talkgroup: number, mix: ArmerMix) {
  return (
    !mix.muted.includes(talkgroup) &&
    (mix.solo === null || mix.solo === talkgroup) &&
    (mix.gains[talkgroup] ?? 1) > 0
  );
}
