"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

interface IncidentCounts {
  violence: number;
  intimidation: number;
  disruption: number;
  election_not_held: number;
  material_shortage: number;
  other: number;
  total: number;
}

const IncidentBar: React.FC = () => {
  const [counts, setCounts] = useState<IncidentCounts>({
    violence: 0, intimidation: 0, disruption: 0,
    election_not_held: 0, material_shortage: 0, other: 0, total: 0,
  });

  useEffect(() => {
    fetchIncidentCounts();

    const channel = supabase
      .channel("incident-updates")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "incidents" }, () => fetchIncidentCounts())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchIncidentCounts = async () => {
    // Count per category without loading all rows into memory
    const categories = ["VIOLENCE", "INTIMIDATION", "DISRUPTION", "ELECTION_NOT_HELD", "MATERIAL_SHORTAGE"];
    const counts: IncidentCounts = {
      violence: 0, intimidation: 0, disruption: 0,
      election_not_held: 0, material_shortage: 0, other: 0, total: 0,
    };

    const results = await Promise.all(
      categories.map(cat =>
        supabase.from("incidents").select("id", { count: "exact", head: true }).eq("category", cat)
      )
    );

    counts.violence = results[0].count || 0;
    counts.intimidation = results[1].count || 0;
    counts.disruption = results[2].count || 0;
    counts.election_not_held = results[3].count || 0;
    counts.material_shortage = results[4].count || 0;
    counts.total = results.reduce((sum, r) => sum + (r.count || 0), 0);

    // Get "other" count (total minus the 5 known categories)
    const { count: totalAll } = await supabase.from("incidents").select("id", { count: "exact", head: true });
    counts.other = Math.max(0, (totalAll || 0) - counts.total);
    counts.total = totalAll || 0;

    setCounts(counts);
  };

  const items = [
    { label: "Violence", count: counts.violence, color: "var(--color-red)" },
    { label: "Intimidation", count: counts.intimidation, color: "var(--color-amber)" },
    { label: "Disruption", count: counts.disruption, color: "var(--color-amber)" },
    { label: "Not Held", count: counts.election_not_held, color: "var(--color-text-dim)" },
    { label: "Materials", count: counts.material_shortage, color: "var(--color-blue)" },
    { label: "Other", count: counts.other, color: "var(--color-text-dim)" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-[12px]">
        <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
          INCIDENTS
        </h3>
        <span className="font-mono text-xs text-[var(--color-text-dim)]">
          {counts.total} total
        </span>
      </div>

      <div className="flex flex-wrap gap-[12px]">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-[8px] px-[12px] py-[8px] rounded-[4px] bg-[var(--color-ink-light)] border border-[var(--color-gray-100)]"
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="font-mono text-xs text-[var(--color-text-muted)]">
              {item.label}
            </span>
            <span className="font-mono text-sm font-bold text-[var(--color-text)]">
              {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default IncidentBar;
