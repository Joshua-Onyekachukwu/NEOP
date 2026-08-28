'use client';

import { useState, useEffect } from 'react';

type AssignmentStatus = 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'SUBMITTED';

interface Assignment {
  id: string;
  polling_unit_name: string;
  polling_unit_code: string;
  state: string;
  lga: string;
  ward: string;
  election_name: string;
  observer_number: number;
  status: AssignmentStatus;
  has_submitted_result: boolean;
  check_in_time: string | null;
}

interface QuickActionsProps {
  assignment: Assignment;
  onCheckIn: () => void;
  onSubmitResult: () => void;
  onReportIncident: () => void;
  onFeelUnsafe: () => void;
  onCheckOut: () => void;
}

export default function ObserverDashboard() {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [queuedSubmissions, setQueuedSubmissions] = useState(0);

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // TODO: Load assignment from Supabase
  // const { data: assignment } = useQuery(api.observer.getMyAssignment);

  const handleCheckIn = async () => {
    // TODO: Submit check-in with optional location
    // await fetch('/api/me/check-in', { ... });
    if (assignment) {
      setAssignment({ ...assignment, status: 'CHECKED_IN', check_in_time: new Date().toISOString() });
    }
  };

  const handleSubmitResult = () => {
    window.location.href = '/submit-result';
  };

  const handleReportIncident = () => {
    window.location.href = '/report-incident';
  };

  const handleFeelUnsafe = () => {
    window.location.href = '/safety';
  };

  const handleCheckOut = async () => {
    // TODO: Submit check-out
    if (assignment) {
      setAssignment({ ...assignment, status: 'NOT_CHECKED_IN' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Offline banner */}
      {!isOnline && (
        <div className="offline-banner">
          ⚠ Offline — Submissions will be queued and sent when connectivity is
          restored
        </div>
      )}

      {/* Header */}
      <div className="bg-[var(--color-primary)] px-4 py-4 text-white">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">My Assignment</h1>
          <div className="flex items-center gap-2">
            {queuedSubmissions > 0 && (
              <div className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold">
                {queuedSubmissions} queued
              </div>
            )}
            <div
              className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-red-400'}`}
            />
          </div>
        </div>
      </div>

      {assignment ? (
        <div className="p-4">
          {/* Assignment Card */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {assignment.polling_unit_name}
                </h2>
                <p className="text-sm text-gray-500">
                  {assignment.polling_unit_code}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  assignment.status === 'CHECKED_IN'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {assignment.status === 'CHECKED_IN' ? 'CHECKED IN' : 'NOT CHECKED IN'}
              </span>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">State:</span>
                <span className="font-medium">{assignment.state}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">LGA:</span>
                <span className="font-medium">{assignment.lga}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Ward:</span>
                <span className="font-medium">{assignment.ward}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Observer:</span>
                <span className="font-medium">#{assignment.observer_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Election:</span>
                <span className="font-medium">{assignment.election_name}</span>
              </div>
              {assignment.check_in_time && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Checked in:</span>
                  <span className="font-medium">
                    {new Date(assignment.check_in_time).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-6 space-y-3">
            {assignment.status !== 'CHECKED_IN' ? (
              <button
                onClick={handleCheckIn}
                className="w-full touch-target rounded-lg bg-[var(--color-primary)] py-4 text-base font-bold text-white shadow-sm hover:bg-[var(--color-primary-light)] active:bg-[var(--color-primary-dark)]"
              >
                ✓ CHECK IN
              </button>
            ) : (
              <>
                <button
                  onClick={handleSubmitResult}
                  className="w-full touch-target rounded-lg bg-green-600 py-4 text-base font-bold text-white shadow-sm hover:bg-green-700 active:bg-green-800"
                >
                  📊 SUBMIT RESULT
                </button>

                <button
                  onClick={handleReportIncident}
                  className="w-full touch-target rounded-lg border-2 border-orange-400 bg-white py-4 text-base font-bold text-orange-700 shadow-sm hover:bg-orange-50"
                >
                  ⚠ REPORT INCIDENT
                </button>

                <button
                  onClick={handleCheckOut}
                  className="w-full touch-target rounded-lg border border-gray-300 bg-white py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Check Out
                </button>
              </>
            )}
          </div>

          {/* Safety Button */}
          <div className="mt-8">
            <button onClick={handleFeelUnsafe} className="emergency-btn">
              🚨 I FEEL UNSAFE
            </button>
            <p className="mt-2 text-center text-xs text-gray-500">
              This will stop your field activity and alert your coordinator
            </p>
          </div>

          {/* Offline Status */}
          {queuedSubmissions > 0 && (
            <div className="mt-4">
              <div className="queued-indicator">
                {queuedSubmissions} submission{queuedSubmissions !== 1 ? 's' : ''}{' '}
                queued for upload
              </div>
            </div>
          )}
        </div>
      ) : (
        /* No Assignment */
        <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
          <div className="text-4xl">📋</div>
          <h2 className="mt-4 text-lg font-bold text-gray-900">No Assignment</h2>
          <p className="mt-2 text-sm text-gray-500">
            You don&apos;t have an active polling unit assignment yet. Check back
            closer to election day or contact your coordinator.
          </p>
        </div>
      )}
    </div>
  );
}
