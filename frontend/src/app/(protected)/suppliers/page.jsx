'use client';

import { useState } from 'react';
import Layout from '@/components/Layout';
import { ConfirmButton } from '@/components/ConfirmButton';
import AdminOnly from '@/components/AdminOnly';
import { FETCH_ALL, useAction, useClientTable, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

export default function SuppliersPage() {
  return (
    <AdminOnly>
      <Suppliers />
    </AdminOnly>
  );
}

function Suppliers() {
  const toast = useToast();
  const { run, loading: busy } = useAction();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // Fetched once with everything in it; the search box and the toggle below
  // filter that copy in the browser, so typing is instant.
  const { data, loading, error, reload } = useFetch(`/suppliers?include_inactive=true&page_size=${FETCH_ALL}`);

  const table = useClientTable(data?.data, {
    search,
    searchKeys: ['name', 'contact_person', 'phone', 'email'],
    predicate: (row) => (includeInactive ? true : row.is_active),
    sort: 'name',
    serverTotal: data?.meta?.total,
    resetKey: includeInactive,
  });

  async function remove() {
    try {
      const result = await run(() => api.del(`/suppliers/${deleting.id}`));
      toast.success(result.message);
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(err.message);
      setDeleting(null);
    }
  }

  return (
    <Layout
      title="Suppliers"
      subtitle="Where the Main Inventory buys its raw materials"
      actions={
        <Button variant="primary" onClick={() => setEditing({})}>
          Add supplier
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <FilterBar
            more={
              <>
                <Select
                  value={String(includeInactive)}
                  onChange={(e) => setIncludeInactive(e.target.value === 'true')}
                  options={[
                    { value: 'true', label: 'Show all' },
                    { value: 'false', label: 'Active only' },
                  ]}
                />
              </>
            }
          >
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name, contact or phone…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          columns={[
            {
              key: 'name',
              label: 'Supplier',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.name}</div>
                  {r.address && <div className="cell-sub">{r.address}</div>}
                </div>
              ),
            },
            {
              key: 'contact_person',
              label: 'Contact',
              render: (r) => (
                <div>
                  <div>{r.contact_person || '—'}</div>
                  <div className="cell-sub">{r.phone || ''}</div>
                </div>
              ),
            },
            {
              key: 'email',
              label: 'Email',
              render: (r) => <span className="muted small">{r.email || '—'}</span>,
            },
            {
              key: 'item_count',
              label: 'Items supplied',
              align: 'right',
              render: (r) => num(r.item_count),
            },
            {
              key: 'is_active',
              label: 'Status',
              render: (r) => (
                <Badge tone={r.is_active ? 'green' : 'gray'} dot>
                  {r.is_active ? 'Active' : 'Inactive'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <div className="flex gap-4 nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="supplier"
              title="No suppliers yet"
              message="Add the suppliers you buy raw materials from so goods receipts can reference them."
              action={
                <Button variant="primary" onClick={() => setEditing({})}>
                  Add a supplier
                </Button>
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>

      <SupplierForm
        supplier={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
        toast={toast}
      />

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name}?`}
        message="Suppliers with goods receipts on record cannot be deleted — deactivate them instead."
        confirmLabel="Delete supplier"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Layout>
  );
}

function SupplierForm({ supplier, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [seeded, setSeeded] = useState(false);

  if (supplier && !seeded) {
    setForm({
      name: supplier.name ?? '',
      contact_person: supplier.contact_person ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
      is_active: supplier.id ? !!supplier.is_active : true,
    });
    setSeeded(true);
  }
  if (!supplier && seeded) setSeeded(false);

  const isNew = supplier && !supplier.id;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setError(null);
    setErrors({});
    const payload = {
      name: form.name,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      notes: form.notes || null,
    };
    try {
      if (isNew) {
        await run(() => api.post('/suppliers', payload));
        toast.success(`${form.name} added`);
      } else {
        await run(() =>
          api.put(`/suppliers/${supplier.id}`, { ...payload, is_active: !!form.is_active }),
        );
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
      open={!!supplier}
      size="wide"
      title={isNew ? 'Add a supplier' : `Edit ${supplier?.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          {isNew ? (
            <Button variant="primary" onClick={submit} loading={loading}>
              {'Add supplier'}
            </Button>
          ) : (
            <ConfirmButton
              variant="primary"
              loading={loading}
              onConfirm={submit}
              title={`Save changes to ${supplier?.name ?? 'this supplier'}?`}
              message="The supplier is updated on every goods receipt that names them."
            >
              Save changes
            </ConfirmButton>
          )}
        </>
      }
    >
      {error && !Object.keys(errors).length && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <div className="form-row">
        <Field label="Supplier name" required error={errors.name}>
          <Input
            value={form.name ?? ''}
            onChange={set('name')}
            error={errors.name}
            autoFocus
            placeholder="Sunrise Flour Mills"
          />
        </Field>
        <Field label="Contact person" optional error={errors.contact_person}>
          <Input value={form.contact_person ?? ''} onChange={set('contact_person')} placeholder="Name" />
        </Field>
      </div>

      <div className="form-row">
        <Field label="Phone" optional error={errors.phone}>
          <Input value={form.phone ?? ''} onChange={set('phone')} placeholder="+91 …" />
        </Field>
        <Field label="Email" optional error={errors.email}>
          <Input value={form.email ?? ''} onChange={set('email')} placeholder="orders@supplier.com" />
        </Field>
      </div>

      <Field label="Address" optional error={errors.address}>
        <Textarea value={form.address ?? ''} rows={2} onChange={set('address')} />
      </Field>

      <Field label="Notes" optional error={errors.notes}>
        <Textarea
          value={form.notes ?? ''}
          rows={2}
          onChange={set('notes')}
          placeholder="Payment terms, delivery days…"
        />
      </Field>

      {!isNew && (
        <Checkbox
          label="Active supplier"
          checked={!!form.is_active}
          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
        />
      )}
    </Modal>
  );
}
