"use client";

import React from "react";
import { Skeleton } from "@/components/ui/Skeleton";

const PartyResultsSkeleton: React.FC = () => (
  <div>
    {/* Header */}
    <div className="px-[16px] md:px-[24px] py-[12px] border-b border-[var(--color-gray-100)] flex items-center justify-between">
      <div>
        <Skeleton className="h-[13px] rounded-[2px] mb-[4px]" style={{ width: "110px" }} />
        <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "160px" }} />
      </div>
      <div className="text-right">
        <Skeleton className="h-[10px] rounded-[2px] mb-[4px] ml-auto" style={{ width: "70px" }} />
        <Skeleton className="h-[18px] rounded-[2px] ml-auto" style={{ width: "80px" }} />
      </div>
    </div>

    {/* Rows */}
    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
      <div
        key={i}
        className="px-[16px] md:px-[24px] py-[10px] border-b border-[var(--color-gray-100)]"
      >
        <div className="flex items-center justify-between mb-[6px]">
          <div className="flex items-center gap-[10px]">
            <Skeleton className="w-[22px] h-[22px] rounded-full flex-shrink-0!" />
            <Skeleton className="w-[10px] h-[10px] rounded-full flex-shrink-0!" />
            <Skeleton className="h-[13px] rounded-[2px]" style={{ width: `${40 + i * 5}px` }} />
          </div>
          <div className="flex items-center gap-[12px]">
            <Skeleton className="h-[13px] rounded-[2px]" style={{ width: "55px" }} />
            <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "40px" }} />
          </div>
        </div>
        <div className="ml-[32px]">
          <Skeleton className="h-[3px] rounded-full!" style={{ width: `${100 - i * 10}%` }} />
        </div>
      </div>
    ))}

    {/* Footer */}
    <div className="px-[16px] md:px-[24px] py-[10px] border-t border-[var(--color-gray-100)] flex items-center justify-between">
      <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "120px" }} />
      <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "80px" }} />
    </div>
  </div>
);

export default PartyResultsSkeleton;
