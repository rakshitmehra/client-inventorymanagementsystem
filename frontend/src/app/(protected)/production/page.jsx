'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { FETCH_ALL, useClientTable, useFetch, useListState } from '@/lib/hooks';
import { dateTime, isoDate, money, num, qty } from '@/lib/format';
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
} from '@/components/ui';

export default function ProductionPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [state, update] = useListState();

  const { data, loading, error } = useFetch(`/production?page_size=${FETCH_ALL}`);

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['production_no', 'product_name', 'product_sku', 'kitchen_name'],
    filters: { kitchen_id: state.kitchen_id ?? '', product_id: state.product_id ?? '' },
    predicate: (row) => {
      const day = (row.produced_at ?? '').slice(0, 10);
      if (state.from && day < state.from) return false;
      if (state.to && day > state.to) return false;
      return true;
    },
    serverTotal: data?.meta?.total,
    resetKey: state,
  });
  const kitchens = useFetch('/kitchens?include_inactive=true');
  const products = useFetch('/products?page_size=200');

  const hasFilters =
    state.search || state.kitchen_id || state.product_id || state.from || state.to;

  return (
    <Layout
      title="Production History"
      subtitle="Every batch produced and the ingredients it consumed"
      actions={
        <Button variant="primary" onClick={() => router.push('/production/new')}>
          Record production
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <FilterBar
            hasFilters={hasFilters}
            onClear={() => update({ search: '', kitchen_id: '', product_id: '', from: '', to: '' })}
            more={
              <>
                {isAdmin && (
                  <Select
                    value={state.kitchen_id ?? ''}
                    onChange={(e) => update({ kitchen_id: e.target.value })}
                    placeholder="All kitchens"
                    options={(kitchens.data?.data ?? []).map((k) => ({ value: k.id, label: k.name }))}
                  />
                )}
                <Select
                  value={state.product_id ?? ''}
                  onChange={(e) => update({ product_id: e.target.value })}
                  placeholder="All products"
                  options={(products.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
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
              placeholder="Search run number or product…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          onRowClick={(r) => router.push(`/production/${r.id}`)}
          columns={[
            {
              key: 'production_no',
              label: 'Run',
              render: (r) => (
                <div>
                  <div className="cell-title mono">{r.production_no}</div>
                  <div className="cell-sub">{dateTime(r.produced_at)}</div>
                </div>
              ),
            },
            {
              key: 'product_name',
              label: 'Product',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.product_name}</div>
                  <div className="cell-sub mono">{r.product_sku}</div>
                </div>
              ),
            },
            ...(isAdmin
              ? [{ key: 'kitchen_name', label: 'Kitchen', render: (r) => r.kitchen_name }]
              : []),
            {
              key: 'output_quantity',
              label: 'Produced',
              align: 'right',
              render: (r) => <strong>{qty(r.output_quantity, r.output_unit_code)}</strong>,
            },
            {
              key: 'ingredient_count',
              label: 'Items used',
              align: 'right',
              render: (r) => <Badge tone="gray">{num(r.ingredient_count)}</Badge>,
            },
            {
              key: 'total_cost',
              label: 'Ingredient cost',
              align: 'right',
              render: (r) => money(r.total_cost),
            },
            {
              key: 'created_by_name',
              label: 'Recorded by',
              render: (r) => <span className="muted">{r.created_by_name || '—'}</span>,
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/print/production/${r.id}`);
                  }}
                >
                  Slip
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="cooking"
              title="No production recorded"
              message="Record a batch to start tracking how ingredients are being used."
              action={
                <Button variant="primary" onClick={() => router.push('/production/new')}>
                  Record production
                </Button>
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>
    </Layout>
  );
}
