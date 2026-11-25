import counties from "./counties.json";
import events from "./events.json";
import type { SameHeader, SameLocation, SameCategory } from "./model";
const countyNames: Record<string, string> = counties;
const eventNames: Record<string, string> = events;
const states: Record<string, string> = Object.fromEntries(
  [
    "01 Alabama",
    "02 Alaska",
    "04 Arizona",
    "05 Arkansas",
    "06 California",
    "08 Colorado",
    "09 Connecticut",
    "10 Delaware",
    "11 District of Columbia",
    "12 Florida",
    "13 Georgia",
    "15 Hawaii",
    "16 Idaho",
    "17 Illinois",
    "18 Indiana",
    "19 Iowa",
    "20 Kansas",
    "21 Kentucky",
    "22 Louisiana",
    "23 Maine",
    "24 Maryland",
    "25 Massachusetts",
    "26 Michigan",
    "27 Minnesota",
    "28 Mississippi",
    "29 Missouri",
    "30 Montana",
    "31 Nebraska",
    "32 Nevada",
    "33 New Hampshire",
    "34 New Jersey",
    "35 New Mexico",
    "36 New York",
    "37 North Carolina",
    "38 North Dakota",
    "39 Ohio",
    "40 Oklahoma",
    "41 Oregon",
    "42 Pennsylvania",
    "44 Rhode Island",
    "45 South Carolina",
    "46 South Dakota",
    "47 Tennessee",
    "48 Texas",
    "49 Utah",
    "50 Vermont",
    "51 Virginia",
    "53 Washington",
    "54 West Virginia",
    "55 Wisconsin",
    "56 Wyoming",
    "60 American Samoa",
    "66 Guam",
    "69 Northern Mariana Islands",
    "72 Puerto Rico",
    "78 U.S. Virgin Islands",
  ].map((x) => [x.slice(0, 2), x.slice(3)]),
);
const subdivisions = [
  "All or unspecified portion",
  "Northwest",
  "North",
  "Northeast",
  "West",
  "Central",
  "East",
  "Southwest",
  "South",
  "Southeast",
];
export function parseLocation(code: string): SameLocation {
  if (!/^\d{6}$/.test(code))
    throw Error("A SAME location must contain six digits.");
  const stateCode = code.slice(1, 3),
    countyCode = code.slice(3),
    subdivision = subdivisions[Number(code[0])];
  const nationwide = code === "000000";
  const state = nationwide
    ? "United States"
    : (states[stateCode] ?? `State/region ${stateCode}`);
  const county = nationwide
    ? "Nationwide"
    : countyCode === "000"
      ? `Entire ${state}`
      : (countyNames[code.slice(1)] ?? `County/zone ${countyCode}`);
  return {
    code,
    subdivision,
    stateCode,
    countyCode,
    state,
    county,
    name: nationwide
      ? "Nationwide"
      : `${code[0] === "0" ? "" : subdivision + " · "}${county}, ${state}`,
    known:
      nationwide ||
      (stateCode in states &&
        (countyCode === "000" || code.slice(1) in countyNames)),
  };
}
export function eventCategory(code: string): SameCategory {
  const name = eventNames[code];
  if (!name) return "unknown"; // Never infer severity from an unknown suffix.
  if (["RWT", "RMT", "NPT", "DMO"].includes(code)) return "test";
  if (/Warning/.test(name)) return "warning";
  if (/Watch/.test(name)) return "watch";
  if (/Emergency|Evacuation Immediate/.test(name)) return "emergency";
  if (/Statement/.test(name)) return "statement";
  return "information";
}
/** Year is absent on air. Resolve the nearest valid year to the capture reference,
 * explicitly retaining that inference. Purge is measured from issuance, not receipt. */
const headerPattern =
  /^ZCZC-([A-Z]{3})-([A-Z]{3})-((?:\d{6}-){0,30}\d{6})\+(\d{4})-(\d{3})(\d{2})(\d{2})-([\x20-\x7e]{8})-/;
// A burst framer may append a few noise bytes while detecting carrier loss.
// Retain those raw bytes as evidence; only parse an actually complete prefix.
export const headerPrefix = (raw: string): string | undefined =>
  headerPattern.exec(raw)?.[0];
export function parseSame(raw: string, reference: Date): SameHeader {
  if (!Number.isFinite(reference.getTime()))
    throw Error("Invalid capture reference date.");
  const match = headerPattern.exec(raw);
  if (!match || match[0] !== raw)
    throw Error("Incomplete or malformed SAME header.");
  const [, originator, event, areas, purge, d, h, m, sender] = match;
  if (/[-+]/.test(sender)) throw Error("Invalid sender identifier.");
  const hours = Number(purge.slice(0, 2)),
    minutes = Number(purge.slice(2));
  const durationMinutes = hours * 60 + minutes;
  if (
    minutes >= 60 ||
    durationMinutes === 0 ||
    (originator === "WXR" && durationMinutes > 360) ||
    (durationMinutes <= 60 ? durationMinutes % 15 : durationMinutes % 30)
  )
    throw Error("Invalid purge interval.");
  const day = Number(d),
    hour = Number(h),
    minute = Number(m);
  if (day < 1 || day > 366 || hour > 23 || minute > 59)
    throw Error("Invalid UTC issue timestamp.");
  const year = reference.getUTCFullYear();
  const candidates = [year - 1, year, year + 1]
    .map((y) => new Date(Date.UTC(y, 0, day, hour, minute)))
    .filter((date, n) => date.getUTCFullYear() === year - 1 + n);
  candidates.sort(
    (a, b) =>
      Math.abs(a.getTime() - reference.getTime()) -
      Math.abs(b.getTime() - reference.getTime()),
  );
  const issued = candidates[0];
  if (!issued)
    throw Error("The issue day does not exist near the reference year.");
  return {
    raw,
    originator,
    originatorName:
      (
        {
          WXR: "National Weather Service",
          CIV: "Civil authorities",
          EAS: "EAS participant",
          PEP: "United States Government",
        } as Record<string, string>
      )[originator] ?? `Unknown originator ${originator}`,
    event,
    eventName: eventNames[event] ?? `Unknown event ${event}`,
    category: eventCategory(event),
    locations: areas.split("-").map(parseLocation),
    durationMinutes,
    day,
    hour,
    minute,
    issued: issued.toISOString(),
    expires: new Date(issued.getTime() + durationMinutes * 60000).toISOString(),
    inferredYear: issued.getUTCFullYear(),
    sender,
  };
}
/** 0 county/state/national codes are wildcards, including subdivision matching. */
export function matchesLocation(alert: string, wanted: string): boolean {
  const a = parseLocation(alert),
    b = parseLocation(wanted);
  return (
    alert === "000000" ||
    wanted === "000000" ||
    (a.stateCode === b.stateCode &&
      (a.countyCode === "000" ||
        b.countyCode === "000" ||
        a.countyCode === b.countyCode) &&
      (alert[0] === "0" || wanted[0] === "0" || alert[0] === wanted[0]))
  );
}
