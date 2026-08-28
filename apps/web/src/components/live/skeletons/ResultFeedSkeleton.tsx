"use client";

import React from "react";
import { Skeleton } from "@/components/ui/Skeleton";

const ResultFeedSkeleton: React.FC = () => (
  <div className="flex flex-col h-full">
    {/* Header */}
    <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] flex items-center justify-between">
      <Skeleton className="h-[13px] rounded-[2px]" style={{ width: "120px" }} />
      <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "60px" }} />
    </div>

    {/* Result rows */}
    <div className="flex-1 overflow-y-auto max-h-[600px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)]"
        >
          {/* PU code + confidence */}
          <div className="flex items-center justify-between mb-[8px]">
            <div className="flex items-center gap-[8px]">
              <Skeleton className="h-[13px] rounded-[2px]" style={{ width: "80px" }} />
              <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "55px" }} />
            </div>
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "50px" }} />
          </div>

          {/* Party dots row */}
          <div className="flex gap-[12px] mb-[8px]">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => (
              <div key={j} className="flex items-center gap-[4px]">
                <Skeleton className="w-[8px] h-[8px] rounded-full flex-shrink-0!" />
                <Skeleton className="h-[10px] rounded-[2px]" style={{ width: `${28 + j * 3}px` }} />
              </div>
            ))}
          </div>

          {/* Vote totals */}
          <div className="flex gap-[12px]">
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "45px" }} />
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "35px" }} />
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "50px" }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default ResultFeedSkeleton;
