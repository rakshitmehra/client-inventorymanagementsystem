'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';
import AppFrame from '@/components/AppFrame';

/**
 * Guard for every signed-in route. Individual pages add their own role checks
 * with <AdminOnly>; this only establishes that somebody is signed in.
 *
 * It also holds the app shell. A layout stays mounted as you move between the
 * routes inside it, so putting the sidebar here is what lets it keep its
 * scroll position instead of being rebuilt - and reset to the top - on every
 * navigation.
 */
export default function ProtectedLayout({ children }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  if (!ready) return <Loading label="Restoring your session…" />;
  if (!user) return <Loading label="Redirecting to sign-in…" />;

  return <AppFrame>{children}</AppFrame>;
}
