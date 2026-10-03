'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { PastBillForm } from '@/components/PastBillForm';
import { useAction } from '@/lib/hooks';
import { api } from '@/lib/api';
import { Button, useToast } from '@/components/ui';

export default function NewPastBillPage() {
  return (
    <AdminOnly>
      <NewPastBill />
    </AdminOnly>
  );
}

function NewPastBill() {
  const router = useRouter();
  const toast = useToast();
  const { run, loading } = useAction();
  const [error, setError] = useState(null);

  async function save(body) {
    setError(null);
    try {
      const result = await run(() => api.post('/past-bills', body));
      toast.success(result.message);
      router.push('/past-bills');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Layout
      title="Add a Past Bill"
      subtitle="Type in an old bill so it is on file. It will not change your stock."
      actions={<Button onClick={() => router.push('/past-bills')}>Back to bills</Button>}
    >
      <PastBillForm saving={loading} error={error} onSubmit={save} onCancel={() => router.push('/past-bills')} />
    </Layout>
  );
}
