'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { useFetch, useReference } from '@/lib/hooks';
import { api } from '@/lib/api';
import { LineItemEditor, toPayloadLines } from '@/components/LineItems';
import {
  Alert,
  Button,
  Field,
  Input,
  Loading,
  Select,
  Step,
  Textarea,
  useToast,
} from '@/components/ui';

export default function NewStandardListPage() {
  return (
    <AdminOnly>
      <NewStandardList />
    </AdminOnly>
  );
}

/**
 * Setting up a standard list.
 *
 * Two questions before the items: what is this list for, and where does it
 * go. Everything else follows from those - a refill buys into the main store
 * and may name a supplier; a delivery goes to one named kitchen. Asking first
 * means the item table below is the only long part of the form.
 */
function NewStandardList() {
  const router = useRouter();
  const toast = useToast();

  const { units } = useReference();
  const itemsQuery = useFetch('/items?page_size=500');
  const kitchens = useFetch('/kitchens');
  const suppliers = useFetch('/suppliers');

  const [purpose, setPurpose] = useState('REFILL');
  const [name, setName] = useState('');
  const [kitchenId, setKitchenId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ item_id: null, quantity: '', unit_id: null }]);
  const [saving, setSaving] = useState(false);

  const ready = toPayloadLines(lines);
  const complete = name.trim().length >= 2 && ready.length > 0 && (purpose === 'REFILL' || kitchenId);

  async function submit() {
    setSaving(true);
    try {
      const result = await api.post('/standard-lists', {
        name: name.trim(),
        purpose,
        kitchen_id: purpose === 'DELIVERY' ? Number(kitchenId) : undefined,
        supplier_id: purpose === 'REFILL' && supplierId ? Number(supplierId) : undefined,
        notes: notes || undefined,
        items: ready.map(({ item_id, quantity, unit_id }) => ({ item_id, quantity, unit_id })),
      });
      toast.success(result.message);
      router.push(`/standard-lists/${result.data.id}`);
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
    }
  }

  return (
    <Layout
      title="New Standard List"
      subtitle="Save an order you place again and again, then run it in one click"
      actions={
        <Button onClick={() => router.push('/standard-lists')} icon="arrow-left">
          Back
        </Button>
      }
    >

      <div className="card mb-16">
        <div className="card-body">
          <Step number={1} title="What is this list for?" />

          <div className="form-row">
            <Field label="Purpose" required>
              <Select
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  setKitchenId('');
                  setSupplierId('');
                }}
                options={[
                  { value: 'REFILL', label: 'Refill the main store (a purchase)' },
                  { value: 'DELIVERY', label: 'Send stock to one kitchen' },
                ]}
              />
            </Field>

            {purpose === 'DELIVERY' ? (
              <Field label="Which kitchen" required>
                <Select
                  value={kitchenId}
                  onChange={(e) => setKitchenId(e.target.value)}
                  placeholder="Choose a kitchen"
                  options={(kitchens.data?.data ?? []).map((k) => ({
                    value: k.id,
                    label: k.name,
                  }))}
                />
              </Field>
            ) : (
              <Field label="Usual supplier" optional hint="Used on the receipt when the list is run">
                <Select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  placeholder="No particular supplier"
                  options={(suppliers.data?.data ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                  }))}
                />
              </Field>
            )}
          </div>

          <div className="form-row">
            <Field
              label="Name this list"
              required
              hint={
                purpose === 'REFILL'
                  ? 'Something you will recognise, like "Monthly Refill"'
                  : 'Something like "Central Kitchen — weekly"'
              }
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={purpose === 'REFILL' ? 'Monthly Refill' : 'Weekly delivery'}
              />
            </Field>
          </div>

          <Field label="Notes" optional>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything whoever runs this should know"
            />
          </Field>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-body">
          <Step number={2} title="What goes on it, and how much?" />
          <p className="muted small mb-16">
            These are the usual amounts. Whoever runs the list can change any line for that run
            without touching what is saved here.
          </p>

          {itemsQuery.loading ? (
            <Loading label="Loading the item list…" />
          ) : (
            <LineItemEditor
              lines={lines}
              onChange={setLines}
              items={itemsQuery.data?.data ?? []}
              units={units}
              showCost={false}
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="kv mb-16">
            <dt>Purpose</dt>
            <dd>{purpose === 'REFILL' ? 'Refill the main store' : 'Delivery to a kitchen'}</dd>
            <dt>Items</dt>
            <dd>{ready.length}</dd>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="btn-block"
            icon="check"
            loading={saving}
            disabled={!complete}
            onClick={submit}
          >
            {ready.length === 0
              ? 'Add at least one item'
              : !name.trim()
                ? 'Give the list a name'
                : purpose === 'DELIVERY' && !kitchenId
                  ? 'Choose which kitchen'
                  : `Save this list (${ready.length} item${ready.length === 1 ? '' : 's'})`}
          </Button>

          <p className="muted small mt-8" style={{ textAlign: 'center' }}>
            Saving does not move any stock. The list sits here until you run it.
          </p>
        </div>
      </div>
    </Layout>
  );
}
