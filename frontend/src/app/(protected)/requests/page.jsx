'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { StockTabs } from '@/components/StockTabs';
import { useAuth } from '@/lib/auth';
import { FETCH_ALL, useClientTable, useFetch, useListState } from '@/lib/hooks';
import { dateTime, num } from '@/lib/format';
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

const STATUS_TONE = {
  PENDING: 'amber',
  APPROVED: 'green',
  DECLINED: 'red',
  CANCELLED: 'gray',
};

const STATUS_LABEL = {
  PENDING: 'Waiting',
  APPROVED: 'Sent',
  DECLINED: 'Turned down',
  CANCELLED: 'Withdrawn',
};

export default function RequestsPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [state, update] = useListState();

  const { data, loading, error } = useFetch(`/requests?page_size=${FETCH_ALL}`);

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['request_no', 'kitchen_name', 'requested_by_name'],
    filters: { status: state.status ?? '', kitchen_id: state.kitchen_id ?? '' },
    serverTotal: data?.meta?.total,
  });
  const kitchens = useFetch('/kitchens', { skip: !isAdmin });

  const waiting = data?.meta?.pending ?? 0;
  const hasFilters = !!(state.search || state.status || state.kitchen_id);

  return (
    <Layout
      title={isAdmin ? 'Stock Requests' : 'My Requests'}
      subtitle={
        isAdmin
          ? 'What the kitchens have asked the main store to send them'
          : 'What you have asked the main store for, and how it went'
      }
      actions={
        !isAdmin && (
          <Button variant="primary" icon="request" onClick={() => router.push('/requests/new')}>
            Ask for Stock
          </Button>
        )
      }
    >
      <StockTabs />
      {error && <Alert tone="error">{error.message}</Alert>}

      {waiting > 0 && (
        <Alert tone="warn" title={`${waiting} request${waiting === 1 ? '' : 's'} waiting`}>
          {isAdmin
            ? 'Open one to send the stock, change the amounts, or turn it down.'
            : 'The main store has not decided on these yet.'}
        </Alert>
      )}

      <div className="grid cols-3 mb-16">
        <Stat icon="request" tone="amber" label="Waiting on a decision" value={num(waiting)} />
        <Stat icon="list" tone="blue" label="Requests shown" value={num(table.meta.total)} />
        <Stat
          icon="check-circle"
          tone="green"
          label="Sent"
          value={num(table.allRows.filter((r) => r.status === 'APPROVED').length)}
          meta="matching the filters"
        />
      </div>

      <div className="card">
        <div className="card-head">
          <FilterBar
            hasFilters={hasFilters}
            onClear={() => update({ search: '', status: '', kitchen_id: '' })}
            more={
              <>
                <Select
                  value={state.status ?? ''}
                  onChange={(e) => update({ status: e.target.value })}
                  placeholder="Any status"
                  options={[
                    { value: 'PENDING', label: 'Waiting' },
                    { value: 'APPROVED', label: 'Sent' },
                    { value: 'DECLINED', label: 'Turned down' },
                    { value: 'CANCELLED', label: 'Withdrawn' },
                  ]}
                />
                {isAdmin && (
                  <Select
                    value={state.kitchen_id ?? ''}
                    onChange={(e) => update({ kitchen_id: e.target.value })}
                    placeholder="All kitchens"
                    options={(kitchens.data?.data ?? []).map((k) => ({
                      value: k.id,
                      label: k.name,
                    }))}
                  />
                )}
              </>
            }
          >
            <SearchInput
              value={state.search ?? ''}
              onChange={(search) => update({ search })}
              placeholder="Search request number or kitchen…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          columns={[
            {
              key: 'request_no',
              label: 'Request',
              render: (r) => (
                <>
                  <div className="mono strong">{r.request_no}</div>
                  <div className="cell-sub">{dateTime(r.requested_at)}</div>
                </>
              ),
            },
            ...(isAdmin
              ? [
                  {
                    key: 'kitchen_name',
                    label: 'Kitchen',
                    render: (r) => (
                      <>
                        <div>{r.kitchen_name}</div>
                        <div className="cell-sub">{r.requested_by_name}</div>
                      </>
                    ),
                  },
                ]
              : []),
            {
              key: 'total_items',
              label: 'Items',
              align: 'right',
              render: (r) => num(r.total_items),
            },
            {
              key: 'needed_by',
              label: 'Needed by',
              render: (r) => r.needed_by ?? <span className="muted">—</span>,
            },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                <Badge tone={STATUS_TONE[r.status] ?? 'gray'}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </Badge>
              ),
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <Button size="sm" onClick={() => router.push(`/requests/${r.id}`)}>
                  {isAdmin && r.status === 'PENDING' ? 'Review' : 'Open'}
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="request"
              title={isAdmin ? 'No requests yet' : 'You have not asked for anything yet'}
              message={
                isAdmin
                  ? 'When a kitchen asks the main store for stock, it will appear here.'
                  : 'Use "Ask for Stock" when your kitchen is running low on something.'
              }
              action={
                !isAdmin && (
                  <Button variant="primary" onClick={() => router.push('/requests/new')}>
                    Ask for Stock
                  </Button>
                )
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>
    </Layout>
  );
}
