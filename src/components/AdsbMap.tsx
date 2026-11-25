import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  distanceBearing,
  field,
  type Aircraft,
  type ReceiverLocation,
} from "../adsb/model";
interface Props {
  aircraft: Aircraft[];
  now: number;
  receiver: ReceiverLocation | null;
  selected: string | null;
  onSelect: (id: string) => void;
  tiles: boolean;
  rings: boolean;
  follow: boolean;
  trailSeconds: number;
  fit: number;
}
export function AdsbMap(p: Props) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    planes = useRef(new Map<string, { marker: L.Marker; trail: L.Polyline }>());
  const selection = useRef(p.onSelect);
  selection.current = p.onSelect;
  useEffect(() => {
    const m = L.map(root.current!, {
      center: p.receiver ? [p.receiver.lat, p.receiver.lon] : [39, -98],
      zoom: p.receiver ? 7 : 4,
      worldCopyJump: true,
      preferCanvas: true,
    });
    map.current = m;
    L.control.scale({ imperial: true }).addTo(m);
    // A coordinate grid keeps the geographic overlay readable without tiles.
    const grid = L.layerGroup();
    for (let lat = -80; lat <= 80; lat += 10)
      L.polyline(
        [
          [lat, -180],
          [lat, 180],
        ],
        { weight: 1, color: "#566570", opacity: 0.22, interactive: false },
      ).addTo(grid);
    for (let lon = -180; lon <= 180; lon += 10)
      L.polyline(
        [
          [-85, lon],
          [85, lon],
        ],
        { weight: 1, color: "#566570", opacity: 0.22, interactive: false },
      ).addTo(grid);
    grid.addTo(m);
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(root.current!);
    return () => {
      resize.disconnect();
      planes.current.clear();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m || !p.tiles) return;
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        keepBuffer: 0,
        updateWhenIdle: true,
      },
    );
    tiles.addTo(m);
    return () => {
      tiles.remove();
    };
  }, [p.tiles]);
  useEffect(() => {
    const m = map.current;
    if (!m || !p.receiver) return;
    const r = p.receiver,
      layer = L.layerGroup();
    L.circleMarker([r.lat, r.lon], {
      radius: 5,
      color: "#f3b966",
      weight: 3,
      fillOpacity: 1,
    })
      .bindTooltip("Receiver")
      .addTo(layer);
    if (p.rings)
      for (const nm of [25, 50, 100, 150, 200])
        L.circle([r.lat, r.lon], {
          radius: nm * 1852,
          color: "#d4a968",
          weight: 1,
          fill: false,
          opacity: 0.5,
        })
          .bindTooltip(`${nm} NM`)
          .addTo(layer);
    layer.addTo(m);
    return () => {
      layer.remove();
    };
  }, [p.receiver, p.rings]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const active = new Set<string>();
    for (const a of p.aircraft) {
      const pos = a.position;
      if (!pos || p.now - pos.at > 15 || p.now - a.lastSeen > 60) continue;
      active.add(a.id);
      let entry = planes.current.get(a.id);
      if (!entry) {
        entry = {
          marker: L.marker([pos.lat, pos.lon]),
          trail: L.polyline([], { weight: 2, opacity: 0.6 }),
        };
        entry.marker.on("click", () => selection.current(a.id));
        entry.trail.addTo(m);
        entry.marker.addTo(m);
        planes.current.set(a.id, entry);
      }
      const track =
        field(a, "headingType", p.now) === 1
          ? field(a, "heading", p.now)
          : undefined;
      const altitude =
          field(a, "baroAltitude", p.now) ?? field(a, "gnssAltitude", p.now),
        color =
          altitude === undefined
            ? "#adb8c2"
            : altitude < 10000
              ? "#59d3a8"
              : altitude < 25000
                ? "#65adf5"
                : "#be96ff";
      const known = track !== undefined;
      const html = `<span class="adsb-plane ${a.id === p.selected ? "selected" : ""}" style="color:${color};transform:rotate(${known ? track : 0}deg)">${known ? '<svg viewBox="0 0 24 24"><path d="M12 1 14 9 22 15 22 17 14 14 14 20 17 22 17 23 12 22 7 23 7 22 10 20 10 14 2 17 2 15 10 9Z"/></svg>' : '<span class="adsb-plane-dot">●</span>'}</span>`;
      entry.marker
        .setLatLng([pos.lat, pos.lon])
        .setIcon(
          L.divIcon({
            html,
            className: "adsb-marker",
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
        );
      const label = document.createElement("span");
      label.textContent = `${field(a, "callsign", p.now)?.trim() || a.address} · ${altitude === undefined ? "altitude unavailable" : `${Math.round(altitude).toLocaleString()} ft`}`;
      entry.marker.unbindTooltip().bindTooltip(label, { direction: "top" });
      // Split at the antimeridian rather than drawing a trail across the world.
      const trail = a.trail.filter((t) => p.now - t.at <= p.trailSeconds);
      const segments: L.LatLngExpression[][] = [];
      for (const t of trail) {
        if (
          !segments.length ||
          Math.abs(t.lon - (segments.at(-1)!.at(-1) as [number, number])[1]) >
            180
        )
          segments.push([]);
        segments.at(-1)!.push([t.lat, t.lon]);
      }
      entry.trail.setLatLngs(segments).setStyle({ color });
      if (
        p.follow &&
        a.id === p.selected &&
        distanceBearing({ lat: m.getCenter().lat, lon: m.getCenter().lng }, pos)
          .distance > 0.05
      )
        m.panTo([pos.lat, pos.lon], { animate: false });
    }
    for (const [id, e] of planes.current)
      if (!active.has(id)) {
        e.marker.remove();
        e.trail.remove();
        planes.current.delete(id);
      }
  }, [p.aircraft, p.now, p.selected, p.follow, p.trailSeconds]);
  useEffect(() => {
    const m = map.current;
    if (!m || !p.fit) return;
    const positions = p.aircraft
      .filter((a) => a.position && p.now - a.position.at <= 15)
      .map((a) => [a.position!.lat, a.position!.lon] as [number, number]);
    if (p.receiver) positions.push([p.receiver.lat, p.receiver.lon]);
    if (positions.length)
      m.fitBounds(L.latLngBounds(positions), {
        padding: [30, 30],
        maxZoom: 12,
      });
  }, [p.fit]);
  return (
    <div
      className="adsb-map"
      ref={root}
      role="region"
      aria-label="Aircraft map"
    />
  );
}
