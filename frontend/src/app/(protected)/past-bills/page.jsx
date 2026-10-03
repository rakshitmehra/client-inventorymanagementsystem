'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { FETCH_ALL, useClientTable, useFetch, useListState } from '@/lib/hooks';
import { date, isoDate, money, num } from '@/lib/format';
import {
  Alert,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  FilterBar,
  Pagination,
  SearchInput,
  Stat,
} from '@/components/ui';

export default function PastBillsPage() {
  return (
    <AdminOnly>
      <PastBills />
    </AdminOnly>
  );
}

function PastBills() {
  const router = useRouter();
  const [state, update] = useListState();
  const { data, loading, error } = useFetch(`/past-bills?page_size=${FETCH_ALL}`);

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['bill_no', 'supplier_name', 'invoice_no', 'notes'],
    predicate: (row) => {
      if (state.from && row.bill_date < state.from) return false;
      if (state.to && row.bill_date > state.to) return false;
      return true;
    },
    serverTotal: data?.meta?.total,
    resetKey: state,
  });

  const shownTotal = table.allRows.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0);

  return (
    <Layout
      title="Past Bills"
      subtitle="Old bills kept on file for audit. They do not change your stock."
      actions={
        <Button variant="primary" icon="plus" onClick={() => router.push('/past-bills/new')}>
          Add a past bill
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="grid cols-2 mb-16">
        <Stat icon="documents" tone="blue" label="Bills shown" value={num(table.meta.total)} />
        <Stat icon="rupee" tone="amber" label="Total of bills shown" value={money(shownTotal)} />
      </div>

      <div className="card">
        <div className="card-head">
          <FilterBar
            more={
              <>
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
              placeholder="Search supplier or bill number…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          onRowClick={(r) => router.push(`/past-bills/${r.id}`)}
          columns={[
            {
              key: 'bill_date',
              label: 'Date',
              render: (r) => (
                <div>
                  <div className="cell-title">{date(r.bill_date)}</div>
                  <div className="cell-sub mono">{r.bill_no}</div>
                </div>
              ),
            },
            { key: 'supplier_name', label: 'Bought from' },
            {
              key: 'invoice_no',
              label: 'Bill number',
              render: (r) => r.invoice_no || <span className="muted">—</span>,
            },
            { key: 'item_count', label: 'Items', align: 'right' },
            {
              key: 'total_amount',
              label: 'Amount',
              align: 'right',
              render: (r) => <strong>{money(r.total_amount)}</strong>,
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <Button size="sm" variant="ghost" onClick={() => router.push(`/past-bills/${r.id}`)}>
                  Open
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="documents"
              title="No past bills yet"
              message="Add an old bill and it will be kept here for your records."
              action={<Button onClick={() => router.push('/past-bills/new')}>Add a past bill</Button>}
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} onPageSize={table.setPageSize} />
      </div>
    </Layout>
  );
}
