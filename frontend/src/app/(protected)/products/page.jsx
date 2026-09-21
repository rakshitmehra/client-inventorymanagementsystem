'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import {
  FETCH_ALL,
  useAction,
  useClientTable,
  useFetch,
  useListState,
  useReference,
} from '@/lib/hooks';
import { api } from '@/lib/api';
import { money, num } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  NumberInput,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

export default function ProductsPage() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { units, categories } = useReference();

  const [state, update] = useListState();
  const [editing, setEditing] = useState(null);

  const { data, loading, error, reload } = useFetch(
    `/products?include_inactive=true&page_size=${FETCH_ALL}`,
  );

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['name', 'sku', 'description'],
    filters: { category_id: state.category_id ?? '' },
    predicate: (row) => {
      if (state.has_recipe === 'true' && !row.active_recipe_id) return false;
      return state.include_inactive === 'true' ? true : row.is_active;
    },
    serverTotal: data?.meta?.total,
    resetKey: state,
  });

  return (
    <Layout
      title={isAdmin ? 'Products & Recipes' : 'Recipes'}
      subtitle={
        isAdmin
          ? 'What the kitchens make, and the ingredients each one needs'
          : 'The recipes you can produce, and what they consume'
      }
      actions={
        isAdmin && (
          <Button variant="primary" onClick={() => setEditing({})}>
            Add product
          </Button>
        )
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

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
                  value={state.has_recipe ?? ''}
                  onChange={(e) => update({ has_recipe: e.target.value })}
                  options={[
                    { value: '', label: 'All products' },
                    { value: 'true', label: 'With an active recipe' },
                  ]}
                />
                {isAdmin && (
                  <Select
                    value={state.include_inactive ?? ''}
                    onChange={(e) => update({ include_inactive: e.target.value })}
                    options={[
                      { value: '', label: 'Active products' },
                      { value: 'true', label: 'Include archived' },
                    ]}
                  />
                )}
              </>
            }
          >
            <SearchInput
              value={state.search ?? ''}
              onChange={(search) => update({ search })}
              placeholder="Search product or SKU…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          onRowClick={(r) => router.push(`/products/${r.id}`)}
          columns={[
            {
              key: 'name',
              label: 'Product',
              render: (r) => (
                <div>
                  <div className="cell-title">
                    {r.name} {!r.is_active && <Badge tone="gray">Archived</Badge>}
                  </div>
                  <div className="cell-sub">
                    <span className="mono">{r.sku}</span>
                    {r.category_name ? ` · ${r.category_name}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'recipe',
              label: 'Recipe',
              render: (r) =>
                r.active_recipe_id ? (
                  <Badge tone="green" dot>
                    {num(r.ingredient_count)} ingredients
                  </Badge>
                ) : (
                  <Badge tone="amber" dot>
                    No recipe
                  </Badge>
                ),
            },
            { key: 'unit_code', label: 'Sold in', render: (r) => <Badge tone="gray">{r.unit_code}</Badge> },
            {
              key: 'selling_price',
              label: 'Price',
              align: 'right',
              render: (r) => money(r.selling_price),
            },
            {
              key: 'total_produced',
              label: 'Produced to date',
              align: 'right',
              render: (r) => (
                <span className="muted">
                  {num(r.total_produced)} {r.unit_code}
                </span>
              ),
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <div className="flex gap-4 nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/products/${r.id}`);
                    }}
                  >
                    {isAdmin ? 'Recipe' : 'View'}
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(r);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="product"
              title="No products yet"
              message="Add a product such as a cake, then give it a recipe listing every ingredient it needs."
              action={
                isAdmin && (
                  <Button variant="primary" onClick={() => setEditing({})}>
                    Add a product
                  </Button>
                )
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>

      <ProductForm
        product={editing}
        units={units}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          setEditing(null);
          reload();
          if (id) router.push(`/products/${id}`);
        }}
        toast={toast}
      />
    </Layout>
  );
}

/* ------------------------------------------------------------------------- */
function ProductForm({ product, units, categories, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [seeded, setSeeded] = useState(false);

  if (product && !seeded) {
    setForm({
      sku: product.sku ?? '',
      name: product.name ?? '',
      description: product.description ?? '',
      category_id: product.category_id ?? '',
      unit_id: product.unit_id ?? units.find((u) => u.code === 'pcs')?.id ?? '',
      selling_price: product.selling_price ?? 0,
      is_active: product.id ? !!product.is_active : true,
    });
    setSeeded(true);
  }
  if (!product && seeded) setSeeded(false);

  const isNew = product && !product.id;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setError(null);
    setErrors({});
    const payload = {
      sku: form.sku,
      name: form.name,
      description: form.description || null,
      category_id: form.category_id ? Number(form.category_id) : null,
      unit_id: Number(form.unit_id),
      selling_price: Number(form.selling_price || 0),
    };
    try {
      if (isNew) {
        const result = await run(() => api.post('/products', payload));
        toast.success(`${form.name} created — now add its recipe`);
        onSaved(result.data.id);
      } else {
        await run(() =>
          api.put(`/products/${product.id}`, { ...payload, is_active: !!form.is_active }),
        );
        toast.success(`${form.name} updated`);
        onSaved();
      }
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    }
  }

  return (
    <Modal
      open={!!product}
      title={isNew ? 'Add a product' : `Edit ${product?.name}`}
      subtitle={isNew ? 'A finished item your kitchens produce' : product?.sku}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={loading}>
            {isNew ? 'Create and add recipe' : 'Save changes'}
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
        <Field label="SKU" required error={errors.sku}>
          <Input value={form.sku ?? ''} onChange={set('sku')} error={errors.sku} placeholder="FG-CAKE-001" />
        </Field>
        <Field label="Product name" required error={errors.name}>
          <Input
            value={form.name ?? ''}
            onChange={set('name')}
            error={errors.name}
            placeholder="Classic Vanilla Cake"
          />
        </Field>
      </div>

      <div className="form-row three">
        <Field label="Category" optional>
          <Select
            value={form.category_id ?? ''}
            onChange={set('category_id')}
            placeholder="Uncategorised"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Sold in" required error={errors.unit_id} hint="How the output is counted">
          <Select
            value={form.unit_id ?? ''}
            onChange={set('unit_id')}
            placeholder="Choose…"
            error={errors.unit_id}
            options={units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))}
          />
        </Field>
        <Field label="Selling price" optional error={errors.selling_price}>
          <NumberInput value={form.selling_price ?? 0} min="0" onChange={set('selling_price')} />
        </Field>
      </div>

      <Field label="Description" optional>
        <Textarea value={form.description ?? ''} rows={2} onChange={set('description')} />
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
