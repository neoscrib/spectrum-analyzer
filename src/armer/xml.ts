import {
  resolver,
  validateRules,
  type ArmerConfig,
  type TalkgroupRule,
} from "./model";
const xml = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
export interface PlaylistSite {
  name: string;
  system: string;
  frequencies: number[];
  aliasList: string;
  supported: boolean;
}
export interface ImportedPlaylist {
  sites: PlaylistSite[];
  lists: Record<string, TalkgroupRule[]>;
}
const children = (element: Element, name: string) =>
  Array.from(element.childNodes).filter(
    (n): n is Element => n.nodeType === 1 && (n as Element).localName === name,
  );
const type = (e: Element) =>
  e.getAttribute("type") ??
  e.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "type") ??
  "";
export function parseSdrtrunk(xmlText: string): ImportedPlaylist {
  if (
    xmlText.length > 10 * 1024 * 1024 ||
    /<!\s*(DOCTYPE|ENTITY)\b/i.test(xmlText)
  )
    throw Error("Use a playlist smaller than 10 MB without DTDs/entities.");
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const root = doc.documentElement;
  if (
    !root ||
    root.localName !== "playlist" ||
    doc.getElementsByTagName("parsererror").length ||
    !["3", "4"].includes(root.getAttribute("version") ?? "")
  )
    throw Error("Choose a valid SDRTrunk version 3 or 4 playlist XML.");
  const lists: Record<string, TalkgroupRule[]> = Object.create(null);
  for (const alias of children(root, "alias")) {
    const list = alias.getAttribute("list") ?? "",
      ids = children(alias, "id");
    const priority = ids.find((id) => type(id) === "priority");
    const p = priority ? Number(priority.getAttribute("priority")) : 100;
    if (!Number.isInteger(p) || (p !== -1 && (p < 1 || p > 100)))
      throw Error("Invalid SDRTrunk audio priority.");
    for (const id of ids) {
      const t = type(id);
      if (
        !["talkgroup", "talkgroupRange"].includes(t) ||
        id.getAttribute("protocol") !== "APCO25"
      )
        continue;
      (lists[list] ??= []).push({
        id: Number(id.getAttribute(t === "talkgroup" ? "value" : "min")),
        ...(t === "talkgroupRange"
          ? { max: Number(id.getAttribute("max")) }
          : {}),
        name: alias.getAttribute("name") ?? "",
        group: alias.getAttribute("group") ?? "",
        listen: p !== -1,
        origin: "import",
      });
    }
  }
  Object.values(lists).forEach(validateRules);
  const sites = children(root, "channel").map((channel) => {
    const source = children(channel, "source_configuration")[0],
      decode = children(channel, "decode_configuration")[0];
    const frequencies = source
      ? [
          ...(source.hasAttribute("frequency")
            ? [Number(source.getAttribute("frequency"))]
            : []),
          ...children(source, "frequency").map((f) => Number(f.textContent)),
        ]
      : [];
    return {
      name:
        channel.getAttribute("site") ||
        channel.getAttribute("name") ||
        "Imported site",
      system: channel.getAttribute("system") ?? "",
      aliasList: children(channel, "alias_list_name")[0]?.textContent ?? "",
      frequencies: [...new Set(frequencies)],
      supported:
        !!decode &&
        type(decode) === "decodeConfigP25Phase1" &&
        decode.getAttribute("modulation") === "C4FM" &&
        !!source &&
        ["sourceConfigTuner", "sourceConfigTunerMultipleFrequency"].includes(
          type(source),
        ) &&
        frequencies.length > 0 &&
        frequencies.every(
          (n) => Number.isInteger(n) && n >= 24e6 && n <= 1766e6,
        ),
    };
  });
  return { sites, lists };
}
/** Non-overlapping identifiers preserve mute exceptions in native SDRTrunk,
 * including imported overlapping ranges with exact-ID precedence. */
export function exportSdrtrunk(
  config: ArmerConfig,
  control: number,
  discovered: number[] = [],
): string {
  validateRules(config.rules);
  if (!Number.isInteger(control) || control < 24e6 || control > 1766e6)
    throw Error("Invalid control frequency.");
  const resolve = resolver(config),
    exactIds = new Set([
      ...config.rules.filter((r) => r.max === undefined).map((r) => r.id),
      ...discovered,
    ]);
  const list = "Spectrum ARMER";
  const aliases: string[] = [];
  let start = 1,
    previous = "",
    lastName = "",
    lastGroup = "",
    lastListen = true;
  const emit = (end: number) => {
    aliases.push(
      `  <alias color="0" group="${xml(lastGroup)}" list="${list}" name="${xml(lastName)}">\n    <id type="${start === end ? "talkgroup" : "talkgroupRange"}" protocol="APCO25" ${start === end ? `value="${start}"` : `min="${start}" max="${end}"`}/>\n    <id type="priority" priority="${lastListen ? 100 : -1}"/>\n  </alias>`,
    );
  };
  for (let id = 1; id <= 65536; id++) {
    const r = id <= 65535 ? resolve(id) : undefined;
    const name =
        r?.name ||
        (exactIds.has(id) ? `Talkgroup ${id}` : "Unlisted talkgroups"),
      group = r?.group || "ARMER",
      listen = r?.listen ?? config.defaultListen;
    const key = JSON.stringify([
      name,
      group,
      listen,
      exactIds.has(id) ? id : 0,
    ]);
    if (id > 1 && (key !== previous || id === 65536)) {
      emit(id - 1);
      start = id;
    }
    previous = key;
    lastName = name;
    lastGroup = group;
    lastListen = listen;
  }
  const frequencies = [...new Set([control, ...config.controls])].filter(
    (n) => Number.isInteger(n) && n >= 24e6 && n <= 1766e6,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n${aliases.join("\n")}\n  <channel system="ARMER" enabled="true" site="${xml(config.siteName)}" order="1" name="${xml(config.siteName || "ARMER")}">\n    <event_log_configuration><logger>CALL_EVENT</logger></event_log_configuration>\n    <source_configuration type="sourceConfigTunerMultipleFrequency" frequency_rotation_delay="1000" source_type="TUNER_MULTIPLE_FREQUENCIES">\n${frequencies.map((n) => `      <frequency>${n}</frequency>`).join("\n")}\n    </source_configuration>\n    <alias_list_name>${list}</alias_list_name>\n    <aux_decode_configuration/>\n    <decode_configuration type="decodeConfigP25Phase1" modulation="C4FM" ignore_data_calls="true" traffic_channel_pool_size="6"/>\n    <record_configuration/>\n  </channel>\n</playlist>\n`;
}
