import { redirect } from 'next/navigation';

/**
 * Observer app root — redirect to the public live election dashboard.
 * Observers don't need to log in; they just view the live site.
 */
export default function ObserverRootPage() {
  redirect('/dashboard');
}
