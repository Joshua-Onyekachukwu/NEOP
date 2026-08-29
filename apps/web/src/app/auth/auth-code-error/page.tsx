"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const AuthCodeError: React.FC = () => {
  const searchParams = useSearchParams();
  const error = searchParams?.get("error") || "Unknown error";

  return (
    <div className="min-h-screen bg-[var(--color-ink)] flex items-center justify-center p-[20px]">
      <div className="text-center max-w-[400px]">
        <div className="text-5xl mb-[20px]">⚠️</div>
        <h1 className="text-xl font-bold text-[var(--color-text)] mb-[10px]">
          Authentication Error
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mb-[10px]">
          There was an error signing you in. Please try again.
        </p>
        <div className="p-3 bg-[var(--color-red-dim)] border border-[var(--color-red)] text-[var(--color-red-bright)] text-xs font-mono mb-[20px]">
          {decodeURIComponent(error)}
        </div>
        <Link
          href="/agent/login"
          className="inline-block px-[20px] py-[12px] bg-[var(--color-green)] text-white rounded font-bold hover:bg-[var(--color-green-dim)] transition-colors font-mono text-sm"
        >
          Try Again
        </Link>
      </div>
    </div>
  );
};

export default AuthCodeError;
