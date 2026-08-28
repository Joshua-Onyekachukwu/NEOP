"use client";

import React from "react";

const Disclaimer: React.FC = () => {
  return (
    <div className="bg-[var(--color-amber-bg)] border-b border-[var(--color-amber-dim)]">
      <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[10px]">
        <p className="text-center font-mono text-xs text-[var(--color-amber)]">
          <strong>Independent Observation Platform</strong> — Not affiliated with, endorsed by, or connected to INEC.
          All data is independently collected by citizen observers. Not official INEC election results.
        </p>
      </div>
    </div>
  );
};

export default Disclaimer;
