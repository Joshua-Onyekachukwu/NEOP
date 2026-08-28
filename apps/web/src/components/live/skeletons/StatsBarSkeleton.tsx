"use client";

import React from "react";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

const StatsBarSkeleton: React.FC = () => (
  <div className="flex flex-wrap items-stretch divide-x divide-[var(--color-gray-100)]">
    {[1, 2, 3, 4].map((i) => (
      <div key={i} className="flex-1 min-w-[140px] py-[16px] px-[16px]">
        <SkeletonText width="45%" className="mb-[8px] h-[11px]!" />
        <Skeleton className="h-[28px] rounded-[2px] mb-[6px]" style={{ width: "55%" }} />
        <SkeletonText width="35%" className="h-[10px]!" />
      </div>
    ))}
  </div>
);

export default StatsBarSkeleton;
