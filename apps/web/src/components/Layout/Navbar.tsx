"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const Navbar: React.FC = () => {
  const pathname = usePathname();
  const [isSticky, setIsSticky] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsSticky(window.scrollY > 80);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isAdmin = pathname?.startsWith("/admin") ?? false;
  const isAgent = pathname?.startsWith("/agent") ?? false;

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all ${
        isSticky || mobileOpen
          ? "bg-[var(--color-ink)] border-b border-[var(--color-gray-100)]"
          : "bg-[var(--color-ink)]/90 backdrop-blur-sm"
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px]">
        <div className="flex items-center justify-between h-[56px]">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-[8px]">
            <span className="font-display font-bold text-base text-[var(--color-text)]">
              NG<span className="text-[var(--color-green)]">EO</span>
            </span>
            {!isAdmin && !isAgent && (
              <span className="hidden sm:inline font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
                Live Election Data
              </span>
            )}
            {isAdmin && (
              <span className="hidden sm:inline font-mono text-[10px] text-[var(--color-amber)] uppercase tracking-wider">
                Admin
              </span>
            )}
            {isAgent && (
              <span className="hidden sm:inline font-mono text-[10px] text-[var(--color-blue)] uppercase tracking-wider">
                Agent
              </span>
            )}
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-[20px]">
            {/* Live page link — always visible */}
            <Link
              href="/"
              className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center gap-[6px]"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green-bright)] animate-pulse" />
              LIVE
            </Link>

            {/* Public page: show Agent + Admin links */}
            {!isAdmin && !isAgent && (
              <>
                <Link
                  href="/agent/login"
                  className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                  Agent
                </Link>
                <Link
                  href="/admin/login"
                  className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                  Admin
                </Link>
              </>
            )}

            {/* Admin page: show Dashboard + Agent links */}
            {isAdmin && (
              <Link
                href="/admin/dashboard"
                className={`font-mono text-xs transition-colors ${
                  pathname === "/admin/dashboard"
                    ? "text-[var(--color-amber)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                Dashboard
              </Link>
            )}

            {/* Agent page: show Dashboard link */}
            {isAgent && (
              <Link
                href="/agent/dashboard"
                className={`font-mono text-xs transition-colors ${
                  pathname === "/agent/dashboard"
                    ? "text-[var(--color-blue)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                Dashboard
              </Link>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden flex flex-col gap-[4px] p-[8px]"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <span className={`w-[18px] h-[1.5px] bg-[var(--color-text-muted)] transition-transform ${mobileOpen ? "rotate-45 translate-y-[5.5px]" : ""}`} />
            <span className={`w-[18px] h-[1.5px] bg-[var(--color-text-muted)] transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
            <span className={`w-[18px] h-[1.5px] bg-[var(--color-text-muted)] transition-transform ${mobileOpen ? "-rotate-45 -translate-y-[5.5px]" : ""}`} />
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden pb-[16px] border-t border-[var(--color-gray-100)] bg-[var(--color-ink)]">
            {/* Live link — always first */}
            <Link
              href="/"
              className="flex items-center gap-[8px] py-[12px] font-mono text-sm border-b border-[var(--color-gray-100)] text-[var(--color-green-bright)]"
              onClick={() => setMobileOpen(false)}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green-bright)] animate-pulse" />
              LIVE
            </Link>

            {!isAdmin && !isAgent && (
              <>
                <Link
                  href="/agent/login"
                  className="block py-[12px] font-mono text-sm border-b border-[var(--color-gray-100)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  onClick={() => setMobileOpen(false)}
                >
                  Agent Portal
                </Link>
                <Link
                  href="/admin/login"
                  className="block py-[12px] font-mono text-sm border-b border-[var(--color-gray-100)] last:border-b-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  onClick={() => setMobileOpen(false)}
                >
                  Admin Portal
                </Link>
              </>
            )}

            {isAdmin && (
              <Link
                href="/admin/dashboard"
                className="block py-[12px] font-mono text-sm border-b border-[var(--color-gray-100)] last:border-b-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                onClick={() => setMobileOpen(false)}
              >
                Admin Dashboard
              </Link>
            )}

            {isAgent && (
              <Link
                href="/agent/dashboard"
                className="block py-[12px] font-mono text-sm border-b border-[var(--color-gray-100)] last:border-b-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                onClick={() => setMobileOpen(false)}
              >
                Agent Dashboard
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
