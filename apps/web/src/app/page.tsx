"use client";

import React, { useEffect, useState } from "react";
import StatsBar from "@/components/live/StatsBar";
import ResultFeed from "@/components/live/ResultFeed";
import StateTable from "@/components/live/StateTable";
import PartyResults from "@/components/live/PartyResults";
import IncidentBar from "@/components/live/IncidentBar";
import Disclaimer from "@/components/live/Disclaimer";
import LiveMap from "@/components/live/LiveMap";
import { supabase } from "@/lib/supabase-browser";

const HomePage: React.FC = () => {
  const [currentTime, setCurrentTime] = useState("");
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("en-NG", {
          timeZone: "Africa/Lagos",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    const channel = supabase
      .channel("health-check")
      .on("presence", { event: "sync" }, () => setIsLive(true))
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") setIsLive(true);
      });

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen pt-[56px]">
      <main id="main-content">
      {/* Disclaimer */}
      <Disclaimer />

      {/* Hero — the thesis: one big number */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[32px] md:py-[48px]">
          <div className="flex flex-col md:flex-row items-end justify-between gap-[24px]">
            <div>
              <div className="stat-label mb-[8px]">
                Presidential &amp; House of Assembly Election — 16 January 2027
              </div>
              <h1 className="big-number">176,846</h1>
              <div className="stat-label mt-[8px]">polling units across Nigeria</div>
            </div>

            <div className="flex items-center gap-[16px] pb-[8px]">
              <div className="flex items-center gap-[8px]">
                <div className={isLive ? "live-dot" : "w-2 h-2 rounded-full bg-[var(--color-gray-400)]"} />
                <span className="font-mono text-[var(--color-text-muted)] text-sm">
                  {isLive ? "LIVE" : "CONNECTING"}
                </span>
              </div>
              <span className="font-mono text-[var(--color-text-dim)] text-sm">
                {currentTime} WAT
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats row — tight, data-dense */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px]">
          <StatsBar />
        </div>
      </section>

      {/* Map + Feed — side by side, no card wrappers */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Map */}
            <div className="border-b lg:border-b-0 lg:border-r border-[var(--color-gray-100)]">
              <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)]">
                <h3 className="font-display font-semibold text-sm text-[var(--color-text-muted)]">
                  NATIONAL MAP
                </h3>
              </div>
              <LiveMap />
            </div>

            {/* Result Feed */}
            <div>
              <ResultFeed />
            </div>
          </div>
        </div>
      </section>

      {/* State Breakdown + Party Results — side by side, equal height */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* State Breakdown */}
            <div className="border-b lg:border-b-0 lg:border-r border-[var(--color-gray-100)] max-h-[600px] overflow-y-auto">
              <StateTable />
            </div>
            {/* Party Results — leaderboard */}
            <div className="max-h-[600px] overflow-y-auto">
              <PartyResults />
            </div>
          </div>
        </div>
      </section>

      {/* Incidents — compact strip */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[24px]">
          <IncidentBar />
        </div>
      </section>

      {/* Methodology — numbered, tight */}
      <section className="border-b border-[var(--color-gray-100)]">
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[32px] md:py-[40px]">
          <h2 className="font-display font-bold text-xl md:text-2xl text-[var(--color-text)] mb-[24px]">
            How We Collect Data
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-[24px]">
            {[
              {
                step: "01",
                title: "Recruit & Verify",
                desc: "Volunteers register, verify their identity, and are confirmed as qualified observers.",
              },
              {
                step: "02",
                title: "Train & Assign",
                desc: "Volunteers complete mandatory training. Each is assigned to a specific polling unit.",
              },
              {
                step: "03",
                title: "Observe & Report",
                desc: "Observers submit structured field reports with photographic evidence where permitted.",
              },
              {
                step: "04",
                title: "Verify & Publish",
                desc: "Results are cross-checked using two-observer comparison, OCR, and mathematical validation.",
              },
            ].map((item) => (
              <div key={item.step}>
                <div className="font-mono text-xs text-[var(--color-green)] mb-[8px]">
                  {item.step}
                </div>
                <h3 className="font-display font-semibold text-base text-[var(--color-text)] mb-[6px]">
                  {item.title}
                </h3>
                <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Limitations */}
      <section>
        <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[32px] md:py-[40px]">
          <h2 className="font-display font-bold text-xl md:text-2xl text-[var(--color-text)] mb-[16px]">
            Our Limitations
          </h2>
          <div className="space-y-[12px] text-sm text-[var(--color-text-muted)] max-w-[800px]">
            <p>
              We cannot guarantee coverage of every polling unit. Some areas may
              be inaccessible due to security concerns, logistical challenges,
              or other factors.
            </p>
            <p>
              We do not determine official results. Official election results are
              declared by INEC. Our platform provides independent, parallel
              observation to complement — not replace — the official process.
            </p>
            <p>
              Anomaly detection flags unusual patterns for human review. An
              anomaly is not automatically evidence of fraud or irregularity.
            </p>
          </div>
        </div>
      </section>

      </main>
    </div>
  );
};

export default HomePage;
