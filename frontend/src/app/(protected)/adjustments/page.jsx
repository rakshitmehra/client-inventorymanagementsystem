'use client';

import { useMemo, useState } from 'react';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch, useListState } from '@/lib/hooks';
import { api, qs } from '@/lib/api';
import {
  ADJUSTMENT_REASONS,
  dateTime,
  humanise,
  isoDate,
  num,
  qty,
  withCurrentTime,
} from '@/lib/format';
import { ItemPicker } from '@/components/LineItems';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  Field,
  Modal,
  NumberInput,
  FilterBar,Pagination,
  SearchInput,
  Select,
  Stat,
  Textarea,
  useToast,
} from '@/components/ui';

export default function AdjustmentsPage() {
  const toast = useToast();
  const { isAdmin, user } = useAuth();
  const [state, update] = useListState({ page_size: 25 });
  const [open, setOpen] = useState(false);

  const { data, loading, error, reload } = useFetch(`/adjustments${qs(state)}`);
  const kitchens = useFetch('/kitchens?include_inactive=true');

  const rows = data?.data ?? [];

  return (
    <Layout
      title="Stock Adjustments"
      subtitle="Corrections from physical counts, with the difference recorded in the ledger"
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          New adjustment
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="grid cols-3 mb-16">
        <Stat icon="adjust" tone="blue" label="Adjustments (filtered)" value={num(data?.meta?.total ?? 0)} />
        <Stat
          icon="arrow-up"
          tone="green"
          label="Increases on this page"
          value={num(rows.filter((r) => r.adjustment_type === 'INCREASE').length)}
        />
        <Stat
          icon="arrow-down"
          tone="red"
          label="Decreases on this page"
          value={num(rows.filter((r) => r.adjustment_type === 'DECREASE').length)}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <FilterBar
            more={
              <>
                {isAdmin && (
                  <Select
                    value={state.kitchen_id ?? ''}
                    onChange={(e) => update({ kitchen_id: e.target.value })}
                    placeholder="All locations"
                    options={(kitchens.data?.data ?? []).map((k) => ({ value: k.id, label: k.name }))}
                  />
                )}
                <Select
                  value={state.adjustment_type ?? ''}
                  onChange={(e) => update({ adjustment_type: e.target.value })}
                  placeholder="Any direction"
                  options={[
                    { value: 'INCREASE', label: 'Increases' },
                    { value: 'DECREASE', label: 'Decreases' },
                  ]}
                />
                <Select
                  value={state.reason_code ?? ''}
                  onChange={(e) => update({ reason_code: e.target.value })}
                  placeholder="Any reason"
                  options={ADJUSTMENT_REASONS.map((r) => ({ value: r, label: humanise(r) }))}
                />
                <DateInput
                  value={state.from ?? ''}
                  max={isoDate()}
                  onChange={(e) => update({ from: e.target.value })}
                  title="From date"
                />
                <DateInput
                  value={state.to ?? ''}
                  max={isoDate()}
                  onChange={(e) => update({ to: e.target.value })}
                  title="To date"
                />
              </>
            }
          >
            <SearchInput
              value={state.search ?? ''}
              onChange={(search) => update({ search })}
              placeholder="Search adjustment or item…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={rows}
          columns={[
            {
              key: 'adjustment_no',
              label: 'Adjustment',
              render: (r) => (
                <div>
                  <div className="cell-title mono">{r.adjustment_no}</div>
                  <div className="cell-sub">{dateTime(r.adjusted_at)}</div>
                </div>
              ),
            },
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub mono">{r.sku}</div>
                </div>
              ),
            },
            { key: 'location_label', label: 'Location' },
            {
              key: 'previous_quantity',
              label: 'System had',
              align: 'right',
              render: (r) => <span className="muted">{qty(r.previous_quantity, r.unit_code)}</span>,
            },
            {
              key: 'new_quantity',
              label: 'Counted',
              align: 'right',
              render: (r) => <strong>{qty(r.new_quantity, r.unit_code)}</strong>,
            },
            {
              key: 'difference',
              label: 'Difference',
              align: 'right',
              render: (r) => (
                <strong className={r.difference > 0 ? 'pos-up' : 'pos-down'}>
                  {r.difference > 0 ? '+' : ''}
                  {num(r.difference)}
                </strong>
              ),
            },
            {
              key: 'reason_code',
              label: 'Reason',
              render: (r) => (
                <div>
                  <Badge tone={r.adjustment_type === 'INCREASE' ? 'green' : 'amber'}>
                    {humanise(r.reason_code)}
                  </Badge>
                  {r.reason && <div className="cell-sub">{r.reason}</div>}
                </div>
              ),
            },
            {
              key: 'created_by_name',
              label: 'By',
              render: (r) => <span className="muted">{r.created_by_name || '—'}</span>,
            },
          ]}
          empty={
            <EmptyState
              icon="adjust"
              title="No adjustments recorded"
              message="Adjustments let you correct the system to match a physical count."
              action={<Button onClick={() => setOpen(true)}>New adjustment</Button>}
            />
          }
        />

        {data?.meta && (
          <div className="card-foot">
            <Pagination meta={data.meta} onPage={(page) => update({ page })} />
          </div>
        )}
      </div>

      <AdjustmentForm
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          reload();
        }}
        isAdmin={isAdmin}
        user={user}
        kitchens={(kitchens.data?.data ?? []).filter((k) => k.is_active)}
        toast={toast}
      />
    </Layout>
  );
}

