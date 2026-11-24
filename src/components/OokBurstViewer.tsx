import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  formatOokDump,
  interpretBurstWithTiming,
  type OokCapture,
  type OokInterpretation,
  type OokOptions,
} from "../ook/model";

interface Inspection {
  firstBit: number;
  endBit: number;
  interval?: number;
}
const durationFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
const micros = (value: number) => durationFormat.format(value);
const overlaps = (hover: Inspection | null, first: number, end: number) =>
  !!hover && first < hover.endBit && end > hover.firstBit;

function selectionAt(data: OokInterpretation, time: number): Inspection | null {
  const interval = data.intervals.find(
    (run) => !run.delimiter && time >= run.startUs && time < run.endUs,
  );
  if (!interval) return null;
  const bit = data.spans.find(
    (span) => time >= span.startUs && time < span.endUs,
  );
  return {
    interval: interval.index,
    firstBit: bit?.index ?? -1,
    endBit: bit ? bit.index + 1 : -1,
  };
}

function PulsePlot({
  data,
  hover,
  onInspect,
  showBytes,
}: {
  data: OokInterpretation;
  hover: Inspection | null;
  onInspect: (selection: Inspection | null) => void;
  showBytes: boolean;
}) {
  const total = data.signalEndUs;
  const xFor = (us: number) => 12 + (us / Math.max(1, total)) * 976;
  const runs = data.intervals.filter((run) => !run.delimiter);
  let points = runs
    .flatMap((run) => {
      const y = run.high ? 18 : 80;
      return [`${xFor(run.startUs)},${y}`, `${xFor(run.endUs)},${y}`];
    })
    .join(" ");
  if (runs.at(-1)?.high) points += ` ${xFor(total)},80`;
  const measured =
    hover?.interval !== undefined ? data.intervals[hover.interval] : undefined;
  let label =
    "Hover anywhere over the plot to measure a high pulse or low gap.";
  if (hover) {
    const first = data.spans[hover.firstBit],
      last = data.spans[hover.endBit - 1];
    if (measured) {
      label = `${measured.high ? "High pulse" : "Low gap"} · ${micros(measured.durationUs)} µs`;
      if (first) label += ` · Bit ${first.index + 1} = ${first.value}`;
    } else if (first && last) {
      label =
        first === last
          ? `Bit ${first.index + 1} = ${first.value}`
          : `Bits ${first.index + 1}–${last.index + 1}`;
      label += ` · ${micros(last.endUs - first.startUs)} µs span`;
    }
  }
  return (
    <div className="ook-waveform">
      <svg
        role="img"
        tabIndex={0}
        aria-label="Sliced OOK pulse train"
        aria-describedby={hover ? "ook-timing-tooltip" : undefined}
        viewBox="0 0 1000 96"
        preserveAspectRatio="none"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const fraction =
            (((event.clientX - rect.left) / rect.width) * 1000 - 12) / 976;
          const time = Math.max(0, Math.min(total - 1e-7, fraction * total));
          onInspect(selectionAt(data, time));
        }}
        onPointerLeave={() => onInspect(null)}
        onFocus={() => onInspect(selectionAt(data, 0))}
        onBlur={() => onInspect(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const at = Math.max(
            0,
            Math.min(
              runs.length - 1,
              (hover?.interval ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
            ),
          );
          const run = runs[at];
          if (run) onInspect(selectionAt(data, (run.startUs + run.endUs) / 2));
        }}
      >
        {data.spans.map((span) => (
          <rect
            key={span.index}
            className={`ook-symbol ${span.index % 2 ? "ook-symbol-odd" : "ook-symbol-even"} ${overlaps(hover, span.index, span.index + 1) ? "is-highlighted" : ""}`}
            data-bit-index={span.index}
            data-start-us={span.startUs}
            data-end-us={span.endUs}
            data-highlighted={overlaps(hover, span.index, span.index + 1)}
            x={xFor(span.startUs)}
            y="0"
            width={Math.max(0, xFor(span.endUs) - xFor(span.startUs))}
            height="96"
          />
        ))}
        {showBytes &&
          data.spans
            .filter((span) => (span.index + 1) % 8 === 0)
            .map((span) => (
              <line
                key={span.index}
                className="ook-byte-boundary"
                data-after-bit={span.index + 1}
                data-time-us={span.endUs}
                x1={xFor(span.endUs)}
                x2={xFor(span.endUs)}
                y1="0"
                y2="96"
                vectorEffect="non-scaling-stroke"
              />
            ))}
        {measured && (
          <rect
            className="ook-measured-interval"
            data-testid="ook-measured-interval"
            data-start-us={measured.startUs}
            data-end-us={measured.endUs}
            x={xFor(measured.startUs)}
            y="1"
            width={xFor(measured.endUs) - xFor(measured.startUs)}
            height="94"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <line x1="12" x2="988" y1="80" y2="80" className="ook-baseline" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {/* Capture the entire height, including the empty area away from the trace. */}
        <rect
          className="ook-waveform-hit"
          x="0"
          y="0"
          width="1000"
          height="96"
        />
      </svg>
      <div className="ook-axis">
        <span>0 µs</span>
        <span>{micros(total)} µs</span>
      </div>
      <div className={`ook-timing-readout ${hover ? "is-inspecting" : ""}`}>
        <span
          id="ook-timing-tooltip"
          role={hover ? "tooltip" : undefined}
          data-testid="ook-timing-tooltip"
        >
          {label}
        </span>
      </div>
      <p className="caption">
        Sliced levels, not amplitude. All captured signal edges are shown.
        {data.intervals.at(-1)?.delimiter
          ? " Final idle delimiter omitted from the plot; its timing remains in the raw table."
          : ""}
      </p>
    </div>
  );
}

function navigate(event: KeyboardEvent<HTMLSpanElement>, selector: string) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const nodes = Array.from(
    event.currentTarget.closest("pre")!.querySelectorAll<HTMLElement>(selector),
  );
  const current = nodes.indexOf(event.currentTarget);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? nodes.length - 1
        : Math.max(
            0,
            Math.min(
              nodes.length - 1,
              current + (event.key === "ArrowRight" ? 1 : -1),
            ),
          );
  nodes[next]?.focus();
}

