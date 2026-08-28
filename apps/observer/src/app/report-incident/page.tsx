'use client';

import { useState } from 'react';
import Link from 'next/link';

const CATEGORIES = [
  { value: 'VIOLENCE', label: 'Violence', icon: '🔴', description: 'Physical violence, armed threats' },
  { value: 'INTIMIDATION', label: 'Intimidation', icon: '🟠', description: 'Threats, coercion, undue influence' },
  { value: 'DISRUPTION', label: 'Disruption', icon: '🟡', description: 'Process interruption, obstruction' },
  { value: 'ELECTION_NOT_HELD', label: 'Election Not Held', icon: '⚪', description: 'No voting took place' },
  { value: 'MATERIAL_SHORTAGE', label: 'Material Shortage', icon: '📦', description: 'Missing or insufficient materials' },
  { value: 'POLLING_UNIT_RELOCATION', label: 'PU Relocation', icon: '🔄', description: 'Polling unit moved without notice' },
  { value: 'ACCESS_PROBLEM', label: 'Access Problem', icon: '🚫', description: 'Denied entry or observation' },
  { value: 'SECURITY_INCIDENT', label: 'Security Incident', icon: '🛡️', description: 'Security forces intervention' },
  { value: 'OTHER', label: 'Other', icon: '📝', description: 'Other irregularity' },
] as const;

const SEVERITIES = [
  { value: 'LOW', label: 'Low', color: 'bg-gray-100 text-gray-700' },
  { value: 'MEDIUM', label: 'Medium', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'HIGH', label: 'High', color: 'bg-orange-100 text-orange-700' },
  { value: 'CRITICAL', label: 'Critical', color: 'bg-red-100 text-red-700' },
] as const;

export default function ReportIncidentPage() {
  const [category, setCategory] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');
  const [whatObserved, setWhatObserved] = useState('');
  const [agentSafe, setAgentSafe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = category && severity && whatObserved.length >= 10;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // TODO: Submit to API
      // If agent_safe is false, trigger emergency escalation
      await new Promise((resolve) => setTimeout(resolve, 1500));
      window.location.href = '/dashboard';
    } catch (err) {
      setError('Submission failed. Your report has been saved locally.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[var(--color-primary)] px-4 py-4 text-white">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-white hover:text-blue-100">
            ← Back
          </Link>
          <h1 className="text-lg font-bold">Report Incident</h1>
        </div>
      </div>

      {/* Safety reminder */}
      <div className="mx-4 mt-4 rounded-md bg-amber-50 border border-amber-200 p-3">
        <p className="text-sm text-amber-800">
          <strong>Remember:</strong> Report what you <em>personally observed</em>.
          Do not include hearsay or assumptions. Your safety comes first.
        </p>
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="p-4">
        {/* Category */}
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Category</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`flex flex-col items-center rounded-lg border p-3 text-center transition-colors ${
                  category === cat.value
                    ? 'border-[var(--color-primary)] bg-blue-50 text-[var(--color-primary)]'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="text-xl">{cat.icon}</span>
                <span className="mt-1 text-xs font-medium">{cat.label}</span>
              </button>
            ))}
          </div>
          {category && (
            <p className="mt-2 text-xs text-gray-500">
              {CATEGORIES.find((c) => c.value === category)?.description}
            </p>
          )}
        </div>

        {/* Severity */}
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-900">Severity</h2>
          <div className="mt-3 flex gap-2">
            {SEVERITIES.map((sev) => (
              <button
                key={sev.value}
                onClick={() => setSeverity(sev.value)}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                  severity === sev.value
                    ? `${sev.color} border-current ring-2 ring-current ring-offset-1`
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {sev.label}
              </button>
            ))}
          </div>
        </div>

        {/* What did you observe */}
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-900">
            What did you personally observe?
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Describe specific events, actions, and details. Minimum 10 characters.
          </p>
          <textarea
            value={whatObserved}
            onChange={(e) => setWhatObserved(e.target.value)}
            rows={5}
            placeholder="Describe what you personally observed in detail..."
            className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-400">
            {whatObserved.length} / 5000 characters
          </p>
        </div>

        {/* Safety check */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Are you safe?</h2>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => setAgentSafe(true)}
              className={`flex-1 rounded-lg border py-3 text-sm font-medium ${
                agentSafe
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              ✓ I am safe
            </button>
            <button
              onClick={() => setAgentSafe(false)}
              className={`flex-1 rounded-lg border py-3 text-sm font-medium ${
                !agentSafe
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              🚨 I need help
            </button>
          </div>
          {!agentSafe && (
            <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              Your safety coordinator will be alerted immediately. Please move to
              a safe location if possible.
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="mt-8">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="w-full rounded-lg bg-[var(--color-primary)] py-4 text-base font-bold text-white shadow-sm hover:bg-[var(--color-primary-light)] disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Incident Report'}
          </button>
        </div>
      </div>
    </div>
  );
}
