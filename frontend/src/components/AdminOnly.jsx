'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Loading } from './ui';

/** Wrap an administrator-only page; kitchen managers are sent to their dashboard. */
export default function AdminOnly({ children }) {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/dashboard');
  }, [ready, isAdmin, router]);

  if (!ready || !isAdmin) return <Loading />;
  return children;
}
