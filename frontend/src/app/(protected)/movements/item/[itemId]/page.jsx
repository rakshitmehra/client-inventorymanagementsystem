'use client';

import { Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { FETCH_ALL, useClientTable, useFetch, useListState } from '@/lib/hooks';
import { qs } from '@/lib/api';
import { MOVEMENT_LABELS, dateTime, isoDate, money, num, qty } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  Loading,
  Pagination,
  Select,
  Stat,
} from '@/components/ui';
import { Icon } from '@/components/Icon';

export default function ItemLedgerPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ItemLedger />
    </Suspense>
  );
}

/**
 * Item-wise movement history: what came in, where it went, what was used and
 * wasted, and what each location holds right now.
 */
function ItemLedger() {
  const { itemId } = useParams();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const searchParams = useSearchParams();

  const [state, update] = useListState({
    kitchen_id: searchParams.get('kitchen_id') ?? '',
  });

  // The dates bound the fetch; the kitchen is picked out here, so switching
  // between kitchens does not re-read the whole history each time.
  const { data, loading, error } = useFetch(
    `/movements/item/${itemId}${qs({ from: state.from, to: state.to, page_size: FETCH_ALL })}`,
  );
  const kitchens = useFetch('/kitchens?include_inactive=true');

  const payload = data?.data;
  const table = useClientTable(payload?.movements, {
    filters: { kitchen_id: state.kitchen_id ?? '' },
    serverTotal: data?.meta?.total,
    resetKey: state,
  });
  const item = payload?.item;
  const summary = payload?.summary ?? {};
  const stock = payload?.stock;

  if (loading && !payload) {
    return (
      <Layout title="Item history">
        <Loading />
      </Layout>
    );
  }
  if (error) {
    return (
      <Layout title="Item history">
        <Alert tone="error">{error.message}</Alert>
      </Layout>
    );
  }
  if (!item) return null;

  return (
    <Layout
      title={item.name}
      subtitle={`${item.sku} · ${item.category_name || 'Uncategorised'} · stocked in ${
        item.unit_name
      } (${item.unit_code})`}
      actions={
        <>
          <Button onClick={() => router.back()}>Back</Button>
          {isAdmin && <Button onClick={() => router.push('/items')}>Item catalogue</Button>}
        </>
      }
    >
      <div className="grid cols-4 mb-16">
        <Stat
          icon="inbox"
          tone="green"
          label="Received into main"
          value={qty(summary.received ?? 0, item.unit_code)}
        />
        <Stat
          icon="transfer"
          tone="blue"
          label="Transferred to kitchens"
          value={qty(summary.transferred_to_kitchens ?? 0, item.unit_code)}
        />
        <Stat
          icon="cooking"
          tone="amber"
          label="Consumed in production"
          value={qty(summary.consumed ?? 0, item.unit_code)}
        />
        <Stat
          icon="out"
          tone="red"
          label="Wasted"
          value={qty(summary.wasted ?? 0, item.unit_code)}
          meta={`${num(summary.movement_count ?? 0)} ledger entries`}
        />
      </div>

      {stock && (
        <div className="card mb-16">
          <div className="card-head">
            <h3>Where this item is right now</h3>
            <span className="muted small">
              Total across the business: <strong>{qty(stock.total_quantity, item.unit_code)}</strong>
              {' · '}
              {money(stock.total_quantity * item.unit_cost)}
            </span>
          </div>
          <div className="card-body">
            <div className="grid cols-auto">
              <div className="stat">
                <div className="stat-icon green">
                  <Icon name="box" size={24} />
                </div>
                <div className="stat-body">
                  <div className="stat-label">Main Inventory</div>
                  <div className="stat-value">{num(stock.main_quantity)}</div>
                  <div className="stat-meta">
                    {item.unit_code} · minimum {num(item.min_stock_level)}
                    {stock.main_quantity <= item.min_stock_level && (
                      <>
                        {' · '}
                        <Badge tone={stock.main_quantity <= 0 ? 'red' : 'amber'}>
                          {stock.main_quantity <= 0 ? 'Out' : 'Low'}
                        </Badge>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {stock.kitchens.map((k) => (
                <div className="stat" key={k.kitchen_id}>
                  <div className="stat-icon blue">
                    <Icon name="kitchen" size={24} />
                  </div>
                  <div className="stat-body">
                    <div className="stat-label">{k.kitchen_name}</div>
                    <div className="stat-value">{num(k.quantity)}</div>
                    <div className="stat-meta">
                      {item.unit_code} · {k.kitchen_code}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Movement history</h3>
          <div className="card-head-actions">
            {isAdmin && (
              <Select
                value={state.kitchen_id ?? ''}
                onChange={(e) => update({ kitchen_id: e.target.value })}
                placeholder="All locations"
                options={(kitchens.data?.data ?? []).map((k) => ({ value: k.id, label: k.name }))}
              />
            )}
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
          </div>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
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
              label: 'Change',
              align: 'right',
              render: (r) => (
                <strong className={r.direction === 'IN' ? 'pos-up' : 'pos-down'}>
                  {r.direction === 'IN' ? '+' : '−'}
                  {num(r.quantity)}
                </strong>
              ),
            },
            {
              key: 'balance_before',
              label: 'Before',
              align: 'right',
              render: (r) => <span className="muted">{num(r.balance_before)}</span>,
            },
            {
              key: 'balance_after',
              label: 'After',
              align: 'right',
              render: (r) => <strong>{num(r.balance_after)}</strong>,
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
          ]}
          empty={
            <EmptyState
              icon="list"
              title="No movements in this period"
              message="Widen the date range to see earlier activity."
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>
    </Layout>
  );
}
