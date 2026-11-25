import type {
  RadioSource,
  ReceiverInfo,
  ReceiverSettings,
  SourceOptions,
} from "./model";
import { validateReceiver } from "./model";
export interface BridgeReceiver {
  label: string;
  args: string;
}
export class BridgeConnection {
  private socket: WebSocket;
  private id = 0;
  private requests = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private queue: ArrayBuffer[] = [];
  private reads: {
    resolve: (value: { data: ArrayBuffer }) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  private failure?: Error;
  private generation = 0;
  private sequence = 0;
  readonly ready: Promise<void>;
  constructor(options: SourceOptions) {
    const url = new URL(options.url);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password)
      throw Error(
        "Enter a ws:// or wss:// bridge URL without embedded credentials.",
      );
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(Error("SDR bridge connection timed out."));
        reject(this.failure);
      }, 8000);
      this.socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.socket.onerror = () => {
        clearTimeout(timeout);
        const error = Error(
          "Cannot reach the SDR bridge. Check its URL, TLS certificate and allowed app origin.",
        );
        this.fail(error);
        reject(error);
      };
      this.socket.onclose = () => {
        clearTimeout(timeout);
        const error = Error("SDR bridge disconnected.");
        this.fail(error);
        reject(error);
      };
    });
    this.socket.onmessage = ({ data }) => {
      try {
        if (typeof data === "string") {
          if (data.length > 32768)
            throw Error("SDR bridge response is too large.");
          const message = JSON.parse(data);
          if (message.type === "error")
            throw Error(String(message.error).slice(0, 500));
          const request = this.requests.get(message.id);
          if (!request) return;
          clearTimeout(request.timer);
          this.requests.delete(message.id);
          if (message.error)
            request.reject(Error(String(message.error).slice(0, 500)));
          else request.resolve(message.result);
        } else {
          if (
            !(data instanceof ArrayBuffer) ||
            data.byteLength < 18 ||
            data.byteLength > 131088
          )
            throw Error("Invalid SDR bridge IQ block.");
          const header = new DataView(data);
          if (
            header.getUint32(0, false) !== 0x53495131 ||
            header.getUint32(8, true) * 2 !== data.byteLength - 16
          )
            throw Error("Invalid SDR bridge IQ header.");
          if (header.getUint32(12, true) !== this.generation) return;
          if (header.getUint32(4, true) !== this.sequence)
            throw Error("SDR bridge sample sequence gap; reception stopped.");
          this.sequence = (this.sequence + 1) >>> 0;
          const block = data.slice(16),
            read = this.reads.shift();
          if (read) {
            clearTimeout(read.timer);
            read.resolve({ data: block });
          } else {
            if (this.queue.length >= 8)
              throw Error(
                "SDR bridge input overflow; reception stopped to preserve sample continuity.",
              );
            this.queue.push(block);
          }
        }
      } catch (e) {
        this.fail(e instanceof Error ? e : Error(String(e)));
      }
    };
  }
  private fail(error: Error) {
    this.failure ??= error;
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(this.failure);
    }
    this.requests.clear();
    for (const read of this.reads.splice(0)) {
      clearTimeout(read.timer);
      read.reject(this.failure);
    }
    this.queue = [];
    this.socket.close();
  }
  async request(
    type: string,
    fields: Record<string, unknown> = {},
  ): Promise<any> {
    await this.ready;
    if (this.failure) throw this.failure;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.requests.delete(id);
          const error = Error("SDR bridge command timed out.");
          reject(error);
          this.fail(error);
        },
        type === "close" ? 3000 : 12000,
      );
      this.requests.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ type, id, ...fields }));
    });
  }
  async configure(settings: ReceiverSettings): Promise<ReceiverInfo> {
    const result = await this.request("configure", { ...settings });
    this.generation = result.generation;
    this.sequence = 0;
    this.queue = [];
    return checkedInfo(result.info);
  }
  readSamples(): Promise<{ data: ArrayBuffer }> {
    if (this.failure) return Promise.reject(this.failure);
    const data = this.queue.shift();
    if (data) return Promise.resolve({ data });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(Error("SDR bridge stopped delivering IQ samples.")),
        4000,
      );
      this.reads.push({ resolve, reject, timer });
    });
  }
  async close() {
    if (!this.failure) {
      try {
        await this.request("close");
      } catch {
        /* Disconnect still releases the receiver. */
      }
    }
    this.fail(Error("Receiver stopped."));
  }
}
function checkedInfo(info: ReceiverInfo): ReceiverInfo {
  if (
    !info ||
    typeof info.name !== "string" ||
    info.name.length > 160 ||
    info.format !== "cu8" ||
    !Number.isFinite(info.sampleRate) ||
    info.sampleRate < 48000 ||
    info.sampleRate > 20000000 ||
    (info.sampleRates !== undefined &&
      (!Array.isArray(info.sampleRates) ||
        info.sampleRates.length > 100 ||
        !info.sampleRates.every(
          (rate) => Number.isFinite(rate) && rate >= 48000 && rate <= 20000000,
        ))) ||
    (info.maxNativeRate !== undefined &&
      (!Number.isFinite(info.maxNativeRate) ||
        info.maxNativeRate < 48000 ||
        info.maxNativeRate > 20000000)) ||
    !Number.isFinite(info.nativeRate) ||
    info.nativeRate < 48000 ||
    info.nativeRate > 20e6 ||
    !Number.isFinite(info.minHz) ||
    !Number.isFinite(info.maxHz) ||
    info.minHz > info.maxHz ||
    !info.gain ||
    !Number.isFinite(info.gain.min) ||
    !Number.isFinite(info.gain.max) ||
    info.gain.min > info.gain.max ||
    !Number.isFinite(info.gain.step) ||
    info.gain.step <= 0 ||
    typeof info.nativeFormat !== "string" ||
    info.nativeFormat.length > 16 ||
    (info.frequencyRanges !== undefined &&
      (!Array.isArray(info.frequencyRanges) ||
        info.frequencyRanges.length > 32 ||
        !info.frequencyRanges.every(
          (range) =>
            Array.isArray(range) &&
            range.length === 2 &&
            range.every(Number.isFinite) &&
            range[0] <= range[1],
        ))) ||
    typeof info.gain.auto !== "boolean" ||
    typeof info.ppm !== "boolean"
  )
    throw Error("SDR bridge returned incompatible receiver capabilities.");
  return { ...info, transport: "WebSocket" };
}
export async function openBridge(
  options: SourceOptions,
  sampleRate = 2400000,
): Promise<RadioSource> {
  const connection = new BridgeConnection(options);
  try {
    const source: RadioSource = {
      info: checkedInfo(
        await connection.request("open", {
          args: options.args,
          token: options.token ?? "",
          sampleRate,
        }),
      ),
      async configure(s) {
        validateReceiver(s, source.info);
        source.info = await connection.configure(s);
      },
      readSamples: () => connection.readSamples(),
      close: () => connection.close(),
    };
    return source;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
export async function discoverBridge(
  options: SourceOptions,
): Promise<BridgeReceiver[]> {
  const connection = new BridgeConnection(options);
  try {
    const result = await connection.request("list", {
      token: options.token ?? "",
    });
    if (
      !Array.isArray(result) ||
      result.length > 100 ||
      !result.every(
        (r) => typeof r.label === "string" && typeof r.args === "string",
      )
    )
      throw Error("Invalid bridge device list.");
    return result;
  } finally {
    await connection.close();
  }
}
