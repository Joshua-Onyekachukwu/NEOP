"use client";

import React from "react";
import Link from "next/link";

const Footer: React.FC = () => {
  return (
    <footer className="border-t border-[var(--color-gray-100)]">
      <div className="max-w-[1400px] mx-auto px-[16px] md:px-[24px] py-[32px] md:py-[40px]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[24px] mb-[32px]">
          {/* About */}
          <div>
            <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-[12px]">
              About
            </h3>
            <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
              Independent, evidence-backed election observation and verification for Nigeria 2027.
              Empowering trained observers to monitor polling units across all 36 states and the FCT.
            </p>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-[12px]">
              Links
            </h3>
            <ul className="space-y-[8px]">
              {[
                { href: "/#methodology", label: "Methodology" },
                { href: "/about/privacy", label: "Privacy Policy" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="font-mono text-xs text-[var(--color-text-muted)] hover:text-[var(--color-green)] transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Data Sources */}
          <div>
            <h3 className="font-display font-semibold text-sm text-[var(--color-text)] mb-[12px]">
              Data Sources
            </h3>
            <ul className="space-y-[8px]">
              {[
                "Publicly available polling unit data",
                "Result sheet photographs (where permitted)",
                "Independent field observation",
                "AI/OCR verification",
              ].map((item) => (
                <li key={item} className="font-mono text-xs text-[var(--color-text-muted)]">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="pt-[20px] border-t border-[var(--color-gray-100)] flex flex-col md:flex-row items-center justify-between gap-[12px]">
          <p className="font-mono text-[10px] text-[var(--color-text-dim)]">
            © {new Date().getFullYear()} Nigeria Election Observation Platform
          </p>
          <div className="flex items-center gap-[12px] font-mono text-[10px] text-[var(--color-text-dim)]">
            <span>Built with transparency</span>
            <span>•</span>
            <span>Open methodology</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
