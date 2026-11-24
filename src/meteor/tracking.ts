import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
  degreesToRadians,
  radiansToDegrees,
  type SatRec,
} from "satellite.js";
export interface Observer {
  latitude: number;
  longitude: number;
  altitude: number;
}
export interface Look {
  azimuth: number;
  elevation: number;
  range: number;
}
export interface Pass {
  start: number;
  end: number;
  maximum: number;
  peak: number;
  path: (Look & { time: number })[];
}
export function parseTle(text: string, expectedId?: number): SatRec {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trimEnd());
  const one = lines.findIndex((s) => s.startsWith("1 "));
  const l1 = lines[one],
    l2 = lines[one + 1];
  if (
    !l1 ||
    !l2 ||
    !l2.startsWith("2 ") ||
    l1.length !== 69 ||
    l2.length !== 69
  )
    throw Error("Paste a complete two-line TLE (optional name line).");
  const checksum = (line: string) =>
    [...line.slice(0, 68)].reduce(
      (sum, c) => sum + (c === "-" ? 1 : /\d/.test(c) ? Number(c) : 0),
      0,
    ) % 10;
  if (checksum(l1) !== Number(l1[68]) || checksum(l2) !== Number(l2[68]))
    throw Error(
      "TLE checksum failed. Refresh or paste unmodified element lines.",
    );
  if (
    l1.slice(2, 7) !== l2.slice(2, 7) ||
    (expectedId && Number(l1.slice(2, 7)) !== expectedId)
  )
    throw Error("TLE catalog number does not match the selected satellite.");
  const sat = twoline2satrec(l1, l2);
  if (sat.error || !Number.isFinite(sat.no) || sat.no <= 0)
    throw Error("Invalid orbital elements.");
  return sat;
}
export function tleAgeDays(sat: SatRec, now = Date.now()) {
  return now / 86400000 + 2440587.5 - sat.jdsatepoch;
}
export function lookAt(sat: SatRec, observer: Observer, time: number): Look {
  const date = new Date(time),
    state = propagate(sat, date);
  if (!state || !state.position || typeof state.position === "boolean")
    throw Error("Orbit propagation failed. Refresh the TLE.");
  const position = eciToEcf(state.position, gstime(date));
  const look = ecfToLookAngles(
    {
      latitude: degreesToRadians(observer.latitude),
      longitude: degreesToRadians(observer.longitude),
      height: observer.altitude / 1000,
    },
    position,
  );
  return {
    azimuth: radiansToDegrees(look.azimuth),
    elevation: radiansToDegrees(look.elevation),
    range: look.rangeSat,
  };
}
export function dopplerHz(
  sat: SatRec,
  observer: Observer,
  time: number,
  frequency: number,
) {
  const radialVelocity =
    lookAt(sat, observer, time + 500).range -
    lookAt(sat, observer, time - 500).range;
  return (-frequency * radialVelocity) / 299792.458;
}
export function predictPasses(
  sat: SatRec,
  observer: Observer,
  now = Date.now(),
  minimum = 10,
  hours = 48,
): Pass[] {
  const passes: Pass[] = [];
  const step = 30000;
  let start: number | undefined;
  const horizon = (t: number) => lookAt(sat, observer, t).elevation;
  const crossing = (a: number, b: number) => {
    const rising = horizon(a) < 0;
    for (let i = 0; i < 15; i++) {
      const m = (a + b) / 2;
      if (horizon(m) < 0 === rising) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  let previous = now - 1800000,
    el = horizon(previous);
  for (
    let time = previous + step;
    time <= now + hours * 3600000;
    time += step
  ) {
    const next = horizon(time);
    if (el < 0 && next >= 0) start = crossing(previous, time);
    if (el >= 0 && next < 0 && start !== undefined) {
      const end = crossing(previous, time);
      if (end > now) {
        let maximum = -90,
          peak = start;
        const path: Pass["path"] = [];
        for (let t = start; t <= end; t += 5000) {
          const look = lookAt(sat, observer, t);
          path.push({ ...look, time: t });
          if (look.elevation > maximum) {
            maximum = look.elevation;
            peak = t;
          }
        }
        path.push({ ...lookAt(sat, observer, end), time: end });
        if (maximum >= minimum)
          passes.push({ start, end, maximum, peak, path });
      }
      start = undefined;
    }
    previous = time;
    el = next;
  }
  return passes;
}
