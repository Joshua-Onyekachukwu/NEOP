"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/Skeleton";
import { subscribePublishedResults, createIdDedupe } from "@/lib/realtime";
import { useRealtimeData } from "@/components/live/RealtimeLayer";

interface LGAMarker {
  lga_id: string;
  lga_name: string;
  state_name: string;
  total_pus: number;
  dominant_status: string;
  status_counts: Record<string, number>;
  longitude: number;
  latitude: number;
}

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "#6B7280",
  VOTING: "#3B82F6",
  COUNTING: "#FBBF24",
  RESULT_ANNOUNCED: "#06B6D4",
  RESULT_SUBMITTED: "#8B5CF6",
  VERIFICATION_PENDING: "#F472B6",
  VERIFIED: "#22C55E",
  DISPUTED: "#F97316",
  DISRUPTED: "#EF4444",
  ELECTION_NOT_HELD: "#374151",
  NO_REPORT: "#4B5563",
  AWAITING_AGENTS: "#6B7280",
  AWAITING: "#6B7280",
  FAILED_VERIFICATION: "#B91C1C",
  UNAVAILABLE: "#374151",
  ONE_SUBMISSION: "#F59E0B",
  VERIFYING: "#3B82F6",
  FLAGGED: "#EF4444",
  HUMAN_REVIEW: "#F97316",
  PUBLISHED: "#16A34A",
  SUPERSEDED: "#9CA3AF",
  REJECTED: "#7F1D1D",
};

