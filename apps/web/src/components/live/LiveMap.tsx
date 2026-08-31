"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/Skeleton";

interface PollingUnit {
  id: string;
  official_code: string;
  name: string;
  latitude: number;
  longitude: number;
  status: string;
  state_name: string;
}

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "#9CA3AF",
  VOTING: "#3B82F6",
  COUNTING: "#F59E0B",
  RESULT_ANNOUNCED: "#10B981",
  RESULT_SUBMITTED: "#8B5CF6",
  VERIFICATION_PENDING: "#06B6D4",
  VERIFIED: "#22C55E",
  DISPUTED: "#F97316",
  DISRUPTED: "#EF4444",
  ELECTION_NOT_HELD: "#6B7280",
  NO_REPORT: "#4B5563",
};

const LiveMap: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const maplibreglRef = useRef<any>(null);
  const [selectedPU, setSelectedPU] = useState<PollingUnit | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [totalPU, setTotalPU] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const pollingUnitsRef = useRef<any[]>([]);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (mapContainer.current && !map.current) {
      initMap();
    }
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (mapLoaded) {
      loadPollingUnits();
      const interval = setInterval(pollStatusUpdates, 5000);
      return () => clearInterval(interval);
    }
  }, [mapLoaded, refreshKey]);

  const initMap = async () => {
    const maplibregl = await import("maplibre-gl");
    maplibreglRef.current = maplibregl;

    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [8.0, 9.0],
      zoom: 6,
      minZoom: 5,
      maxZoom: 18,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    map.current.addControl(new maplibregl.ScaleControl(), "bottom-right");

    map.current.on("load", () => {
      setMapLoaded(true);
    });
  };

  const loadPollingUnits = async () => {
    if (!map.current || !maplibreglRef.current || fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      // Fetch all PUs from server-side GeoJSON endpoint
      const res = await fetch("/api/public/polling-units");
      if (!res.ok) throw new Error("Failed to fetch PUs");

      const geojson = await res.json();
      const units = geojson.features.map((f: any) => ({
        id: f.properties.id,
        official_code: f.properties.official_code,
        name: f.properties.name,
        status: f.properties.status,
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
        state_name: f.properties.state_name,
      }));

      pollingUnitsRef.current = units;
      setTotalPU(units.length);

      // Add source
      map.current.addSource("polling-units", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.current.addLayer({
        id: "clusters",
        type: "circle",
        source: "polling-units",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#1B6B3A33",
            100,
            "#1B6B3A66",
            750,
            "#1B6B3A99",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            20,
            100,
            30,
            750,
            40,
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#1B6B3A",
        },
      });

      // Cluster count labels
      map.current.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "polling-units",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#E8E6E1",
        },
      });

      // Individual points with status colors
      map.current.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "polling-units",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "status"],
            "VERIFIED",
            STATUS_COLORS.VERIFIED,
            "VOTING",
            STATUS_COLORS.VOTING,
            "COUNTING",
            STATUS_COLORS.COUNTING,
            "RESULT_SUBMITTED",
            STATUS_COLORS.RESULT_SUBMITTED,
            "RESULT_ANNOUNCED",
            STATUS_COLORS.RESULT_ANNOUNCED,
            "VERIFICATION_PENDING",
            STATUS_COLORS.VERIFICATION_PENDING,
            "DISPUTED",
            STATUS_COLORS.DISPUTED,
            "DISRUPTED",
            STATUS_COLORS.DISRUPTED,
            "ELECTION_NOT_HELD",
            STATUS_COLORS.ELECTION_NOT_HELD,
            "NOT_STARTED",
            STATUS_COLORS.NOT_STARTED,
            "#4B5563",
          ],
          "circle-radius": 5,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0C0F14",
          "circle-opacity": 0.85,
        },
      });

      // Click handler for unclustered points
      map.current.on("click", "unclustered-point", (e: any) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        setSelectedPU({
          id: props.id,
          official_code: props.official_code,
          name: props.name,
          latitude: coords[1],
          longitude: coords[0],
          status: props.status,
          state_name: props.state_name || "Unknown",
        });
      });

      // Click handler for clusters — zoom in
      map.current.on("click", "clusters", (e: any) => {
        if (!e.features || e.features.length === 0) return;
        const clusterId = e.features[0].properties.cluster_id;
        const source = map.current.getSource("polling-units");
        source.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
          if (err) return;
          map.current.easeTo({
            center: e.features[0].geometry.coordinates,
            zoom: zoom,
          });
        });
      });

      // Cursor changes
      map.current.on("mouseenter", "unclustered-point", () => {
        map.current.getCanvas().style.cursor = "pointer";
      });
      map.current.on("mouseleave", "unclustered-point", () => {
        map.current.getCanvas().style.cursor = "";
      });
      map.current.on("mouseenter", "clusters", () => {
        map.current.getCanvas().style.cursor = "pointer";
      });
      map.current.on("mouseleave", "clusters", () => {
        map.current.getCanvas().style.cursor = "";
      });

      // Fit bounds
      const bounds = new maplibreglRef.current.LngLatBounds();
      units.forEach((pu: any) => {
        bounds.extend([pu.longitude, pu.latitude]);
      });
      map.current.fitBounds(bounds, { padding: 50 });

      // ── Load disruption markers ──
      loadDisruptions();
    } catch (err) {
      console.error("Error loading polling units:", err);
    } finally {
      fetchingRef.current = false;
    }
  };

  const loadDisruptions = async () => {
    if (!map.current || !maplibreglRef.current) return;
    try {
      const res = await fetch("/api/public/disruptions?limit=500");
      if (!res.ok) return;
      const data = await res.json();
      if (!data.map_markers || data.map_markers.length === 0) return;

      // Build GeoJSON for disruptions
      const disruptionGeoJSON = {
        type: "FeatureCollection" as const,
        features: data.map_markers.map((m: any) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [m.longitude, m.latitude] },
          properties: {
            id: m.id,
            code: m.code,
            name: m.name,
            state: m.state,
            category: m.category,
            severity: m.severity,
            color: m.color,
          },
        })),
      };

      // Add disruption source
      if (map.current.getSource("disruptions")) {
        (map.current.getSource("disruptions") as any).setData(disruptionGeoJSON);
      } else {
        map.current.addSource("disruptions", {
          type: "geojson",
          data: disruptionGeoJSON,
        });

        // Disruption markers — larger, pulsing rings
        map.current.addLayer({
          id: "disruption-pulse",
          type: "circle",
          source: "disruptions",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 12,
            "circle-opacity": 0.3,
          },
        });

        map.current.addLayer({
          id: "disruption-point",
          type: "circle",
          source: "disruptions",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 6,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#FFFFFF",
          },
        });

        // Click handler for disruption points
        map.current.on("click", "disruption-point", (e: any) => {
          if (!e.features || e.features.length === 0) return;
          const props = e.features[0].properties;
          const coords = e.features[0].geometry.coordinates.slice();
          setSelectedPU({
            id: props.id,
            official_code: props.code,
            name: props.name + " [" + props.category + "]",
            latitude: coords[1],
            longitude: coords[0],
            status: props.severity,
            state_name: props.state || "Unknown",
          });
        });
      }
    } catch {
      // silently fail
    }
  };

  const buildGeoJSON = (units: any[]) => ({
    type: "FeatureCollection" as const,
    features: units.map((pu: any) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [pu.longitude, pu.latitude],
      },
      properties: {
        id: pu.id,
        official_code: pu.official_code,
        name: pu.name,
        status: pu.status,
        state_name: pu.state_name || "Unknown",
      },
    })),
  });

  const pollStatusUpdates = useCallback(async () => {
    if (!map.current || fetchingRef.current) return;

    try {
      const res = await fetch("/api/public/polling-units/status-changes");
      if (!res.ok) return;

      const data = await res.json();
      if (!data.active || data.active.length === 0) return;

      const activeMap = new Map(
        data.active.map((pu: any) => [pu.id, pu.status])
      );

      const updated = pollingUnitsRef.current.map((pu) => {
        const newStatus = activeMap.get(pu.id);
        if (newStatus && newStatus !== pu.status) {
          return { ...pu, status: newStatus };
        }
        return pu;
      });

      const changed = updated.some(
        (pu, i) => pu.status !== pollingUnitsRef.current[i]?.status
      );

      if (changed) {
        pollingUnitsRef.current = updated;
        const geojson = buildGeoJSON(updated);
        const source = map.current.getSource("polling-units");
        if (source) {
          source.setData(geojson);
          setLastUpdate(new Date());
        }
      }
    } catch {
      // silently fail — will retry next interval
    }
  }, []);

  const getStatusColor = (status: string): string => {
    return STATUS_COLORS[status] || "#4B5563";
  };

  return (
    <div className="relative">
      <div
        ref={mapContainer}
        className="w-full h-[400px] md:h-[500px] overflow-hidden border border-[var(--color-gray-100)]"
        role="application"
        aria-label="Interactive map showing polling unit locations across Nigeria. Click a point for details."
      />

      {/* Skeleton overlay while map initializes */}
      {!mapLoaded && (
        <div className="absolute inset-0 z-20">
          <Skeleton className="w-full h-full rounded-none!" />
          <div className="absolute bottom-3 left-3 right-3 flex justify-between">
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "100px" }} />
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "80px" }} />
          </div>
        </div>
      )}

      {/* Live update indicator */}
      {mapLoaded && (
        <div className="absolute top-3 right-3 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] px-3 py-1.5 z-10">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[var(--color-green-bright)] animate-pulse" />
            <span className="font-mono text-xs text-[var(--color-text-muted)]">
              LIVE • {totalPU.toLocaleString()} PUs
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-3 left-3 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] p-3 z-10">
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
          Status
        </div>
        <div className="space-y-1.5">
          {Object.entries(STATUS_COLORS)
            .filter(([key]) => !["NOT_STARTED", "ELECTION_NOT_HELD", "NO_REPORT"].includes(key))
            .map(([key, color]) => (
              <div key={key} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                  {key.replace(/_/g, " ").toLowerCase()}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Selected PU detail */}
      {selectedPU && (
        <div className="absolute bottom-3 left-3 right-3 bg-[var(--color-ink)]/95 border border-[var(--color-gray-100)] p-4 z-10">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-lg font-bold text-[var(--color-text)]">
                {selectedPU.official_code}
              </div>
              <div className="text-sm text-[var(--color-text-muted)]">{selectedPU.name}</div>
              <div className="text-sm text-[var(--color-text-muted)]">{selectedPU.state_name}</div>
              <div className="mt-2">
                <span
                  className="font-mono text-[10px] uppercase tracking-wider px-2 py-1"
                  style={{
                    color: getStatusColor(selectedPU.status),
                    backgroundColor: `${getStatusColor(selectedPU.status)}1A`,
                  }}
                >
                  {selectedPU.status.replace(/_/g, " ").toLowerCase()}
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedPU(null)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-mono text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Total count */}
      <div className="absolute bottom-3 right-3 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] px-3 py-1.5 z-10">
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {totalPU.toLocaleString()} polling units
        </span>
      </div>
    </div>
  );
};

export default LiveMap;
