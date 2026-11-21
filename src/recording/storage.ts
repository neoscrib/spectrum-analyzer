import { metadataName, type RecordingSink } from "./model";
// A minimal boundary keeps the optional Chromium picker out of shared DOM types.
interface CaptureDirectory {
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(data: Uint8Array | string): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }>;
  }>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (options: {
    id: string;
    mode: "readwrite";
  }) => Promise<CaptureDirectory>;
};
export function canStreamToFolder(): boolean {
  return typeof (window as PickerWindow).showDirectoryPicker === "function";
}
/** Invoke directly inside the button gesture, before any await in the caller. */
export async function folderSink(filename: string): Promise<RecordingSink> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker)
    throw Error("Folder saving is unavailable. Choose Download instead.");
  const directory = await picker.call(window, {
    id: "spectrum-iq",
    mode: "readwrite",
  });
  const file = await directory.getFileHandle(filename, { create: true });
  const stream = await file.createWritable();
  return {
    mode: "disk",
    filename,
    write: (data) => stream.write(data),
    close: async () => {
      await stream.close();
      return undefined;
    },
    abort: () => stream.abort(),
    saveMetadata: async (text) => {
      const meta = await directory.getFileHandle(metadataName(filename), {
        create: true,
      });
      const out = await meta.createWritable();
      try {
        await out.write(text);
        await out.close();
      } catch (error) {
        try {
          await out.abort();
        } catch {}
        throw error;
      }
    },
  };
}
export function downloadSink(filename: string): RecordingSink {
  let chunks: BlobPart[] = [];
  return {
    mode: "download",
    filename,
    write: async (data) => {
      chunks.push(data as Uint8Array<ArrayBuffer>);
    },
    close: async () => {
      const blob = new Blob(chunks, { type: "application/octet-stream" });
      chunks = [];
      return blob;
    },
    abort: async () => {
      chunks = [];
    },
    saveMetadata: async () => {},
  };
}
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