function BitDump({
  dump,
  data,
  hover,
  onInspect,
}: {
  dump: ReturnType<typeof formatOokDump>;
  data: OokInterpretation;
  hover: Inspection | null;
  onInspect: (selection: Inspection | null) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");
  const binary = useRef<HTMLPreElement>(null),
    hex = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!hover || hover.firstBit < 0) return;
    // Scroll only each dump's viewport, never the page under the pointer.
    for (const [ref, selector] of [
      [binary, `.ook-bit[data-bit-index="${hover.firstBit}"]`],
      [
        hex,
        `.ook-hex-group[data-byte-index="${Math.floor(hover.firstBit / 8)}"]`,
      ],
    ] as const) {
      const pre = ref.current,
        item = pre?.querySelector<HTMLElement>(selector);
      if (!pre || !item) continue;
      if (item.offsetTop < pre.scrollTop + 8)
        pre.scrollTop = item.offsetTop - 8;
      else if (
        item.offsetTop + item.offsetHeight >
        pre.scrollTop + pre.clientHeight - 8
      )
        pre.scrollTop =
          item.offsetTop + item.offsetHeight - pre.clientHeight + 8;
      if (item.offsetLeft < pre.scrollLeft + 8)
        pre.scrollLeft = item.offsetLeft - 8;
      else if (
        item.offsetLeft + item.offsetWidth >
        pre.scrollLeft + pre.clientWidth - 8
      )
        pre.scrollLeft =
          item.offsetLeft + item.offsetWidth - pre.clientWidth + 8;
    }
  }, [hover?.firstBit, hover?.endBit]);
  useEffect(() => {
    setCopied(null);
    setCopyError("");
  }, [dump?.binary, dump?.hex]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy(kind: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setCopyError("");
    } catch {
      setCopyError(
        "Copy is unavailable here. Select the dump text to copy it.",
      );
    }
  }
  if (!dump)
    return (
      <p className="caption" data-testid="ook-bits">
        Select PWM, PPM, or NRZ to interpret timings and show binary and hex
        dumps.
      </p>
    );
  return (
    <>
      <div
        className="ook-dumps"
        role="group"
        aria-label="Interpreted OOK binary and hex dumps"
      >
        {(
          [
            ["binary", "Binary", dump.binary],
            ["hex", "Hex · MSB first", dump.hex],
          ] as const
        ).map(([kind, label, value]) => (
          <div className="ook-dump" key={kind}>
            <div className="ook-dump-heading">
              <span>{label}</span>
              <button
                className="small"
                type="button"
                disabled={!value}
                aria-label={`Copy ${kind} dump`}
                onClick={() => void copy(kind, value)}
              >
                {copied === kind ? "Copied" : "Copy"}
              </button>
            </div>
            <pre
              ref={kind === "binary" ? binary : hex}
              data-testid={kind === "binary" ? "ook-bits" : "ook-hex"}
            >
              {dump.groups.map((group, groupIndex) => (
                <Fragment key={group.startBit}>
                  {groupIndex ? (groupIndex % 4 === 0 ? "\n" : " ") : null}
                  {kind === "binary" ? (
                    group.binary.split("").map((bit, i) => {
                      const index = group.startBit + i,
                        span = data.spans[index];
                      const inspect = () =>
                        onInspect({ firstBit: index, endBit: index + 1 });
                      return (
                        <span
                          key={index}
                          className={`ook-bit ${overlaps(hover, index, index + 1) ? "is-highlighted" : ""}`}
                          role="button"
                          tabIndex={index === 0 ? 0 : -1}
                          data-bit-index={index}
                          data-highlighted={overlaps(hover, index, index + 1)}
                          aria-label={`Bit ${index + 1} = ${bit}`}
                          title={
                            span
                              ? `Bit ${index + 1} = ${bit} · ${micros(span.startUs)}–${micros(span.endUs)} µs`
                              : undefined
                          }
                          onPointerEnter={inspect}
                          onPointerLeave={() => onInspect(null)}
                          onFocus={inspect}
                          onBlur={() => onInspect(null)}
                          onClick={inspect}
                          onKeyDown={(event) => navigate(event, ".ook-bit")}
                        >
                          {bit}
                        </span>
                      );
                    })
                  ) : (
                    <span
                      className={`ook-hex-group ${overlaps(hover, group.startBit, group.endBit) ? "is-highlighted" : ""}`}
                      role="button"
                      tabIndex={groupIndex === 0 ? 0 : -1}
                      data-byte-index={groupIndex}
                      data-highlighted={overlaps(
                        hover,
                        group.startBit,
                        group.endBit,
                      )}
                      aria-label={`Hex ${group.hex}, bits ${group.startBit + 1}–${group.endBit}`}
                      onPointerEnter={() =>
                        onInspect({
                          firstBit: group.startBit,
                          endBit: group.endBit,
                        })
                      }
                      onPointerLeave={() => onInspect(null)}
                      onFocus={() =>
                        onInspect({
                          firstBit: group.startBit,
                          endBit: group.endBit,
                        })
                      }
                      onBlur={() => onInspect(null)}
                      onClick={() =>
                        onInspect({
                          firstBit: group.startBit,
                          endBit: group.endBit,
                        })
                      }
                      onKeyDown={(event) => navigate(event, ".ook-hex-group")}
                    >
                      {group.hex}
                    </span>
                  )}
                </Fragment>
              ))}
              {!dump.groups.length ? "—" : dump.truncated ? "\n…" : null}
            </pre>
          </div>
        ))}
      </div>
      <p className="caption" data-testid="ook-dump-note">
        {dump.truncated ? "At least " : ""}
        {dump.bitCount} interpreted bits
        {dump.unknownBits
          ? ` · ${dump.unknownBits} uncertain ${dump.unknownBits === 1 ? "bit" : "bits"}`
          : ""}
        {dump.partialByteBits
          ? ` · final byte has ${dump.partialByteBits} of 8 bits`
          : ""}
        .
        {dump.trailingBits
          ? ` [${dump.trailingBits}] shows trailing bits that do not fill a hex digit; no zero padding is added.`
          : ""}
        {dump.unknownBits
          ? " ? marks a timing mismatch in binary and an unknown nibble in hex."
          : ""}
        {dump.truncated
          ? " The interpretation limit was reached; this is a partial dump."
          : ""}
      </p>
      {copyError && (
        <p className="caption" role="alert">
          {copyError}
        </p>
      )}
    </>
  );
}

