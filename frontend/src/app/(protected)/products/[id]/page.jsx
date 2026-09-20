'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch, useReference } from '@/lib/hooks';
import { api } from '@/lib/api';
import { date, money, num, qty } from '@/lib/format';
import { ItemPicker } from '@/components/LineItems';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  NumberInput,
  Stat,
  Textarea,
  useToast,
} from '@/components/ui';

export default function ProductDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { units } = useReference();
  const { run, loading: busy } = useAction();

  const [editingRecipe, setEditingRecipe] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data, loading, error, reload } = useFetch(`/products/${id}`);
  const items = useFetch('/items?page_size=300');
  const product = data?.data;

  async function activate(recipe) {
    try {
      await run(() => api.patch(`/products/recipes/${recipe.id}/activate`));
      toast.success(`Version ${recipe.version} is now the active recipe`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeRecipe() {
    try {
      await run(() => api.del(`/products/recipes/${deleting.id}`));
      toast.success('Recipe deleted');
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(err.message);
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <Layout title="Product">
        <Loading />
      </Layout>
    );
  }
  if (error) {
    return (
      <Layout title="Product">
        <Alert tone="error">{error.message}</Alert>
      </Layout>
    );
  }
  if (!product) return null;

  const active = product.active_recipe;

  return (
    <Layout
      title={product.name}
      subtitle={`${product.sku}${product.category_name ? ` · ${product.category_name}` : ''}`}
      actions={
        <>
          <Button onClick={() => router.push('/products')}>All products</Button>
          {active && (
            <Button
              variant="primary"
              onClick={() => router.push(`/production/new?product=${product.id}`)}
            >
              Produce this
            </Button>
          )}
          {isAdmin && (
            <Button onClick={() => setEditingRecipe({ product })}>
              {active ? 'New recipe version' : 'Add recipe'}
            </Button>
          )}
        </>
      }
    >
      <div className="grid cols-4 mb-16">
        <Stat icon="product" tone="violet" label="Sold in" value={product.unit_code} meta={product.unit_name} />
        <Stat icon="rupee" tone="green" label="Selling price" value={money(product.selling_price)} />
        <Stat
          icon="ingredient"
          tone="blue"
          label="Ingredient cost"
          value={active ? money(active.cost_per_unit) : '—'}
          meta={active ? `per ${product.unit_code}` : 'no active recipe'}
        />
        <Stat
          icon="cooking"
          tone="amber"
          label="Margin"
          value={
            active && product.selling_price > 0
              ? `${Math.round(
                  ((product.selling_price - active.cost_per_unit) / product.selling_price) * 100,
                )}%`
              : '—'
          }
          meta={
            active && product.selling_price > 0
              ? money(product.selling_price - active.cost_per_unit)
              : ''
          }
        />
      </div>

      {product.description && (
        <div className="card mb-16">
          <div className="card-body">
            <p className="muted">{product.description}</p>
          </div>
        </div>
      )}

      {!active ? (
        <div className="card mb-16">
          <EmptyState
            icon="product"
            title="This product has no recipe"
            message="A recipe lists every ingredient and quantity needed. Without one, production cannot be recorded."
            action={
              isAdmin && (
                <Button variant="primary" onClick={() => setEditingRecipe({ product })}>
                  Add a recipe
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="card mb-16">
          <div className="card-head">
            <div>
              <h3>{active.name}</h3>
              <p className="muted small mt-4">
                Version {active.version} · yields {num(active.yield_quantity)} {active.yield_unit_code}
                {active.prep_time_mins ? ` · ${active.prep_time_mins} min preparation` : ''}
              </p>
            </div>
            <div className="card-head-actions">
              <Badge tone="green" dot>
                Active recipe
              </Badge>
              {isAdmin && (
                <Button size="sm" onClick={() => setEditingRecipe({ product, recipe: active })}>
                  Edit
                </Button>
              )}
            </div>
          </div>

          <DataTable
            rows={active.ingredients}
            columns={[
              {
                key: 'item_name',
                label: 'Ingredient',
                render: (r) => (
                  <div>
                    <div className="cell-title">
                      {r.item_name} {!r.item_is_active && <Badge tone="red">Archived item</Badge>}
                    </div>
                    <div className="cell-sub">
                      <span className="mono">{r.sku}</span>
                      {r.category_name ? ` · ${r.category_name}` : ''}
                    </div>
                  </div>
                ),
              },
              {
                key: 'quantity',
                label: 'Per batch',
                align: 'right',
                render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
              },
              {
                key: 'base_quantity',
                label: 'In stock units',
                align: 'right',
                render: (r) => <span className="muted">{qty(r.base_quantity, r.item_unit_code)}</span>,
              },
              {
                key: 'per_unit',
                label: `Per ${product.unit_code}`,
                align: 'right',
                render: (r) => (
                  <span className="muted">
                    {qty(r.base_quantity / active.yield_quantity, r.item_unit_code)}
                  </span>
                ),
              },
              {
                key: 'unit_cost',
                label: 'Unit cost',
                align: 'right',
                render: (r) => <span className="muted">{money(r.unit_cost)}</span>,
              },
              { key: 'line_cost', label: 'Cost', align: 'right', render: (r) => money(r.line_cost) },
            ]}
            footer={
              <tr>
                <td colSpan={5} className="right">
                  Cost per batch of {num(active.yield_quantity)}
                </td>
                <td className="num">{money(active.estimated_cost)}</td>
              </tr>
            }
          />

          {active.instructions && (
            <div className="card-body" style={{ borderTop: '1px solid var(--ink-200)' }}>
              <h4
                style={{
                  fontSize: 12.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--ink-500)',
                  marginBottom: 6,
                }}
              >
                Method
              </h4>
              <p className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {active.instructions}
              </p>
            </div>
          )}
        </div>
      )}

      {product.recipes.length > 1 && (
        <div className="card">
          <div className="card-head">
            <h3>Recipe versions</h3>
            <span className="muted small">
              Past versions are kept so historical production still shows what was actually used
            </span>
          </div>
          <DataTable
            rows={product.recipes}
            columns={[
              {
                key: 'name',
                label: 'Recipe',
                render: (r) => (
                  <div>
                    <div className="cell-title">{r.name}</div>
                    <div className="cell-sub">
                      Version {r.version} · {r.ingredients.length} ingredients
                    </div>
                  </div>
                ),
              },
              {
                key: 'yield',
                label: 'Yield',
                align: 'right',
                render: (r) => `${num(r.yield_quantity)} ${r.yield_unit_code}`,
              },
              {
                key: 'estimated_cost',
                label: 'Batch cost',
                align: 'right',
                render: (r) => money(r.estimated_cost),
              },
              {
                key: 'created_at',
                label: 'Created',
                render: (r) => (
                  <span className="muted small">
                    {date(r.created_at)} · {r.created_by_name || '—'}
                  </span>
                ),
              },
              {
                key: 'is_active',
                label: 'Status',
                render: (r) => (
                  <Badge tone={r.is_active ? 'green' : 'gray'} dot>
                    {r.is_active ? 'Active' : 'Superseded'}
                  </Badge>
                ),
              },
              ...(isAdmin
                ? [
                    {
                      key: 'actions',
                      label: '',
                      render: (r) =>
                        !r.is_active && (
                          <div className="flex gap-4 nowrap">
                            <Button size="sm" variant="ghost" onClick={() => activate(r)}>
                              Make active
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                              Delete
                            </Button>
                          </div>
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}

      <RecipeForm
        context={editingRecipe}
        units={units}
        items={(items.data?.data ?? []).map((i) => ({
          id: i.id,
          name: i.name,
          sku: i.sku,
          unit_id: i.unit_id,
          unit_code: i.unit_code,
          unit_cost: i.unit_cost,
        }))}
        onClose={() => setEditingRecipe(null)}
        onSaved={() => {
          setEditingRecipe(null);
          reload();
        }}
        toast={toast}
      />

      <ConfirmDialog
        open={!!deleting}
        title={`Delete version ${deleting?.version}?`}
        message="Recipe versions used by past production runs cannot be deleted."
        confirmLabel="Delete version"
        loading={busy}
        onConfirm={removeRecipe}
        onCancel={() => setDeleting(null)}
      />
    </Layout>
  );
}

/* ------------------------------------------------------------------------- */
function RecipeForm({ context, units, items, onClose, onSaved, toast }) {
  const { run, loading } = useAction();
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [seeded, setSeeded] = useState(false);

  const product = context?.product;
  const existing = context?.recipe;

  if (context && !seeded) {
    setForm({
      name: existing?.name ?? `${product?.name} — standard`,
      yield_quantity: existing?.yield_quantity ?? 1,
      yield_unit_id: existing?.yield_unit_id ?? product?.unit_id ?? '',
      prep_time_mins: existing?.prep_time_mins ?? '',
      instructions: existing?.instructions ?? '',
      ingredients: existing
        ? existing.ingredients.map((ing) => ({
            item_id: ing.item_id,
            quantity: String(ing.quantity),
            unit_id: ing.unit_id,
          }))
        : [{ item_id: null, quantity: '', unit_id: null }],
    });
    setSeeded(true);
  }
  if (!context && seeded) setSeeded(false);

  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const ingredients = form.ingredients ?? [];

  const unitsFor = (itemId) => {
    const item = itemsById[itemId];
    if (!item) return units;
    const base = units.find((u) => u.id === item.unit_id);
    return units.filter((u) => u.dimension === base?.dimension);
  };

  const toBase = (line) => {
    const item = itemsById[line.item_id];
    if (!item || !line.quantity) return 0;
    const entered = units.find((u) => u.id === (line.unit_id ?? item.unit_id));
    const base = units.find((u) => u.id === item.unit_id);
    if (!entered || !base || entered.dimension !== base.dimension) return 0;
    return (Number(line.quantity) * Number(entered.factor)) / Number(base.factor);
  };

  const batchCost = ingredients.reduce(
    (sum, line) => sum + toBase(line) * Number(itemsById[line.item_id]?.unit_cost ?? 0),
    0,
  );

  const setIngredient = (index, patch) =>
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const addIngredient = () =>
    setForm((f) => ({
      ...f,
      ingredients: [...f.ingredients, { item_id: null, quantity: '', unit_id: null }],
    }));

  const removeIngredient = (index) =>
    setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== index) }));

  async function submit() {
    setError(null);
    setErrors({});
    const payload = {
      name: form.name,
      yield_quantity: Number(form.yield_quantity),
      yield_unit_id: Number(form.yield_unit_id),
      prep_time_mins: form.prep_time_mins === '' ? null : Number(form.prep_time_mins),
      instructions: form.instructions || null,
      ingredients: ingredients
        .filter((line) => line.item_id && Number(line.quantity) > 0)
        .map((line) => ({
          item_id: line.item_id,
          quantity: Number(line.quantity),
          unit_id: line.unit_id ?? itemsById[line.item_id]?.unit_id,
        })),
    };

    try {
      if (existing) {
        await run(() => api.put(`/products/recipes/${existing.id}`, payload));
        toast.success('Recipe updated');
      } else {
        await run(() => api.post(`/products/${product.id}/recipes`, payload));
        toast.success('Recipe saved and made active');
      }
      onSaved();
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    }
  }

  const ready = ingredients.filter((l) => l.item_id && Number(l.quantity) > 0).length;

  return (
    <Modal
      open={!!context}
      size="xwide"
      title={existing ? `Edit ${existing.name}` : `New recipe for ${product?.name}`}
      subtitle={
        existing
          ? `Version ${existing.version} — changes apply to future production only`
          : 'A new version becomes the active recipe; earlier versions are kept for history'
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={loading} disabled={ready === 0}>
            {existing ? 'Save recipe' : 'Save and activate'}
          </Button>
        </>
      }
    >
      {error && !Object.keys(errors).length && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <div className="form-row three">
        <Field label="Recipe name" required error={errors.name}>
          <Input
            value={form.name ?? ''}
            error={errors.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field
          label="Batch yield"
          required
          error={errors.yield_quantity}
          hint="How many finished units one batch makes"
        >
          <div className="input-group">
            <NumberInput
              value={form.yield_quantity ?? 1}
              min="0.0001"
              onChange={(e) => setForm((f) => ({ ...f, yield_quantity: e.target.value }))}
            />
            <select
              className="select"
              value={form.yield_unit_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, yield_unit_id: Number(e.target.value) }))}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Preparation time" optional error={errors.prep_time_mins} hint="Minutes">
          <NumberInput
            value={form.prep_time_mins ?? ''}
            min="0"
            onChange={(e) => setForm((f) => ({ ...f, prep_time_mins: e.target.value }))}
          />
        </Field>
      </div>

      <div className="divider" />

      <div className="flex between items-center mb-12">
        <h4 style={{ fontSize: 13.5 }}>Ingredients</h4>
        <span className="muted small">
          {ready} ingredient(s) · batch cost <strong>{money(batchCost)}</strong>
          {Number(form.yield_quantity) > 0 &&
            ` · ${money(batchCost / Number(form.yield_quantity))} per unit`}
        </span>
      </div>

      <div className="line-item-head mb-8">
        <span>Ingredient</span>
        <span>Quantity per batch</span>
        <span>Cost</span>
        <span />
      </div>

      <div className="line-items">
        {ingredients.map((line, index) => {
          const item = itemsById[line.item_id];
          const base = toBase(line);
          return (
            <div className="line-item" key={index}>
              <div>
                <ItemPicker
                  items={items}
                  value={line.item_id}
                  excludeIds={ingredients.map((l) => l.item_id).filter(Boolean)}
                  onChange={(itemId) =>
                    setIngredient(index, {
                      item_id: itemId,
                      unit_id: itemsById[itemId]?.unit_id ?? null,
                    })
                  }
                />
                {item && <div className="cell-sub mt-4">Stocked in {item.unit_code}</div>}
              </div>

              <div className="input-group">
                <NumberInput
                  value={line.quantity}
                  min="0"
                  placeholder="0"
                  onChange={(e) => setIngredient(index, { quantity: e.target.value })}
                />
                <select
                  className="select"
                  value={line.unit_id ?? item?.unit_id ?? ''}
                  disabled={!item}
                  onChange={(e) => setIngredient(index, { unit_id: Number(e.target.value) })}
                >
                  {unitsFor(line.item_id).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="small muted" style={{ paddingTop: 8 }}>
                {item && base > 0 ? money(base * Number(item.unit_cost)) : '—'}
              </div>

              <Button
                variant="ghost"
                className="btn-icon"
                onClick={() => removeIngredient(index)}
                disabled={ingredients.length === 1}
                title="Remove ingredient"
                aria-label="Remove ingredient"
                icon="close"
              />
            </div>
          );
        })}
      </div>

      <Button className="mt-12" onClick={addIngredient}>
        + Add ingredient
      </Button>

      <div className="divider" />

      <Field label="Method" optional error={errors.instructions}>
        <Textarea
          value={form.instructions ?? ''}
          rows={4}
          onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
          placeholder="Mixing, baking temperature and time, finishing…"
        />
      </Field>
    </Modal>
  );
}
