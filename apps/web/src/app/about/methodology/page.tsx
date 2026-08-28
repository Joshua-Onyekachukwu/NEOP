"use client";

import React from "react";
import Link from "next/link";

const Methodology: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#0a0e19] py-[40px]">
      <div className="container mx-auto px-[12px] max-w-[800px]">
        <h1 className="text-3xl font-bold text-[#06201B] dark:text-white mb-[30px]">
          Our Methodology
        </h1>

        <div className="space-y-[30px] text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Overview
            </h2>
            <p className="mb-[15px]">
              This platform enables an appropriately constituted and legally compliant election-observation organization to recruit, verify, and train volunteers; assign them to specific polling units; collect structured field observations; capture evidence where legally permitted; verify reported results through multiple independent checks; and publish verified data on a public dashboard.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Observer Recruitment
            </h2>
            <p className="mb-[15px]">
              Volunteers register through the platform and undergo identity verification. Google authentication establishes an application account; it is not election-observer accreditation. Volunteers must complete training on observation protocols, neutrality, safety, and evidence collection before they are activated for field duty.
            </p>
            <p className="mb-[15px]">
              <strong>Important:</strong> INEC&apos;s current guidance states that domestic and international observers are appointed by their organizations and accredited by INEC. Accredited observers must wear INEC-issued observer badges at polling stations. Our volunteers are not automatically INEC-accredited observers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Polling Unit Assignment
            </h2>
            <p className="mb-[15px]">
              Each volunteer is assigned to a specific polling unit. During result submission, the system automatically knows the volunteer&apos;s assigned polling unit — volunteers cannot submit results for an arbitrary polling unit. Where possible, two independent observers are assigned to the same polling unit to provide independent cross-checks.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Data Collection
            </h2>
            <p className="mb-[15px]">
              Observers submit structured reports covering: polling-unit opening procedures, voting activity, counting, result announcement, and any incidents. Where legally permitted and safe, observers photograph polling-unit result sheets. Every submission is tied to a specific election, polling unit, observer, and timestamp.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Verification Process
            </h2>
            <p className="mb-[15px]">Reported results undergo multiple independent checks:</p>
            <ul className="list-disc list-inside space-y-[10px] mb-[15px]">
              <li>
                <strong>Mathematical validation:</strong> The system automatically verifies that the sum of party votes equals valid votes, and that valid votes plus rejected votes equals the total.
              </li>
              <li>
                <strong>Two-observer comparison:</strong> When two observers report the same polling unit, their reported numbers are compared. Discrepancies are flagged for review.
              </li>
              <li>
                <strong>AI/OCR verification:</strong> Photographed result sheets are processed using optical character recognition. Extracted numbers are compared against the observer&apos;s typed entry.
              </li>
              <li>
                <strong>Human review:</strong> AI assists verification; humans make consequential decisions. Anomaly detection flags unusual patterns for human review — anomalies are not automatically treated as fraud.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Confidence Levels
            </h2>
            <p className="mb-[15px]">Each published result carries a confidence label:</p>
            <ul className="list-disc list-inside space-y-[10px] mb-[15px]">
              <li>
                <strong>HIGH:</strong> Observer A and B match, image uploaded, OCR matches, math validates, location verified
              </li>
              <li>
                <strong>MEDIUM:</strong> One observer, image uploaded, math validates
              </li>
              <li>
                <strong>LOW:</strong> Single observer entry only, limited verification
              </li>
              <li>
                <strong>UNDER REVIEW:</strong> Discrepancies detected, pending human review
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Limitations
            </h2>
            <ul className="list-disc list-inside space-y-[10px] mb-[15px]">
              <li>We cannot guarantee coverage of every polling unit.</li>
              <li>No submission does not prove an election did not occur.</li>
              <li>AI verification assists human review but does not provide definitive proof of document authenticity.</li>
              <li>Partial coverage should not be interpreted as final results.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Independence
            </h2>
            <p className="mb-[15px]">
              This platform operates independently of all political parties, candidates, and the government. Our observation methodology is designed to be impartial, objective, and non-partisan. We do not determine official results.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Official Results
            </h2>
            <p className="mb-[15px]">
              Official election results are declared by the Independent National Electoral Commission (INEC). This platform provides independent, parallel observation to complement — not replace — the official process.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#06201B] dark:text-white mb-[15px]">
              Data Privacy
            </h2>
            <p className="mb-[15px]">
              We collect the minimum personal information necessary for election observation. Volunteer identity information is stored separately from public observation data. We never collect or store how an individual voted. Our data practices are guided by Nigeria&apos;s data protection framework.
            </p>
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

export default Methodology;
