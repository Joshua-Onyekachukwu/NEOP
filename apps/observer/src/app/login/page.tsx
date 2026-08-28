'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: Implement Supabase Google OAuth
      // const { data, error } = await supabase.auth.signInWithOAuth({
      //   provider: 'google',
      //   options: {
      //     redirectTo: `${window.location.origin}/auth/callback`,
      //   },
      // });

      // Placeholder
      window.location.href = '/dashboard';
    } catch (err) {
      setError('Login failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white text-2xl font-bold">
            EO
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">Election Observer</h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign in to access your assignment
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Google Sign-In */}
        <button
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {isLoading ? (
            <div className="spinner" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
          )}
          {isLoading ? 'Signing in...' : 'Sign in with Google'}
        </button>

        {/* Note */}
        <p className="mt-6 text-center text-xs text-gray-500">
          Google sign-in establishes your application account. It is not election
          observer accreditation. Accreditation is a separate INEC process.
        </p>

        {/* Offline indicator */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">
            The observer app works offline. Queued submissions will sync when
            connectivity is restored.
          </p>
        </div>
      </div>
    </div>
  );
}
