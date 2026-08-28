'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function SafetyPage() {
  const [step, setStep] = useState<'initial' | 'reporting' | 'submitted'>('initial');
  const [details, setDetails] = useState('');

  const handleStopActivity = async () => {
    // TODO: Mark assignment as suspended, alert coordinator
    setStep('reporting');
  };

  const handleEmergencyReport = async () => {
    // TODO: Submit emergency incident with highest priority
    setStep('submitted');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-red-600 px-4 py-4 text-white">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-white hover:text-red-100">
            ← Back
          </Link>
          <h1 className="text-lg font-bold">Safety</h1>
        </div>
      </div>

      <div className="p-4">
        {step === 'initial' && (
          <div>
            <div className="rounded-lg bg-red-50 border border-red-200 p-6 text-center">
              <div className="text-5xl">🚨</div>
              <h2 className="mt-4 text-xl font-bold text-red-800">
                Your safety comes first
              </h2>
              <p className="mt-2 text-sm text-red-700">
                Never put yourself in danger to complete a report. It is always
                okay to leave.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <button
                onClick={handleStopActivity}
                className="w-full rounded-lg bg-red-600 py-4 text-base font-bold text-white shadow-sm hover:bg-red-700"
              >
                🛑 STOP FIELD ACTIVITY
              </button>

              <Link
                href="/report-incident"
                className="block w-full rounded-lg border-2 border-red-300 bg-white py-3 text-center text-sm font-bold text-red-700 hover:bg-red-50"
              >
                ⚠ Report Incident
              </Link>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-900">
                  Safety Reminders
                </h3>
                <ul className="mt-2 space-y-2 text-sm text-gray-600">
                  <li>• Do not confront anyone</li>
                  <li>• Do not argue with officials or security</li>
                  <li>• Leave if you feel threatened</li>
                  <li>• Move to a safe location first</li>
                  <li>• Report what happened after you are safe</li>
                  <li>• Your safety is more important than any data</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {step === 'reporting' && (
          <div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="text-sm text-amber-800">
                <strong>Field activity stopped.</strong> Your coordinator has been
                alerted. Please describe what happened so we can assist you.
              </p>
            </div>

            <div className="mt-6">
              <h2 className="text-sm font-semibold text-gray-900">
                What happened? (Optional)
              </h2>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                placeholder="Describe the situation..."
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleEmergencyReport}
              className="mt-6 w-full rounded-lg bg-red-600 py-4 text-base font-bold text-white hover:bg-red-700"
            >
              Submit Safety Report
            </button>
          </div>
        )}

        {step === 'submitted' && (
          <div className="text-center">
            <div className="text-5xl">✓</div>
            <h2 className="mt-4 text-xl font-bold text-gray-900">
              Report Submitted
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Your coordinator has been notified. You are not expected to continue
              field activity today.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-block rounded-lg bg-[var(--color-primary)] px-6 py-3 text-sm font-bold text-white hover:bg-[var(--color-primary-light)]"
            >
              Return to Dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
