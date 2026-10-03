'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { ConfirmButton } from '@/components/ConfirmButton';
import { PastBillForm } from '@/components/PastBillForm';
import { useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { date, dateTime, money, num } from '@/lib/format';
import { Alert, Button, Loading, useToast } from '@/components/ui';

export default function PastBillPage() {
  return (
    <AdminOnly>
      <PastBill />
    </AdminOnly>
  );
}

function PastBill() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { run, loading: busy } = useAction();
  const { data, loading, error, reload } = useFetch(`/past-bills/${id}`);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const bill = data?.data;

  async function save(body) {
    setSaveError(null);
    try {
      const result = await run(() => api.put(`/past-bills/${id}`, body));
      toast.success(result.message);
      setEditing(false);
      reload();
    } catch (err) {
      setSaveError(err);
    }
  }

  async function remove() {
    try {
      const result = await run(() => api.del(`/past-bills/${id}`));
      toast.success(result.message);
      router.push('/past-bills');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) {
    return (
      <Layout title="Past Bill">
        <Loading />
      </Layout>
    );
  }
  if (error || !bill) {
    return (
      <Layout title="Past Bill" actions={<Button onClick={() => router.push('/past-bills')}>Back to bills</Button>}>
        <Alert tone="error">{error?.message ?? 'This bill could not be found.'}</Alert>
      </Layout>
    );
  }

  if (editing) {
    return (
      <Layout
        title={`Change ${bill.bill_no}`}
        subtitle={bill.supplier_name}
        actions={<Button onClick={() => setEditing(false)}>Cancel</Button>}
      >
        <PastBillForm
          bill={bill}
          saving={busy}
          error={saveError}
          submitLabel="Save changes"
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      </Layout>
    );
  }

  return (
    <Layout
      title={bill.bill_no}
      subtitle={`${bill.supplier_name} · ${date(bill.bill_date)}`}
      actions={
        <>
          <Button onClick={() => router.push('/past-bills')}>Back to bills</Button>
          <Button icon="edit" onClick={() => setEditing(true)}>
            Change
          </Button>
          <ConfirmButton
            variant="danger"
            title="Delete this bill?"
            message={`${bill.bill_no} from ${bill.supplier_name} will be removed from your records. This cannot be undone.`}
            confirmLabel="Yes, delete it"
            tone="danger"
            loading={busy}
            onConfirm={remove}
          >
            Delete
          </ConfirmButton>
        </>
      }
    >
      <div className="card mb-16">
        <div className="card-body">
          <dl className="kv">
            <dt>Bought from</dt>
            <dd>{bill.supplier_name}</dd>
            <dt>Bill number</dt>
            <dd>{bill.invoice_no || '—'}</dd>
            <dt>Date on the bill</dt>
            <dd>{date(bill.bill_date)}</dd>
            <dt>Total</dt>
            <dd>
              <strong>{money(bill.total_amount)}</strong>
            </dd>
            {bill.notes && (
              <>
                <dt>Notes</dt>
                <dd>{bill.notes}</dd>
              </>
            )}
            <dt>Added</dt>
            <dd>
              {dateTime(bill.created_at)}
              {bill.created_by_name ? ` by ${bill.created_by_name}` : ''}
            </dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>What was on it</h3>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  How much
                </th>
                <th scope="col" className="num">
                  Price each
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((line) => (
                <tr key={line.id}>
                  <td data-label="Item">{line.item_name}</td>
                  <td data-label="How much" className="num">
                    {num(line.quantity)} {line.unit}
                  </td>
                  <td data-label="Price each" className="num">
                    {money(line.unit_price)}
                  </td>
                  <td data-label="Amount" className="num">
                    {money(line.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="muted small mt-16">
        This bill is only kept on file. It does not add or remove any stock.
      </p>
    </Layout>
  );
}
