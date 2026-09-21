'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { FETCH_ALL, useClientTable, useFetch, useListState, useReference } from '@/lib/hooks';
import { STOCK_STATUS, money, num, qty } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
  Stat,
} from '@/components/ui';

export default function MainInventoryPage() {
  return (
    <AdminOnly>
      <MainInventory />
    </AdminOnly>
  );
}

function MainInventory() {
  const router = useRouter();
  const { categories } = useReference();
  const [state, update, setSort] = useListState({ sort: 'name', order: 'asc' });

  const { data, loading, error } = useFetch(`/main-inventory?page_size=${FETCH_ALL}`);
  const suppliers = useFetch('/suppliers');

  // The row carries the supplier's name but not its id, so the picker offers
  // names as its values rather than resolving ids on every keystroke.
  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['item_name', 'sku'],
    filters: {
      category_id: state.category_id ?? '',
      supplier_name: state.supplier_id ?? '',
    },
    predicate: (row) => {
      if (!state.stock_status) return true;
      // The filter speaks plain English; the row speaks in flags.
      const wanted = { low: 'LOW', out: 'OUT', in: 'OK' }[state.stock_status];
      return row.stock_status === wanted;
    },
    sort: state.sort === 'name' ? 'item_name' : state.sort,
    order: state.order,
    serverTotal: data?.meta?.total,
    resetKey: state,
  });

  const rows = table.allRows;

  return (
    <Layout
      title="Main Store"
      subtitle="Everything you hold centrally, before it goes to a kitchen"
      actions={
        <>
          <Button onClick={() => router.push('/goods-receipts/new')} icon="inbox">
            Receive Stock
          </Button>
          <Button variant="primary" onClick={() => router.push('/transfers/new')} icon="truck">
            Send to a Kitchen
          </Button>
        </>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="grid cols-3 mb-16">
        <Stat
          icon="rupee"
          tone="green"
          label="Stock value"
          value={money(data?.meta?.stock_value ?? 0)}
        />
        <Stat icon="ingredient" tone="blue" label="Ingredients listed" value={num(data?.meta?.total ?? 0)} />
        <Stat
          icon="alert"
          tone="amber"
          label="Running low"
          value={num(rows.filter((r) => r.stock_status !== 'OK').length)}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <FilterBar
            hasFilters={!!(state.search || state.category_id || state.supplier_id || state.stock_status)}
            onClear={() =>
              update({ search: '', category_id: '', supplier_id: '', stock_status: '' })
            }
            more={
              <>
                <Select
                  value={state.category_id ?? ''}
                  onChange={(e) => update({ category_id: e.target.value })}
                  placeholder="Any kind of ingredient"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  value={state.supplier_id ?? ''}
                  onChange={(e) => update({ supplier_id: e.target.value })}
                  placeholder="Any supplier"
                  options={(suppliers.data?.data ?? []).map((s) => ({ value: s.name, label: s.name }))}
                />
                <Select
                  value={state.stock_status ?? ''}
                  onChange={(e) => update({ stock_status: e.target.value })}
                  placeholder="Any amount left"
                  options={[
                    { value: 'low', label: 'Running low' },
                    { value: 'out', label: 'All gone' },
                    { value: 'in', label: 'Plenty left' },
                  ]}
                />
              </>
            }
          >
            <SearchInput
              value={state.search ?? ''}
              onChange={(search) => update({ search })}
              placeholder="Search for an ingredient…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          sort={state.sort}
          order={state.order}
          onSort={setSort}
          rows={table.rows}
          startIndex={table.startIndex}
          rowKey={(r) => r.item_id}
          onRowClick={(r) => router.push(`/movements/item/${r.item_id}`)}
          columns={[
            {
              key: 'name',
              label: 'Ingredient',
              sortable: true,
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub">{r.category_name || 'No category'}</div>
                </div>
              ),
            },
            {
              key: 'quantity',
              label: 'In main store',
              align: 'right',
              sortable: true,
              render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
            },
            {
              key: 'in_kitchens',
              label: 'In kitchens',
              align: 'right',
              render: (r) => <span className="muted">{qty(r.in_kitchens, r.unit_code)}</span>,
            },
            {
              key: 'min_level',
              label: 'Minimum',
              align: 'right',
              sortable: true,
              render: (r) => <span className="muted">{qty(r.min_stock_level, r.unit_code)}</span>,
            },
            {
              key: 'stock_status',
              label: 'Status',
              render: (r) => {
                const status = STOCK_STATUS[r.stock_status];
                return (
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                );
              },
            },
            {
              key: 'value',
              label: 'Value',
              align: 'right',
              sortable: true,
              render: (r) => money(r.stock_value),
            },
          ]}
          empty={
            <EmptyState
              icon="box"
              title="Nothing found"
              message="Try a different search, or clear the filters to see everything."
              action={<Button onClick={() => router.push('/items')}>Manage ingredients</Button>}
            />
          }
          footer={
            rows.length > 0 && (
              <tr>
                <td colSpan={5} className="right">
                  Total of everything shown
                </td>
                <td className="num">
                  {money(rows.reduce((sum, r) => sum + Number(r.stock_value), 0))}
                </td>
              </tr>
            )
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>
    </Layout>
  );
}
