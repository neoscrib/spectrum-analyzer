export interface OfflineStatus {
  ready?: boolean;
  error?: string;
  ok?: boolean;
}
export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function activeWorker(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorker> {
  if (registration.active) return Promise.resolve(registration.active);
  return new Promise((resolve, reject) => {
    const worker = registration.installing ?? registration.waiting;
    if (!worker) {
      reject(Error("Offline setup is unavailable. Reload the app and retry."));
      return;
    }
    const finish = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        clearTimeout(timeout);
        worker.removeEventListener("statechange", finish);
        if (worker.state === "activated") resolve(worker);
        else
          reject(
            Error("Offline files could not be saved. Reconnect and retry."),
          );
      }
    };
    const timeout = setTimeout(() => {
      worker.removeEventListener("statechange", finish);
      reject(Error("Offline setup timed out. Reconnect and retry."));
    }, 60000);
    worker.addEventListener("statechange", finish);
    finish();
  });
}
/** Message channels keep replies scoped to a request, including a waiting SW. */
export function askWorker(
  worker: ServiceWorker,
  type: string,
): Promise<OfflineStatus> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(
      () => {
        channel.port1.close();
        reject(
          Error("Offline setup timed out. Check your connection and retry."),
        );
      },
      type === "SAVE_OFFLINE" ? 60000 : 5000,
    );
    channel.port1.onmessage = ({ data }: MessageEvent<OfflineStatus>) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (data.error) reject(Error(data.error));
      else resolve(data);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}