export function OokBurstViewer({
  capture,
  options,
  showBytes,
  onShowBytes,
}: {
  capture: OokCapture;
  options: OokOptions;
  showBytes: boolean;
  onShowBytes: (show: boolean) => void;
}) {
  const data = useMemo(
    () => interpretBurstWithTiming(capture, options),
    [capture, options],
  );
  const dump = useMemo(() => formatOokDump(data.bits), [data]);
  const [hover, setHover] = useState<Inspection | null>(null);
  const inspect = useCallback(
    (next: Inspection | null) =>
      setHover((previous) =>
        previous?.firstBit === next?.firstBit &&
        previous?.endBit === next?.endBit &&
        previous?.interval === next?.interval
          ? previous
          : next,
      ),
    [],
  );
  return (
    <>
      <div className="ook-inspection-toolbar">
        <span>
          Hover to inspect timing · alternating shading marks interpreted bits
        </span>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showBytes}
            disabled={!data.spans.length}
            onChange={(event) => onShowBytes(event.target.checked)}
          />
          Show byte boundaries
        </label>
      </div>
      <PulsePlot
        data={data}
        hover={hover}
        onInspect={inspect}
        showBytes={showBytes}
      />
      <div className="ook-bits">
        <span>
          Interpreted bits · {options.encoding.toUpperCase()}
          {dump ? ` · ${dump.truncated ? "≥ " : ""}${dump.bitCount} bits` : ""}
        </span>
        <BitDump dump={dump} data={data} hover={hover} onInspect={inspect} />
        {data.bits !== null && (
          <p className="caption">
            Hover a binary digit or hex group to highlight its captured waveform
            span. Use arrow keys when a bit or group has keyboard focus. Current
            interpretation uses ±25% timing tolerance; no protocol or checksum
            validation.
            {options.encoding === "nrz" && data.bits.includes("?")
              ? " NRZ byte alignment after a timing mismatch is tentative."
              : ""}
          </p>
        )}
      </div>
    </>
  );
}
