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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const links = [
    { href: "/", label: "Home" },
    { href: "/#dashboard", label: "Dashboard" },
    { href: "/#map", label: "Map" },
    { href: "/#methodology", label: "Methodology" },
  ];

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
            <span className="hidden sm:inline font-mono text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
              Election Observation
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-[24px]">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`font-mono text-xs transition-colors ${
                  pathname === link.href
                    ? "text-[var(--color-green)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {link.label}
              </Link>
            ))}
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
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`block py-[12px] font-mono text-sm border-b border-[var(--color-gray-100)] last:border-b-0 ${
                  pathname === link.href
                    ? "text-[var(--color-green)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
