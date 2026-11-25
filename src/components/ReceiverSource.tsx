import { useState } from "react";
import type { ReceiverInfo, SourceOptions } from "../sources/model";
import { discoverBridge, type BridgeReceiver } from "../sources/soapy";
export function ReceiverSource({
  options,
  info,
  disabled,
  onChange,
  known,
}: {
  known: boolean;
  options: SourceOptions;
  info: ReceiverInfo;
  disabled: boolean;
  onChange: (next: SourceOptions) => void;
}) {
  const [finding, setFinding] = useState(false),
    [error, setError] = useState("");
  const [devices, setDevices] = useState<BridgeReceiver[]>([]);
  return (
    <div className="receiver-source">
      <label>
        Radio source
        <select
          aria-label="Radio source"
          value={options.kind}
          disabled={disabled || finding}
          onChange={(e) => {
            setError("");
            setDevices([]);
            onChange({
              ...options,
              kind: e.target.value as SourceOptions["kind"],
            });
          }}
        >
          <option value="rtl">RTL-SDR · USB</option>
          <option value="hackrf">HackRF One · USB</option>
          <option value="soapy">SoapySDR · bridge</option>
        </select>
      </label>
      {options.kind === "soapy" && (
        <>
          <label>
            Bridge URL
            <input
              aria-label="SDR bridge URL"
              value={options.url}
              disabled={disabled || finding}
              onChange={(e) => onChange({ ...options, url: e.target.value })}
            />
          </label>
          <label>
            Device arguments
            <input
              aria-label="SDR device arguments"
              placeholder="driver=airspy,serial=… (blank: first receiver)"
              value={options.args}
              disabled={disabled || finding}
              onChange={(e) => onChange({ ...options, args: e.target.value })}
            />
          </label>
          <details>
            <summary>Bridge authentication</summary>
            <label>
              Access token
              <input
                type="password"
                aria-label="SDR bridge token"
                autoComplete="off"
                value={options.token ?? ""}
                disabled={disabled || finding}
                onChange={(e) =>
                  onChange({ ...options, token: e.target.value })
                }
              />
            </label>
          </details>
          <button
            className="button"
            disabled={disabled || finding}
            onClick={async () => {
              setFinding(true);
              setError("");
              try {
                const found = await discoverBridge(options);
                setDevices(found);
                if (!found.length)
                  setError(
                    "No receivers found. Install the SoapySDR module for your radio and check the bridge host's USB permissions.",
                  );
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setFinding(false);
              }
            }}
          >
            {finding ? "Finding receivers…" : "Find bridge receivers"}
          </button>
          {devices.length > 0 && (
            <label>
              Detected receivers
              <select
                aria-label="Detected SDR receivers"
                value={
                  devices.some((d) => d.args === options.args)
                    ? options.args
                    : ""
                }
                disabled={disabled}
                onChange={(e) => onChange({ ...options, args: e.target.value })}
              >
                <option value="" disabled>
                  Select a receiver
                </option>
                {devices.map((d) => (
                  <option key={d.args} value={d.args}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="caption">
            Connects to a bridge running beside your radio. Supports installed
            SoapySDR drivers, including Airspy, SDRplay, LimeSDR, bladeRF, USRP
            and PlutoSDR. HTTPS apps require a trusted wss:// endpoint.
          </p>
          <details>
            <summary>Bridge setup</summary>
            <p className="caption">
              On the computer attached to the radio, install its SoapySDR module
              and Python bindings. From the Spectrum repository:
            </p>
            <pre>
              python3 -m venv --system-site-packages .venv{"\n"}.venv/bin/pip
              install -r bridge/requirements.txt{"\n"}.venv/bin/python
              bridge/sdr_bridge.py
            </pre>
          </details>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="caption" data-testid="receiver-format">
        {known
          ? `${info.nativeFormat.toUpperCase()} · ${(info.nativeRate / 1e6).toFixed(3)} MSPS device → CU8 · 2.4 MSPS decoder input.`
          : "Device capabilities are read when you connect. Bridge output: CU8 at 2.4 MSPS."}
        {options.kind === "soapy"
          ? " Bridge conversion includes streaming resampling when needed and 8-bit quantization."
          : options.kind === "hackrf"
            ? " Signed IQ is converted losslessly to unsigned IQ. RX filter: 1.75 MHz; RF amplifier off."
            : " Native IQ passes through unchanged."}
      </p>
    </div>
  );
}
