'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';

/** Entry point: send the visitor to their dashboard or to sign-in. */
export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [ready, user, router]);

  return <Loading label="Starting KitchenStock…" />;
}
