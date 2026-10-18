import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Feature, LineString } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Site, Report } from "../domain";
import { MapPin, Layers, Maximize2, WifiOff } from "lucide-react";
maplibregl.setWorkerUrl(mapWorkerUrl);
export default function MapView({
  sites,
  reports = [],
  selected,
  onSelect,
  route,
  large = false,
}: {
  sites: Site[];
  reports?: Report[];
  selected?: string;
  onSelect?: (s: Site) => void;
  route?: number[][];
  large?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | undefined>(undefined);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(!navigator.onLine),
    [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    setFailed(!online);
    if (!root.current || !online) return;
    let m: maplibregl.Map;
    const timeout = setTimeout(() => setFailed(true), 12000);
    try {
      m = new maplibregl.Map({
        container: root.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: sites.length ? [sites[0].lon, sites[0].lat] : [0, 20],
        zoom: sites.length ? 9 : 2,
        attributionControl: { compact: true },
      });
      map.current = m;
      m.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      m.on("load", () => {
        clearTimeout(timeout);
        setReady(true);
        setFailed(false);
      });
      m.on("error", () => {
        if (!m.isStyleLoaded()) setFailed(true);
      });
    } catch {
      setFailed(true);
    }
    return () => {
      clearTimeout(timeout);
      m?.remove();
      map.current = undefined;
      setReady(false);
    };
  }, [online]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    markers.current.forEach((x) => x.remove());
    markers.current = sites.map((s, i) => {
      const el = document.createElement("button");
      el.className = `map-marker ${selected === s.id ? "selected" : ""} ${reports.some((r) => r.siteId === s.id && r.severity === "blocked" && Date.parse(r.expiresAt) > Date.now()) ? "blocked" : ""}`;
      el.textContent = String(i + 1);
      el.title = s.name;
      el.setAttribute("aria-label", s.name);
      el.onclick = () => onSelect?.(s);
      return new maplibregl.Marker({ element: el })
        .setLngLat([s.lon, s.lat])
        .addTo(m);
    });
    if (sites.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      sites.forEach((s) => bounds.extend([s.lon, s.lat]));
      m.fitBounds(bounds, { padding: 65, maxZoom: 12, duration: 500 });
    } else if (sites.length)
      m.flyTo({ center: [sites[0].lon, sites[0].lat], zoom: 12 });
  }, [sites, ready, selected, reports]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const data: Feature<LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: route && route.length > 1 ? route : [],
      },
    };
    const source = m.getSource("trip") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      m.addSource("trip", { type: "geojson", data });
      m.addLayer({
        id: "trip-line",
        type: "line",
        source: "trip",
        paint: {
          "line-color": "#287d62",
          "line-width": 4,
          "line-opacity": 0.8,
        },
      });
    }
  }, [route, ready]);
  return (
    <div className={`map-view ${large ? "large" : ""}`}>
      <div ref={root} className="map-canvas" />
      {failed && (
        <div className="map-fallback">
          <WifiOff size={22} />
          <strong>Site overview</strong>
          <span>Basemap unavailable. Saved locations are listed below.</span>
          <div className="offline-sites">
            {sites.map((s, i) => (
              <button key={s.id} onClick={() => onSelect?.(s)}>
                <MapPin size={15} />
                <b>{i + 1}</b> {s.name}
                <small>
                  {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="map-label">
        <Layers size={14} />{" "}
        {failed ? "Saved site coordinates" : "OpenFreeMap · OpenStreetMap"}
      </div>
      <button
        className="map-fit icon-btn"
        title="Fit all sites"
        onClick={() => {
          if (map.current && sites.length) {
            const b = new maplibregl.LngLatBounds();
            sites.forEach((s) => b.extend([s.lon, s.lat]));
            map.current.fitBounds(b, { padding: 70, maxZoom: 12 });
          }
        }}
      >
        <Maximize2 size={17} />
      </button>
    </div>
  );
}