/* ------------------------------------------------------------------------- */
function blank(isAdmin, user) {
  return {
    location_type: 'KITCHEN',
    kitchen_id: isAdmin ? '' : String(user?.kitchens?.[0]?.id ?? ''),
    item_id: null,
    new_quantity: '',
    reason_code: '',
    reason: '',
    adjusted_at: isoDate(),
  };
}

function AdjustmentForm({ open, onClose, onSaved, isAdmin, user, kitchens, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState(() => blank(isAdmin, user));
  const [error, setError] = useState(null);

  const locationPath =
    form.location_type === 'MAIN'
      ? '/main-inventory?page_size=500'
      : form.kitchen_id
        ? `/kitchens/${form.kitchen_id}/inventory?page_size=500`
        : null;
  const stock = useFetch(locationPath, { skip: !open || !locationPath });

  const rows = stock.data?.data ?? [];
  const items = rows.map((r) => ({
    id: r.item_id,
    name: r.item_name,
    sku: r.sku,
    unit_id: r.unit_id,
    unit_code: r.unit_code,
  }));
  const availability = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.item_id, Number(r.quantity)])),
    [rows],
  );

  const selected = items.find((i) => i.id === form.item_id);
  const current = form.item_id ? availability[form.item_id] ?? 0 : null;
  const difference =
    current !== null && form.new_quantity !== '' ? Number(form.new_quantity) - current : null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    setError(null);
    try {
      const result = await run(() =>
        api.post('/adjustments', {
          location_type: form.location_type,
          kitchen_id: form.location_type === 'KITCHEN' ? Number(form.kitchen_id) : null,
          item_id: form.item_id,
          new_quantity: Number(form.new_quantity),
          reason_code: form.reason_code,
          reason: form.reason || null,
          adjusted_at: withCurrentTime(form.adjusted_at),
        }),
      );
      toast.success(result.message);
      setForm(blank(isAdmin, user));
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal
      open={open}
      title="Stock adjustment"
      subtitle="Set the counted quantity; the difference is written to the ledger"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={loading}
            disabled={
              !form.item_id || form.new_quantity === '' || !form.reason_code || difference === 0
            }
          >
            Apply adjustment
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <div className="form-row">
        {isAdmin && (
          <Field label="Location" required>
            <Select
              value={form.location_type}
              onChange={(e) =>
                set({ location_type: e.target.value, item_id: null, new_quantity: '' })
              }
              options={[
                { value: 'KITCHEN', label: 'A kitchen' },
                { value: 'MAIN', label: 'Main Inventory' },
              ]}
            />
          </Field>
        )}
        {form.location_type === 'KITCHEN' &&
          /* A manager who runs one kitchen has nothing to choose. Showing them
             a dropdown they cannot use is a step that only causes hesitation,
             so the kitchen is simply stated. */
          (kitchens.length === 1 && !isAdmin ? (
            <Field label="Kitchen">
              <div className="field-static">{kitchens[0].name}</div>
            </Field>
          ) : (
            <Field label="Kitchen" required>
              <Select
                value={form.kitchen_id ?? ''}
                disabled={!isAdmin}
                onChange={(e) => set({ kitchen_id: e.target.value, item_id: null, new_quantity: '' })}
                placeholder="Choose a kitchen…"
                options={kitchens.map((k) => ({ value: k.id, label: k.name }))}
              />
            </Field>
          ))}
      </div>

      <Field label="Item" required>
        <ItemPicker
          items={items}
          value={form.item_id}
          availability={availability}
          onChange={(itemId) => set({ item_id: itemId, new_quantity: '' })}
          placeholder={stock.loading ? 'Loading stock…' : 'Search for an item…'}
        />
      </Field>

      {selected && (
        <div className="grid cols-3 mb-16">
          <Stat label="System shows" value={qty(current, selected.unit_code)} />
          <Stat
            label="You counted"
            value={
              form.new_quantity === '' ? '—' : qty(Number(form.new_quantity), selected.unit_code)
            }
          />
          <Stat
            label="Difference"
            value={
              difference === null || form.new_quantity === ''
                ? '—'
                : `${difference > 0 ? '+' : ''}${num(difference)}`
            }
          />
        </div>
      )}

      <div className="form-row">
        <Field
          label={`Counted quantity${selected ? ` (${selected.unit_code})` : ''}`}
          required
          hint={
            difference === 0 && form.new_quantity !== ''
              ? 'This matches the system — nothing to adjust'
              : undefined
          }
        >
          <NumberInput
            value={form.new_quantity}
            min="0"
            onChange={(e) => set({ new_quantity: e.target.value })}
          />
        </Field>
        <Field label="Date" required>
          <DateInput
            value={form.adjusted_at}
            max={isoDate()}
            onChange={(e) => set({ adjusted_at: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Reason" required>
        <Select
          value={form.reason_code}
          onChange={(e) => set({ reason_code: e.target.value })}
          placeholder="Why is the system wrong?"
          options={ADJUSTMENT_REASONS.map((r) => ({ value: r, label: humanise(r) }))}
        />
      </Field>

      <Field label="Details" optional>
        <Textarea
          value={form.reason}
          rows={2}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="Who counted, what was found…"
        />
      </Field>
    </Modal>
  );
}
