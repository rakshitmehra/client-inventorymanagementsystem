'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { FETCH_ALL, useClientTable, useFetch, useListState } from '@/lib/hooks';
import { dateTime, isoDate, money, num } from '@/lib/format';
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

export default function TransfersPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [state, update] = useListState();

  // Fetched once. Every control below narrows this copy in the browser, so the
  // list reacts as you type rather than after a round trip.
  const { data, loading, error } = useFetch(`/transfers?page_size=${FETCH_ALL}`);
  const kitchens = useFetch('/kitchens?include_inactive=true');

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['transfer_no', 'source_label', 'destination_label'],
    predicate: (row) => {
      // A transfer touches a kitchen at either end, so match both: picking
      // "Central Kitchen" should show what it received AND what it sent back.
      if (state.kitchen_id) {
        const want = String(state.kitchen_id);
        const touches =
          String(row.from_kitchen_id ?? '') === want || String(row.to_kitchen_id ?? '') === want;
        if (!touches) return false;
      }
      if (state.direction === 'to_kitchen' && row.to_location_type !== 'KITCHEN') return false;
      if (state.direction === 'to_main' && row.to_location_type !== 'MAIN') return false;
      const day = (row.transfer_date ?? '').slice(0, 10);
      if (state.from && day < state.from) return false;
      if (state.to && day > state.to) return false;
      return true;
    },
    serverTotal: data?.meta?.total,
    resetKey: state,
  });

  const hasFilters =
    state.search || state.kitchen_id || state.direction || state.from || state.to;

  return (
    <Layout
      title={isAdmin ? 'Stock Transfers' : 'Incoming Transfers'}
      subtitle={
        isAdmin
          ? 'Every movement between the Main Inventory and the kitchens'
          : 'Stock sent to your kitchen from the Main Inventory'
      }
      actions={
        isAdmin && (
          <Button variant="primary" onClick={() => router.push('/transfers/new')}>
            New transfer
          </Button>
        )
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <FilterBar
            hasFilters={hasFilters}
            onClear={() => update({ search: '', kitchen_id: '', direction: '', from: '', to: '' })}
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
                  value={state.direction ?? ''}
                  onChange={(e) => update({ direction: e.target.value })}
                  placeholder="Any direction"
                  options={[
                    { value: 'to_kitchen', label: 'Main → Kitchen' },
                    { value: 'to_main', label: 'Kitchen → Main' },
                  ]}
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
              placeholder="Search transfer number…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          onRowClick={(r) => router.push(`/transfers/${r.id}`)}
          columns={[
            {
              key: 'transfer_no',
              label: 'Transfer',
              render: (r) => (
                <div>
                  <div className="cell-title mono">{r.transfer_no}</div>
                  <div className="cell-sub">{dateTime(r.transfer_date)}</div>
                </div>
              ),
            },
            {
              key: 'route',
              label: 'Route',
              render: (r) => (
                <div className="flex items-center gap-8 nowrap">
                  <span>{r.source_label}</span>
                  <span className="muted">→</span>
                  <strong>{r.destination_label}</strong>
                </div>
              ),
            },
            { key: 'total_items', label: 'Items', align: 'right', render: (r) => num(r.total_items) },
            {
              key: 'total_cost',
              label: 'Value',
              align: 'right',
              render: (r) => money(r.total_cost),
            },
            {
              key: 'created_by_name',
              label: 'Transferred by',
              render: (r) => <span className="muted">{r.created_by_name || '—'}</span>,
            },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                <Badge tone={r.status === 'COMPLETED' ? 'green' : 'gray'} dot>
                  {r.status === 'COMPLETED' ? 'Completed' : r.status}
                </Badge>
              ),
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
                    router.push(`/print/transfer/${r.id}`);
                  }}
                >
                  Slip
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="transfer"
              title="No transfers recorded"
              message={
                isAdmin
                  ? 'Move stock from the Main Inventory to a kitchen to create the first transfer.'
                  : 'Deliveries to your kitchen will be listed here.'
              }
              action={
                isAdmin ? (
                  <Button variant="primary" onClick={() => router.push('/transfers/new')}>
                    New transfer
                  </Button>
                ) : null
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>
    </Layout>
  );
}