const LiveMap: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const maplibreglRef = useRef<any>(null);
  const [selectedPU, setSelectedPU] = useState<LGAMarker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [totalPU, setTotalPU] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const pollingUnitsRef = useRef<any[]>([]);
  const fetchingRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { config } = useRealtimeData();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const t1 = setTimeout(() => map.current?.resize(), 60);
    const t2 = setTimeout(() => map.current?.resize(), 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isFullscreen]);

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

  useEffect(() => {
    const shouldRefresh = createIdDedupe();
    return subscribePublishedResults({
      scope: "map",
      onPublishedResult: (record) => {
        if (shouldRefresh(record.id)) router.refresh();
      },
    });
  }, [router]);

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
      const res = await fetch("/api/public/polling-units");
      if (!res.ok) throw new Error("Failed to fetch LGA data");

      const geojson = await res.json();

      // Map LGA features to internal units
      const units = geojson.features.map((f: any) => ({
        lga_id: f.properties.lga_id,
        lga_name: f.properties.lga_name,
        state_name: f.properties.state_name,
        total_pus: f.properties.total_pus,
        dominant_status: f.properties.dominant_status,
        status_counts: f.properties.status_counts || {},
        longitude: f.geometry.coordinates[0],
        latitude: f.geometry.coordinates[1],
      }));

      pollingUnitsRef.current = units;
      setTotalPU(units.length);

      // Add source (no clustering — 774 LGA markers render directly)
      map.current.addSource("polling-units", {
        type: "geojson",
        data: geojson,
        cluster: false,
      });

      // LGA markers — sized by PU count, colored by dominant status
      map.current.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "polling-units",
        paint: {
          "circle-color": [
            "match",
            ["get", "dominant_status"],
            "PUBLISHED", STATUS_COLORS.PUBLISHED,
            "VERIFIED", STATUS_COLORS.VERIFIED,
            "VOTING", STATUS_COLORS.VOTING,
            "COUNTING", STATUS_COLORS.COUNTING,
            "RESULT_SUBMITTED", STATUS_COLORS.RESULT_SUBMITTED,
            "RESULT_ANNOUNCED", STATUS_COLORS.RESULT_ANNOUNCED,
            "VERIFICATION_PENDING", STATUS_COLORS.VERIFICATION_PENDING,
            "DISPUTED", STATUS_COLORS.DISPUTED,
            "HUMAN_REVIEW", STATUS_COLORS.HUMAN_REVIEW,
            "FAILED_VERIFICATION", STATUS_COLORS.FAILED_VERIFICATION,
            "DISRUPTED", STATUS_COLORS.DISRUPTED,
            "UNAVAILABLE", STATUS_COLORS.UNAVAILABLE,
            "AWAITING", STATUS_COLORS.AWAITING,
            "NOT_STARTED", STATUS_COLORS.NOT_STARTED,
            "#4B5563",
          ],
          "circle-radius": [
            "step",
            ["get", "total_pus"],
            6,
            100, 8,
            500, 10,
            1000, 12,
            5000, 14,
            10000, 16,
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0C0F14",
          "circle-opacity": 0.85,
        },
      });

      // Click handler — show LGA summary
      map.current.on("click", "unclustered-point", (e: any) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        setSelectedPU({
          lga_id: props.lga_id,
          lga_name: props.lga_name,
          state_name: props.state_name,
          total_pus: props.total_pus,
          dominant_status: props.dominant_status,
          status_counts: typeof props.status_counts === "string"
            ? JSON.parse(props.status_counts)
            : props.status_counts,
          longitude: coords[0],
          latitude: coords[1],
        });
      });

      // Cursor changes
      map.current.on("mouseenter", "unclustered-point", () => {
        map.current.getCanvas().style.cursor = "pointer";
      });
      map.current.on("mouseleave", "unclustered-point", () => {
        map.current.getCanvas().style.cursor = "";
      });

      // Fit bounds
      const bounds = new maplibreglRef.current.LngLatBounds();
      units.forEach((u: any) => {
        bounds.extend([u.longitude, u.latitude]);
      });
      map.current.fitBounds(bounds, { padding: 50 });

      loadDisruptions();
    } catch (err) {
      console.error("Error loading LGA data:", err);
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

      if (map.current.getSource("disruptions")) {
        (map.current.getSource("disruptions") as any).setData(disruptionGeoJSON);
      } else {
        map.current.addSource("disruptions", {
          type: "geojson",
          data: disruptionGeoJSON,
        });

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

        map.current.on("click", "disruption-point", (e: any) => {
          if (!e.features || e.features.length === 0) return;
          const props = e.features[0].properties;
          const coords = e.features[0].geometry.coordinates.slice();
          setSelectedPU({
            lga_id: props.id,
            lga_name: props.name + " [" + props.category + "]",
            state_name: props.state || "Unknown",
            total_pus: 0,
            dominant_status: props.severity,
            status_counts: {},
            longitude: coords[0],
            latitude: coords[1],
          });
        });
      }
    } catch {
      // silently fail
    }
  };

  const buildGeoJSON = (units: any[]) => ({
    type: "FeatureCollection" as const,
    features: units.map((u: any) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [u.longitude, u.latitude],
      },
      properties: {
        lga_id: u.lga_id,
        lga_name: u.lga_name,
        state_name: u.state_name,
        total_pus: u.total_pus,
        dominant_status: u.dominant_status,
        status_counts: u.status_counts,
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

      // active is now LGA-level: { id=lga_id, status=dominant_status }
      const activeMap = new Map(
        data.active.map((u: any) => [u.id, u.status])
      );

      const updated = pollingUnitsRef.current.map((u) => {
        const newStatus = activeMap.get(u.lga_id);
        if (newStatus && newStatus !== u.dominant_status) {
          return { ...u, dominant_status: newStatus };
        }
        return u;
      });

      const changed = updated.some(
        (u, i) => u.dominant_status !== pollingUnitsRef.current[i]?.dominant_status
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

  const simLabel = config?.status_label || "SIMULATED DATA";

  const mapShell = (
    <div className={isFullscreen ? "fixed inset-0 z-[9999] bg-[var(--color-ink)]" : "relative"}>
      <div
        ref={mapContainer}
        className={
          isFullscreen
            ? "w-full h-full"
            : "w-full h-[400px] md:h-[500px] overflow-hidden border border-[var(--color-gray-100)]"
        }  role="application"
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

      {/* Simulation badge */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-[var(--color-amber)]/15 border border-[var(--color-amber)]/60 px-3 py-1.5 pointer-events-none max-w-[92%]">
        <span className="font-mono text-[10px] md:text-xs font-bold tracking-wider text-[var(--color-amber)] whitespace-nowrap">
          ⚠ <span className="md:hidden">SIMULATED</span>
          <span className="hidden md:inline">{simLabel} — NOT OFFICIAL ELECTION RESULTS</span>
        </span>
      </div>

      {/* Full-screen controls */}
      {isFullscreen ? (
        <button
          onClick={() => setIsFullscreen(false)}
          className="absolute top-14 right-3 z-30 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] px-3 py-2 font-mono text-xs text-[var(--color-text)] hover:bg-[var(--color-ink-light)]"
          aria-label="Exit full-screen map"
        >
          ✕ EXIT FULL SCREEN
        </button>
      ) : (
        <>
          <button
            onClick={() => setIsFullscreen(true)}
            className="hidden md:block absolute top-14 right-3 z-20 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] px-3 py-2 font-mono text-xs text-[var(--color-text)] hover:bg-[var(--color-ink-light)]"
            aria-label="Open full-screen map"
          >
            ⛶ FULL SCREEN
          </button>
          <button
            onClick={() => setIsFullscreen(true)}
            className="md:hidden absolute bottom-14 right-3 z-20 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] px-2.5 py-2 font-mono text-[11px] text-[var(--color-text)]"
            aria-label="Open full-screen map"
          >
            ⛶
          </button>
        </>
      )}

      {/* Map legend — LGA level */}
      <div className="absolute bottom-3 left-3 z-20 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] p-2 font-mono text-[9px] space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--color-text-muted)]">LIVE •</span>
          <span className="text-[var(--color-text)]">{totalPU}</span>
          <span className="text-[var(--color-text-muted)]">LGAs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
          <span>published</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#F97316]" />
          <span>disputed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#B91C1C]" />
          <span>failed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
          <span>disrupted</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#374151]" />
          <span>unavailable</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#6B7280]" />
          <span>awaiting</span>
        </div>
      </div>
    </div>
  );

  // Popup for selected LGA
  const popup = selectedPU && (
    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
      <div
        className="bg-[var(--color-ink)] border border-[var(--color-gray-100)] p-3 max-w-xs pointer-events-auto font-mono text-xs"
        onClick={() => setSelectedPU(null)}
      >
        <div className="font-bold text-[var(--color-text)]">
          {selectedPU.lga_name} · {selectedPU.state_name}
        </div>
        <div className="text-[var(--color-text-muted)] mt-1">
          {selectedPU.total_pus.toLocaleString()} polling units
        </div>
        <div className="mt-2">
          <span
            className="inline-block px-1.5 py-0.5 text-[10px] font-bold"
            style={{ backgroundColor: getStatusColor(selectedPU.dominant_status), color: "#fff" }}
          >
            {selectedPU.dominant_status}
          </span>
        </div>
        {selectedPU.status_counts && Object.keys(selectedPU.status_counts).length > 0 && (
          <div className="mt-2 text-[10px] text-[var(--color-text-muted)]">
            {Object.entries(selectedPU.status_counts).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <span>{k}</span>
                <span>{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative">
      {mapShell}
      {popup}
      {/* Live update indicator */}
      {lastUpdate && (
        <div className="absolute bottom-3 right-3 z-20 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] px-2 py-1 font-mono text-[9px] text-[var(--color-text-muted)]">
          Updated {lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

export default LiveMap;
