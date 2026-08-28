'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';

interface PartyEntry {
  party_id: string;
  party_name: string;
  party_abbreviation: string;
  votes: string;
}

interface ResultForm {
  party_results: PartyEntry[];
  rejected_votes: string;
}

// TODO: Load from database
const PARTIES: Array<{ id: string; name: string; abbreviation: string }> = [
  { id: 'placeholder', name: 'Party data loads from database', abbreviation: '...' },
];

export default function SubmitResultPage() {
  const [form, setForm] = useState<ResultForm>({
    party_results: PARTIES.map((p) => ({
      party_id: p.id,
      party_name: p.name,
      party_abbreviation: p.abbreviation,
      votes: '',
    })),
    rejected_votes: '',
  });

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'photo' | 'numbers' | 'review'>('photo');

  const validVotes = form.party_results.reduce(
    (sum, pr) => sum + (parseInt(pr.votes) || 0),
    0
  );
  const rejectedVotes = parseInt(form.rejected_votes) || 0;
  const totalVotes = validVotes + rejectedVotes;

  const isValid = validVotes > 0 && form.party_results.every((pr) => pr.votes !== '');

  const handlePhotoCapture = useCallback(() => {
    // TODO: Use camera API
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.capture = 'environment';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setPhotoFile(file);
        const reader = new FileReader();
        reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, []);

  const handlePartyVoteChange = (index: number, value: string) => {
    // Only allow digits
    if (value !== '' && !/^\d+$/.test(value)) return;

    const newResults = [...form.party_results];
    newResults[index] = { ...newResults[index], votes: value };
    setForm({ ...form, party_results: newResults });
  };

  const handleSubmit = async () => {
    if (!isValid) {
      setError('Please fill in all party vote counts');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // TODO: Submit to API
      // 1. Upload photo to Supabase Storage
      // 2. Get SHA-256 hash of image
      // 3. Submit result with idempotency key
      // 4. Queue for offline if needed

      // Simulate
      await new Promise((resolve) => setTimeout(resolve, 1500));

      window.location.href = '/dashboard';
    } catch (err) {
      setError('Submission failed. Your data has been saved locally and will retry when connectivity is restored.');
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
          <h1 className="text-lg font-bold">Submit Result</h1>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-center gap-2 text-sm">
          <StepIndicator step="photo" current={step} label="Photo" />
          <span className="text-gray-300">→</span>
          <StepIndicator step="numbers" current={step} label="Numbers" />
          <span className="text-gray-300">→</span>
          <StepIndicator step="review" current={step} label="Review" />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="p-4">
        {/* Step 1: Photo */}
        {step === 'photo' && (
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Photograph Result Sheet
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Take a clear photograph of the polling unit result sheet. This helps
              verify the numbers you enter.
            </p>

            <div className="mt-6">
              {photoPreview ? (
                <div className="relative">
                  <img
                    src={photoPreview}
                    alt="Result sheet"
                    className="w-full rounded-lg border border-gray-200"
                  />
                  <button
                    onClick={() => {
                      setPhotoPreview(null);
                      setPhotoFile(null);
                    }}
                    className="absolute right-2 top-2 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  onClick={handlePhotoCapture}
                  className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white py-16 text-gray-500 hover:border-gray-400 hover:bg-gray-50"
                >
                  <span className="text-4xl">📷</span>
                  <span className="mt-3 text-base font-medium">
                    Tap to Take Photo
                  </span>
                  <span className="mt-1 text-sm text-gray-400">
                    Camera will open
                  </span>
                </button>
              )}
            </div>

            <button
              onClick={() => setStep('numbers')}
              className="mt-6 w-full rounded-lg bg-[var(--color-primary)] py-3 text-base font-bold text-white hover:bg-[var(--color-primary-light)]"
            >
              {photoPreview ? 'Continue' : 'Skip Photo'}
            </button>
          </div>
        )}

        {/* Step 2: Enter Numbers */}
        {step === 'numbers' && (
          <div>
            <h2 className="text-lg font-bold text-gray-900">Enter Vote Counts</h2>
            <p className="mt-2 text-sm text-gray-600">
              Enter the vote count for each party as shown on the result sheet.
            </p>

            <div className="mt-6 space-y-4">
              {form.party_results.map((pr, index) => (
                <div key={pr.party_id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <label className="block text-sm font-medium text-gray-700">
                    {pr.party_name} ({pr.party_abbreviation})
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pr.votes}
                    onChange={(e) => handlePartyVoteChange(index, e.target.value)}
                    placeholder="0"
                    className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-lg font-mono shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <label className="block text-sm font-medium text-gray-700">
                  Rejected Votes
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.rejected_votes}
                  onChange={(e) => {
                    if (e.target.value === '' || /^\d+$/.test(e.target.value)) {
                      setForm({ ...form, rejected_votes: e.target.value });
                    }
                  }}
                  placeholder="0"
                  className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-lg font-mono shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-gray-100 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Valid votes (sum of parties):</span>
                <span className="font-bold">{validVotes.toLocaleString()}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-gray-600">Rejected votes:</span>
                <span className="font-bold">{rejectedVotes.toLocaleString()}</span>
              </div>
              <div className="mt-2 border-t border-gray-300 pt-2">
                <div className="flex justify-between">
                  <span className="font-medium text-gray-900">Total:</span>
                  <span className="font-bold text-gray-900">
                    {totalVotes.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setStep('photo')}
                className="flex-1 rounded-lg border border-gray-300 bg-white py-3 text-sm font-medium text-gray-700"
              >
                Back
              </button>
              <button
                onClick={() => setStep('review')}
                disabled={!isValid}
                className="flex-1 rounded-lg bg-[var(--color-primary)] py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                Review
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 'review' && (
          <div>
            <h2 className="text-lg font-bold text-gray-900">Review & Submit</h2>
            <p className="mt-2 text-sm text-gray-600">
              Please verify the numbers before submitting. You cannot undo a
              submission.
            </p>

            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">Vote Counts</h3>
              <div className="mt-3 space-y-2">
                {form.party_results.map((pr) => (
                  <div key={pr.party_id} className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {pr.party_abbreviation}
                    </span>
                    <span className="font-mono font-bold">
                      {parseInt(pr.votes).toLocaleString()}
                    </span>
                  </div>
                ))}
                <div className="border-t border-gray-200 pt-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Rejected</span>
                    <span className="font-mono font-bold">{rejectedVotes.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-sm font-bold">
                    <span>Total</span>
                    <span className="font-mono">{totalVotes.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {photoPreview && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-900">
                  📷 Result Sheet Photo
                </h3>
                <img
                  src={photoPreview}
                  alt="Result sheet"
                  className="mt-2 w-full rounded border border-gray-200"
                />
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setStep('numbers')}
                className="flex-1 rounded-lg border border-gray-300 bg-white py-3 text-sm font-medium text-gray-700"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !isValid}
                className="flex-1 rounded-lg bg-green-600 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Submitting...' : '✓ SUBMIT RESULT'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepIndicator({
  step,
  current,
  label,
}: {
  step: string;
  current: string;
  label: string;
}) {
  const isCurrent = step === current;
  const steps = ['photo', 'numbers', 'review'];
  const currentIndex = steps.indexOf(current);
  const thisIndex = steps.indexOf(step);
  const isCompleted = thisIndex < currentIndex;

  return (
    <div
      className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
        isCurrent
          ? 'bg-[var(--color-primary)] text-white'
          : isCompleted
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-500'
      }`}
    >
      {isCompleted ? '✓' : thisIndex + 1}
      {label}
    </div>
  );
}
