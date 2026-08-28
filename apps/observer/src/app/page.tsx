import { redirect } from 'next/navigation';

/**
 * Observer app root — redirect to login or dashboard.
 * In production, check auth state and redirect accordingly.
 */
export default function ObserverRootPage() {
  redirect('/login');
}
