"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import type { Coordinate, ProjectSnapshot } from "@/domain/types";
import { calculatePolygonArea, calculatePolygonPerimeter } from "@/geometry/polygons";
import { createMapReference, latLonToLocalMeters } from "@/geometry/map-projection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type GeoPoint = {
  lat: number;
  lon: number;
};

type GeocodeResult = GeoPoint & {
  label: string;
};

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { message: string } };

export function MapWorkflow({ initialProject }: { initialProject: ProjectSnapshot }) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>();
  const layerGroupRef = useRef<L.LayerGroup>();
  const [query, setQuery] = useState(initialProject.field.mapReference?.address ?? "");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [status, setStatus] = useState("Klik i kortet for at tegne markgrænsen.");
  const initialCenter = useMemo<GeoPoint>(
    () => ({
      lat: initialProject.field.mapReference?.centerLat ?? 55.6761,
      lon: initialProject.field.mapReference?.centerLon ?? 12.5683
    }),
    [initialProject.field.mapReference?.centerLat, initialProject.field.mapReference?.centerLon]
  );

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const map = L.map(mapElementRef.current, { zoomControl: true }).setView([initialCenter.lat, initialCenter.lon], initialProject.field.mapReference?.zoom ?? 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    const layers = L.layerGroup().addTo(map);
    layerGroupRef.current = layers;
    map.on("click", (event: L.LeafletMouseEvent) => {
      setPoints((current) => [...current, { lat: event.latlng.lat, lon: event.latlng.lng }]);
      setStatus("Punkt tilføjet.");
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = undefined;
      layerGroupRef.current = undefined;
    };
  }, [initialCenter.lat, initialCenter.lon, initialProject.field.mapReference?.zoom]);

  useEffect(() => {
    const layers = layerGroupRef.current;
    if (!layers) return;
    layers.clearLayers();
    points.forEach((point, index) => {
      L.circleMarker([point.lat, point.lon], {
        radius: 5,
        color: "#2f6235",
        fillColor: "#ffffff",
        fillOpacity: 1,
        weight: 2
      })
        .bindTooltip(`${index + 1}`)
        .addTo(layers);
    });
    if (points.length > 1) {
      L.polyline(points.map((point) => [point.lat, point.lon] as [number, number]), { color: "#2f6235", weight: 3 }).addTo(layers);
    }
    if (points.length > 2) {
      L.polygon(points.map((point) => [point.lat, point.lon] as [number, number]), {
        color: "#2f6235",
        fillColor: "#d9eed9",
        fillOpacity: 0.35,
        weight: 2
      }).addTo(layers);
    }
  }, [points]);

  async function search() {
    setStatus("Søger adresse ...");
    const response = await fetch(`/api/geocode?query=${encodeURIComponent(query)}`);
    const payload = (await response.json()) as ApiResponse<GeocodeResult[]>;
    if (!payload.success) {
      setStatus(payload.error.message);
      return;
    }
    setResults(payload.data);
    setStatus(payload.data.length > 0 ? "Vælg et søgeresultat." : "Ingen resultater.");
  }

  function goTo(result: GeocodeResult) {
    mapRef.current?.setView([result.lat, result.lon], 17);
    setQuery(result.label);
    setStatus("Kortet er flyttet til adressen.");
  }

  async function savePolygon() {
    if (points.length < 3) {
      setStatus("Marken skal have mindst tre punkter.");
      return;
    }

    const center = centerOf(points);
    const zoom = mapRef.current?.getZoom() ?? 15;
    const mapReference = createMapReference({ centerLat: center.lat, centerLon: center.lon, zoom, address: query || undefined });
    const polygon = points.map((point) => latLonToLocalMeters(point, mapReference));
    const areaM2 = calculatePolygonArea(polygon);
    const nextProject: ProjectSnapshot = {
      ...initialProject,
      field: {
        ...initialProject.field,
        sourceType: "map",
        mapReference,
        polygon,
        areaM2,
        areaHa: areaM2 / 10_000,
        perimeterMeters: calculatePolygonPerimeter(polygon)
      },
      updatedAt: new Date().toISOString()
    };

    setStatus("Gemmer mark fra kort ...");
    const response = await fetch(`/api/projects/${initialProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: nextProject })
    });
    setStatus(response.ok ? "Kortpolygonen er gemt." : "Kortpolygonen kunne ikke gemmes.");
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f5f7f4] text-ink-900">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <Link href={`/projects/${initialProject.id}`} className="text-sm text-field-700 underline">
              Tilbage til editoren
            </Link>
            <h1 className="mt-2 text-2xl font-semibold">Kortgrundlag for {initialProject.name}</h1>
          </div>
          <Button variant="primary" onClick={() => void savePolygon()}>
            Gem markpolygon
          </Button>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-5 py-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-md border border-slate-200 bg-white p-4 shadow-panel">
          <div>
            <label className="text-sm font-medium">
              Adresse eller stednavn
              <Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
            </label>
            <Button className="mt-2 w-full" onClick={() => void search()}>
              Søg
            </Button>
          </div>
          <div className="space-y-2">
            {results.map((result) => (
              <button
                key={`${result.lat}-${result.lon}`}
                className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-left text-sm hover:border-field-600"
                onClick={() => goTo(result)}
              >
                {result.label}
              </button>
            ))}
          </div>
          <div className="rounded-md bg-slate-50 p-3 text-sm text-ink-700">
            <p>{points.length} kortpunkter valgt.</p>
            <p className="mt-1">{status}</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setPoints((current) => current.slice(0, -1))}>
              Fortryd punkt
            </Button>
            <Button className="flex-1" onClick={() => setPoints([])}>
              Ryd
            </Button>
          </div>
        </aside>
        <div ref={mapElementRef} className="min-h-[620px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel" />
      </section>
    </main>
  );
}

function centerOf(points: GeoPoint[]): GeoPoint {
  const sum = points.reduce(
    (accumulator, point) => ({
      lat: accumulator.lat + point.lat,
      lon: accumulator.lon + point.lon
    }),
    { lat: 0, lon: 0 }
  );

  return {
    lat: sum.lat / points.length,
    lon: sum.lon / points.length
  };
}
