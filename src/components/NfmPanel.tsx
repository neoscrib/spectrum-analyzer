import type { NfmTelemetry } from "../presets/model";
import { toneLabel } from "../presets/model";
export function NfmPanel({
  status,
  test,
  active,
}: {
  status: NfmTelemetry | null;
  test: boolean;
  active: boolean;
}) {
  const selected =
    status?.channels.find((c) => c.id === status.selectedId) ??
    status?.channels[0];
  return (
    <section className="nfm-panel" aria-label="NFM reception">
      <div className="nfm-heading">
        <h2>Narrowband FM</h2>
        <span
          className={`chip ${active && selected?.open ? "armer-lock" : ""}`}
          data-testid="nfm-squelch"
        >
          {!active
            ? "Stopped"
            : selected?.open
              ? "Squelch open"
              : selected?.carrier
                ? "Carrier · waiting for code"
                : "Squelch closed"}
        </span>
      </div>
      {test && (
        <p className="armer-test-note">
          GENERATED NFM IQ · Test tones and codes, not received radio traffic.
          CH 1: 1 kHz + 100 Hz CTCSS; CH 2: 1.5 kHz + DCS 023N; CH 8: 2 kHz +
          88.5 Hz CTCSS.
        </p>
      )}
      <div className="nfm-readings">
        <div>
          <span>Selected frequency</span>
          <strong>
            {selected ? (selected.frequency / 1e6).toFixed(4) + " MHz" : "—"}
          </strong>
        </div>
        <div>
          <span>Channel power</span>
          <strong data-testid="nfm-power">
            {selected ? selected.level.toFixed(1) + " dBFS" : "—"}
          </strong>
        </div>
        <div>
          <span>Detected signalling</span>
          <strong data-testid="nfm-code">
            {selected
              ? toneLabel(selected.ctcss, selected.dcs)
              : "No code detected"}
          </strong>
        </div>
        <div>
          <span>Virtual receivers</span>
          <strong>
            {status?.channels.length ?? 0}
            {status?.bankId ? " in current RF window" : " · single channel"}
          </strong>
        </div>
      </div>
      <p className="caption">
        Codes are squelch signalling, not encryption. DCS cyclic/polarity
        equivalents are shown together; manufacturer “privacy code” numbers
        vary.
      </p>
    </section>
  );
}
