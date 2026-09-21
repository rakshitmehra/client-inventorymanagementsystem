'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { FETCH_ALL, useFetch, useReference } from '@/lib/hooks';
import { api } from '@/lib/api';
import { isoDate } from '@/lib/format';
import { LineItemEditor, toPayloadLines } from '@/components/LineItems';
import {
  Alert,
  Button,
  DateInput,
  Field,
  Loading,
  Step,
  Textarea,
  useToast,
} from '@/components/ui';

/**
 * A kitchen manager asking the main store for stock.
 *
 * Deliberately short: which items, how much, and by when. No costs, no
 * locations, no direction to choose - where it comes from and where it goes
 * are both already known, so asking would only be a chance to get it wrong.
 */
export default function NewRequestPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const kitchen = user?.kitchens?.[0];

  const { units } = useReference();
  const itemsQuery = useFetch(`/items?page_size=${FETCH_ALL}`);
  const items = itemsQuery.data?.data ?? [];

  const [lines, setLines] = useState([{ item_id: null, quantity: '', unit_id: null }]);
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const ready = toPayloadLines(lines);

  if (!kitchen) {
    return (
      <Layout title="Ask for Stock">
        <Alert tone="warn" title="No kitchen assigned">
          Your account is not linked to a kitchen yet, so there is nowhere to send stock. Ask an
          administrator to assign you one.
        </Alert>
      </Layout>
    );
  }

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const result = await api.post('/requests', {
        kitchen_id: kitchen.id,
        needed_by: neededBy || undefined,
        notes: notes || undefined,
        items: ready.map(({ item_id, quantity, unit_id }) => ({ item_id, quantity, unit_id })),
      });
      toast.success(result.message);
      router.push(`/requests/${result.data.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Layout
      title="Ask for Stock"
      subtitle="Tell the main store what your kitchen needs"
      actions={
        <Button onClick={() => router.push('/requests')} icon="arrow-left">
          Back
        </Button>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}

      <div className="card mb-16">
        <div className="card-body">
          <Step number={1} title="What do you need?" />

          {itemsQuery.loading ? (
            <Loading label="Loading the ingredient list…" />
          ) : (
            <LineItemEditor
              lines={lines}
              onChange={setLines}
              items={items}
              units={units}
              showCost={false}
            />
          )}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-body">
          <Step number={2} title="When do you need it?" />

          <div className="form-row">
            <Field label="Needed by" optional hint="Leave blank if there is no particular day">
              <DateInput
                value={neededBy}
                min={isoDate()}
                onChange={(e) => setNeededBy(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Anything the main store should know" optional>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Running low before the weekend rush…"
            />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="kv mb-16">
            <dt>Asking for</dt>
            <dd>{kitchen.name}</dd>
            <dt>Items</dt>
            <dd>{ready.length}</dd>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="btn-block"
            icon="request"
            loading={saving}
            disabled={ready.length === 0}
            onClick={submit}
          >
            {ready.length === 0
              ? 'Add at least one item'
              : `Send this request (${ready.length} item${ready.length === 1 ? '' : 's'})`}
          </Button>

          <p className="muted small mt-8" style={{ textAlign: 'center' }}>
            Nothing moves yet. The main store decides what to send, and you will see the result
            here.
          </p>
        </div>
      </div>
    </Layout>
  );
}
