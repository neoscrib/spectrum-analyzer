import type { IqFormat } from "./model";
export const iqStride = (format: IqFormat) =>
  format === "cu8" ? 2 : format === "cs16" ? 4 : 8;
export function iqValue(
  bytes: Uint8Array,
  view: DataView,
  n: number,
  format: IqFormat,
): number {
  return format === "cu8"
    ? (bytes[n] - 127.5) / 128
    : format === "cs16"
      ? view.getInt16(n * 2, true) / 32768
      : view.getFloat32(n * 4, true);
}
