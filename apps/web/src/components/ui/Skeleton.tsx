import React from "react";

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

/** Minimal shimmer block — one div, one animation, no JS. */
export const Skeleton: React.FC<SkeletonProps> = ({ className = "", style }) => (
  <div
    className={`relative overflow-hidden bg-[var(--color-gray-100)] ${className}`}
    style={style}
    aria-hidden="true"
  >
    <div className="skeleton-shimmer" />
  </div>
);

/** Text-shaped skeleton: label + value line */
export const SkeletonText: React.FC<{ width?: string; className?: string }> = ({
  width = "60%",
  className = "",
}) => (
  <Skeleton className={`h-[12px] rounded-[2px] ${className}`} style={{ width }} />
);

/** Stat block skeleton: label, big number, sub-label */
export const SkeletonStat: React.FC = () => (
  <div className="py-[16px]">
    <SkeletonText width="45%" className="mb-[8px]" />
    <Skeleton className="h-[28px] rounded-[2px] mb-[6px]" style={{ width: "55%" }} />
    <SkeletonText width="35%" />
  </div>
);

/** Row skeleton for tables and feeds */
export const SkeletonRow: React.FC<{ lines?: number; className?: string }> = ({
  lines = 2,
  className = "",
}) => (
  <div className={`py-[12px] space-y-[6px] ${className}`}>
    <Skeleton className="h-[14px] rounded-[2px]" style={{ width: "70%" }} />
    {lines > 1 && (
      <div className="flex gap-[12px]">
        <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "30%" }} />
        <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "20%" }} />
      </div>
    )}
    {lines > 2 && (
      <Skeleton className="h-[10px] rounded-[2px]" style={{ width: "45%" }} />
    )}
  </div>
);
