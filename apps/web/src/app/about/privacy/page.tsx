"use client";

import React from "react";
import Link from "next/link";

const Privacy: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#0a0e19] py-[40px]">
      <div className="container mx-auto px-[12px] max-w-[800px]">
        <h1 className="text-3xl font-bold text-[#06201B] dark:text-white mb-[30px]">
          Privacy Policy
        </h1>

        <div className="space-y-[30px] text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Data We Collect
            </h2>
            <ul className="list-disc list-inside space-y-[10px]">
              <li><strong>Volunteer information:</strong> Name, email, phone number, state, LGA, and polling unit preference (for assignment purposes only).</li>
              <li><strong>Field observations:</strong> Structured reports about polling unit conditions, voting activity, and incidents.</li>
              <li><strong>Election results:</strong> Vote counts as reported by observers (not how individuals voted).</li>
              <li><strong>Evidence:</strong> Photographs of result sheets where legally permitted.</li>
              <li><strong>Device information:</strong> Minimal device metadata for security purposes.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Data We Do NOT Collect
            </h2>
            <ul className="list-disc list-inside space-y-[10px]">
              <li>How an individual voted</li>
              <li>Voter registration details</li>
              <li>Continuous location tracking</li>
              <li>Biometric data</li>
              <li>Political preferences</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              How We Use Data
            </h2>
            <ul className="list-disc list-inside space-y-[10px]">
              <li>To provide independent election observation</li>
              <li>To verify reported results through cross-checking</li>
              <li>To publish aggregated, verified data on the public dashboard</li>
              <li>To ensure observer safety and accountability</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Data Security
            </h2>
            <ul className="list-disc list-inside space-y-[10px]">
              <li>All data is encrypted in transit and at rest</li>
              <li>Access to personal data is restricted by role-based permissions</li>
              <li>Evidence files are stored in private buckets with signed URLs</li>
              <li>Audit logs track all access to sensitive data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Data Retention
            </h2>
            <ul className="list-disc list-inside space-y-[10px]">
              <li>Election data is retained for the operational period plus a defined compliance period</li>
              <li>Volunteer personal data is retained while the account is active</li>
              <li>Evidence is retained according to the evidence retention policy</li>
              <li>Audit logs are retained for compliance purposes</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Your Rights
            </h2>
            <ul className="list-disc list-inside space-y-[10px]">
              <li>Request access to your personal data</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of eligible data</li>
              <li>Withdraw consent where applicable</li>
            </ul>
          </section>

          <div className="pt-[20px] border-t border-gray-200 dark:border-[#202c4b]">
            <Link href="/" className="text-primary-600 hover:text-primary-700 font-medium">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Privacy;
