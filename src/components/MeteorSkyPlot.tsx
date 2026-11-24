import type { Pass, Look } from "../meteor/tracking";
function xy(p: Look) {
  const r = ((90 - Math.max(0, p.elevation)) / 90) * 80,
    a = (p.azimuth * Math.PI) / 180;
  return [100 + r * Math.sin(a), 100 - r * Math.cos(a)];
}
export function MeteorSkyPlot({
  pass,
  current,
}: {
  pass?: Pass;
  current?: Look;
}) {
  const point = current && current.elevation >= 0 ? xy(current) : undefined;
  return (
    <svg
      viewBox="0 0 200 200"
      className="skyplot"
      role="img"
      aria-label="Sky plot: north up, east right, horizon at outer circle"
    >
      <g fill="none" stroke="#29404c">
        <circle cx="100" cy="100" r="80" />
        <circle cx="100" cy="100" r="53" strokeDasharray="2 4" />
        <circle cx="100" cy="100" r="26" strokeDasharray="2 4" />
        <path d="M20 100h160M100 20v160" />
      </g>
      <g fill="#78909e" fontSize="10" textAnchor="middle">
        <text x="100" y="12">
          N
        </text>
        <text x="100" y="196">
          S
        </text>
        <text x="190" y="104">
          E
        </text>
        <text x="9" y="104">
          W
        </text>
        <text x="110" y="95" fontSize="8">
          90°
        </text>
      </g>
      {pass && (
        <>
          <polyline
            points={pass.path.map((p) => xy(p).join(",")).join(" ")}
            stroke="#e4b97d"
            fill="none"
            strokeWidth="2"
          />
          <circle
            cx={xy(pass.path[0])[0]}
            cy={xy(pass.path[0])[1]}
            r="3"
            fill="#e4b97d"
          />
        </>
      )}
      {point && (
        <circle
          cx={point[0]}
          cy={point[1]}
          r="5"
          stroke="#0c171f"
          strokeWidth="2"
          fill="#83ddbd"
        />
      )}
    </svg>
  );
}
