import { useEffect, useRef, useState } from "react";
import { Check, Download, RefreshCw, X } from "lucide-react";
import { activeWorker, askWorker, type InstallPrompt } from "../pwa/client";

export function AppAccess({ canUpdate }: { canUpdate: boolean }) {
  return import.meta.env.DEV ? (
    <DevelopmentAppAccess />
  ) : (
    <ProductionAppAccess canUpdate={canUpdate} />
  );
}

/** Keep installation discoverable on the development page while the offline
 * worker remains isolated to the built app's origin. */
function DevelopmentAppAccess() {
  const dialog = useRef<HTMLDialogElement>(null);
  const installUrl = new URL("/", location.href);
  installUrl.port = "5177";
  return (
    <>
      <button
        className="app-access-button"
        type="button"
        onClick={() => dialog.current?.showModal()}
      >
        <Download size={16} aria-hidden="true" />
        <span>Install app</span>
      </button>
      <dialog
        ref={dialog}
        className="app-access-dialog"
        aria-labelledby="app-access-title"
      >
        <div className="app-access-heading">
          <h2 id="app-access-title">Install Spectrum</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close app options"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          This is the development version. Open the installable version to set
          up offline access.
        </p>
        <a
          className="button primary"
          href={installUrl.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open installable app
        </a>
        <p className="app-access-detail">
          Opens {installUrl.origin} in a new tab. Your current radio session
          stays here.
        </p>
      </dialog>
    </>
  );
}

/** Installation/offline support belongs to production builds. The dev server
 * intentionally never registers a worker, so HMR stays network-backed. */
function ProductionAppAccess({ canUpdate }: { canUpdate: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const applying = useRef(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(
    () => matchMedia("(display-mode: standalone)").matches,
  );
  const [status, setStatus] = useState<
    "preparing" | "ready" | "error" | "unsupported"
  >("preparing");
  const [waiting, setWaiting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const supported = "serviceWorker" in navigator && globalThis.isSecureContext;

  useEffect(() => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }
    let disposed = false;
    const fail = (error: unknown) => {
      if (disposed) return;
      setStatus("error");
      setError(
        error instanceof Error
          ? error.message
          : "Offline setup failed. Reconnect and retry.",
      );
    };
    async function refresh() {
      const worker = registration.current?.active;
      if (!worker) return;
      try {
        const saved = await askWorker(worker, "STATUS");
        if (!disposed) setStatus(saved.ready ? "ready" : "error");
      } catch (error) {
        fail(error);
      }
    }
    const controllerChanged = () => {
      if (applying.current) location.reload();
      else void refresh();
    };
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const appInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const networkChanged = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void registration.current?.update().catch(() => {});
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    window.addEventListener("online", networkChanged);
    window.addEventListener("offline", networkChanged);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      controllerChanged,
    );
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (disposed) return;
        registration.current = reg;
        setWaiting(!!reg.waiting);
        const observe = () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (disposed) return;
            setWaiting(!!reg.waiting);
            if (worker.state === "redundant" && !reg.active)
              fail(
                Error("Offline files could not be saved. Reconnect and retry."),
              );
            if (worker.state === "activated") void refresh();
          });
        };
        observe();
        reg.addEventListener("updatefound", observe);
        void refresh();
        void navigator.serviceWorker.ready.then(() => {
          if (!disposed) void refresh();
        });
      })
      .catch(fail);
    return () => {
      disposed = true;
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
      window.removeEventListener("online", networkChanged);
      window.removeEventListener("offline", networkChanged);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChanged,
      );
    };
  }, [supported]);

  async function install() {
    if (!prompt) return;
    setError("");
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setError("Use your browser’s Install app menu to install Spectrum.");
    } finally {
      setPrompt(null);
    }
  }
  async function retry() {
    setError("");
    setStatus("preparing");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
      registration.current = reg;
      const active = await activeWorker(reg);
      if (!(await askWorker(active, "STATUS")).ready)
        await askWorker(active, "SAVE_OFFLINE");
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setError(
        error instanceof Error ? error.message : "Offline setup failed.",
      );
    }
  }
  async function update() {
    const worker = registration.current?.waiting;
    if (!worker || !canUpdate || applying.current) return;
    setError("");
    applying.current = true;
    setUpdating(true);
    try {
      await askWorker(worker, "APPLY_UPDATE");
    } catch (error) {
      applying.current = false;
      setUpdating(false);
      setError(
        error instanceof Error
          ? error.message
          : "The update could not be applied.",
      );
    }
  }
  return (
    <>
      <button
        className="app-access-button"
        type="button"
        onClick={() => dialog.current?.showModal()}
      >
        <Download size={16} aria-hidden="true" />
        <span>{installed ? "App" : "Install app"}</span>
        <i className={waiting ? "update" : status} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        className="app-access-dialog"
        aria-labelledby="app-access-title"
        onCancel={(event) => {
          if (updating) event.preventDefault();
        }}
      >
        <div className="app-access-heading">
          <h2 id="app-access-title">Spectrum app</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close app options"
            disabled={updating}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          Install Spectrum to open it in its own window and use your radio
          without a network connection.
        </p>
        <div
          className={`offline-status ${status}`}
          role="status"
          aria-label="Offline app availability"
        >
          {status === "ready" ? <Check size={18} /> : <Download size={18} />}
          <div>
            <strong>
              {status === "ready"
                ? "Offline ready"
                : status === "preparing"
                  ? "Saving app for offline use…"
                  : status === "unsupported"
                    ? "Offline access unavailable"
                    : "Offline setup incomplete"}
            </strong>
            <p>
              {status === "ready"
                ? `All decoders are saved on this device. ${online ? "" : "You’re offline."}`
                : status === "unsupported"
                  ? "Open Spectrum over HTTPS or localhost in Chrome or Edge."
                  : "Keep this window open while the app and decoders are saved."}
            </p>
          </div>
        </div>
        <p className="app-access-detail">
          Decoder files are saved to disk and loaded into memory only when
          selected. RadioReference lookup needs a connection; saved aliases and
          radio decoding work offline.
        </p>
        {error && (
          <p className="app-access-error" role="alert">
            {error}
          </p>
        )}
        {status === "error" && (
          <button
            className="button secondary"
            type="button"
            onClick={() => void retry()}
          >
            Retry offline setup
          </button>
        )}
        {installed ? (
          <p className="app-access-detail">
            Spectrum is installed. You can open it from your apps.
          </p>
        ) : prompt ? (
          <button
            className="button primary"
            type="button"
            onClick={() => void install()}
            disabled={status !== "ready"}
          >
            Install Spectrum
          </button>
        ) : (
          <p className="app-access-detail">
            In Chrome or Edge, choose <strong>Install Spectrum</strong> from the
            address bar or browser menu. If it’s already installed, open it from
            your apps.
          </p>
        )}
        {waiting && (
          <div className="app-access-update">
            <strong>A Spectrum update is ready</strong>
            <p>
              {canUpdate
                ? "Reload to use the new version."
                : "Stop reception and finish saving your recording before updating."}
            </p>
            <button
              className="button secondary"
              type="button"
              disabled={!canUpdate || updating}
              onClick={() => void update()}
            >
              <RefreshCw size={15} />
              {updating ? "Updating…" : "Update and reload"}
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
