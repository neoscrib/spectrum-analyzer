import type { ControlQuality } from "./quality";
export interface TalkgroupRule {
  id: number;
  max?: number;
  name: string;
  group: string;
  /** Absent means inherit the default listen setting. */
  listen?: boolean;
  origin: "manual" | "local" | "radioreference" | "import";
}
export interface ArmerPolicy {
  defaultListen: boolean;
  rules: TalkgroupRule[];
}
export interface ArmerConfig extends ArmerPolicy {
  siteName: string;
  controls: number[];
}
export interface P25Event {
  kind: string;
  frequency: number;
  talkgroup: number;
  source: number;
  channel: number;
  encrypted: boolean | null;
  message: string;
  nac: number;
  system: number;
  wacn: number;
  rfss: number;
  site: number;
  members: number[];
  corrections: number;
  time: number;
}
export interface P25Stats {
  valid: number;
  invalid: number;
  frames: number;
  voiceFrames: number;
  channels: number;
  seconds: number;
}
export interface ArmerStatus extends P25Stats {
  audioTalkgroup: number;
  controlLocked: boolean;
  quality: ControlQuality;
}
export interface ArmerFeed {
  status: ArmerStatus | null;
  events: P25Event[];
}
export interface SeenTalkgroup {
  id: number;
  count: number;
  lastSeen: number;
  frequency: number;
  source: number;
  encrypted: boolean | null;
  message: string;
}
export const ruleKey = (r: Pick<TalkgroupRule, "id" | "max">) =>
  `${r.id}:${r.max ?? r.id}`;
export const validId = (id: number) =>
  Number.isInteger(id) && id >= 1 && id <= 65535;
export function validateRules(
  rules: unknown,
): asserts rules is TalkgroupRule[] {
  if (!Array.isArray(rules) || rules.length > 10000)
    throw Error("Use at most 10,000 talkgroup rules.");
  const keys = new Set<string>();
  for (const r of rules) {
    if (
      !r ||
      !validId(r.id) ||
      (r.max !== undefined && (!validId(r.max) || r.max < r.id)) ||
      typeof r.name !== "string" ||
      r.name.length > 240 ||
      typeof r.group !== "string" ||
      r.group.length > 240 ||
      (r.listen !== undefined && typeof r.listen !== "boolean") ||
      !["manual", "local", "radioreference", "import"].includes(r.origin)
    )
      throw Error("Invalid talkgroup rule. IDs must be 1–65535.");
    const key = ruleKey(r);
    if (keys.has(key)) throw Error(`Duplicate talkgroup rule: ${r.id}.`);
    keys.add(key);
  }
}
export function resolver(policy: ArmerPolicy) {
  const exact = new Map(
    policy.rules.filter((r) => r.max === undefined).map((r) => [r.id, r]),
  );
  const ranges = policy.rules
    .filter((r) => r.max !== undefined)
    .sort((a, b) => a.max! - a.id - (b.max! - b.id));
  return (id: number) =>
    exact.get(id) ?? ranges.find((r) => r.id <= id && id <= r.max!);
}
export function listens(id: number, policy: ArmerPolicy): boolean {
  return resolver(policy)(id)?.listen ?? policy.defaultListen;
}
export function policyBitmap(policy: ArmerPolicy): Uint8Array {
  validateRules(policy.rules);
  const resolve = resolver(policy),
    enabled = new Uint8Array(65536);
  for (let id = 1; id <= 65535; id++)
    enabled[id] = Number(resolve(id)?.listen ?? policy.defaultListen);
  return enabled;
}
export function mergeAliases(
  existing: TalkgroupRule[],
  incoming: TalkgroupRule[],
): TalkgroupRule[] {
  validateRules(incoming);
  const map = new Map(existing.map((r) => [ruleKey(r), r]));
  for (const item of incoming) {
    const old = map.get(ruleKey(item));
    if (!old) {
      map.set(ruleKey(item), item);
      continue;
    }
    const preserveName =
      item.origin === "radioreference" &&
      ["manual", "import"].includes(old.origin);
    map.set(ruleKey(item), {
      ...old,
      ...item,
      ...(item.origin === "radioreference"
        ? { listen: old.listen }
        : item.listen === undefined
          ? { listen: old.listen }
          : {}),
      ...(preserveName
        ? { name: old.name, group: old.group, origin: old.origin }
        : {}),
    });
  }
  const result = [...map.values()];
  validateRules(result);
  return result;
}
export const STARTER_CONFIG: ArmerConfig = {
  defaultListen: true,
  siteName: "Ogilvie 5-75",
  controls: [853075000, 853875000],
  rules: [],
};
export function loadArmerConfig(starter: TalkgroupRule[]): ArmerConfig {
  try {
    const data = JSON.parse(
      localStorage.getItem("spectrum-armer-v1") ?? "null",
    );
    if (!data) return { ...STARTER_CONFIG, rules: starter };
    validateRules(data.rules);
    if (
      typeof data.defaultListen !== "boolean" ||
      typeof data.siteName !== "string" ||
      data.siteName.length > 160 ||
      !Array.isArray(data.controls) ||
      !data.controls.length ||
      data.controls.length > 32 ||
      !data.controls.every(
        (n: number) => Number.isInteger(n) && n >= 24e6 && n <= 1766e6,
      )
    )
      throw Error("Invalid saved ARMER settings.");
    return data;
  } catch {
    return { ...STARTER_CONFIG, rules: starter };
  }
}
