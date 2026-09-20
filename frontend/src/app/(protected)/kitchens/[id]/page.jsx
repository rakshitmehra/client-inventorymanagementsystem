'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { date, dateTime, initials, money, num } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Loading,
  Modal,
  Select,
  Stat,
  useToast,
} from '@/components/ui';

export default function KitchenDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { run, loading: saving } = useAction();

  const [assigning, setAssigning] = useState(false);
  const [newManagerId, setNewManagerId] = useState('');
  const [removing, setRemoving] = useState(null);

  const { data, loading, error, reload } = useFetch(`/kitchens/${id}`);
  const kitchen = data?.data;

  const managers = useFetch('/users?role=KITCHEN_MANAGER', { skip: !isAdmin });
  const production = useFetch(`/production?kitchen_id=${id}&page_size=8`);
  const transfers = useFetch(`/transfers?kitchen_id=${id}&page_size=8`);

  async function assign() {
    try {
      await run(() => api.post(`/kitchens/${id}/managers`, { user_id: Number(newManagerId) }));
      toast.success('Manager assigned');
      setAssigning(false);
      setNewManagerId('');
      reload();
      managers.reload();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function unassign() {
    try {
      await run(() => api.del(`/kitchens/${id}/managers/${removing.id}`));
      toast.success(`${removing.full_name} removed from this kitchen`);
      setRemoving(null);
      reload();
      managers.reload();
    } catch (err) {
      toast.error(err.message);
      setRemoving(null);
    }
  }

  if (loading) {
    return (
      <Layout title="Kitchen">
        <Loading />
      </Layout>
    );
  }
  if (error) {
    return (
      <Layout title="Kitchen">
        <Alert tone="error">{error.message}</Alert>
      </Layout>
    );
  }
  if (!kitchen) return null;

  const assignable = (managers.data?.data ?? []).filter(
    (m) => m.is_active && !kitchen.managers.some((km) => km.id === m.id),
  );

  return (
    <Layout
      title={kitchen.name}
      subtitle={`${kitchen.code} · ${kitchen.location || 'No location recorded'}`}
      actions={
        <>
          <Button onClick={() => router.push('/kitchens')}>All kitchens</Button>
          <Button onClick={() => router.push(`/kitchens/${id}/inventory`)}>View inventory</Button>
          {isAdmin && (
            <Button variant="primary" onClick={() => router.push(`/transfers/new?kitchen=${id}`)}>
              Send stock
            </Button>
          )}
        </>
      }
    >
      <div className="grid cols-4 mb-16">
        <Stat icon="rupee" tone="green" label="Stock value" value={money(kitchen.summary.stock_value)} />
        <Stat icon="ingredient" tone="blue" label="Items held" value={num(kitchen.summary.item_count)} />
        <Stat icon="alert" tone="amber" label="Low stock" value={num(kitchen.summary.low_stock)} />
        <Stat icon="out" tone="red" label="Out of stock" value={num(kitchen.summary.out_of_stock)} />
      </div>

      <div className="grid cols-2 mb-16">
        <div className="card">
          <div className="card-head">
            <h3>Kitchen details</h3>
            <div className="card-head-actions">
              <Badge tone={kitchen.is_active ? 'green' : 'gray'} dot>
                {kitchen.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>Code</dt>
              <dd className="mono">{kitchen.code}</dd>
              <dt>Name</dt>
              <dd>{kitchen.name}</dd>
              <dt>Location</dt>
              <dd>{kitchen.location || '—'}</dd>
              <dt>Phone</dt>
              <dd>{kitchen.phone || '—'}</dd>
              <dt>Description</dt>
              <dd>{kitchen.description || '—'}</dd>
              <dt>Created</dt>
              <dd>
                {date(kitchen.created_at)} by {kitchen.created_by_name || '—'}
              </dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Assigned managers</h3>
            {isAdmin && (
              <div className="card-head-actions">
                <Button size="sm" onClick={() => setAssigning(true)} disabled={assignable.length === 0}>
                  Assign manager
                </Button>
              </div>
            )}
          </div>
          <div className="card-body">
            {kitchen.managers.length === 0 ? (
              <EmptyState
                icon="users"
                title="No manager assigned"
                message="Assign a kitchen manager so someone can record production here."
                action={
                  isAdmin &&
                  assignable.length > 0 && (
                    <Button variant="primary" onClick={() => setAssigning(true)}>
                      Assign a manager
                    </Button>
                  )
                }
              />
            ) : (
              <div className="flex col gap-12">
                {kitchen.managers.map((manager) => (
                  <div className="flex items-center gap-12" key={manager.id}>
                    <div className="avatar lg">{initials(manager.full_name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-8">
                        <strong>{manager.full_name}</strong>
                        {manager.is_primary && <Badge tone="brand">Primary</Badge>}
                        {!manager.is_active && <Badge tone="red">Account inactive</Badge>}
                      </div>
                      <div className="cell-sub">
                        {manager.email}
                        {manager.phone ? ` · ${manager.phone}` : ''}
                      </div>
                      <div className="cell-sub">Assigned {date(manager.assigned_at)}</div>
                    </div>
                    {isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(manager)}>
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-2 mb-16">
        <div className="card">
          <div className="card-head">
            <h3>Recent production</h3>
            <div className="card-head-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => router.push(`/production?kitchen_id=${id}`)}
              >
                View all
              </Button>
            </div>
          </div>
          <DataTable
            loading={production.loading}
            rows={production.data?.data ?? []}
            onRowClick={(r) => router.push(`/production/${r.id}`)}
            columns={[
              {
                key: 'product_name',
                label: 'Product',
                render: (r) => (
                  <div>
                    <div className="cell-title">{r.product_name}</div>
                    <div className="cell-sub mono">{r.production_no}</div>
                  </div>
                ),
              },
              {
                key: 'output_quantity',
                label: 'Made',
                align: 'right',
                render: (r) => `${num(r.output_quantity)} ${r.output_unit_code}`,
              },
              {
                key: 'produced_at',
                label: 'When',
                render: (r) => <span className="muted small nowrap">{dateTime(r.produced_at)}</span>,
              },
            ]}
            empty={
              <EmptyState icon="cooking" title="No production yet" message="Nothing has been produced at this kitchen." />
            }
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Recent transfers</h3>
            <div className="card-head-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => router.push(`/transfers?kitchen_id=${id}`)}
              >
                View all
              </Button>
            </div>
          </div>
          <DataTable
            loading={transfers.loading}
            rows={transfers.data?.data ?? []}
            onRowClick={(r) => router.push(`/transfers/${r.id}`)}
            columns={[
              {
                key: 'transfer_no',
                label: 'Transfer',
                render: (r) => (
                  <div>
                    <div className="cell-title mono">{r.transfer_no}</div>
                    <div className="cell-sub">
                      {r.source_label} → {r.destination_label}
                    </div>
                  </div>
                ),
              },
              { key: 'total_items', label: 'Items', align: 'right', render: (r) => num(r.total_items) },
              {
                key: 'transfer_date',
                label: 'When',
                render: (r) => <span className="muted small nowrap">{dateTime(r.transfer_date)}</span>,
              },
            ]}
            empty={
              <EmptyState icon="transfer" title="No transfers yet" message="No stock has moved to or from this kitchen." />
            }
          />
        </div>
      </div>

      {isAdmin && kitchen.manager_history.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Assignment history</h3>
            <span className="muted small">Who has managed this kitchen over time</span>
          </div>
          <DataTable
            rows={kitchen.manager_history}
            columns={[
              {
                key: 'full_name',
                label: 'Manager',
                render: (r) => (
                  <div>
                    <div className="cell-title">{r.full_name}</div>
                    <div className="cell-sub mono">{r.username}</div>
                  </div>
                ),
              },
              { key: 'assigned_at', label: 'Assigned', render: (r) => date(r.assigned_at) },
              {
                key: 'assigned_by_name',
                label: 'Assigned by',
                render: (r) => <span className="muted">{r.assigned_by_name || '—'}</span>,
              },
              {
                key: 'unassigned_at',
                label: 'Removed',
                render: (r) => (r.unassigned_at ? date(r.unassigned_at) : '—'),
              },
              {
                key: 'is_active',
                label: 'Status',
                render: (r) => (
                  <Badge tone={r.is_active ? 'green' : 'gray'}>{r.is_active ? 'Current' : 'Past'}</Badge>
                ),
              },
            ]}
          />
        </div>
      )}

      <Modal
        open={assigning}
        title="Assign a kitchen manager"
        subtitle={kitchen.name}
        onClose={() => setAssigning(false)}
        footer={
          <>
            <Button onClick={() => setAssigning(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={assign} loading={saving} disabled={!newManagerId}>
              Assign
            </Button>
          </>
        }
      >
        <p className="muted small mb-16">
          Only accounts with the Kitchen Manager role can be assigned. A manager may look after more
          than one kitchen.
        </p>
        <Field label="Manager" required>
          <Select
            value={newManagerId}
            onChange={(e) => setNewManagerId(e.target.value)}
            placeholder="Choose a manager…"
            options={assignable.map((m) => ({
              value: m.id,
              label: `${m.full_name} (${m.username})${
                m.kitchens.length ? ` — manages ${m.kitchens.length}` : ''
              }`,
            }))}
          />
        </Field>
        {assignable.length === 0 && (
          <Alert tone="info">
            Every active kitchen manager is already assigned here. Create a new manager account
            first.
          </Alert>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.full_name}?`}
        message="They will immediately lose access to this kitchen's inventory and production. The assignment stays in the history."
        confirmLabel="Remove from kitchen"
        loading={saving}
        onConfirm={unassign}
        onCancel={() => setRemoving(null)}
      />
    </Layout>
  );
}
