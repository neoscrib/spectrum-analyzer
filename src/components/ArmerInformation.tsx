import { useEffect, useState } from "react";
import { emptyInformation, updateInformation } from "../armer/information";
import type { P25Event, SystemInformation } from "../armer/model";
import { ArmerSystemSummary } from "./ArmerSystemSummary";

export function ArmerInformation({
  events,
  information,
  generation,
  test,
  active,
}: {
  events: P25Event[];
  information?: SystemInformation;
  generation: number;
  test: boolean;
  active: boolean;
}) {
  const [messages, setMessages] = useState(emptyInformation);
  useEffect(() => {
    setMessages(emptyInformation());
  }, [generation, test]);
  useEffect(() => {
    if (events.length) setMessages((old) => updateInformation(old, events));
  }, [events]);
  return (
    <section
      className="armer-information"
      aria-label="Control-channel information"
    >
      <details className="armer-summary-accordion">
        <summary>
          <strong>System summary</strong>
          <span>
            {test
              ? "GENERATED TEST"
              : active
                ? "P25 Phase I · C4FM"
                : "Stopped"}
          </span>
        </summary>
        <ArmerSystemSummary information={information} />
      </details>
      <details className="armer-broadcasts">
        <summary>
          <strong>System broadcasts</strong>
          <span>{messages.announcements.length} distinct messages</span>
        </summary>
        {messages.announcements.length ? (
          <div className="armer-table-scroll armer-broadcast-table">
            <table aria-label="System broadcast messages">
              <thead>
                <tr>
                  <th>Opcode / MFID</th>
                  <th>Decoded message</th>
                  <th>Count</th>
                  <th>Last (s)</th>
                  <th>Raw</th>
                </tr>
              </thead>
              <tbody>
                {messages.announcements.map(({ key, event, count }) => (
                  <tr key={key}>
                    <td>
                      {event
                        .control!.opcode.toString(16)
                        .toUpperCase()
                        .padStart(2, "0")}{" "}
                      /{" "}
                      {event
                        .control!.mfid.toString(16)
                        .toUpperCase()
                        .padStart(2, "0")}
                    </td>
                    <td className="armer-table-text">{event.control!.text}</td>
                    <td>{count}</td>
                    <td>{event.time.toFixed(1)}</td>
                    <td>
                      <details className="armer-raw-block">
                        <summary>Hex</summary>
                        <code>{event.message}</code>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="caption">
            {active
              ? "Waiting for CRC-valid system broadcasts…"
              : "Start reception to collect system broadcasts."}
          </p>
        )}
      </details>
    </section>
  );
}
