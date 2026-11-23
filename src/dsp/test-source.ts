import type { Settings } from "../model";
export interface TestSource {
  process(center: number, count?: number): Uint8Array;
}

/** Fixtures are optional dependencies of the selected decoder worker. */
export async function createTestSource(
  kind: Settings["decoder"],
): Promise<TestSource> {
  switch (kind) {
    case "armer": {
      const native = await import("../wasm/armer");
      await native.default();
      const source = new native.ArmerTestSource();
      return {
        process: (center, count = 65536) => source.process(center, count),
      };
    }
    case "am":
      return new (await import("./am-synthetic")).AmTestSignal();
    case "wwv":
      return new (await import("./wwv-synthetic")).WwvTestSignal();
    case "nfm":
      return new (await import("./nfm-synthetic")).NfmTestSignal();
    case "ook":
      return new (await import("./ook-synthetic")).OokTestSignal();
    case "rtl433":
      return new (await import("./rtl433-synthetic")).Rtl433TestSignal();
    default:
      return new (await import("./synthetic")).TestSignal();
  }
}
