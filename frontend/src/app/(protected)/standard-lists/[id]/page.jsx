'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useFetch, useReference } from '@/lib/hooks';
import { api } from '@/lib/api';
import { dateTime, money, num, qty } from '@/lib/format';
import { LineItemEditor, toPayloadLines } from '@/components/LineItems';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  Loading,
  NumberInput,
  Textarea,
  useToast,
} from '@/components/ui';

/**
 * One standard list: run it, or change what it says.
 *
 * The two are deliberately separate. Changing a quantity in the run table
 * affects this run and nothing else - "send 30 kg today" - while editing the
 * list is a decision about what normal looks like from now on. Keeping them
 * apart means a one-off exception never silently becomes the new standing
 * order, which is the way these lists rot.
 */
export default function StandardListPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const { data, loading, error, reload } = useFetch(`/standard-lists/${id}`);
  const list = data?.data;

  const { units } = useReference();
  const itemsQuery = useFetch('/items?page_size=500');

  /** What to send this time, keyed by item id. Starts at the saved amounts. */
  const [amounts, setAmounts] = useState({});
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (list?.items) {
      setAmounts(Object.fromEntries(list.items.map((l) => [l.item_id, String(l.quantity)])));
    }
  }, [list?.id, list?.items]);

  if (loading) {
    return (
      <Layout title="Standard list">
        <Loading label="Opening the list…" />
      </Layout>
    );
  }
  if (error) {
    return (
      <Layout title="Standard list">
        <Alert tone="error">{error.message}</Alert>
      </Layout>
    );
  }
  if (!list) return null;

  const isRefill = list.purpose === 'REFILL';
  const sending = list.items.filter((l) => Number(amounts[l.item_id] ?? 0) > 0);
  const changed = list.items.some(
    (l) => Number(amounts[l.item_id] ?? 0) !== Number(l.quantity),
  );
  const runTotal = sending.reduce(
    (sum, l) => sum + Number(amounts[l.item_id] ?? 0) * Number(l.unit_cost || 0),
    0,
  );
  // Only a delivery can run the main store short; a refill is filling it.
  const short = !isRefill
    ? sending.filter((l) => Number(amounts[l.item_id] ?? 0) > Number(l.main_quantity ?? 0))
    : [];

  async function act(fn, done) {
    setBusy(true);
    try {
      const result = await fn();
      toast.success(result.message);
      done?.(result);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const run = () =>
    act(
      () =>
        api.post(`/standard-lists/${id}/run`, {
          // Send the amounts only when they differ from the saved ones, so an
          // untouched run is the plain "use the list as it stands" call.
          items: changed
            ? list.items.map((l) => ({
                item_id: l.item_id,
                quantity: Number(amounts[l.item_id] ?? 0),
                unit_id: l.unit_id,
              }))
            : undefined,
        }),
      (result) => {
        setConfirming(false);
        if (result.outcome === 'receipt') router.push('/goods-receipts');
        else if (result.outcome === 'transfer') router.push('/transfers');
        else router.push('/requests');
      },
    );

  const save = () =>
    act(
      () =>
        api.put(`/standard-lists/${id}`, {
          name: form.name,
          purpose: list.purpose,
          kitchen_id: list.kitchen_id ?? undefined,
          supplier_id: list.supplier_id ?? undefined,
          notes: form.notes || undefined,
          is_active: true,
          items: toPayloadLines(lines).map(({ item_id, quantity, unit_id }) => ({
            item_id,
            quantity,
            unit_id,
          })),
        }),
      () => {
        setEditing(false);
        reload();
      },
    );

  const remove = () =>
    act(
      () => api.del(`/standard-lists/${id}`),
      () => router.push('/standard-lists'),
    );

  function startEditing() {
    setForm({ name: list.name, notes: list.notes ?? '' });
    setLines(
      list.items.map((l) => ({
        item_id: l.item_id,
        quantity: String(l.quantity),
        unit_id: l.unit_id,
      })),
    );
    setEditing(true);
  }

  return (
    <Layout
      title={list.name}
      subtitle={
        isRefill
          ? `Refills the main store${list.supplier_name ? ` · ${list.supplier_name}` : ''}`
          : `Goes to ${list.kitchen_name}`
      }
      actions={
        <>
          <Button onClick={() => router.push('/standard-lists')} icon="arrow-left">
            Back
          </Button>
          {isAdmin && !editing && (
            <Button onClick={startEditing} icon="edit">
              Change the list
            </Button>
          )}
        </>
      }
    >

      <div className="grid cols-4 mb-16">
        <div className="card">
          <div className="card-body">
            <div className="stat-label">What it does</div>
            <div className="mt-4">
              <Badge tone={isRefill ? 'blue' : 'green'}>
                {isRefill ? 'Refill the main store' : 'Delivery to a kitchen'}
              </Badge>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Items on the list</div>
            <div className="stat-value">{num(list.total_items)}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Roughly worth</div>
            <div className="stat-value" style={{ fontSize: 'var(--text-md)' }}>
              {list.estimated_cost > 0 ? money(list.estimated_cost) : '—'}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Last run</div>
            <div className="stat-value" style={{ fontSize: 'var(--text-md)' }}>
              {list.last_used_at ? dateTime(list.last_used_at) : <span className="muted">Never</span>}
            </div>
          </div>
        </div>
      </div>

      {list.notes && <Alert tone="info">{list.notes}</Alert>}

      {editing ? (
        <div className="card">
          <div className="card-head">
            <h3>Change what this list says</h3>
          </div>
          <div className="card-body">
            <p className="muted small mb-16">
              This changes the list itself, for every run from now on. To send a different amount
              just this once, cancel and change the quantity in the run table instead.
            </p>

            <div className="form-row">
              <Field label="Name" required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Notes" optional>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>

            <div className="mt-16">
              <LineItemEditor
                lines={lines}
                onChange={setLines}
                items={itemsQuery.data?.data ?? []}
                units={units}
                showCost={false}
              />
            </div>
          </div>
          <div className="card-foot">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              variant="primary"
              icon="check"
              loading={busy}
              disabled={toPayloadLines(lines).length === 0}
              onClick={save}
            >
              Save the list
            </Button>
            {isAdmin && (
              <Button variant="danger" icon="trash" onClick={() => setDeleting(true)}>
                Delete this list
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <h3>Run this list</h3>
            {changed && (
              <div className="card-head-actions">
                <Button
                  onClick={() =>
                    setAmounts(
                      Object.fromEntries(list.items.map((l) => [l.item_id, String(l.quantity)])),
                    )
                  }
                >
                  Back to the usual amounts
                </Button>
              </div>
            )}
          </div>

          {short.length > 0 && (
            <Alert tone="warn" title={`${short.length} line${short.length === 1 ? '' : 's'} short in the main store`}>
              You can still send what is there — lower those quantities, or top the main store up
              first. Running as it stands will be refused.
            </Alert>
          )}

          <DataTable
            rows={list.items}
            rowKey={(l) => l.item_id}
            columns={[
              {
                key: 'item_name',
                label: 'Item',
                render: (l) => (
                  <>
                    <div className="strong">{l.item_name}</div>
                    <div className="cell-sub mono">{l.item_sku}</div>
                  </>
                ),
              },
              {
                key: 'usual',
                label: 'Usual',
                align: 'right',
                render: (l) => <span className="muted">{qty(l.quantity, l.unit_code)}</span>,
              },
              ...(isRefill
                ? []
                : [
                    {
                      key: 'main_quantity',
                      label: 'In main store',
                      align: 'right',
                      render: (l) => {
                        const wanted = Number(amounts[l.item_id] ?? 0);
                        const have = Number(l.main_quantity ?? 0);
                        return wanted > have ? (
                          <Badge tone="red">{qty(have, l.unit_code)}</Badge>
                        ) : (
                          <span className="muted">{qty(have, l.unit_code)}</span>
                        );
                      },
                    },
                  ]),
              {
                key: 'sending',
                label: isRefill ? 'Book in' : 'Send',
                align: 'right',
                render: (l) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <NumberInput
                      value={amounts[l.item_id] ?? ''}
                      min={0}
                      onChange={(e) =>
                        setAmounts((a) => ({ ...a, [l.item_id]: e.target.value }))
                      }
                    />
                    <span className="muted small nowrap">{l.unit_code}</span>
                  </div>
                ),
              },
            ]}
            empty={<EmptyState icon="documents" title="This list has no items" />}
          />

          <div className="card-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <p className="muted small">
              Change any amount to send something different just this once — the saved list is not
              affected. Set a line to <strong>0</strong> to leave it out of this run.
              {runTotal > 0 && <> This run is worth roughly <strong>{money(runTotal)}</strong>.</>}
            </p>
            <Button
              variant="primary"
              size="lg"
              className="btn-block"
              icon="check"
              loading={busy}
              disabled={sending.length === 0}
              onClick={() => setConfirming(true)}
            >
              {sending.length === 0
                ? 'Nothing to send — every line is zero'
                : isRefill
                  ? `Top up the main store (${sending.length} item${sending.length === 1 ? '' : 's'})`
                  : isAdmin
                    ? `Send ${sending.length} item${sending.length === 1 ? '' : 's'} to ${list.kitchen_name}`
                    : `Ask for ${sending.length} item${sending.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        tone="primary"
        title={isRefill ? 'Top up the main store?' : isAdmin ? 'Send this now?' : 'Send this request?'}
        message={
          isRefill
            ? `${sending.length} items will be booked into the main store as a delivery. This adds stock straight away.`
            : isAdmin
              ? `${sending.length} items will move from the main store to ${list.kitchen_name} straight away, and a delivery note will be created.`
              : `The main store will see your request for ${sending.length} items. Nothing moves until an administrator approves it.`
        }
        confirmLabel={isRefill ? 'Top it up' : isAdmin ? 'Send it' : 'Send the request'}
        loading={busy}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />

      <ConfirmDialog
        open={deleting}
        title={`Delete '${list.name}'?`}
        message="The list is removed. Stock already received or sent from it is not affected."
        confirmLabel="Delete it"
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
    </Layout>
  );
}
