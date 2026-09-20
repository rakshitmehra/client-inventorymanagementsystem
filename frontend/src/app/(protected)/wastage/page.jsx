'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch, useListState } from '@/lib/hooks';
import { api, qs } from '@/lib/api';
import { WASTAGE_REASONS, dateTime, humanise, isoDate, money, num, qty, withCurrentTime } from '@/lib/format';
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

export default function WastagePage() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin, user } = useAuth();
  const [state, update] = useListState({ page_size: 25 });
  const [open, setOpen] = useState(false);

  const { data, loading, error, reload } = useFetch(`/wastage${qs(state)}`);
  const kitchens = useFetch('/kitchens?include_inactive=true');

  return (
    <Layout
      title="Wastage"
      subtitle="Stock written off, with the reason and its cost"
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          Record wastage
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="grid cols-3 mb-16">
        <Stat
          icon="out"
          tone="red"
          label="Wastage value (filtered)"
          value={money(data?.meta?.total_cost ?? 0)}
        />
        <Stat icon="list" tone="amber" label="Events" value={num(data?.meta?.total ?? 0)} />
        <Stat
          icon="layers"
          tone="blue"
          label="Reports"
          value="Wastage analysis"
          meta="Break down by reason and location"
          onClick={() => router.push('/reports?tab=wastage')}
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
                  value={state.reason_code ?? ''}
                  onChange={(e) => update({ reason_code: e.target.value })}
                  placeholder="Any reason"
                  options={WASTAGE_REASONS.map((r) => ({ value: r, label: humanise(r) }))}
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
              placeholder="Search note number or item…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={data?.data ?? []}
          columns={[
            {
              key: 'wastage_no',
              label: 'Note',
              render: (r) => (
                <div>
                  <div className="cell-title mono">{r.wastage_no}</div>
                  <div className="cell-sub">{dateTime(r.recorded_at)}</div>
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
              key: 'quantity',
              label: 'Written off',
              align: 'right',
              render: (r) => <strong className="pos-down">{qty(r.base_quantity, r.unit_code)}</strong>,
            },
            {
              key: 'reason_code',
              label: 'Reason',
              render: (r) => (
                <div>
                  <Badge tone="red">{humanise(r.reason_code)}</Badge>
                  {r.reason && <div className="cell-sub">{r.reason}</div>}
                </div>
              ),
            },
            {
              key: 'estimated_cost',
              label: 'Cost',
              align: 'right',
              render: (r) => money(r.estimated_cost),
            },
            {
              key: 'recorded_by_name',
              label: 'Recorded by',
              render: (r) => <span className="muted">{r.recorded_by_name || '—'}</span>,
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <Button size="sm" variant="ghost" onClick={() => router.push(`/print/wastage/${r.id}`)}>
                  Slip
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="check-circle"
              title="No wastage recorded"
              message="Nothing has been written off in this period — which is good news."
              action={<Button onClick={() => setOpen(true)}>Record wastage</Button>}
            />
          }
        />

        {data?.meta && (
          <div className="card-foot">
            <Pagination meta={data.meta} onPage={(page) => update({ page })} />
          </div>
        )}
      </div>

      <WastageForm
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
    unit_id: null,
    quantity: '',
    reason_code: '',
    reason: '',
    recorded_at: isoDate(),
  };
}

function WastageForm({ open, onClose, onSaved, isAdmin, user, kitchens, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState(() => blank(isAdmin, user));
  const [error, setError] = useState(null);

  const locationPath =
    form.location_type === 'MAIN'
      ? '/main-inventory?page_size=500'
      : form.kitchen_id
        ? `/kitchens/${form.kitchen_id}/inventory?page_size=500&hide_zero=true`
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
  const available = form.item_id ? availability[form.item_id] ?? 0 : null;
  const tooMuch = available !== null && Number(form.quantity) > available + 1e-9;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    setError(null);
    try {
      const result = await run(() =>
        api.post('/wastage', {
          location_type: form.location_type,
          kitchen_id: form.location_type === 'KITCHEN' ? Number(form.kitchen_id) : null,
          item_id: form.item_id,
          quantity: Number(form.quantity),
          unit_id: form.unit_id ?? selected?.unit_id,
          reason_code: form.reason_code,
          reason: form.reason || null,
          recorded_at: withCurrentTime(form.recorded_at),
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
      title="Record wastage"
      subtitle="Write stock off and record why"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            loading={loading}
            disabled={!form.item_id || !(Number(form.quantity) > 0) || !form.reason_code || tooMuch}
          >
            Write off stock
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
              onChange={(e) => set({ location_type: e.target.value, item_id: null })}
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
                onChange={(e) => set({ kitchen_id: e.target.value, item_id: null })}
                placeholder="Choose a kitchen…"
                options={kitchens.map((k) => ({ value: k.id, label: k.name }))}
              />
            </Field>
          ))}
      </div>

      <Field
        label="Item"
        required
        hint={selected ? `${qty(available, selected.unit_code)} currently available` : undefined}
      >
        <ItemPicker
          items={items}
          value={form.item_id}
          availability={availability}
          onChange={(itemId) => {
            const item = items.find((i) => i.id === itemId);
            set({ item_id: itemId, unit_id: item?.unit_id ?? null });
          }}
          placeholder={stock.loading ? 'Loading stock…' : 'Search for an item…'}
        />
      </Field>

      <div className="form-row">
        <Field
          label={`Quantity wasted${selected ? ` (${selected.unit_code})` : ''}`}
          required
          error={tooMuch ? `Only ${qty(available, selected?.unit_code)} is available` : undefined}
        >
          <NumberInput
            value={form.quantity}
            min="0"
            error={tooMuch}
            onChange={(e) => set({ quantity: e.target.value })}
          />
        </Field>
        <Field label="Date" required>
          <DateInput
            value={form.recorded_at}
            max={isoDate()}
            onChange={(e) => set({ recorded_at: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Reason" required>
        <Select
          value={form.reason_code}
          onChange={(e) => set({ reason_code: e.target.value })}
          placeholder="Why was this written off?"
          options={WASTAGE_REASONS.map((r) => ({ value: r, label: humanise(r) }))}
        />
      </Field>

      <Field label="Details" optional>
        <Textarea
          value={form.reason}
          rows={2}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="What happened?"
        />
      </Field>
    </Modal>
  );
}
