"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { LngLat } from "@/lib/types";

interface BoundaryMapProps {
  /** Accessible name for the map region, e.g. "Map of Niles Neighbors boundary". */
  label: string;
  boundary?: LngLat[];
  others?: { name: string; boundary: LngLat[] }[];
  point?: { lat: number; lng: number; label: string };
  /** Draws an "affected area" circle around the point. */
  radiusM?: number | null;
  className?: string;
  interactive?: boolean;
}

const toLatLng = (ring: LngLat[]) => ring.map(([lng, lat]) => [lat, lng] as [number, number]);

// A stable default, so re-rendering the parent doesn't rebuild the map.
const NO_OTHERS: { name: string; boundary: LngLat[] }[] = [];

export function BoundaryMap({ label, boundary, others = NO_OTHERS, point, radiusM = null, className = "", interactive = true }: BoundaryMapProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;

    // Leaflet touches window on import, so load it only in the browser.
    import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      map = L.map(container.current, {
        scrollWheelZoom: false,
        dragging: interactive,
        zoomControl: interactive,
        keyboard: interactive,
        doubleClickZoom: interactive,
        touchZoom: interactive,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "docket-tiles",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      let bounds: import("leaflet").LatLngBounds | undefined;
      const extend = (b: import("leaflet").LatLngBounds) => (bounds = bounds ? bounds.extend(b) : b);

      for (const other of others) {
        const layer = L.polygon(toLatLng(other.boundary), {
          color: "#474747",
          weight: 2,
          dashArray: "6 5",
          fillColor: "#8DC2F5",
          fillOpacity: 0.12,
        })
          .bindTooltip(other.name, { sticky: true })
          .addTo(map);
        extend(layer.getBounds());
      }

      if (boundary) {
        const layer = L.polygon(toLatLng(boundary), {
          color: "#2F6A31",
          weight: 3,
          fillColor: "#6DB33F",
          fillOpacity: 0.2,
        }).addTo(map);
        extend(layer.getBounds());
      }

      if (point && radiusM) {
        L.circle([point.lat, point.lng], {
          radius: radiusM,
          color: "#2a78d6",
          weight: 2,
          fillColor: "#2a78d6",
          fillOpacity: 0.1,
        }).addTo(map);
        // circle.getBounds() needs a map view that doesn't exist yet; compute it from the radius.
        extend(L.latLng(point.lat, point.lng).toBounds(radiusM * 2));
      }

      if (point) {
        L.marker([point.lat, point.lng], {
          title: point.label,
          keyboard: false,
          icon: L.divIcon({ className: "docket-pin", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] }),
        }).addTo(map);
        extend(L.latLngBounds([point.lat, point.lng], [point.lat, point.lng]));
      }

      if (bounds) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
      else map.setView([37.5485, -121.9886], 12);
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [boundary, others, point, radiusM, interactive]);

  return <div ref={container} role="region" aria-label={label} className={`isolate z-0 w-full bg-sky-mist ${className}`} />;
}
