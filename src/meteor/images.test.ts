import { expect, it } from "vitest";
import { mergeImage, contrastLevels } from "./images";
it("ignores missing black strips when calculating display contrast, and leaves constant images alone", () => {
  const pixels = new Uint8Array(1000);
  pixels.set([36, 38, 40, 42, 44, 46, 48, 50, 51], 990);
  expect(contrastLevels(pixels)).toEqual([36, 51]);
  expect(contrastLevels(new Uint8Array(100))).toEqual([0, 255]);
  expect(contrastLevels(new Uint8Array(100).fill(12))).toEqual([0, 255]);
});
it("preserves skipped-render rows when several progressive patches arrive before a paint", () => {
  let image = mergeImage(undefined, {
    apid: 64,
    width: 2,
    height: 1,
    startRow: 0,
    pixels: new Uint8Array([1, 2]),
  });
  image = mergeImage(image, {
    apid: 64,
    width: 2,
    height: 2,
    startRow: 1,
    pixels: new Uint8Array([3, 4]),
  });
  image = mergeImage(image, {
    apid: 64,
    width: 2,
    height: 3,
    startRow: 2,
    pixels: new Uint8Array([5, 6]),
  });
  expect([...image.pixels]).toEqual([1, 2, 3, 4, 5, 6]);
  image = mergeImage(image, {
    apid: 64,
    width: 2,
    height: 3,
    startRow: 2,
    pixels: new Uint8Array([7, 8]),
  });
  expect([...image.pixels]).toEqual([1, 2, 3, 4, 7, 8]);
});
