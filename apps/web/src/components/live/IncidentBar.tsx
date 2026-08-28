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
    const { data } = await supabase.from("incidents").select("category");
    if (!data) return;

    const c: IncidentCounts = {
      violence: 0, intimidation: 0, disruption: 0,
      election_not_held: 0, material_shortage: 0, other: 0, total: data.length,
    };

    for (const i of data) {
      switch (i.category) {
        case "VIOLENCE": c.violence++; break;
        case "INTIMIDATION": c.intimidation++; break;
        case "DISRUPTION": c.disruption++; break;
        case "ELECTION_NOT_HELD": c.election_not_held++; break;
        case "MATERIAL_SHORTAGE": c.material_shortage++; break;
        default: c.other++;
      }
    }
    setCounts(c);
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
