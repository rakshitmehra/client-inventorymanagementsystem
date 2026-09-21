'use client';

import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/hooks';
import { money, num, qty, relative } from '@/lib/format';
import {
  ActionCard,
  Alert,
  Badge,
  Button,
  CardSkeleton,
  DataTable,
  EmptyState,
  Skeleton,
  StatSkeleton,
  Stat,
} from '@/components/ui';

export default function DashboardPage() {
  const { isAdmin } = useAuth();
  return isAdmin ? <AdminHome /> : <KitchenHome />;
}

/**
 * The dashboard's own shape, drawn while its numbers are in flight.
 *
 * A centred spinner told you only that something was happening; this shows
 * where the tiles and tables are about to appear, so the page settles into
 * place instead of springing into existence, and nothing moves under the
 * pointer when the data lands.
 */
function DashboardSkeleton({ stats = 4, cards = 2 }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading your dashboard</span>

      <div className="action-row mb-16">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="action-card" aria-hidden="true">
            <Skeleton width={44} height={44} radius={12} />
            <Skeleton width="70%" height={16} className="mt-12" />
            <Skeleton width="45%" height={12} className="mt-8" />
          </div>
        ))}
      </div>

      <Skeleton width={230} height={22} className="mt-24 mb-16" />

      <div className={`grid cols-${stats} mb-16`}>
        {Array.from({ length: stats }).map((_, index) => (
          <StatSkeleton key={index} />
        ))}
      </div>

      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="mb-16">
          <CardSkeleton rows={5} />
        </div>
      ))}
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ========================================================================== */
function AdminHome() {
  const { user } = useAuth();
  const router = useRouter();
  // A fixed 30-day window: one less control to think about.
  const { data, loading, error } = useFetch('/dashboard/admin?days=30');
  const d = data?.data;

  // Requests are the one thing on this screen that somebody else is waiting
  // on. Only the count is needed, so ask for a single row and read the meta.
  const requests = useFetch('/requests?page_size=1');
  const waiting = requests.data?.meta?.pending ?? 0;

  const needsAttention = d ? d.main_inventory.low_stock + d.low_stock_kitchens.length : 0;

  return (
    <Layout title="Home" subtitle={`${greeting()}, ${user?.full_name?.split(' ')[0] ?? ''}`}>
      {loading && <DashboardSkeleton stats={4} />}
      {error && <Alert tone="error">{error.message}</Alert>}

      {/* A kitchen cannot get on with its day until this is answered, so it
          goes above everything else - including the numbers. */}
      {waiting > 0 && (
        <Alert
          tone="warn"
          title={`${waiting} kitchen request${waiting === 1 ? '' : 's'} waiting for you`}
        >
          <div className="flex items-center gap-12 wrap">
            <span>
              {waiting === 1 ? 'A kitchen has' : 'Kitchens have'} asked the main store for stock.
              Nothing moves until you decide.
            </span>
            <Button variant="primary" icon="request" onClick={() => router.push('/requests')}>
              Review {waiting === 1 ? 'it' : 'them'}
            </Button>
          </div>
        </Alert>
      )}

      {d && (
        <>
          {/* ------------------------------------------ what do you want to do */}
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 16 }}>
            What would you like to do?
          </h2>
          <div className="action-row mb-16">
            <ActionCard
              primary
              href="/transfers/new"
              icon="truck"
              title="Send to a Kitchen"
              sub="Move stock out of the main store"
            />
            <ActionCard
              href="/goods-receipts/new"
              icon="inbox"
              title="Receive Stock"
              sub="Record a delivery from a supplier"
            />
            <ActionCard
              href="/requests"
              icon="request"
              title="Stock Requests"
              sub={waiting > 0 ? `${waiting} waiting for a decision` : 'Nothing waiting'}
            />
            <ActionCard
              href="/reports"
              icon="chart"
              title="See Reports"
              sub="Stock, usage and waste"
            />
          </div>

          {/* --------------------------------------------------- key numbers */}
          <h2 style={{ fontSize: 'var(--text-xl)', margin: '28px 0 16px' }}>
            How things stand today
          </h2>
          <div className="grid cols-4 mb-16">
            <Stat
              icon="box"
              tone="green"
              label="Stock in the main store"
              value={money(d.main_inventory.stock_value)}
              meta={`${d.main_inventory.item_count} ingredients`}
              onClick={() => router.push('/main-inventory')}
            />
            <Stat
              icon="kitchen"
              tone="blue"
              label="Stock in the kitchens"
              value={money(d.kitchen_stock_value)}
              meta={`${d.counts.active_kitchens} kitchens open`}
              onClick={() => router.push('/kitchens')}
            />
            <Stat
              icon={needsAttention > 0 ? 'alert' : 'check-circle'}
              tone={needsAttention > 0 ? 'amber' : 'green'}
              label="Running low"
              value={needsAttention > 0 ? num(needsAttention) : 'All good'}
              meta={needsAttention > 0 ? 'Needs your attention' : 'Nothing is short'}
              onClick={() => router.push('/reports?tab=low-stock')}
            />
            <Stat
              icon="trash"
              tone="red"
              label="Waste this month"
              value={money(d.period.wastage_cost)}
              meta={`${d.period.production_runs} production runs`}
              onClick={() => router.push('/wastage')}
            />
          </div>

          {/* ------------------------------------------------------ kitchens */}
          <div className="card mb-16">
            <div className="card-head">
              <h3>Your kitchens</h3>
              <div className="card-head-actions">
                <Button onClick={() => router.push('/kitchens')} icon="kitchen">
                  Manage kitchens
                </Button>
              </div>
            </div>
            <DataTable
              rows={d.kitchens}
              onRowClick={(k) => router.push(`/kitchens/${k.id}`)}
              columns={[
                {
                  key: 'name',
                  label: 'Kitchen',
                  render: (k) => (
                    <div>
                      <div className="cell-title">{k.name}</div>
                      <div className="cell-sub">{k.manager_name || 'Nobody assigned yet'}</div>
                    </div>
                  ),
                },
                {
                  key: 'stock_value',
                  label: 'Stock held',
                  align: 'right',
                  render: (k) => <strong>{money(k.stock_value)}</strong>,
                },
                {
                  key: 'alerts',
                  label: 'Running low',
                  render: (k) =>
                    k.low_stock + k.out_of_stock > 0 ? (
                      <Badge tone={k.out_of_stock ? 'red' : 'amber'}>
                        {k.low_stock + k.out_of_stock} items
                      </Badge>
                    ) : (
                      <Badge tone="green">All good</Badge>
                    ),
                },
                {
                  key: 'status',
                  label: 'Open?',
                  render: (k) => (
                    <Badge tone={k.is_active ? 'green' : 'gray'} dot>
                      {k.is_active ? 'Open' : 'Closed'}
                    </Badge>
                  ),
                },
              ]}
              empty={
                <EmptyState
                  icon="kitchen"
                  title="No kitchens yet"
                  message="Add your first kitchen, then you can send stock to it."
                  action={
                    <Button variant="primary" onClick={() => router.push('/kitchens')}>
                      Add a kitchen
                    </Button>
                  }
                />
              }
            />
          </div>

          {/* ------------------------------------------------ needs ordering */}
          <div className="card">
            <div className="card-head">
              <h3>Items you may need to order</h3>
              <div className="card-head-actions">
                <Button onClick={() => router.push('/reports?tab=low-stock')} icon="chart">
                  See the full list
                </Button>
              </div>
            </div>
            {d.low_stock_main.length === 0 ? (
              <EmptyState
                icon="check-circle"
                title="Nothing is running low"
                message="Every ingredient in the main store is above its minimum."
              />
            ) : (
              <DataTable
                rows={d.low_stock_main.slice(0, 6)}
                rowKey={(r) => r.item_id}
                onRowClick={(r) => router.push(`/movements/item/${r.item_id}`)}
                columns={[
                  {
                    key: 'item_name',
                    label: 'Ingredient',
                    render: (r) => <span className="cell-title">{r.item_name}</span>,
                  },
                  {
                    key: 'quantity',
                    label: 'You have',
                    align: 'right',
                    render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
                  },
                  {
                    key: 'min_stock_level',
                    label: 'You should keep',
                    align: 'right',
                    render: (r) => qty(r.min_stock_level, r.unit_code),
                  },
                  {
                    key: 'status',
                    label: '',
                    render: (r) => (
                      <Badge tone={r.stock_status === 'OUT' ? 'red' : 'amber'}>
                        {r.stock_status === 'OUT' ? 'All gone' : 'Running low'}
                      </Badge>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </>
      )}
    </Layout>
  );
}

/* ========================================================================== */
function KitchenHome() {
  const { user } = useAuth();
  const router = useRouter();
  const kitchenId = user?.kitchens?.[0]?.id;

  const { data, loading, error } = useFetch(
    kitchenId ? `/dashboard/kitchen/${kitchenId}?days=30` : null,
    { skip: !kitchenId },
  );
  const d = data?.data;

  if (!kitchenId) {
    return (
      <Layout title="Home">
        <Alert tone="warn" title="You have not been given a kitchen yet">
          Please ask your manager to add you to a kitchen. Once they do, you will be able to record
          your production here.
        </Alert>
      </Layout>
    );
  }

  const needsAttention = d ? d.stock.low_stock + d.stock.out_of_stock : 0;

  return (
    <Layout
      title={user.kitchens[0].name}
      subtitle={`${greeting()}, ${user?.full_name?.split(' ')[0] ?? ''}`}
    >
      {loading && <DashboardSkeleton stats={3} />}
      {error && <Alert tone="error">{error.message}</Alert>}

      {d && (
        <>
          <h2 style={{ fontSize: 'var(--text-xl)', marginBottom: 16 }}>
            What would you like to do?
          </h2>
          <div className="action-row mb-16">
            <ActionCard
              primary
              href="/production/new"
              icon="cooking"
              title="Record Production"
              sub="Log what the kitchen produced"
            />
            <ActionCard
              href="/requests/new"
              icon="request"
              title="Ask for Stock"
              sub="Request more from the main store"
            />
            <ActionCard
              href={`/kitchens/${kitchenId}/inventory`}
              icon="box"
              title="Check My Stock"
              sub="See what you have left"
            />
            <ActionCard
              href="/wastage"
              icon="trash"
              title="Record Waste"
              sub="Something spoiled or spilled"
            />
          </div>

          <h2 style={{ fontSize: 'var(--text-xl)', margin: '28px 0 16px' }}>
            How your kitchen is doing
          </h2>
          <div className="grid cols-3 mb-16">
            <Stat
              icon="box"
              tone="green"
              label="Stock you are holding"
              value={money(d.stock.stock_value)}
              meta={`${d.stock.item_count} ingredients`}
              onClick={() => router.push(`/kitchens/${kitchenId}/inventory`)}
            />
            <Stat
              icon={needsAttention > 0 ? 'alert' : 'check-circle'}
              tone={needsAttention > 0 ? 'amber' : 'green'}
              label="Running low"
              value={needsAttention > 0 ? num(needsAttention) : 'All good'}
              meta={needsAttention > 0 ? 'Ask for more of these' : 'Nothing is short'}
              onClick={() => router.push(`/kitchens/${kitchenId}/inventory?stock_status=low`)}
            />
            <Stat
              icon="cooking"
              tone="violet"
              label="Made this month"
              value={`${num(d.period.units_produced)} items`}
              meta={`${d.period.production_runs} production runs`}
              onClick={() => router.push('/production')}
            />
          </div>

          <div className="grid cols-2">
            <div className="card">
              <div className="card-head">
                <h3>Running low — ask for more</h3>
              </div>
              {d.low_stock.length === 0 ? (
                <EmptyState
                  icon="check-circle"
                  title="You have everything you need"
                  message="Nothing in your kitchen is below its minimum."
                />
              ) : (
                <DataTable
                  rows={d.low_stock.slice(0, 6)}
                  rowKey={(r) => r.item_id}
                  columns={[
                    {
                      key: 'item_name',
                      label: 'Ingredient',
                      render: (r) => <span className="cell-title">{r.item_name}</span>,
                    },
                    {
                      key: 'quantity',
                      label: 'You have',
                      align: 'right',
                      render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
                    },
                    {
                      key: 'status',
                      label: '',
                      render: (r) => (
                        <Badge tone={r.stock_status === 'OUT' ? 'red' : 'amber'}>
                          {r.stock_status === 'OUT' ? 'All gone' : 'Low'}
                        </Badge>
                      ),
                    },
                  ]}
                />
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Produced recently</h3>
                <div className="card-head-actions">
                  <Button onClick={() => router.push('/production')} icon="history">
                    See all
                  </Button>
                </div>
              </div>
              {d.recent_production.length === 0 ? (
                <EmptyState
                  icon="cooking"
                  title="Nothing recorded yet"
                  message="Use the Record Production button above after your first batch."
                  action={
                    <Button variant="primary" onClick={() => router.push('/production/new')}>
                      Record Production
                    </Button>
                  }
                />
              ) : (
                <DataTable
                  rows={d.recent_production.slice(0, 6)}
                  onRowClick={(r) => router.push(`/production/${r.id}`)}
                  columns={[
                    {
                      key: 'product_name',
                      label: 'What you made',
                      render: (r) => (
                        <div>
                          <div className="cell-title">{r.product_name}</div>
                          <div className="cell-sub">{relative(r.produced_at)}</div>
                        </div>
                      ),
                    },
                    {
                      key: 'output_quantity',
                      label: 'How many',
                      align: 'right',
                      render: (r) => <strong>{qty(r.output_quantity, r.unit_code)}</strong>,
                    },
                  ]}
                />
              )}
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
