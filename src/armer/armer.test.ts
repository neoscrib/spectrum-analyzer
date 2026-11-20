import { describe, it, expect, vi } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import {
  policyBitmap,
  mergeAliases,
  STARTER_CONFIG,
  type ArmerPolicy,
  type TalkgroupRule,
} from "./model";
import { parseSdrtrunk, exportSdrtrunk } from "./xml";
vi.stubGlobal("DOMParser", DOMParser);
const rule = (id: number, listen?: boolean, max?: number): TalkgroupRule => ({
  id,
  max,
  listen,
  name: `Alias & <${id}>`,
  group: 'Group "A"',
  origin: "manual",
});
describe("ARMER talkgroup policy and native playlist interchange", () => {
  it("listens to all 65,535 nonzero IDs by default, with exact/range exceptions", () => {
    const bitmap = policyBitmap({
      defaultListen: true,
      rules: [rule(1, false, 100), rule(50, true), rule(65535, false)],
    });
    expect(bitmap[0]).toBe(0);
    expect(bitmap[1]).toBe(0);
    expect(bitmap[50]).toBe(1);
    expect(bitmap[101]).toBe(1);
    expect(bitmap[65535]).toBe(0);
  });
  it("preserves custom aliases and listen settings during API refresh, but applies explicit imports", () => {
    const original = rule(6620, false);
    expect(
      mergeAliases(
        [original],
        [{ ...rule(6620), name: "Directory", origin: "radioreference" }],
      ),
    ).toEqual([original]);
    const imported = {
      ...rule(6620, true),
      name: "Imported",
      origin: "import" as const,
    };
    expect(mergeAliases([original], [imported])).toEqual([imported]);
    expect(
      mergeAliases([original], [{ ...rule(6620), name: "Edited" }])[0],
    ).toMatchObject({ name: "Edited", listen: false });
  });
  for (const defaultListen of [true, false])
    it(`round-trips all IDs with default listen=${defaultListen}, escaping names and normalizing overlaps`, () => {
      const config = {
        ...STARTER_CONFIG,
        siteName: 'Site & "test"',
        defaultListen,
        rules: [
          rule(1, false, 65535),
          rule(100, true, 500),
          rule(200, false),
          rule(65535, true),
        ],
      };
      const xml = exportSdrtrunk(config, 853075000, [600]);
      expect(xml).toContain("&amp;");
      expect(xml).toContain('priority="-1"');
      const parsed = parseSdrtrunk(xml),
        site = parsed.sites[0];
      expect(site).toMatchObject({
        name: config.siteName,
        supported: true,
        frequencies: config.controls,
      });
      const rules = parsed.lists[site.aliasList];
      expect(policyBitmap({ defaultListen: !defaultListen, rules })).toEqual(
        policyBitmap(config),
      );
      const coverage = new Uint8Array(65536);
      for (const r of rules)
        for (let n = r.id; n <= (r.max ?? r.id); n++) coverage[n]++;
      expect(coverage.slice(1).every((n) => n === 1)).toBe(true);
      expect(rules.find((r) => r.id === 200)?.name).toBe(config.rules[2].name);
    });
  it("rejects unsafe/malformed XML and marks unsupported channels", () => {
    expect(() =>
      parseSdrtrunk('<!DOCTYPE a><playlist version="4"/>'),
    ).toThrow();
    expect(() => parseSdrtrunk('<playlist version="99"/>')).toThrow();
    expect(() =>
      policyBitmap({ defaultListen: true, rules: [rule(65536)] }),
    ).toThrow();
    const xml = exportSdrtrunk({ ...STARTER_CONFIG, rules: [] }, 853075000);
    expect(
      parseSdrtrunk(xml.replace('modulation="C4FM"', 'modulation="CQPSK"'))
        .sites[0].supported,
    ).toBe(false);
    expect(
      parseSdrtrunk(
        xml.replace("decodeConfigP25Phase1", "decodeConfigP25Phase2"),
      ).sites[0].supported,
    ).toBe(false);
  });
});
