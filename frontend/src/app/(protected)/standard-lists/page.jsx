'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useClientTable, useFetch } from '@/lib/hooks';
import { dateTime, money, num } from '@/lib/format';
import { RunListButton } from '@/components/RunList';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Pagination,
  SearchInput,
} from '@/components/ui';

/**
 * Standard lists: the orders that get placed again and again.
 *
 * The whole point of this screen is the Run button. Refilling the main store
 * is eighty-odd lines that barely change month to month, and typing them in
 * is both slow and where the mistakes come from. Here it is one click, with
 * a confirmation that says plainly what is about to happen.
 *
 * "Open" is for the month where something does change - a line more, a line
 * less, a different quantity - and lets that be adjusted before anything is
 * committed, without editing the saved list.
 */
export default function StandardListsPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();

  const { data, loading, error, reload } = useFetch('/standard-lists');
  const [search, setSearch] = useState('');

  const table = useClientTable(data?.data, {
    search,
    searchKeys: ['name', 'kitchen_name', 'supplier_name'],
    resetKey: search,
  });

  return (
    <Layout
      title="Standard Lists"
      subtitle={
        isAdmin
          ? 'The orders you place again and again — run a whole list in one click'
          : 'What your kitchen normally takes — ask for the lot in one click'
      }
      actions={
        isAdmin && (
          <Button variant="primary" icon="plus" onClick={() => router.push('/standard-lists/new')}>
            New list
          </Button>
        )
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <SearchInput value={search} onChange={setSearch} placeholder="Search lists…" />
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          onRowClick={(r) => router.push(`/standard-lists/${r.id}`)}
          columns={[
            {
              key: 'name',
              label: 'List',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.name}</div>
                  <div className="cell-sub">
                    {r.purpose === 'REFILL'
                      ? `Buys into the main store${r.supplier_name ? ` · ${r.supplier_name}` : ''}`
                      : `Goes to ${r.kitchen_name}`}
                  </div>
                </div>
              ),
            },
            {
              key: 'purpose',
              label: 'What it does',
              render: (r) => (
                <Badge tone={r.purpose === 'REFILL' ? 'blue' : 'green'}>
                  {r.purpose === 'REFILL' ? 'Refill' : 'Delivery'}
                </Badge>
              ),
            },
            {
              key: 'total_items',
              label: 'Items',
              align: 'right',
              render: (r) => num(r.total_items),
            },
            {
              key: 'estimated_cost',
              label: 'Roughly',
              align: 'right',
              render: (r) =>
                r.estimated_cost > 0 ? money(r.estimated_cost) : <span className="muted">—</span>,
            },
            {
              key: 'last_used_at',
              label: 'Last run',
              render: (r) =>
                r.last_used_at ? (
                  dateTime(r.last_used_at)
                ) : (
                  <span className="muted">Never</span>
                ),
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <div className="flex gap-4 nowrap">
                  <RunListButton list={r} onDone={reload} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/standard-lists/${r.id}`);
                    }}
                  >
                    Open
                  </Button>
                </div>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="documents"
              title="No standard lists yet"
              message={
                isAdmin
                  ? 'Save the order you place every month, then run the whole thing in one click instead of typing it out.'
                  : 'Your administrator has not set up a standard list for your kitchen yet.'
              }
              action={
                isAdmin ? (
                  <Button variant="primary" onClick={() => router.push('/standard-lists/new')}>
                    Create the first list
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
