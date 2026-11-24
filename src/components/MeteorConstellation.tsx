import { useEffect, useRef } from "react";
export function MeteorConstellation({ data }: { data: Float32Array | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0b171f";
      ctx.fillRect(0, 0, 160, 160);
      ctx.strokeStyle = "#253744";
      ctx.beginPath();
      ctx.moveTo(0, 80);
      ctx.lineTo(160, 80);
      ctx.moveTo(80, 0);
      ctx.lineTo(80, 160);
      ctx.stroke();
      ctx.fillStyle = "#83ddbd90";
      const points = data;
      if (points)
        for (let i = 0; i < points.length; i += 2) {
          ctx.beginPath();
          ctx.arc(
            80 + points[i] / 5,
            80 - points[i + 1] / 5,
            1.2,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
    };
    draw();
  }, [data]);
  return (
    <canvas
      ref={ref}
      width="160"
      height="160"
      className="constellation"
      aria-label="Demodulated IQ constellation"
    />
  );
}
