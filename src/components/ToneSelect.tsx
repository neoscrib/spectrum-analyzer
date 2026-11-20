import { useId } from "react";
import { CTCSS, DCS_CODES, type ToneFilter } from "../presets/model";
export function ToneSelect({
  value,
  onChange,
  disabled = false,
  label = "Code filter",
}: {
  value: ToneFilter | null;
  onChange: (value: ToneFilter | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const key = value
    ? value.type === "ctcss"
      ? `ctcss:${value.hz}`
      : `dcs:${value.code}:${value.inverted ? "I" : "N"}`
    : "any";
  return (
    <label className="preset-field" htmlFor={id}>
      {label}
      <select
        id={id}
        aria-label={label}
        disabled={disabled}
        value={key}
        onChange={(e) => {
          const [type, code, polarity] = e.target.value.split(":");
          onChange(
            type === "ctcss"
              ? { type, hz: Number(code) }
              : type === "dcs"
                ? { type, code, inverted: polarity === "I" }
                : null,
          );
        }}
      >
        <option value="any">Any code · detect only</option>
        <optgroup label="CTCSS (Hz)">
          {CTCSS.map((hz) => (
            <option key={hz} value={`ctcss:${hz}`}>
              {hz.toFixed(1)} Hz
            </option>
          ))}
        </optgroup>
        <optgroup label="DCS normal">
          {DCS_CODES.map((code) => (
            <option key={code} value={`dcs:${code}:N`}>
              {code}N
            </option>
          ))}
        </optgroup>
        <optgroup label="DCS inverted">
          {DCS_CODES.map((code) => (
            <option key={code} value={`dcs:${code}:I`}>
              {code}I
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
export function SquelchSelect({
  value,
  onChange,
  label = "Squelch",
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="preset-field" htmlFor={id}>
      {label}
      <select
        id={id}
        aria-label={label}
        disabled={disabled}
        value={value ?? "off"}
        onChange={(e) =>
          onChange(e.target.value === "off" ? null : Number(e.target.value))
        }
      >
        <option value="off">Off · monitor noise</option>
        {[
          ...new Set([
            -100,
            -95,
            -90,
            -85,
            -80,
            -75,
            -70,
            -65,
            -60,
            -55,
            -50,
            -45,
            -40,
            -35,
            -30,
            -25,
            -20,
            ...(value === null ? [] : [value]),
          ]),
        ]
          .sort((a, b) => a - b)
          .map((v) => (
            <option key={v} value={v}>
              {v} dBFS
            </option>
          ))}
      </select>
    </label>
  );
}
