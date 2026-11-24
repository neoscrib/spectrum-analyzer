import type { ChannelImage } from "./types";
/** Grow in scan-row blocks; accumulate every patch before React can coalesce renders. */
export class MeteorImageStore {
  private channels = new Map<
    number,
    { storage: Uint8Array; image: ChannelImage }
  >();
  merge(patch: ChannelImage): ChannelImage {
    if (
      !Number.isInteger(patch.apid) ||
      patch.apid < 64 ||
      patch.apid > 69 ||
      patch.width !== 1568 ||
      !Number.isInteger(patch.height) ||
      !Number.isInteger(patch.startRow) ||
      patch.height < 1 ||
      patch.height > 12000 ||
      patch.startRow < 0 ||
      patch.startRow > patch.height ||
      patch.pixels.length !== (patch.height - patch.startRow) * patch.width
    )
      throw Error("Invalid Meteor image patch.");
    const previous = this.channels.get(patch.apid),
      length = patch.width * patch.height;
    let storage = previous?.storage;
    if (!storage || storage.length < length) {
      const next = new Uint8Array(
        patch.width * Math.min(12000, Math.ceil(patch.height / 256) * 256),
      );
      if (storage) next.set(storage);
      storage = next;
    }
    storage.set(patch.pixels, patch.startRow * patch.width);
    const image = {
      ...patch,
      startRow: 0,
      pixels: storage.subarray(0, length),
    };
    this.channels.set(patch.apid, { storage, image });
    return image;
  }
  images() {
    return [...this.channels.values()]
      .map(({ image }) => image)
      .sort((a, b) => a.apid - b.apid);
  }
  clear() {
    this.channels.clear();
  }
}
