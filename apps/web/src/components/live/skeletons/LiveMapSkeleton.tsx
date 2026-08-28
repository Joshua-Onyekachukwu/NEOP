"use client";

import React from "react";
import { Skeleton } from "@/components/ui/Skeleton";

const LiveMapSkeleton: React.FC = () => (
  <div className="relative">
    {/* Map area */}
    <Skeleton className="w-full h-[400px] md:h-[500px] rounded-none!" />

    {/* Legend placeholder */}
    <div className="absolute top-3 left-3 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] p-3 z-10">
      <Skeleton className="h-[10px] rounded-[2px] mb-3" style={{ width: "50px" }} />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="w-[10px] h-[10px] rounded-full flex-shrink-0!" />
            <Skeleton className="h-[8px] rounded-[2px]" style={{ width: `${50 + i * 8}px` }} />
          </div>
        ))}
      </div>
    </div>

    {/* Count placeholder */}
    <div className="absolute bottom-3 right-3 bg-[var(--color-ink)]/90 border border-[var(--color-gray-100)] px-3 py-1.5 z-10">
      <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "110px" }} />
    </div>
  </div>
);

export default LiveMapSkeleton;
