import { useEffect, useRef, type RefObject } from "react";
import { Camera, Pause, Play, RotateCcw } from "lucide-react";
import {
  binRange,
  clampChannel,
  frequencyAt,
  SAMPLE_RATE,
  type Settings,
} from "../model";

const palette = Array.from({ length: 256 }, (_, i) => {
  const t = i / 255;
  const stops = [
    [9, 16, 27],
    [16, 40, 76],
    [26, 86, 126],
    [33, 158, 170],
    [139, 210, 142],
    [255, 213, 116],
  ];
  const at = t * (stops.length - 1),
    a = Math.floor(at),
    b = Math.min(stops.length - 1, a + 1),
    f = at - a;
  return stops[a].map((v, j) => Math.round(v + (stops[b][j] - v) * f));
});

export function Spectrum({
  data,
  settings,
  source,
  floor,
  frozen,
  peakHold,
  onChannel,
  onFreeze,
  onReset,
}: {
  data: RefObject<Float32Array | null>;
  settings: Settings;
  source: string;
  floor: number;
  frozen: boolean;
  peakHold: boolean;
  onChannel: (hz: number) => void;
  onFreeze: () => void;
  onReset: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hover = useRef<number | null>(null);
  const current = useRef({ settings, floor, frozen, peakHold, source });
  current.current = { settings, floor, frozen, peakHold, source };
  const reset = useRef(0);
  useEffect(() => {
    reset.current++;
  }, [settings.center, settings.span, source]);
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const history = document.createElement("canvas");
    const hctx = history.getContext("2d")!;
    let previous: Float32Array | null = null,
      visible: Float32Array | null = null;
    let average: Float32Array | null = null,
      peaks: Float32Array | null = null;
    let lastReset = -1,
      animation = 0;
    const draw = () => {
      animation = requestAnimationFrame(draw);
      const { settings: s, floor, frozen, peakHold, source } = current.current;
      const rect = c.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * dpr),
        height = Math.round(rect.height * dpr);
      if (!width || !height) return;
      if (
        c.width !== width ||
        c.height !== height ||
        lastReset !== reset.current
      ) {
        c.width = width;
        c.height = height;
        history.width = Math.max(1, width - Math.round(68 * dpr));
        history.height = Math.max(1, Math.round(height * 0.44));
        hctx.fillStyle = "#09101b";
        hctx.fillRect(0, 0, history.width, history.height);
        previous = visible = average = peaks = null;
        lastReset = reset.current;
      }
      const left = Math.round(52 * dpr),
        right = width - Math.round(16 * dpr),
        w = right - left;
      const top = Math.round(30 * dpr),
        chartBottom = Math.round(height * 0.49);
      const axisY = chartBottom + 25 * dpr,
        waterY = chartBottom + 44 * dpr,
        waterH = height - waterY - 12 * dpr;
      const ceiling = floor + 90;
      const yFor = (db: number) =>
        top +
        Math.max(0, Math.min(1, (ceiling - db) / 90)) * (chartBottom - top);
      const xFor = (hz: number) =>
        left + ((hz - s.center + s.span / 2) / s.span) * w;
      const bins = data.current;
      if (bins && bins !== previous && !frozen) {
        visible = bins;
        previous = bins;
        if (!average || average.length !== bins.length) {
          average = bins.slice();
          peaks = bins.slice();
        } else
          for (let i = 0; i < bins.length; i++) {
            average[i] = 0.55 * average[i] + 0.45 * bins[i];
            peaks![i] = Math.max(peaks![i], bins[i]);
          }
        // Scroll once per actual FFT frame, rather than once per display refresh.
        const rowHeight = Math.max(1, Math.round(2 * dpr));
        hctx.drawImage(
          history,
          0,
          0,
          history.width,
          history.height - rowHeight,
          0,
          rowHeight,
          history.width,
          history.height - rowHeight,
        );
        const row = hctx.createImageData(history.width, rowHeight);
        for (let x = 0; x < history.width; x++) {
          const [lo, hi] = binRange(x, history.width, bins.length, s.span);
          let value = -140;
          for (let b = lo; b < hi; b++) value = Math.max(value, bins[b]);
          const color =
            palette[
              Math.round(Math.max(0, Math.min(1, (value - floor) / 75)) * 255)
            ];
          for (let y = 0; y < rowHeight; y++) {
            const at = (y * history.width + x) * 4;
            row.data[at] = color[0];
            row.data[at + 1] = color[1];
            row.data[at + 2] = color[2];
            row.data[at + 3] = 255;
          }
        }
        hctx.putImageData(row, 0, 0);
      }
      ctx.fillStyle = "#0c1117";
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${11 * dpr}px 'IBM Plex Mono',monospace`;
      ctx.lineWidth = dpr;
      for (let i = 0; i <= 6; i++) {
        const db = ceiling - i * 15,
          y = yFor(db);
        ctx.strokeStyle = "#202b35";
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = "#7d8b99";
        ctx.textAlign = "right";
        ctx.fillText(String(db), left - 10 * dpr, y + 4 * dpr);
      }
      const divisions = rect.width < 650 ? 4 : 8;
      for (let i = 0; i <= divisions; i++) {
        const x = left + (w * i) / divisions;
        ctx.strokeStyle = "#1b252f";
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, chartBottom);
        ctx.stroke();
        ctx.fillStyle = "#8f9ca9";
        ctx.textAlign = i === 0 ? "left" : i === divisions ? "right" : "center";
        ctx.fillText(
          ((s.center - s.span / 2 + (s.span * i) / divisions) / 1e6).toFixed(
            s.span < 200000 ? 4 : 3,
          ),
          x,
          axisY,
        );
      }
      ctx.textAlign = "left";
      ctx.fillStyle = "#667786";
      ctx.fillText("dBFS", left, 16 * dpr);
      ctx.textAlign = "right";
      ctx.fillText("MHz", right, 16 * dpr);
      ctx.drawImage(history, left, waterY, w, waterH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, w, height - top);
      ctx.clip();
      if (s.decoder !== "none") {
        const x1 = xFor(s.channel - s.bandwidth / 2),
          x2 = xFor(s.channel + s.bandwidth / 2),
          x = xFor(s.channel);
        ctx.fillStyle = "#eac17a0b";
        ctx.fillRect(x1, top, x2 - x1, chartBottom - top);
        ctx.strokeStyle = "#eac17a35";
        for (const edge of [x1, x2]) {
          ctx.beginPath();
          ctx.moveTo(edge, top);
          ctx.lineTo(edge, chartBottom);
          ctx.stroke();
        }
        ctx.strokeStyle = "#eac17a";
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, chartBottom);
        ctx.moveTo(x, waterY);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (visible && average) {
        const trace = (values: Float32Array, color: string, fill: boolean) => {
          ctx.beginPath();
          for (let px = 0; px < w; px++) {
            const [lo, hi] = binRange(px, w, values.length, s.span);
            let v = -140;
            for (let b = lo; b < hi; b++) v = Math.max(v, values[b]);
            const y = yFor(v);
            if (px === 0) ctx.moveTo(left, y);
            else ctx.lineTo(left + px, y);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2 * dpr;
          ctx.stroke();
          if (fill) {
            ctx.lineTo(right, chartBottom);
            ctx.lineTo(left, chartBottom);
            ctx.closePath();
            const gradient = ctx.createLinearGradient(0, top, 0, chartBottom);
            gradient.addColorStop(0, "#7fdfb62a");
            gradient.addColorStop(1, "#7fdfb602");
            ctx.fillStyle = gradient;
            ctx.fill();
          }
        };
        if (peakHold && peaks) trace(peaks, "#8e9a6570", false);
        trace(average, "#8ae3bf", true);
      }
      if (hover.current !== null) {
        const x = left + hover.current * w;
        ctx.strokeStyle = "#d1dce45c";
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, chartBottom);
        ctx.stroke();
        const text = `${((s.center + (hover.current - 0.5) * s.span) / 1e6).toFixed(4)} MHz`;
        ctx.font = `${12 * dpr}px 'IBM Plex Mono',monospace`;
        const tw = ctx.measureText(text).width + 16 * dpr,
          tx = Math.max(left, Math.min(x + 10 * dpr, right - tw));
        ctx.fillStyle = "#26313e";
        ctx.fillRect(tx, top + 8 * dpr, tw, 24 * dpr);
        ctx.fillStyle = "#e4eaf0";
        ctx.textAlign = "left";
        ctx.fillText(text, tx + 8 * dpr, top + 24 * dpr);
      }
      ctx.restore();
      if (!visible) {
        ctx.fillStyle = "#9ba9b6";
        ctx.textAlign = "center";
        ctx.font = `${14 * dpr}px 'DM Sans',sans-serif`;
        ctx.fillText(
          source === "idle"
            ? "Connect a receiver to explore the spectrum"
            : "Waiting for IQ samples…",
          left + w / 2,
          top + (chartBottom - top) * 0.52,
        );
        ctx.fillStyle = "#596a79";
        ctx.font = `${12 * dpr}px 'DM Sans',sans-serif`;
        ctx.fillText(
          "Or try a generated test signal",
          left + w / 2,
          top + (chartBottom - top) * 0.52 + 25 * dpr,
        );
      }
      if (s.decoder !== "none") {
        const x = xFor(s.channel);
        if (x >= left && x <= right) {
          ctx.fillStyle = "#eac17a";
          ctx.font = `${10 * dpr}px 'IBM Plex Mono',monospace`;
          ctx.textAlign = "center";
          ctx.fillText(
            s.decoder.toUpperCase(),
            Math.max(left + 20 * dpr, Math.min(right - 20 * dpr, x)),
            top - 9 * dpr,
          );
        }
      }
      ctx.fillStyle = "#627383";
      ctx.font = `${10 * dpr}px 'IBM Plex Mono',monospace`;
      ctx.textAlign = "right";
      ctx.save();
      ctx.translate(17 * dpr, waterY + waterH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("WATERFALL · TIME", 50 * dpr, 0);
      ctx.restore();
    };
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [data]);
  const exportImage = () => {
    const a = document.createElement("a");
    a.download = `spectrum-${(settings.center / 1e6).toFixed(3)}MHz-${source}.png`;
    a.href = canvas.current!.toDataURL("image/png");
    a.click();
  };
  return (
    <>
      <div className="plot-toolbar">
        <div className="legend">
          <i /> Spectrum{" "}
          <span className="legend-channel">
            <i /> Decoder channel
          </span>
        </div>
        <div className="plot-actions">
          <button
            className={frozen ? "small active" : "small"}
            onClick={onFreeze}
            aria-pressed={frozen}
          >
            {frozen ? <Play size={14} /> : <Pause size={14} />}
            {frozen ? "Resume view" : "Freeze view"}
          </button>
          <button
            className="icon-button"
            aria-label="Reset peak hold and waterfall"
            title="Reset peak hold and waterfall"
            onClick={() => {
              reset.current++;
              onReset();
            }}
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Save spectrum PNG"
            title="Save spectrum PNG"
            onClick={exportImage}
          >
            <Camera size={16} />
          </button>
        </div>
      </div>
      <canvas
        ref={canvas}
        className="spectrum-canvas"
        role="slider"
        tabIndex={0}
        aria-label="Decoder frequency on spectrum"
        aria-valuemin={
          settings.center - SAMPLE_RATE / 2 + settings.bandwidth / 2
        }
        aria-valuemax={
          settings.center + SAMPLE_RATE / 2 - settings.bandwidth / 2
        }
        aria-valuenow={settings.channel}
        aria-valuetext={`${(settings.channel / 1e6).toFixed(4)} MHz`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          hover.current = Math.max(
            0,
            Math.min(1, (e.clientX - r.left - 52) / (r.width - 68)),
          );
        }}
        onPointerLeave={() => {
          hover.current = null;
        }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onChannel(
            clampChannel(
              settings,
              frequencyAt(
                e.clientX - r.left - 52,
                r.width - 68,
                settings.center,
                settings.span,
              ),
            ),
          );
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            onChannel(
              clampChannel(
                settings,
                settings.channel +
                  (e.key === "ArrowLeft" ? -1 : 1) *
                    (e.shiftKey ? 100000 : 10000),
              ),
            );
          }
        }}
      />
    </>
  );
}
