'use client';

import { useEffect } from 'react';

/**
 * Observer Login — redirects to live dashboard.
 * Observers don't need to log in; they just view the live election results.
 */
export default function LoginPage() {
  useEffect(() => {
    window.location.href = '/dashboard';
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="text-4xl mb-4">📊</div>
        <h1 className="text-xl font-bold text-gray-900">Election Observer</h1>
        <p className="mt-2 text-sm text-gray-500">
          Loading live election results...
        </p>
        <div className="mt-4">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-[#1B5E20]" />
        </div>
      </div>
    </div>
  );
}
