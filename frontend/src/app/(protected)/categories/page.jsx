'use client';

import { useState } from 'react';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { useAction, useClientTable, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { date, num } from '@/lib/format';
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
  Pagination,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

export default function CategoriesPage() {
  return (
    <AdminOnly>
      <Categories />
    </AdminOnly>
  );
}

function Categories() {
  const toast = useToast();
  const { run, loading: busy } = useAction();
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // One fetch with everything; the toggle filters it in the browser.
  const { data, loading, error, reload } = useFetch('/categories?include_inactive=true');

  const table = useClientTable(data?.data, {
    predicate: (row) => (includeInactive ? true : row.is_active),
    sort: 'name',
    resetKey: includeInactive,
  });

  async function remove() {
    try {
      const result = await run(() => api.del(`/categories/${deleting.id}`));
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
      title="Categories"
      subtitle="Group items and products for reporting and filtering"
      actions={
        <Button variant="primary" onClick={() => setEditing({})}>
          Add category
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <h3>All categories</h3>
          <div className="card-head-actions">
            <Select
              value={String(includeInactive)}
              onChange={(e) => setIncludeInactive(e.target.value === 'true')}
              options={[
                { value: 'true', label: 'Show all' },
                { value: 'false', label: 'Active only' },
              ]}
            />
          </div>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          columns={[
            {
              key: 'name',
              label: 'Category',
              render: (r) => (
                <div>
                  <div className="cell-title">{r.name}</div>
                  {r.description && <div className="cell-sub">{r.description}</div>}
                </div>
              ),
            },
            { key: 'item_count', label: 'Items', align: 'right', render: (r) => num(r.item_count) },
            {
              key: 'product_count',
              label: 'Products',
              align: 'right',
              render: (r) => num(r.product_count),
            },
            {
              key: 'created_at',
              label: 'Created',
              render: (r) => <span className="muted small">{date(r.created_at)}</span>,
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleting(r)}
                    disabled={r.item_count + r.product_count > 0}
                  >
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="grid"
              title="No categories yet"
              message="Categories make the inventory easier to search and report on."
              action={
                <Button variant="primary" onClick={() => setEditing({})}>
                  Add a category
                </Button>
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>

      <CategoryForm
        category={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
        toast={toast}
      />

      <ConfirmDialog
        open={!!deleting}
        title={`Delete "${deleting?.name}"?`}
        message="This cannot be undone. Categories in use by items or products cannot be deleted — deactivate them instead."
        confirmLabel="Delete category"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Layout>
  );
}

function CategoryForm({ category, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [seeded, setSeeded] = useState(false);

  if (category && !seeded) {
    setForm({
      name: category.name ?? '',
      description: category.description ?? '',
      is_active: category.id ? !!category.is_active : true,
    });
    setSeeded(true);
  }
  if (!category && seeded) setSeeded(false);

  const isNew = category && !category.id;

  async function submit() {
    setError(null);
    setErrors({});
    try {
      if (isNew) {
        await run(() =>
          api.post('/categories', { name: form.name, description: form.description || null }),
        );
        toast.success(`Category "${form.name}" created`);
      } else {
        await run(() =>
          api.put(`/categories/${category.id}`, {
            name: form.name,
            description: form.description || null,
            is_active: !!form.is_active,
          }),
        );
        toast.success(`Category "${form.name}" updated`);
      }
      onSaved();
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    }
  }

  return (
    <Modal
      open={!!category}
      title={isNew ? 'Add a category' : `Edit ${category?.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            {isNew ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      {error && !Object.keys(errors).length && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <Field label="Category name" required error={errors.name}>
        <Input
          value={form.name ?? ''}
          error={errors.name}
          autoFocus
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Dairy"
        />
      </Field>

      <Field label="Description" optional error={errors.description}>
        <Textarea
          value={form.description ?? ''}
          rows={2}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="What belongs in this category"
        />
      </Field>

      {!isNew && (
        <Checkbox
          label="Active"
          checked={!!form.is_active}
          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
        />
      )}
    </Modal>
  );
}
