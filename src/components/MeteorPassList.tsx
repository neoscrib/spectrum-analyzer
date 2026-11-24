import { useEffect, useState } from "react";
import {
  lookAt,
  type Observer,
  type Pass,
  type parseTle,
} from "../meteor/tracking";
import { MeteorSkyPlot } from "./MeteorSkyPlot";

export interface MeteorPassPrediction {
  passes: Pass[];
  satellite: string;
  orbit: ReturnType<typeof parseTle>;
  observer: Observer;
}

const passDate = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
});
const passTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const passEndTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

function duration(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [
    days ? `${days}d` : "",
    days || hours ? `${hours}h` : "",
    days || hours || minutes ? `${minutes}m` : "",
    `${seconds % 60}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function MeteorPassList({
  prediction,
}: {
  prediction: MeteorPassPrediction;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    // Refresh immediately when returning from a background/suspended tab.
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const { passes, satellite, orbit, observer } = prediction;
  return (
    <section className="meteor-passes" aria-label="Predicted passes">
      {passes.slice(0, 8).map((pass) => {
        const active = now >= pass.start && now < pass.end;
        const ended = now >= pass.end;
        const peak = Math.round(pass.maximum);
        const quality =
          peak >= 60
            ? { label: "Excellent pass", level: "excellent" }
            : peak >= 30
              ? { label: "Good pass", level: "good" }
              : { label: "Low pass", level: "low" };
        const crossesMidnight =
          new Date(pass.start).toDateString() !==
          new Date(pass.end).toDateString();
        const title = `${satellite} · ${passDate.format(pass.start)}`;
        return (
          <article
            className={`meteor-pass-card${active ? " is-active" : ""}${ended ? " is-ended" : ""}`}
            aria-label={title}
            key={pass.start}
          >
            <MeteorSkyPlot
              pass={pass}
              current={active ? lookAt(orbit, observer, now) : undefined}
            />
            <div className="meteor-pass-data">
              <div className="meteor-pass-heading">
                <div>
                  <p className="meteor-pass-title">{title}</p>
                  <h3>{peak}° peak elevation</h3>
                </div>
                <div className="meteor-pass-status">
                  <span
                    className={`meteor-pass-quality ${quality.level}`}
                    title="Based on peak elevation: excellent ≥60°, good ≥30°, low <30°. Reception also depends on your antenna and signal."
                  >
                    {quality.label}
                  </span>
                  <div
                    className="meteor-pass-countdown"
                    role="timer"
                    aria-live="off"
                  >
                    <span>
                      {ended ? "Pass ended" : active ? "Ends in" : "Starts in"}
                    </span>
                    {!ended && (
                      <strong>
                        {duration((active ? pass.end : pass.start) - now)}
                      </strong>
                    )}
                  </div>
                </div>
              </div>
              <p className="meteor-pass-time">
                <time dateTime={new Date(pass.start).toISOString()}>
                  {passTime.format(pass.start)}
                </time>
                {" – "}
                <time dateTime={new Date(pass.end).toISOString()}>
                  {crossesMidnight && `${passDate.format(pass.end)}, `}
                  {passEndTime.format(pass.end)}
                </time>
              </p>
              <dl className="meteor-pass-stats">
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(pass.end - pass.start)}</dd>
                </div>
                <div>
                  <dt>Peak</dt>
                  <dd>{peak}°</dd>
                </div>
                <div>
                  <dt>Satellite</dt>
                  <dd>{satellite.replace(/^Meteor-/, "")}</dd>
                </div>
              </dl>
            </div>
          </article>
        );
      })}
    </section>
  );
}
