'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useFetch, useListState, useReference } from '@/lib/hooks';
import { qs } from '@/lib/api';
import { MOVEMENT_LABELS, dateTime, isoDate, num } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
  Stat,
} from '@/components/ui';

const MOVEMENT_TYPES = Object.entries(MOVEMENT_LABELS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export default function MovementsPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const { categories } = useReference();
  const [state, update] = useListState({ page_size: 50 });

  const { data, loading, error } = useFetch(`/movements${qs(state)}`);
  const kitchens = useFetch('/kitchens?include_inactive=true');

  const hasFilters =
    state.search ||
    state.location_type ||
    state.kitchen_id ||
    state.movement_type ||
    state.category_id ||
    state.from ||
    state.to;

  return (
    <Layout
      title="Stock Movements"
      subtitle="The complete ledger — every receipt, transfer, consumption, wastage and adjustment"
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="grid cols-3 mb-16">
        <Stat icon="list" tone="blue" label="Ledger entries (filtered)" value={num(data?.meta?.total ?? 0)} />
        <Stat icon="arrow-up" tone="green" label="Quantity in" value={num(data?.meta?.total_in ?? 0)} />
        <Stat icon="arrow-down" tone="red" label="Quantity out" value={num(data?.meta?.total_out ?? 0)} />
      </div>

      <div className="card">
        <div className="card-head">
          <FilterBar
            hasFilters={hasFilters}
            onClear={() =>
              update({
                search: '',
                location_type: '',
                kitchen_id: '',
                movement_type: '',
                category_id: '',
                from: '',
                to: '',
              })
            }
            more={
              <>
                {isAdmin && (
                  <>
                    <Select
                      value={state.location_type ?? ''}
                      onChange={(e) => update({ location_type: e.target.value })}
                      placeholder="All locations"
                      options={[
                        { value: 'MAIN', label: 'Main Inventory' },
                        { value: 'KITCHEN', label: 'Kitchens' },
                      ]}
                    />
                    <Select
                      value={state.kitchen_id ?? ''}
                      onChange={(e) => update({ kitchen_id: e.target.value })}
                      placeholder="All kitchens"
                      options={(kitchens.data?.data ?? []).map((k) => ({ value: k.id, label: k.name }))}
                    />
                  </>
                )}
                <Select
                  value={state.movement_type ?? ''}
                  onChange={(e) => update({ movement_type: e.target.value })}
                  placeholder="All movement types"
                  options={MOVEMENT_TYPES}
                />
                <Select
                  value={state.category_id ?? ''}
                  onChange={(e) => update({ category_id: e.target.value })}
                  placeholder="All categories"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
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
              placeholder="Search item, SKU or document…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={data?.data ?? []}
          columns={[
            {
              key: 'created_at',
              label: 'When',
              render: (r) => <span className="small nowrap">{dateTime(r.created_at)}</span>,
            },
            {
              key: 'movement_type',
              label: 'Type',
              render: (r) => {
                const meta = MOVEMENT_LABELS[r.movement_type];
                return <Badge tone={meta?.tone ?? 'gray'}>{meta?.label ?? r.movement_type}</Badge>;
              },
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
            {
              key: 'location_label',
              label: 'Location',
              render: (r) => <span className="nowrap">{r.location_label}</span>,
            },
            {
              key: 'counterparty',
              label: 'From / to',
              render: (r) => (
                <span className="muted small">
                  {r.counterparty_kitchen_name || r.counterparty_label || r.counterparty_type}
                </span>
              ),
            },
            {
              key: 'quantity',
              label: 'Quantity',
              align: 'right',
              render: (r) => (
                <strong className={r.direction === 'IN' ? 'pos-up' : 'pos-down'}>
                  {r.direction === 'IN' ? '+' : '−'}
                  {num(r.quantity)} {r.unit_code}
                </strong>
              ),
            },
            {
              key: 'balance_after',
              label: 'Balance',
              align: 'right',
              render: (r) => num(r.balance_after),
            },
            {
              key: 'reference_no',
              label: 'Document',
              render: (r) => <span className="mono small">{r.reference_no || '—'}</span>,
            },
            {
              key: 'performed_by_name',
              label: 'By',
              render: (r) => <span className="muted small nowrap">{r.performed_by_name || '—'}</span>,
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => router.push(`/movements/item/${r.item_id}`)}
                >
                  Item
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="list"
              title="No movements match"
              message="Every stock change writes a ledger entry here. Try widening the filters."
            />
          }
        />

        {data?.meta && (
          <div className="card-foot">
            <Pagination meta={data.meta} onPage={(page) => update({ page })} />
          </div>
        )}
      </div>
    </Layout>
  );
}
