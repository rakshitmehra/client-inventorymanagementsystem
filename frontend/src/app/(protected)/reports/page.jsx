'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/hooks';
import { qs } from '@/lib/api';
import { date, dateTime, humanise, isoDate, money, num, qty } from '@/lib/format';
import {
  Alert,
  Badge,
  BarList,
  Button,
  PagedTable,
  DateInput,
  EmptyState,
  Loading,
  Select,
  Stat,
} from '@/components/ui';

const TABS = [
  { key: 'low-stock', label: 'Low stock', adminOnly: false },
  { key: 'kitchen-stock', label: 'Kitchen stock', adminOnly: false },
  { key: 'consumption', label: 'Item consumption', adminOnly: false },
  { key: 'production', label: 'Production', adminOnly: false },
  { key: 'transfers', label: 'Transfers', adminOnly: true },
  { key: 'wastage', label: 'Wastage', adminOnly: false },
  { key: 'adjustments', label: 'Adjustments', adminOnly: false },
  { key: 'valuation', label: 'Stock valuation', adminOnly: true },
];

export default function ReportsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Reports />
    </Suspense>
  );
}

function Reports() {
  const { isAdmin, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabs = TABS.filter((t) => isAdmin || !t.adminOnly);

  const requested = searchParams.get('tab');
  const active = tabs.some((t) => t.key === requested) ? requested : tabs[0].key;

  const [from, setFrom] = useState(isoDate(29));
  const [to, setTo] = useState(isoDate());
  const [kitchenId, setKitchenId] = useState('');

  const kitchens = useFetch('/kitchens?include_inactive=true');
  const dateless = active === 'low-stock' || active === 'kitchen-stock' || active === 'valuation';
  const query = qs(dateless ? { kitchen_id: kitchenId } : { from, to, kitchen_id: kitchenId });
  const { data, loading, error } = useFetch(`/reports/${active}${query}`);

  const activeTab = tabs.find((t) => t.key === active);
  // These carry ten-ish columns and will not fit A4 portrait.
  const WIDE = new Set(['adjustments', 'transfers', 'consumption', 'valuation']);
  const kitchenName =
    (kitchens.data?.data ?? []).find((k) => String(k.id) === String(kitchenId))?.name ??
    'All kitchens';

  return (
    <Layout
      title="Reports"
      subtitle="Stock levels, consumption, movement and wastage across the business"
      actions={<Button onClick={() => window.print()} icon="printer">Print this report</Button>}
    >
      {/* Marks the whole report for landscape when it is too wide for A4
          portrait; the rule only applies while printing. */}
      {WIDE.has(active) && <div className="report-landscape" aria-hidden="true" />}

      {/* Only ever seen on paper. A printed report that does not say who it
          belongs to, what it covers or when it was run is not evidence of
          anything - it is a screenshot. */}
      <div className="report-print-head">
        <div className="report-print-org">
          <strong>Golden Crust Bakery &amp; Kitchens</strong>
          <span>14 Industrial Estate Road, Pune 411001</span>
        </div>
        <h1>{activeTab?.label ?? 'Report'}</h1>
        <dl className="report-print-meta">
          <dt>Period</dt>
          <dd>{dateless ? 'As at today' : `${from} to ${to}`}</dd>
          <dt>Kitchen</dt>
          <dd>{kitchenName}</dd>
          <dt>Generated</dt>
          <dd>
            {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            {user?.full_name ? ` by ${user.full_name}` : ''}
          </dd>
        </dl>
      </div>

      <div className="tabs no-print">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab${active === tab.key ? ' active' : ''}`}
            onClick={() => router.push(`/reports?tab=${tab.key}`)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="filter-bar mb-16 no-print">
        {!dateless && (
          <>
            <DateInput value={from} max={to} onChange={(e) => setFrom(e.target.value)} title="From" />
            <span className="muted small">to</span>
            <DateInput value={to} max={isoDate()} onChange={(e) => setTo(e.target.value)} title="To" />
            <Button
              size="sm"
              onClick={() => {
                setFrom(isoDate(6));
                setTo(isoDate());
              }}
            >
              7 days
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setFrom(isoDate(29));
                setTo(isoDate());
              }}
            >
              30 days
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setFrom(isoDate(89));
                setTo(isoDate());
              }}
            >
              90 days
            </Button>
          </>
        )}
        {active !== 'valuation' && (
          <Select
            value={kitchenId}
            onChange={(e) => setKitchenId(e.target.value)}
            placeholder={isAdmin ? 'All kitchens' : 'My kitchen'}
            options={(kitchens.data?.data ?? []).map((k) => ({ value: k.id, label: k.name }))}
          />
        )}
      </div>

      {error && <Alert tone="error">{error.message}</Alert>}
      {loading && <Loading label="Building the report…" />}

      {!loading && data && (
        <>
          {active === 'low-stock' && <LowStock data={data.data} isAdmin={isAdmin} router={router} />}
          {active === 'kitchen-stock' && <KitchenStock data={data.data} meta={data.meta} />}
          {active === 'consumption' && <Consumption data={data} />}
          {active === 'production' && <Production data={data} />}
          {active === 'transfers' && <Transfers data={data.data} meta={data.meta} />}
          {active === 'wastage' && <Wastage data={data.data} meta={data.meta} />}
          {active === 'adjustments' && <Adjustments data={data.data} meta={data.meta} />}
          {active === 'valuation' && <Valuation data={data.data} meta={data.meta} />}
        </>
      )}
    </Layout>
  );
}

/* ------------------------------------------------------------------------- */
function LowStock({ data, isAdmin, router }) {
  const main = data.main ?? [];
  const kitchens = data.kitchens ?? [];

  return (
    <>
      <div className="grid cols-3 mb-16">
        <Stat icon="alert" tone="amber" label="Main inventory alerts" value={num(main.length)} />
        <Stat icon="kitchen" tone="red" label="Kitchen alerts" value={num(kitchens.length)} />
        <Stat
          icon="rupee"
          tone="blue"
          label="Est. reorder value"
          value={money(
            main.reduce((s, r) => s + Number(r.reorder_quantity) * Number(r.unit_cost), 0),
          )}
        />
      </div>

      {isAdmin && (
        <div className="card mb-16">
          <div className="card-head">
            <h3>Main Inventory — at or below minimum</h3>
            <span className="muted small">{main.length} item(s)</span>
          </div>
          <PagedTable
            rows={main}
            rowKey={(r) => r.item_id}
            onRowClick={(r) => router.push(`/movements/item/${r.item_id}`)}
            columns={[
              {
                key: 'item_name',
                label: 'Item',
                render: (r) => (
                  <div>
                    <div className="cell-title">{r.item_name}</div>
                    <div className="cell-sub">
                      <span className="mono">{r.sku}</span> · {r.category_name || 'Uncategorised'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'quantity',
                label: 'On hand',
                align: 'right',
                render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
              },
              {
                key: 'min_stock_level',
                label: 'Minimum',
                align: 'right',
                render: (r) => qty(r.min_stock_level, r.unit_code),
              },
              {
                key: 'shortfall',
                label: 'Short by',
                align: 'right',
                render: (r) => <span className="pos-down">{qty(r.shortfall, r.unit_code)}</span>,
              },
              {
                key: 'reorder_quantity',
                label: 'Suggested order',
                align: 'right',
                render: (r) => qty(r.reorder_quantity, r.unit_code),
              },
              {
                key: 'supplier_name',
                label: 'Supplier',
                render: (r) => <span className="muted">{r.supplier_name || '—'}</span>,
              },
              {
                key: 'stock_status',
                label: '',
                render: (r) => (
                  <Badge tone={r.stock_status === 'OUT' ? 'red' : 'amber'}>
                    {r.stock_status === 'OUT' ? 'Out' : 'Low'}
                  </Badge>
                ),
              },
            ]}
            empty={
              <EmptyState
                icon="check-circle"
                title="Main Inventory is healthy"
                message="Every item is above its minimum level."
              />
            }
          />
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Kitchens — at or below minimum</h3>
          <span className="muted small">{kitchens.length} line(s)</span>
        </div>
        <PagedTable
          rows={kitchens}
          rowKey={(r, i) => `${r.kitchen_id}-${r.item_id}-${i}`}
          columns={[
            { key: 'kitchen_name', label: 'Kitchen', render: (r) => <strong>{r.kitchen_name}</strong> },
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub mono">{r.sku}</div>
                </div>
              ),
            },
            {
              key: 'quantity',
              label: 'On hand',
              align: 'right',
              render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
            },
            {
              key: 'min_level',
              label: 'Minimum',
              align: 'right',
              render: (r) => qty(r.min_level, r.unit_code),
            },
            {
              key: 'shortfall',
              label: 'Short by',
              align: 'right',
              render: (r) => <span className="pos-down">{qty(r.shortfall, r.unit_code)}</span>,
            },
            {
              key: 'main_available',
              label: 'Available in main',
              align: 'right',
              render: (r) => (
                <Badge tone={Number(r.main_available) >= Number(r.shortfall) ? 'green' : 'red'}>
                  {qty(r.main_available, r.unit_code)}
                </Badge>
              ),
            },
            {
              key: 'stock_status',
              label: '',
              render: (r) => (
                <Badge tone={r.stock_status === 'OUT' ? 'red' : 'amber'}>
                  {r.stock_status === 'OUT' ? 'Out' : 'Low'}
                </Badge>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="check-circle"
              title="All kitchens are stocked"
              message="No kitchen is below its minimum level."
            />
          }
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
function KitchenStock({ data, meta }) {
  if (!data?.length) {
    return (
      <div className="card">
        <EmptyState
          icon="kitchen"
          title="No kitchen stock"
          message="Transfer stock to a kitchen to see it here."
        />
      </div>
    );
  }
  return (
    <>
      <div className="grid cols-2 mb-16">
        <Stat icon="rupee" tone="green" label="Total kitchen stock value" value={money(meta.total_value)} />
        <Stat icon="kitchen" tone="blue" label="Kitchens reporting" value={num(data.length)} />
      </div>

      {data.map((kitchen) => (
        <div className="card mb-16" key={kitchen.kitchen_id}>
          <div className="card-head">
            <h3>{kitchen.kitchen_name}</h3>
            <span className="muted small">
              {kitchen.kitchen_code} · {kitchen.items.length} item(s)
              {!kitchen.is_active && ' · inactive'}
            </span>
            <div className="card-head-actions">
              <strong>{money(kitchen.stock_value)}</strong>
            </div>
          </div>
          <PagedTable
            rows={kitchen.items}
            rowKey={(r) => `${r.kitchen_id}-${r.item_id}`}
            columns={[
              {
                key: 'item_name',
                label: 'Item',
                render: (r) => (
                  <div>
                    <div className="cell-title">{r.item_name}</div>
                    <div className="cell-sub">
                      <span className="mono">{r.sku}</span> · {r.category_name || 'Uncategorised'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'quantity',
                label: 'On hand',
                align: 'right',
                render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
              },
              {
                key: 'min_level',
                label: 'Minimum',
                align: 'right',
                render: (r) => <span className="muted">{qty(r.min_level, r.unit_code)}</span>,
              },
              {
                key: 'unit_cost',
                label: 'Unit cost',
                align: 'right',
                render: (r) => <span className="muted">{money(r.unit_cost)}</span>,
              },
              { key: 'stock_value', label: 'Value', align: 'right', render: (r) => money(r.stock_value) },
            ]}
            footer={
              <tr>
                <td colSpan={4} className="right">
                  Kitchen total
                </td>
                <td className="num">{money(kitchen.stock_value)}</td>
              </tr>
            }
          />
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------------- */
function Consumption({ data }) {
  const rows = data.data ?? [];
  const byKitchen = data.by_kitchen ?? [];

  return (
    <>
      <div className="grid cols-3 mb-16">
        <Stat icon="cooking" tone="amber" label="Ingredient cost consumed" value={money(data.meta.total_cost)} />
        <Stat icon="ingredient" tone="blue" label="Distinct items used" value={num(rows.length)} />
        <Stat icon="kitchen" tone="green" label="Kitchens producing" value={num(byKitchen.length)} />
      </div>

      {byKitchen.length > 0 && (
        <div className="card mb-16">
          <div className="card-head">
            <h3>Consumption by kitchen</h3>
          </div>
          <div className="card-body">
            <BarList
              items={byKitchen.map((k) => ({
                id: k.kitchen_id,
                label: k.kitchen_name,
                value: Number(k.total_cost),
              }))}
              format={(v) => money(v)}
            />
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Item consumption</h3>
          <span className="muted small">
            {date(data.meta.from)} – {date(data.meta.to)}
          </span>
        </div>
        <PagedTable
          rows={rows}
          rowKey={(r) => r.item_id}
          columns={[
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub">
                    <span className="mono">{r.sku}</span> · {r.category_name || 'Uncategorised'}
                  </div>
                </div>
              ),
            },
            {
              key: 'total_consumed',
              label: 'Consumed',
              align: 'right',
              render: (r) => <strong>{qty(r.total_consumed, r.unit_code)}</strong>,
            },
            {
              key: 'production_runs',
              label: 'Runs',
              align: 'right',
              render: (r) => num(r.production_runs),
            },
            {
              key: 'kitchen_count',
              label: 'Kitchens',
              align: 'right',
              render: (r) => num(r.kitchen_count),
            },
            { key: 'total_cost', label: 'Cost', align: 'right', render: (r) => money(r.total_cost) },
          ]}
          empty={
            <EmptyState
              icon="cooking"
              title="No consumption in this period"
              message="Record production to see ingredient usage."
            />
          }
          footer={
            rows.length > 0 && (
              <tr>
                <td colSpan={4} className="right">
                  Total
                </td>
                <td className="num">{money(data.meta.total_cost)}</td>
              </tr>
            )
          }
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
function Production({ data }) {
  const byProduct = data.data?.by_product ?? [];
  const byKitchen = data.data?.by_kitchen ?? [];

  return (
    <>
      <div className="grid cols-3 mb-16">
        <Stat icon="cooking" tone="violet" label="Units produced" value={num(data.meta.total_output)} />
        <Stat icon="rupee" tone="amber" label="Ingredient cost" value={money(data.meta.total_cost)} />
        <Stat icon="product" tone="green" label="Products made" value={num(byProduct.length)} />
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h3>By product</h3>
          <span className="muted small">
            {date(data.meta.from)} – {date(data.meta.to)}
          </span>
        </div>
        <PagedTable
          rows={byProduct}
          rowKey={(r) => r.product_id}
          columns={[
            {
              key: 'product_name',
              label: 'Product',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.product_name}</div>
                  <div className="cell-sub mono">{r.sku}</div>
                </div>
              ),
            },
            { key: 'runs', label: 'Runs', align: 'right', render: (r) => num(r.runs) },
            {
              key: 'total_output',
              label: 'Produced',
              align: 'right',
              render: (r) => <strong>{qty(r.total_output, r.unit_code)}</strong>,
            },
            {
              key: 'total_cost',
              label: 'Ingredient cost',
              align: 'right',
              render: (r) => money(r.total_cost),
            },
            {
              key: 'estimated_revenue',
              label: 'Est. sale value',
              align: 'right',
              render: (r) => money(r.estimated_revenue),
            },
            {
              key: 'margin',
              label: 'Margin',
              align: 'right',
              render: (r) => {
                if (!r.estimated_revenue) return <span className="muted">—</span>;
                const margin = ((r.estimated_revenue - r.total_cost) / r.estimated_revenue) * 100;
                return (
                  <Badge tone={margin > 50 ? 'green' : margin > 25 ? 'amber' : 'red'}>
                    {Math.round(margin)}%
                  </Badge>
                );
              },
            },
          ]}
          empty={<EmptyState icon="cooking" title="No production in this period" />}
        />
      </div>

      {byKitchen.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>By kitchen</h3>
          </div>
          <PagedTable
            rows={byKitchen}
            rowKey={(r) => r.kitchen_id}
            columns={[
              { key: 'kitchen_name', label: 'Kitchen', render: (r) => <strong>{r.kitchen_name}</strong> },
              { key: 'runs', label: 'Runs', align: 'right', render: (r) => num(r.runs) },
              {
                key: 'distinct_products',
                label: 'Products',
                align: 'right',
                render: (r) => num(r.distinct_products),
              },
              {
                key: 'total_output',
                label: 'Units produced',
                align: 'right',
                render: (r) => <strong>{num(r.total_output)}</strong>,
              },
              {
                key: 'total_cost',
                label: 'Ingredient cost',
                align: 'right',
                render: (r) => money(r.total_cost),
              },
            ]}
          />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------- */
function Transfers({ data, meta }) {
  return (
    <>
      <div className="grid cols-3 mb-16">
        <Stat icon="transfer" tone="blue" label="Transfers" value={num(meta.total_transfers)} />
        <Stat icon="kitchen" tone="green" label="Kitchens supplied" value={num(data.by_kitchen.length)} />
        <Stat icon="ingredient" tone="amber" label="Distinct items moved" value={num(data.by_item.length)} />
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h3>Stock sent to each kitchen</h3>
          <span className="muted small">
            {date(meta.from)} – {date(meta.to)}
          </span>
        </div>
        <PagedTable
          rows={data.by_kitchen}
          rowKey={(r) => r.kitchen_id}
          columns={[
            { key: 'kitchen_name', label: 'Kitchen', render: (r) => <strong>{r.kitchen_name}</strong> },
            {
              key: 'transfer_count',
              label: 'Transfers',
              align: 'right',
              render: (r) => num(r.transfer_count),
            },
            {
              key: 'distinct_items',
              label: 'Distinct items',
              align: 'right',
              render: (r) => num(r.distinct_items),
            },
            {
              key: 'total_value',
              label: 'Value sent',
              align: 'right',
              render: (r) => <strong>{money(r.total_value)}</strong>,
            },
          ]}
          empty={<EmptyState icon="transfer" title="No transfers in this period" />}
        />
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h3>Most transferred items</h3>
        </div>
        <PagedTable
          rows={data.by_item}
          rowKey={(r) => r.item_id}
          columns={[
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub mono">{r.sku}</div>
                </div>
              ),
            },
            {
              key: 'transfer_count',
              label: 'Transfers',
              align: 'right',
              render: (r) => num(r.transfer_count),
            },
            {
              key: 'total_quantity',
              label: 'Quantity moved',
              align: 'right',
              render: (r) => <strong>{qty(r.total_quantity, r.unit_code)}</strong>,
            },
            { key: 'total_value', label: 'Value', align: 'right', render: (r) => money(r.total_value) },
          ]}
          empty={<EmptyState icon="ingredient" title="No items transferred" />}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>All transfers</h3>
        </div>
        <PagedTable
          rows={data.transfers}
          columns={[
            {
              key: 'transfer_no',
              label: 'Number',
              render: (r) => <span className="mono">{r.transfer_no}</span>,
            },
            {
              key: 'transfer_date',
              label: 'Date',
              render: (r) => <span className="small nowrap">{dateTime(r.transfer_date)}</span>,
            },
            {
              key: 'route',
              label: 'Route',
              render: (r) => `${r.source_label} → ${r.destination_label}`,
            },
            { key: 'total_items', label: 'Items', align: 'right', render: (r) => num(r.total_items) },
            { key: 'total_cost', label: 'Value', align: 'right', render: (r) => money(r.total_cost) },
            {
              key: 'created_by_name',
              label: 'By',
              render: (r) => <span className="muted small">{r.created_by_name || '—'}</span>,
            },
          ]}
          empty={<EmptyState icon="transfer" title="No transfers in this period" />}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
function Wastage({ data, meta }) {
  const byItem = data.by_item ?? [];
  const byReason = data.by_reason ?? [];
  const byLocation = data.by_location ?? [];

  return (
    <>
      <div className="grid cols-3 mb-16">
        <Stat icon="out" tone="red" label="Total wastage cost" value={money(meta.total_cost)} />
        <Stat icon="ingredient" tone="amber" label="Items affected" value={num(byItem.length)} />
        <Stat
          icon="list"
          tone="blue"
          label="Events"
          value={num(byReason.reduce((s, r) => s + Number(r.events), 0))}
        />
      </div>

      <div className="grid cols-2 mb-16">
        <div className="card">
          <div className="card-head">
            <h3>By reason</h3>
          </div>
          <div className="card-body">
            {byReason.length === 0 ? (
              <p className="muted small">No wastage in this period.</p>
            ) : (
              <BarList
                items={byReason.map((r) => ({
                  id: r.reason_code,
                  label: humanise(r.reason_code),
                  value: Number(r.total_cost),
                }))}
                format={(v) => money(v)}
              />
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>By location</h3>
          </div>
          <div className="card-body">
            {byLocation.length === 0 ? (
              <p className="muted small">No wastage in this period.</p>
            ) : (
              <BarList
                items={byLocation.map((r, i) => ({
                  id: i,
                  label: r.location_label,
                  value: Number(r.total_cost),
                }))}
                format={(v) => money(v)}
              />
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Wastage by item</h3>
          <span className="muted small">
            {date(meta.from)} – {date(meta.to)}
          </span>
        </div>
        <PagedTable
          rows={byItem}
          rowKey={(r) => r.item_id}
          columns={[
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub mono">{r.sku}</div>
                </div>
              ),
            },
            { key: 'events', label: 'Events', align: 'right', render: (r) => num(r.events) },
            {
              key: 'total_quantity',
              label: 'Quantity',
              align: 'right',
              render: (r) => <strong>{qty(r.total_quantity, r.unit_code)}</strong>,
            },
            {
              key: 'total_cost',
              label: 'Cost',
              align: 'right',
              render: (r) => <span className="pos-down">{money(r.total_cost)}</span>,
            },
          ]}
          empty={
            <EmptyState
              icon="check-circle"
              title="No wastage recorded"
              message="Nothing was written off in this period."
            />
          }
          footer={
            byItem.length > 0 && (
              <tr>
                <td colSpan={3} className="right">
                  Total
                </td>
                <td className="num">{money(meta.total_cost)}</td>
              </tr>
            )
          }
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
function Adjustments({ data, meta }) {
  return (
    <>
      <div className="grid cols-3 mb-16">
        <Stat icon="arrow-up" tone="green" label="Increases" value={num(meta.increases)} />
        <Stat icon="arrow-down" tone="red" label="Decreases" value={num(meta.decreases)} />
        <Stat
          icon="rupee"
          tone="blue"
          label="Net value impact"
          value={money(meta.net_value_impact)}
          meta={meta.net_value_impact >= 0 ? 'stock gained' : 'stock written down'}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>All adjustments</h3>
          <span className="muted small">
            {date(meta.from)} – {date(meta.to)}
          </span>
        </div>
        <PagedTable
          rows={data}
          columns={[
            {
              key: 'adjustment_no',
              label: 'Number',
              render: (r) => <span className="mono">{r.adjustment_no}</span>,
            },
            {
              key: 'adjusted_at',
              label: 'Date',
              render: (r) => <span className="small nowrap">{dateTime(r.adjusted_at)}</span>,
            },
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub mono">{r.sku}</div>
                </div>
              ),
            },
            { key: 'location_label', label: 'Location' },
            {
              key: 'previous_quantity',
              label: 'Was',
              align: 'right',
              render: (r) => <span className="muted">{num(r.previous_quantity)}</span>,
            },
            {
              key: 'new_quantity',
              label: 'Now',
              align: 'right',
              render: (r) => <strong>{num(r.new_quantity)}</strong>,
            },
            {
              key: 'difference',
              label: 'Change',
              align: 'right',
              render: (r) => (
                <strong className={r.difference > 0 ? 'pos-up' : 'pos-down'}>
                  {r.difference > 0 ? '+' : ''}
                  {num(r.difference)}
                </strong>
              ),
            },
            {
              key: 'value_impact',
              label: 'Value impact',
              align: 'right',
              render: (r) => money(r.value_impact),
            },
            {
              key: 'reason_code',
              label: 'Reason',
              render: (r) => <Badge tone="gray">{humanise(r.reason_code)}</Badge>,
            },
            {
              key: 'created_by_name',
              label: 'By',
              render: (r) => <span className="muted small">{r.created_by_name || '—'}</span>,
            },
          ]}
          empty={<EmptyState icon="adjust" title="No adjustments in this period" />}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
function Valuation({ data, meta }) {
  return (
    <>
      <div className="grid cols-2 mb-16">
        <Stat icon="rupee" tone="green" label="Total inventory value" value={money(meta.total_value)} />
        <Stat icon="grid" tone="blue" label="Categories" value={num(data.by_category.length)} />
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h3>Value by category</h3>
        </div>
        <PagedTable
          rows={data.by_category}
          rowKey={(r, i) => `${r.category_name}-${i}`}
          columns={[
            { key: 'category_name', label: 'Category', render: (r) => <strong>{r.category_name}</strong> },
            { key: 'item_count', label: 'Items', align: 'right', render: (r) => num(r.item_count) },
            { key: 'main_value', label: 'In main', align: 'right', render: (r) => money(r.main_value) },
            {
              key: 'kitchen_value',
              label: 'In kitchens',
              align: 'right',
              render: (r) => money(r.kitchen_value),
            },
            {
              key: 'total_value',
              label: 'Total',
              align: 'right',
              render: (r) => <strong>{money(r.total_value)}</strong>,
            },
          ]}
          footer={
            <tr>
              <td colSpan={4} className="right">
                Total inventory value
              </td>
              <td className="num">{money(meta.total_value)}</td>
            </tr>
          }
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Value by item</h3>
          <span className="muted small">Highest value first</span>
        </div>
        <PagedTable
          rows={data.by_item}
          rowKey={(r) => r.item_id}
          columns={[
            {
              key: 'item_name',
              label: 'Item',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.item_name}</div>
                  <div className="cell-sub">
                    <span className="mono">{r.sku}</span> · {r.category_name || 'Uncategorised'}
                  </div>
                </div>
              ),
            },
            {
              key: 'main_quantity',
              label: 'In main',
              align: 'right',
              render: (r) => qty(r.main_quantity, r.unit_code),
            },
            {
              key: 'kitchen_quantity',
              label: 'In kitchens',
              align: 'right',
              render: (r) => qty(r.kitchen_quantity, r.unit_code),
            },
            {
              key: 'unit_cost',
              label: 'Unit cost',
              align: 'right',
              render: (r) => <span className="muted">{money(r.unit_cost)}</span>,
            },
            {
              key: 'total_value',
              label: 'Value',
              align: 'right',
              render: (r) => <strong>{money(r.total_value)}</strong>,
            },
          ]}
        />
      </div>
    </>
  );
}
