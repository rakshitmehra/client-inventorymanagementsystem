'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useFetch, useListState } from '@/lib/hooks';
import { qs } from '@/lib/api';
import { dateTime, isoDate, money, num } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  FilterBar,Pagination,
  SearchInput,
  Select,
} from '@/components/ui';

export default function TransfersPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [state, update] = useListState({ page_size: 25 });

  const { data, loading, error } = useFetch(`/transfers${qs(state)}`);
  const kitchens = useFetch('/kitchens?include_inactive=true');

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
          rows={data?.data ?? []}
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

        {data?.meta && (
          <div className="card-foot">
            <Pagination meta={data.meta} onPage={(page) => update({ page })} />
          </div>
        )}
      </div>
    </Layout>
  );
}
