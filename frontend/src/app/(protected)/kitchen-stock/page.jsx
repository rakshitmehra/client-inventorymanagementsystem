'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useClientTable, useFetch, useListState } from '@/lib/hooks';
import { qs } from '@/lib/api';
import { isoDate, money, num, qty } from '@/lib/format';
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

/**
 * Everything a kitchen was sent, used and has left, on one line per item.
 *
 * These three facts already existed, but on three different screens: what was
 * sent is in the transfer list, what was used is in the production and
 * wastage records, and what is left is on the stock page. Nobody can hold
 * three screens side by side, so the question "are they getting through what
 * we send them, and what are they about to run out of" had no answer.
 *
 * Sent, used and wasted are counted over the chosen dates. What is left
 * deliberately is not - it is the shelf right now, because a level that was
 * true three weeks ago is not something anybody can act on.
 */
export default function KitchenStockPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [state, update] = useListState({ status: 'ALL' });

  const from = state.from ?? isoDate(29);
  const to = state.to ?? isoDate();

  // Only the dates and the kitchen go to the server; the rest narrows here.
  const { data, loading, error } = useFetch(
    `/reports/kitchen-activity${qs({ from, to, kitchen_id: state.kitchen_id })}`,
  );
  const kitchens = useFetch('/kitchens?include_inactive=true');

  const rows = data?.data ?? [];
  const meta = data?.meta ?? {};

  const table = useClientTable(rows, {
    search: state.search ?? '',
    searchKeys: ['item_name', 'sku', 'kitchen_name', 'category_name'],
    predicate: (row) => {
      if (state.status === 'LOW') return row.stock_status === 'LOW';
      if (state.status === 'OUT') return row.stock_status === 'OUT';
      if (state.status === 'SHORT') return row.stock_status !== 'OK';
      if (state.status === 'MOVED') return row.sent > 0 || row.used > 0 || row.wasted > 0;
      if (state.status === 'UNUSED') return row.sent > 0 && row.used === 0;
      return true;
    },
    resetKey: state,
  });

  const shown = table.allRows;
  const short = shown.filter((r) => r.stock_status !== 'OK').length;
  // Sent but never touched: either they do not need it, or nobody told us.
  const untouched = shown.filter((r) => r.sent > 0 && r.used === 0).length;

  return (
    <Layout
      title="Kitchen Stock"
      subtitle="What each kitchen was sent, what they used, and what is running out"
      actions={
        <Button onClick={() => window.print()} icon="printer">
          Print
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="grid cols-4 mb-16">
        <Stat icon="box" tone="blue" label="Item lines" value={num(shown.length)} meta={`across ${new Set(shown.map((r) => r.kitchen_id)).size} kitchen(s)`} />
        <Stat icon="alert" tone={short > 0 ? 'amber' : 'green'} label="Running low or out" value={num(short)} meta={short > 0 ? 'Needs restocking' : 'Nothing short'} />
        <Stat icon="rupee" tone="green" label="Stock held" value={money(meta.stock_value ?? 0)} meta="Right now" />
        <Stat icon="trash" tone="red" label="Wasted in this period" value={money(meta.wasted_value ?? 0)} meta={`${from} to ${to}`} />
      </div>

      {untouched > 0 && state.status !== 'UNUSED' && (
        <Alert tone="info" title={`${untouched} item${untouched === 1 ? '' : 's'} sent but not used`}>
          Stock went to a kitchen in this period and none of it has been recorded against
          production.{' '}
          <button type="button" className="link-button" onClick={() => update({ status: 'UNUSED' })}>
            Show just those
          </button>
        </Alert>
      )}

      <div className="card">
        <div className="card-head">
          <FilterBar
            hasFilters={!!(state.search || state.kitchen_id || state.from || state.to || (state.status && state.status !== 'ALL'))}
            onClear={() => update({ search: '', kitchen_id: '', from: '', to: '', status: 'ALL' })}
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
                  value={state.status ?? 'ALL'}
                  onChange={(e) => update({ status: e.target.value })}
                  options={[
                    { value: 'ALL', label: 'Everything' },
                    { value: 'SHORT', label: 'Low or out' },
                    { value: 'LOW', label: 'Running low' },
                    { value: 'OUT', label: 'All gone' },
                    { value: 'MOVED', label: 'Had movement' },
                    { value: 'UNUSED', label: 'Sent but unused' },
                  ]}
                />
                <DateInput
                  value={from}
                  max={isoDate()}
                  onChange={(e) => update({ from: e.target.value })}
                  title="From date"
                />
                <DateInput
                  value={to}
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
              placeholder="Search item or kitchen…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          rowKey={(r) => `${r.kitchen_id}-${r.item_id}`}
          onRowClick={(r) => router.push(`/movements/item/${r.item_id}?kitchen_id=${r.kitchen_id}`)}
          columns={[
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub">
                    {isAdmin && <>{r.kitchen_name} · </>}
                    <span className="mono">{r.sku}</span>
                  </div>
                </div>
              ),
            },
            {
              key: 'sent',
              label: 'Sent',
              align: 'right',
              render: (r) =>
                r.sent > 0 ? qty(r.sent, r.unit_code) : <span className="muted">—</span>,
            },
            {
              key: 'used',
              label: 'Used',
              align: 'right',
              render: (r) =>
                r.used > 0 ? qty(r.used, r.unit_code) : <span className="muted">—</span>,
            },
            {
              key: 'wasted',
              label: 'Wasted',
              align: 'right',
              render: (r) =>
                r.wasted > 0 ? (
                  <span className="danger-text">{qty(r.wasted, r.unit_code)}</span>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: 'quantity',
              label: 'In stock',
              align: 'right',
              render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
            },
            {
              key: 'min_level',
              label: 'Min',
              align: 'right',
              render: (r) => <span className="muted">{num(r.min_level)}</span>,
            },
            {
              key: 'stock_status',
              label: 'Status',
              render: (r) =>
                r.stock_status === 'OUT' ? (
                  <Badge tone="red" dot>All gone</Badge>
                ) : r.stock_status === 'LOW' ? (
                  <Badge tone="amber" dot>Running low</Badge>
                ) : (
                  <Badge tone="green" dot>Fine</Badge>
                ),
            },
          ]}
          empty={
            <EmptyState
              icon="kitchen"
              title="Nothing to show"
              message="No kitchen is holding stock that matches these filters. Try widening the dates or clearing the filters."
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>
    </Layout>
  );
}
