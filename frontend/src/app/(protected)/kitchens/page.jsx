'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { initials, money, num } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

export default function KitchensPage() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { run, loading: saving } = useAction();

  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const path = `/kitchens?include_inactive=${includeInactive}${
    search ? `&search=${encodeURIComponent(search)}` : ''
  }`;
  const { data, loading, error, reload } = useFetch(path);
  const kitchens = data?.data ?? [];

  const managers = useFetch('/users?role=KITCHEN_MANAGER', { skip: !isAdmin });

  async function toggleStatus(kitchen, force = false) {
    try {
      await run(() =>
        api.patch(`/kitchens/${kitchen.id}/status`, { is_active: !kitchen.is_active, force }),
      );
      toast.success(`${kitchen.name} is now ${kitchen.is_active ? 'inactive' : 'active'}`);
      setConfirm(null);
      reload();
    } catch (err) {
      if (err.details?.requires_force) {
        setConfirm({ kitchen, message: err.message });
      } else {
        toast.error(err.message);
        setConfirm(null);
      }
    }
  }

  return (
    <Layout
      title="Kitchens"
      subtitle="Each kitchen keeps its own sub-inventory, separate from the Main Inventory"
      actions={
        isAdmin && (
          <Button variant="primary" onClick={() => setEditing({})}>
            Add kitchen
          </Button>
        )
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="filter-bar mb-16">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, code or location…" />
        <Select
          value={String(includeInactive)}
          onChange={(e) => setIncludeInactive(e.target.value === 'true')}
          options={[
            { value: 'true', label: 'All kitchens' },
            { value: 'false', label: 'Active only' },
          ]}
        />
      </div>

      {loading ? (
        <Loading />
      ) : kitchens.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="kitchen"
            title="No kitchens yet"
            message="Create a kitchen, assign a manager, then transfer stock to it from the Main Inventory."
            action={
              isAdmin && (
                <Button variant="primary" onClick={() => setEditing({})}>
                  Add your first kitchen
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid cols-auto">
          {kitchens.map((kitchen) => (
            <div className="card" key={kitchen.id}>
              <div className="card-body">
                <div className="flex between items-center gap-8 mb-12">
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontSize: 15.5 }}>{kitchen.name}</h3>
                    <div className="cell-sub mono">{kitchen.code}</div>
                  </div>
                  <Badge tone={kitchen.is_active ? 'green' : 'gray'} dot>
                    {kitchen.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <p className="muted small" style={{ minHeight: 34 }}>
                  {kitchen.location || 'No location recorded'}
                </p>

                <div className="divider" style={{ margin: '12px 0' }} />

                <div className="grid cols-2" style={{ gap: 10 }}>
                  <div>
                    <div className="stat-label">Stock value</div>
                    <div style={{ fontWeight: 650, fontSize: 15 }}>
                      {money(kitchen.summary.stock_value)}
                    </div>
                  </div>
                  <div>
                    <div className="stat-label">Items held</div>
                    <div style={{ fontWeight: 650, fontSize: 15 }}>
                      {num(kitchen.summary.item_count)}
                    </div>
                  </div>
                </div>

                {(kitchen.summary.low_stock > 0 || kitchen.summary.out_of_stock > 0) && (
                  <div className="mt-12">
                    <Badge tone={kitchen.summary.out_of_stock > 0 ? 'red' : 'amber'}>
                      {kitchen.summary.low_stock + kitchen.summary.out_of_stock} item(s) need
                      attention
                    </Badge>
                  </div>
                )}

                <div className="divider" style={{ margin: '12px 0' }} />

                <div className="stat-label mb-8">Managers</div>
                {kitchen.managers.length === 0 ? (
                  <p className="muted small">No manager assigned yet.</p>
                ) : (
                  <div className="flex col gap-8">
                    {kitchen.managers.map((manager) => (
                      <div className="flex items-center gap-8" key={manager.id}>
                        <div className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>
                          {initials(manager.full_name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 550 }}>{manager.full_name}</div>
                          <div className="cell-sub">{manager.email}</div>
                        </div>
                        {manager.is_primary && <Badge tone="brand">Primary</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card-foot" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button size="sm" onClick={() => router.push(`/kitchens/${kitchen.id}/inventory`)}>
                  Inventory
                </Button>
                {isAdmin && (
                  <>
                    <Button size="sm" onClick={() => router.push(`/kitchens/${kitchen.id}`)}>
                      Manage
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(kitchen)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      style={{ marginLeft: 'auto' }}
                      onClick={() =>
                        kitchen.is_active ? setConfirm({ kitchen }) : toggleStatus(kitchen)
                      }
                    >
                      {kitchen.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <KitchenForm
        kitchen={editing}
        managers={(managers.data?.data ?? []).filter((m) => m.is_active)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
          managers.reload?.();
        }}
        toast={toast}
      />

      <ConfirmDialog
        open={!!confirm}
        title={`Deactivate ${confirm?.kitchen.name}?`}
        message={
          confirm?.message
            ? `${confirm.message} Deactivating stops new transfers and production but keeps all history.`
            : 'A deactivated kitchen cannot receive stock or record production. Its history is kept.'
        }
        confirmLabel={confirm?.message ? 'Deactivate anyway' : 'Deactivate'}
        loading={saving}
        onConfirm={() => toggleStatus(confirm.kitchen, !!confirm.message)}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}

/* ------------------------------------------------------------------------- */
function KitchenForm({ kitchen, managers, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [seeded, setSeeded] = useState(false);

  // Seed the form the first time the modal opens for a given record.
  if (kitchen && !seeded) {
    setForm({
      code: kitchen.code ?? '',
      name: kitchen.name ?? '',
      location: kitchen.location ?? '',
      phone: kitchen.phone ?? '',
      description: kitchen.description ?? '',
      manager_ids: [],
    });
    setSeeded(true);
  }
  if (!kitchen && seeded) setSeeded(false);

  const isNew = kitchen && !kitchen.id;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setError(null);
    setErrors({});
    const payload = {
      code: form.code,
      name: form.name,
      location: form.location || null,
      phone: form.phone || null,
      description: form.description || null,
    };
    try {
      if (isNew) {
        await run(() => api.post('/kitchens', { ...payload, manager_ids: form.manager_ids }));
        toast.success(`${form.name} created`);
      } else {
        await run(() => api.put(`/kitchens/${kitchen.id}`, payload));
        toast.success(`${form.name} updated`);
      }
      onSaved();
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    }
  }

  return (
    <Modal
      open={!!kitchen}
      title={isNew ? 'Add a kitchen' : `Edit ${kitchen?.name}`}
      subtitle={isNew ? 'Each kitchen gets its own independent sub-inventory' : kitchen?.code}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            {isNew ? 'Create kitchen' : 'Save changes'}
          </Button>
        </>
      }
    >
      {error && !Object.keys(errors).length && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <div className="form-row">
        <Field
          label="Kitchen code"
          required
          error={errors.code}
          hint="Short unique reference, e.g. KIT-CP"
        >
          <Input value={form.code ?? ''} onChange={set('code')} error={errors.code} placeholder="KIT-CP" />
        </Field>
        <Field label="Kitchen name" required error={errors.name}>
          <Input
            value={form.name ?? ''}
            onChange={set('name')}
            error={errors.name}
            placeholder="Central Production Kitchen"
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="Location" optional error={errors.location}>
          <Input value={form.location ?? ''} onChange={set('location')} placeholder="Area, city" />
        </Field>
        <Field label="Phone" optional error={errors.phone}>
          <Input value={form.phone ?? ''} onChange={set('phone')} placeholder="+91 …" />
        </Field>
      </div>

      <Field label="Description" optional error={errors.description}>
        <Textarea
          value={form.description ?? ''}
          onChange={set('description')}
          rows={2}
          placeholder="What this kitchen is used for"
        />
      </Field>

      {isNew && (
        <Field label="Assign a manager" optional hint="You can also assign managers later">
          <Select
            value={form.manager_ids?.[0] ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                manager_ids: e.target.value ? [Number(e.target.value)] : [],
              }))
            }
            placeholder="No manager for now"
            options={managers.map((m) => ({
              value: m.id,
              label: `${m.full_name} (${m.username})${
                m.kitchens.length ? ` — already manages ${m.kitchens.length}` : ''
              }`,
            }))}
          />
        </Field>
      )}
    </Modal>
  );
}
