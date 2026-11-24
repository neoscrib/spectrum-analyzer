import type { ChannelImage } from "./types";
/** Bounded sampling for display levels; zero missing-data pixels do not set the range. */
export function contrastLevels(pixels: Uint8Array): [number, number] {
  const bins = new Uint32Array(256),
    step = Math.max(1, Math.floor(pixels.length / 65536));
  let count = 0;
  for (let i = 0; i < pixels.length; i += step)
    if (pixels[i] > 0) {
      bins[pixels[i]]++;
      count++;
    }
  if (!count) return [0, 255];
  let total = 0,
    low = 0,
    high = 255;
  for (let i = 1; i < 256; i++) {
    total += bins[i];
    if (total >= Math.max(1, Math.ceil(count * 0.01))) {
      low = i;
      break;
    }
  }
  total = 0;
  for (let i = 1; i < 256; i++) {
    total += bins[i];
    if (total >= Math.ceil(count * 0.99)) {
      high = i;
      break;
    }
  }
  return high > low ? [low, high] : [0, 255];
}
/** Accumulate every Worker patch before React can coalesce renders. */
export function mergeImage(
  previous: ChannelImage | undefined,
  patch: ChannelImage,
): ChannelImage {
  const size = patch.width * patch.height;
  let pixels = previous?.pixels;
  if (!pixels || pixels.length !== size || previous?.width !== patch.width) {
    const next = new Uint8Array(size);
    if (pixels && previous?.width === patch.width)
      next.set(pixels.subarray(0, size));
    pixels = next;
  }
  pixels.set(patch.pixels, patch.startRow * patch.width);
  return { ...patch, startRow: 0, pixels };
}
