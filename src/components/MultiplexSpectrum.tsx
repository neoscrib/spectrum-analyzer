import { useEffect, useRef, useState, type RefObject } from "react";
import type { MultiplexSpectrum } from "../types";
import { MULTIPLEX_MAX_HZ } from "../dsp/multiplex-spectrum";
import { spectrumPath } from "./spectrum-path";

export function MultiplexSpectrumView({
  data,
  active,
  test,
}: {
  data: RefObject<MultiplexSpectrum | null>;
  active: boolean;
  test: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [range, setRange] = useState(80);
  const [ceiling, setCeiling] = useState(0);
  const current = useRef({ range, ceiling, active });
  current.current = { range, ceiling, active };

  useEffect(() => {
    const c = canvas.current!,
      ctx = c.getContext("2d")!;
    let animation = 0;
    const draw = () => {
      animation = requestAnimationFrame(draw);
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * dpr),
        height = Math.round(rect.height * dpr);
      if (!width || !height) return;
      if (c.width !== width || c.height !== height) {
        c.width = width;
        c.height = height;
      }
      const left = 52 * dpr,
        right = width - 16 * dpr,
        w = right - left;
      const top = 38 * dpr,
        bottom = height - 36 * dpr;
      const { range, ceiling, active } = current.current;
      const xFor = (hz: number) => left + (hz / MULTIPLEX_MAX_HZ) * w;
      const yFor = (db: number) =>
        top + Math.max(0, Math.min(1, (ceiling - db) / range)) * (bottom - top);
      const frame = data.current;
      ctx.fillStyle = "#0c1117";
      ctx.fillRect(0, 0, width, height);
      for (const [lo, hi, color] of [
        [0, 15000, "#8ae3bf0a"],
        [23000, 53000, "#8abfe30b"],
      ] as const) {
        ctx.fillStyle = color;
        ctx.fillRect(xFor(lo), top, xFor(hi) - xFor(lo), bottom - top);
      }
      ctx.lineWidth = dpr;
      ctx.font = `${10 * dpr}px 'IBM Plex Mono',monospace`;
      for (let i = 0; i <= 4; i++) {
        const db = ceiling - (i * range) / 4,
          y = yFor(db);
        ctx.strokeStyle = "#202b35";
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.fillStyle = "#8f9ca9";
        ctx.textAlign = "right";
        ctx.fillText(String(db), left - 9 * dpr, y + 4 * dpr);
      }
      for (const hz of [0, 10000, 20000, 30000, 40000, 50000, 60000, 65000]) {
        if (rect.width < 500 && hz === 60000) continue;
        const x = xFor(hz);
        ctx.strokeStyle = "#1b252f";
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillStyle = "#8f9ca9";
        ctx.textAlign = hz === 0 ? "left" : hz === 65000 ? "right" : "center";
        ctx.fillText(String(hz / 1000), x, bottom + 21 * dpr);
      }
      if (frame) {
        // Use the tap's actual rate and FFT length, never the 48 kHz PCM rate.
        const binsPerPixel =
          ((MULTIPLEX_MAX_HZ / frame.sampleRate) * frame.fftSize) / w;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, w, bottom - top);
        ctx.clip();
        spectrumPath(
          ctx,
          frame.bins,
          left,
          w,
          (px) => {
            const lo = Math.min(
              frame.bins.length - 1,
              Math.floor(px * binsPerPixel),
            );
            return [
              lo,
              Math.min(
                frame.bins.length,
                Math.max(lo + 1, Math.ceil((px + 1) * binsPerPixel)),
              ),
            ];
          },
          yFor,
        );
        ctx.strokeStyle = "#8ae3bf";
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
        ctx.lineTo(right, bottom);
        ctx.lineTo(left, bottom);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        gradient.addColorStop(0, "#7fdfb62a");
        gradient.addColorStop(1, "#7fdfb602");
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();
      }
      for (const [hz, label, color] of [
        [19000, "19 · pilot", "#eac17a"],
        [38000, "38 · L−R", "#8abfe3"],
        [57000, "57 · RDS", "#d6a4e7"],
      ] as const) {
        const x = xFor(hz);
        ctx.strokeStyle = color;
        ctx.setLineDash([3 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.fillText(label, x, top - 9 * dpr);
      }
      ctx.fillStyle = "#879b94";
      ctx.textAlign = "left";
      ctx.fillText("dB", left, 13 * dpr);
      ctx.textAlign = "right";
      ctx.fillText(
        frame
          ? `${frame.sampleRate / 1000} kSPS · ${(frame.sampleRate / frame.fftSize).toFixed(1)} Hz/bin`
          : "Awaiting multiplex samples",
        right,
        13 * dpr,
      );
      ctx.fillText("kHz", right, height - 3 * dpr);
      if (!frame) {
        ctx.textAlign = "center";
        ctx.font = `${13 * dpr}px 'DM Sans',sans-serif`;
        ctx.fillText(
          active
            ? "Averaging multiplex power…"
            : "Start WFM reception or try the FM test signal",
          left + w / 2,
          (top + bottom) / 2,
        );
      }
    };
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [data]);

  return (
    <section
      className="multiplex-panel"
      id="multiplex-spectrum"
      aria-label="FM multiplex spectrum"
    >
      <div className="multiplex-heading">
        <h2>Multiplex spectrum</h2>
        <span className="caption">0–65 kHz · averaged power</span>
      </div>
      <div className="plot-toolbar multiplex-toolbar">
        <label>
          Vertical zoom
          <select
            aria-label="Multiplex dB range"
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
          >
            {[40, 60, 80, 100].map((value) => (
              <option key={value} value={value}>
                {value} dB range
              </option>
            ))}
          </select>
        </label>
        <label>
          Top
          <input
            aria-label="Multiplex top level"
            type="range"
            min="-60"
            max="0"
            step="5"
            value={ceiling}
            onChange={(e) => setCeiling(Number(e.target.value))}
          />
        </label>
        <output>
          {ceiling - range} to {ceiling} dB
        </output>
      </div>
      <canvas
        ref={canvas}
        className="multiplex-canvas"
        role="img"
        aria-label="One-sided FM multiplex spectrum, 0 to 65 kHz. References: 19 kHz pilot, 38 kHz stereo difference, 57 kHz RDS/RBDS."
      />
      <ul className="multiplex-legend">
        <li>
          <i className="multiplex-mono" />
          0–15 kHz · mono audio (L+R)
        </li>
        <li>
          <i className="multiplex-pilot" />
          19 kHz · stereo pilot
        </li>
        <li>
          <i className="multiplex-difference" />
          23–53 kHz · L−R, centered at 38 kHz
        </li>
        <li>
          <i className="multiplex-rds" />
          57 kHz · RDS/RBDS reference
        </li>
      </ul>
      <p className="caption">
        Hann window · 0.6 s power averaging. Levels are relative to a
        full-deviation (75 kHz) tone; zoom changes only this display. The 57 kHz
        marker is a frequency reference, not RDS detection.
      </p>
      {test && (
        <p className="armer-test-note">
          Generated FM test signal · 19 kHz pilot and encoded test RDS around 57
          kHz. Station information appears in the RDS/RBDS panel.
        </p>
      )}
    </section>
  );
}
