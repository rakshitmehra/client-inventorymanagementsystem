'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch, useListState, useReference } from '@/lib/hooks';
import { api, qs } from '@/lib/api';
import { STOCK_STATUS, dateTime, money, num, qty } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Loading,
  Modal,
  NumberInput,
  FilterBar,Pagination,
  SearchInput,
  Select,
  Stat,
  useToast,
} from '@/components/ui';

export default function KitchenInventoryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <KitchenInventory />
    </Suspense>
  );
}

function KitchenInventory() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { categories } = useReference();
  const searchParams = useSearchParams();

  const [state, update, setSort] = useListState({
    sort: 'name',
    order: 'asc',
    page_size: 50,
    stock_status: searchParams.get('stock_status') ?? '',
  });
  const [editing, setEditing] = useState(null);
  const [minLevel, setMinLevel] = useState('');
  const { run, loading: saving } = useAction();

  const { data, loading, error, reload } = useFetch(`/kitchens/${id}/inventory${qs(state)}`);
  const rows = data?.data ?? [];
  const meta = data?.meta;
  const kitchen = data?.kitchen;

  async function saveMinLevel() {
    try {
      await run(() =>
        api.patch(`/kitchens/${id}/inventory/${editing.item_id}/min-level`, {
          min_stock_level: Number(minLevel),
        }),
      );
      toast.success(`Minimum level updated for ${editing.item_name}`);
      setEditing(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Layout
      title={kitchen ? `${kitchen.name} — Inventory` : 'Kitchen Inventory'}
      subtitle="Stock held by this kitchen, separate from the Main Inventory"
      actions={
        isAdmin ? (
          <>
            <Button size="sm" onClick={() => router.push(`/kitchens/${id}`)}>
              Kitchen details
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => router.push(`/transfers/new?kitchen=${id}`)}
            >
              Send stock here
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={() => router.push('/production/new')}>
            Record production
          </Button>
        )
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="grid cols-4 mb-16">
        <Stat icon="rupee" tone="green" label="Stock value" value={money(meta?.stock_value ?? 0)} />
        <Stat icon="ingredient" tone="blue" label="Items held" value={num(meta?.total ?? 0)} />
        <Stat
          icon="alert"
          tone="amber"
          label="Low on this page"
          value={num(rows.filter((r) => r.stock_status === 'LOW').length)}
        />
        <Stat
          icon="out"
          tone="red"
          label="Out on this page"
          value={num(rows.filter((r) => r.stock_status === 'OUT').length)}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <FilterBar
            more={
              <>
                <Select
                  value={state.category_id ?? ''}
                  onChange={(e) => update({ category_id: e.target.value })}
                  placeholder="All categories"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  value={state.stock_status ?? ''}
                  onChange={(e) => update({ stock_status: e.target.value })}
                  placeholder="Any stock level"
                  options={[
                    { value: 'low', label: 'Low stock' },
                    { value: 'out', label: 'Out of stock' },
                    { value: 'in', label: 'Healthy' },
                  ]}
                />
                <Select
                  value={state.hide_zero ?? ''}
                  onChange={(e) => update({ hide_zero: e.target.value })}
                  options={[
                    { value: '', label: 'Show all lines' },
                    { value: 'true', label: 'Hide empty lines' },
                  ]}
                />
              </>
            }
          >
            <SearchInput
              value={state.search ?? ''}
              onChange={(search) => update({ search })}
              placeholder="Search by name or SKU…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          sort={state.sort}
          order={state.order}
          onSort={setSort}
          rows={rows}
          rowKey={(r) => r.item_id}
          columns={[
            {
              key: 'name',
              label: 'Item',
              sortable: true,
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub">
                    <span className="mono">{r.sku}</span>
                    {r.category_name ? ` · ${r.category_name}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'quantity',
              label: 'On hand',
              align: 'right',
              sortable: true,
              render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
            },
            {
              key: 'effective_min_level',
              label: 'Min level',
              align: 'right',
              render: (r) => (
                <span className="muted">
                  {qty(r.effective_min_level, r.unit_code)}
                  {r.kitchen_min_level > 0 && r.kitchen_min_level !== r.item_min_level && (
                    <span className="xs"> (kitchen)</span>
                  )}
                </span>
              ),
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
            {
              key: 'updated_at',
              label: 'Last movement',
              sortable: true,
              render: (r) => <span className="muted small nowrap">{dateTime(r.updated_at)}</span>,
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <div className="flex gap-4 nowrap">
                  <Link
                    className="btn btn-ghost btn-sm"
                    href={`/movements/item/${r.item_id}?kitchen_id=${id}`}
                  >
                    History
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(r);
                      setMinLevel(String(r.kitchen_min_level ?? 0));
                    }}
                  >
                    Min level
                  </Button>
                </div>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="kitchen"
              title="This kitchen holds no stock yet"
              message={
                isAdmin
                  ? 'Transfer items from the Main Inventory to get this kitchen started.'
                  : 'Stock sent from the Main Inventory will appear here.'
              }
              action={
                isAdmin ? (
                  <Button
                    variant="primary"
                    onClick={() => router.push(`/transfers/new?kitchen=${id}`)}
                  >
                    Send stock
                  </Button>
                ) : null
              }
            />
          }
        />

        {meta && (
          <div className="card-foot">
            <Pagination meta={meta} onPage={(page) => update({ page })} />
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        title="Kitchen minimum level"
        subtitle={editing ? `${editing.item_name} at ${kitchen?.name}` : ''}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveMinLevel} loading={saving}>
              Save level
            </Button>
          </>
        }
      >
        <p className="muted small mb-16">
          This kitchen will be flagged as low when its stock falls to or below this level. The
          catalogue default for this item is{' '}
          {editing ? qty(editing.item_min_level, editing.unit_code) : '—'}; the higher of the two is
          used.
        </p>
        <Field label={`Minimum level (${editing?.unit_code ?? ''})`} required>
          <NumberInput
            value={minLevel}
            min="0"
            onChange={(e) => setMinLevel(e.target.value)}
            autoFocus
          />
        </Field>
      </Modal>
    </Layout>
  );
}
