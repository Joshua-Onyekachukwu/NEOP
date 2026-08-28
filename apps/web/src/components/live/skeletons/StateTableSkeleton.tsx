"use client";

import React from "react";
import { Skeleton } from "@/components/ui/Skeleton";

const StateTableSkeleton: React.FC = () => (
  <div>
    {/* Header */}
    <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] flex items-center justify-between">
      <Skeleton className="h-[13px] rounded-[2px]" style={{ width: "110px" }} />
      <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "80px" }} />
    </div>

    {/* Table header */}
    <div className="px-[16px] md:px-[24px] py-[8px] border-b border-[var(--color-gray-100)] flex justify-between">
      <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "40px" }} />
      <div className="flex gap-[24px]">
        {["30px", "30px", "30px", "40px"].map((w, i) => (
          <Skeleton key={i} className="h-[10px] rounded-[2px]" style={{ width: w }} />
        ))}
      </div>
    </div>

    {/* Rows */}
    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
      <div
        key={i}
        className="px-[16px] md:px-[24px] py-[10px] border-b border-[var(--color-gray-100)] flex items-center justify-between"
      >
        <div className="flex items-center gap-[8px]">
          <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "18px" }} />
          <div>
            <Skeleton className="h-[13px] rounded-[2px] mb-[4px]" style={{ width: `${70 + i * 10}px` }} />
            <Skeleton className="h-[8px] rounded-[2px]" style={{ width: "20px" }} />
          </div>
        </div>
        <div className="flex items-center gap-[20px]">
          <Skeleton className="h-[13px] rounded-[2px]" style={{ width: "30px" }} />
          <Skeleton className="h-[13px] rounded-[2px]" style={{ width: "20px" }} />
          <Skeleton className="h-[13px] rounded-[2px]" style={{ width: "20px" }} />
          <div className="flex items-center gap-[8px]">
            <Skeleton className="h-[3px] rounded-full!" style={{ width: "60px" }} />
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "35px" }} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

export default StateTableSkeleton;
