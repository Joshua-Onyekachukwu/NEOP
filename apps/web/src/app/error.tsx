"use client";

import React from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-[var(--color-ink)] flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-[var(--color-text)] mb-2 font-display">
          Something went wrong
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mb-6">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-[var(--color-green)] text-white font-mono text-sm font-bold hover:bg-[var(--color-green)]/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
