export interface RdsStatus {
  enabled: boolean;
  synchronized: boolean;
  validGroups: number;
  secondsSinceGroup: number | null;
  pi: number | null;
  ps: string | null;
  radioText: string | null;
  pty: number | null;
  tp: boolean | null;
  ta: boolean | null;
  music: boolean | null;
  clock: {
    mjd: number;
    hour: number;
    minute: number;
    offsetMinutes: number;
  } | null;
  groupTypes: number[];
  lastGroup: number[] | null;
}

// On-air PTY is the same five-bit value; its displayed meaning depends on
// the broadcaster's regional standard. Never infer this from PI alone.
const rdsPty = [
  "None",
  "News",
  "Current affairs",
  "Information",
  "Sport",
  "Education",
  "Drama",
  "Culture",
  "Science",
  "Varied",
  "Pop music",
  "Rock music",
  "Easy listening",
  "Light classical",
  "Serious classical",
  "Other music",
  "Weather",
  "Finance",
  "Children’s programmes",
  "Social affairs",
  "Religion",
  "Phone-in",
  "Travel",
  "Leisure",
  "Jazz",
  "Country music",
  "National music",
  "Oldies",
  "Folk music",
  "Documentary",
  "Alarm test",
  "Alarm",
];
const rbdsPty = [
  "None",
  "News",
  "Information",
  "Sports",
  "Talk",
  "Rock",
  "Classic rock",
  "Adult hits",
  "Soft rock",
  "Top 40",
  "Country",
  "Oldies",
  "Soft",
  "Nostalgia",
  "Jazz",
  "Classical",
  "Rhythm and blues",
  "Soft rhythm and blues",
  "Foreign language",
  "Religious music",
  "Religious talk",
  "Personality",
  "Public",
  "College",
  "Spanish talk",
  "Spanish music",
  "Hip hop",
  "Unassigned",
  "Unassigned",
  "Weather",
  "Emergency test",
  "Emergency",
];
export type RdsRegion = "rds" | "rbds";
export function ptyLabel(code: number | null, region: RdsRegion): string {
  if (code === null) return "—";
  return `${(region === "rbds" ? rbdsPty : rdsPty)[code] ?? "Unknown"} (${code})`;
}
export function broadcastClock(clock: RdsStatus["clock"]): string | null {
  if (!clock) return null;
  const date = new Date(
    (clock.mjd - 40587) * 86400000 +
      clock.hour * 3600000 +
      clock.minute * 60000,
  );
  const offset = clock.offsetMinutes;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC · local UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}
