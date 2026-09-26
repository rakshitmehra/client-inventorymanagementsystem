'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { ConfirmButton } from '@/components/ConfirmButton';
import AdminOnly from '@/components/AdminOnly';
import {
  FETCH_ALL,
  useAction,
  useClientTable,
  useFetch,
  useListState,
  useReference,
} from '@/lib/hooks';
import { api } from '@/lib/api';
import { dateTime, money, num, qty, relative } from '@/lib/format';
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
  NumberInput,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

export default function ItemsPage() {
  return (
    <AdminOnly>
      <Items />
    </AdminOnly>
  );
}

/**
 * Where an item stands against its own minimum.
 *
 * An item with no minimum set can never be "low" - there is nothing to be low
 * against - so it reads as OK rather than quietly joining the shortage list.
 */
function stockLevel(item) {
  const total = Number(item.total_quantity ?? 0);
  const min = Number(item.min_stock_level ?? 0);
  if (total <= 0) return 'OUT';
  if (min > 0 && total <= min) return 'LOW';
  return 'OK';
}

function Items() {
  const router = useRouter();
  const toast = useToast();
  const { units, categories } = useReference();
  const { run, loading: busy } = useAction();

  const [state, update, setSort] = useListState({ sort: 'name', order: 'asc' });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // Archived items are fetched too, and hidden below. The catalogue is small,
  // and pulling both means the "Include archived" toggle is instant rather
  // than a round trip that re-sorts the table under the user.
  const { data, loading, error, reload } = useFetch(`/items?include_inactive=true&page_size=${FETCH_ALL}`);
  const suppliers = useFetch('/suppliers');

  // Counted across the whole catalogue, not the current page.
  const noMinimum = (data?.data ?? []).filter(
    (i) => i.is_active && Number(i.min_stock_level ?? 0) <= 0,
  ).length;

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['name', 'sku', 'description'],
    // The row names the supplier column default_supplier_id, not supplier_id;
    // matching the wrong one would quietly filter everything away.
    filters: {
      category_id: state.category_id ?? '',
      default_supplier_id: state.supplier_id ?? '',
    },
    predicate: (row) => {
      if (state.include_inactive !== 'true' && !row.is_active) return false;
      if (!state.stock) return true;
      const level = stockLevel(row);
      return state.stock === 'SHORT' ? level !== 'OK' : level === state.stock;
    },
    // The column is headed "Category" but the row field is category_name.
    sort: state.sort === 'category' ? 'category_name' : state.sort,
    order: state.order,
    serverTotal: data?.meta?.total,
    resetKey: state,
  });

  async function remove() {
    try {
      const result = await run(() => api.del(`/items/${deleting.id}`));
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
      title="Items"
      subtitle="The raw materials catalogue shared by the Main Inventory and every kitchen"
      actions={
        <Button variant="primary" onClick={() => setEditing({})}>
          Add item
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      {/* Said once, where something can be done about it, rather than printed
          on every one of the rows it is true for. An item with no minimum can
          never be reported as running low, so this is the list of things the
          low-stock warnings are currently blind to. */}
      {noMinimum > 0 && (
        <Alert tone="info" title={`${noMinimum} item${noMinimum === 1 ? ' has' : 's have'} no minimum level`}>
          Without a minimum there is nothing to be low against, so these never appear in the
          low-stock warnings. Set one when you edit the item.
        </Alert>
      )}

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
                  value={state.supplier_id ?? ''}
                  onChange={(e) => update({ supplier_id: e.target.value })}
                  placeholder="All suppliers"
                  options={(suppliers.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
                />
                <Select
                  value={state.stock ?? ''}
                  onChange={(e) => update({ stock: e.target.value })}
                  options={[
                    { value: '', label: 'Any stock level' },
                    { value: 'SHORT', label: 'Low or out' },
                    { value: 'OUT', label: 'All gone' },
                    { value: 'OK', label: 'Plenty left' },
                  ]}
                />
                <Select
                  value={state.include_inactive ?? ''}
                  onChange={(e) => update({ include_inactive: e.target.value })}
                  options={[
                    { value: '', label: 'Active items' },
                    { value: 'true', label: 'Include archived' },
                  ]}
                />
              </>
            }
          >
            <SearchInput
              value={state.search ?? ''}
              onChange={(search) => update({ search })}
              placeholder="Search name, SKU or description…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          onRowClick={(r) => router.push(`/movements/item/${r.id}`)}
          sort={state.sort}
          order={state.order}
          onSort={setSort}
          rows={table.rows}
          startIndex={table.startIndex}
          columns={[
            {
              key: 'name',
              label: 'Item',
              sortable: true,
              render: (r) => (
                <div>
                  <div className="cell-title">
                    {r.name} {!r.is_active && <Badge tone="gray">Archived</Badge>}
                  </div>
                  <div className="cell-sub">
                    <span className="mono">{r.sku}</span>
                    {r.category_name ? ` · ${r.category_name}` : ''}
                    {r.is_perishable ? ' · perishable' : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'main_quantity',
              label: 'In main',
              align: 'right',
              sortable: true,
              render: (r) => qty(r.main_quantity, r.unit_code),
            },
            {
              key: 'kitchen_quantity',
              label: 'In kitchens',
              align: 'right',
              render: (r) => <span className="muted">{qty(r.kitchen_quantity, r.unit_code)}</span>,
            },
            {
              key: 'total_quantity',
              label: 'Total held',
              align: 'right',
              sortable: true,
              // The total and how it compares to the minimum are one fact, so
              // they go in one cell. A bare "Min level" column left the reader
              // to do the comparison in their head, 182 times.
              render: (r) => {
                const level = stockLevel(r);
                return (
                  <div className="stack-right">
                    <strong>{qty(r.total_quantity, r.unit_code)}</strong>
                    {level === 'OUT' ? (
                      <Badge tone="red" dot>All gone</Badge>
                    ) : level === 'LOW' ? (
                      <Badge tone="amber" dot>Low</Badge>
                    ) : r.min_stock_level > 0 ? (
                      <span className="cell-sub">min {num(r.min_stock_level)}</span>
                    ) : null}
                  </div>
                );
              },
            },
            {
              key: 'created_at',
              label: 'Added',
              sortable: true,
              render: (r) =>
                r.created_at ? (
                  <span className="cell-sub" title={dateTime(r.created_at)}>
                    {relative(r.created_at)}
                  </span>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: 'unit_cost',
              label: 'Unit cost',
              align: 'right',
              sortable: true,
              render: (r) => money(r.unit_cost),
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
                      setEditing(r);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(r);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="ingredient"
              title="No items match"
              message="Add the raw materials your kitchens use — flour, cream, sugar and so on."
              action={
                <Button variant="primary" onClick={() => setEditing({})}>
                  Add your first item
                </Button>
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>

      <ItemForm
        item={editing}
        units={units}
        categories={categories}
        suppliers={suppliers.data?.data ?? []}
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
        message="Items with stock or movement history are archived instead of deleted, so nothing is lost from the audit trail."
        confirmLabel="Delete item"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Layout>
  );
}

/* ------------------------------------------------------------------------- */
function ItemForm({ item, units, categories, suppliers, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [seeded, setSeeded] = useState(false);

  if (item && !seeded) {
    setForm({
      sku: item.sku ?? '',
      name: item.name ?? '',
      description: item.description ?? '',
      category_id: item.category_id ?? '',
      unit_id: item.unit_id ?? '',
      min_stock_level: item.min_stock_level ?? 0,
      max_stock_level: item.max_stock_level ?? '',
      reorder_quantity: item.reorder_quantity ?? 0,
      unit_cost: item.unit_cost ?? 0,
      default_supplier_id: item.default_supplier_id ?? '',
      is_perishable: !!item.is_perishable,
      is_active: item.id ? !!item.is_active : true,
    });
    setSeeded(true);
  }
  if (!item && seeded) setSeeded(false);

  const isNew = item && !item.id;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const hasHistory = item?.id && Number(item.total_quantity) > 0;

  async function submit() {
    setError(null);
    setErrors({});
    const payload = {
      sku: form.sku,
      name: form.name,
      description: form.description || null,
      category_id: form.category_id ? Number(form.category_id) : null,
      unit_id: Number(form.unit_id),
      min_stock_level: Number(form.min_stock_level || 0),
      max_stock_level: form.max_stock_level === '' ? null : Number(form.max_stock_level),
      reorder_quantity: Number(form.reorder_quantity || 0),
      unit_cost: Number(form.unit_cost || 0),
      default_supplier_id: form.default_supplier_id ? Number(form.default_supplier_id) : null,
      is_perishable: !!form.is_perishable,
    };
    try {
      if (isNew) {
        await run(() => api.post('/items', payload));
        toast.success(`${form.name} added to the catalogue`);
      } else {
        await run(() => api.put(`/items/${item.id}`, { ...payload, is_active: !!form.is_active }));
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
      open={!!item}
      size="wide"
      title={isNew ? 'Add an item' : `Edit ${item?.name}`}
      subtitle={isNew ? 'Raw materials available to every kitchen' : item?.sku}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          {isNew ? (
            <Button variant="primary" onClick={submit} loading={loading}>
              Add item
            </Button>
          ) : (
            <ConfirmButton
              variant="primary"
              loading={loading}
              onConfirm={submit}
              title={`Save changes to ${item?.name ?? 'this item'}?`}
              message="The item is updated everywhere it appears, including on past documents that name it."
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
        <Field label="SKU" required error={errors.sku} hint="Letters, numbers and dashes">
          <Input value={form.sku ?? ''} onChange={set('sku')} error={errors.sku} placeholder="RM-FLR-001" />
        </Field>
        <Field label="Item name" required error={errors.name}>
          <Input value={form.name ?? ''} onChange={set('name')} error={errors.name} placeholder="Wheat Flour" />
        </Field>
      </div>

      <div className="form-row three">
        <Field label="Category" optional error={errors.category_id}>
          <Select
            value={form.category_id ?? ''}
            onChange={set('category_id')}
            placeholder="Uncategorised"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field
          label="Stocking unit"
          required
          error={errors.unit_id}
          hint={hasHistory ? 'Locked once the item has stock history' : 'How this item is counted'}
        >
          <Select
            value={form.unit_id ?? ''}
            onChange={set('unit_id')}
            disabled={hasHistory}
            placeholder="Choose a unit…"
            error={errors.unit_id}
            options={units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))}
          />
        </Field>
        <Field label="Default supplier" optional>
          <Select
            value={form.default_supplier_id ?? ''}
            onChange={set('default_supplier_id')}
            placeholder="No default"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
      </div>

      <div className="form-row three">
        <Field
          label="Minimum stock level"
          error={errors.min_stock_level}
          hint="Low-stock alerts trigger at or below this"
        >
          <NumberInput value={form.min_stock_level ?? 0} min="0" onChange={set('min_stock_level')} />
        </Field>
        <Field label="Maximum stock level" optional error={errors.max_stock_level}>
          <NumberInput value={form.max_stock_level ?? ''} min="0" onChange={set('max_stock_level')} />
        </Field>
        <Field
          label="Reorder quantity"
          optional
          error={errors.reorder_quantity}
          hint="Suggested amount to buy"
        >
          <NumberInput value={form.reorder_quantity ?? 0} min="0" onChange={set('reorder_quantity')} />
        </Field>
      </div>

      <div className="form-row">
        <Field label="Unit cost" error={errors.unit_cost} hint="Used to value stock and cost recipes">
          <NumberInput value={form.unit_cost ?? 0} min="0" onChange={set('unit_cost')} />
        </Field>
        <Field label="Options">
          <div className="flex col gap-8" style={{ paddingTop: 6 }}>
            <Checkbox
              label="Perishable item"
              checked={!!form.is_perishable}
              onChange={(e) => setForm((f) => ({ ...f, is_perishable: e.target.checked }))}
            />
            {!isNew && (
              <Checkbox
                label="Active in the catalogue"
                checked={!!form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
            )}
          </div>
        </Field>
      </div>

      <Field label="Description" optional error={errors.description}>
        <Textarea
          value={form.description ?? ''}
          rows={2}
          onChange={set('description')}
          placeholder="Grade, packaging, storage notes…"
        />
      </Field>
    </Modal>
  );
}
