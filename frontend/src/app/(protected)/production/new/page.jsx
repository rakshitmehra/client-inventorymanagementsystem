'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { isoDate, money, num, qty, withCurrentTime } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  DateInput,
  EmptyState,
  Field,
  Loading,
  Modal,
  NumberInput,
  Select,
  Step,
  Textarea,
  useToast,
} from '@/components/ui';

export default function NewProductionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewProduction />
    </Suspense>
  );
}

/**
 * Three steps down one column: pick the product, say how many, check the
 * ingredient list. Nothing is taken out of stock until the final confirmation.
 */
function NewProduction() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin, user } = useAuth();
  const searchParams = useSearchParams();
  const { run, loading: saving } = useAction();

  const kitchens = useFetch('/kitchens');
  const kitchenList = (kitchens.data?.data ?? []).filter((k) => k.is_active);

  const [kitchenId, setKitchenId] = useState(
    searchParams.get('kitchen') ?? (isAdmin ? '' : String(user?.kitchens?.[0]?.id ?? '')),
  );
  const [productId, setProductId] = useState(searchParams.get('product') ?? '');
  const [quantity, setQuantity] = useState('1');
  const [producedAt, setProducedAt] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // An admin has to pick a kitchen; a manager only ever has their own.
  useEffect(() => {
    if (!isAdmin && user?.kitchens?.[0]) {
      setKitchenId(String(user.kitchens[0].id));
    } else if (isAdmin && !kitchenId && kitchenList.length === 1) {
      setKitchenId(String(kitchenList[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user, kitchens.data]);

  const available = useFetch(kitchenId ? `/production/available/${kitchenId}` : null, {
    skip: !kitchenId,
  });
  const products = available.data?.data ?? [];
  const selectedProduct = products.find((p) => p.id === Number(productId));

  // Recompute the ingredient list whenever the inputs settle.
  useEffect(() => {
    if (!kitchenId || !productId || !(Number(quantity) > 0)) {
      setPreview(null);
      setPreviewError(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      setPreviewError(null);
      try {
        const result = await api.post('/production/preview', {
          kitchen_id: Number(kitchenId),
          product_id: Number(productId),
          output_quantity: Number(quantity),
        });
        if (!cancelled) setPreview(result.data);
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(err);
        }
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kitchenId, productId, quantity]);

  async function submit() {
    try {
      const result = await run(() =>
        api.post('/production', {
          kitchen_id: Number(kitchenId),
          product_id: Number(productId),
          output_quantity: Number(quantity),
          produced_at: withCurrentTime(producedAt),
          notes: notes || null,
        }),
      );
      setConfirming(false);
      toast.success(result.message);
      router.push(`/production/${result.data.id}`);
    } catch (err) {
      setConfirming(false);
      toast.error(err.message);
    }
  }

  if (kitchens.loading) {
    return (
      <Layout title="Record Production">
        <Loading />
      </Layout>
    );
  }

  if (!isAdmin && !user?.kitchens?.length) {
    return (
      <Layout title="Record Production">
        <Alert tone="warn" title="You have not been given a kitchen yet">
          Please ask your manager to add you to a kitchen first.
        </Alert>
      </Layout>
    );
  }

  return (
    <Layout title="Record Production" subtitle="Log what was produced; the ingredients come off your stock">
      <div style={{ maxWidth: 940 }}>
        {/* ------------------------------------------------- step 1: what -- */}
        <div className="card mb-16">
          <div className="card-body">
            <Step number="1" title="What did you make?" />

            {isAdmin && (
              <Field label="Which kitchen?" required>
                <Select
                  value={kitchenId}
                  onChange={(e) => {
                    setKitchenId(e.target.value);
                    setProductId('');
                  }}
                  placeholder="Choose a kitchen…"
                  options={kitchenList.map((k) => ({ value: k.id, label: k.name }))}
                />
              </Field>
            )}

            {!kitchenId ? (
              <Alert tone="info">Choose a kitchen first and we will show what it can make.</Alert>
            ) : available.loading ? (
              <Loading label="Checking what you can make…" />
            ) : products.length === 0 ? (
              <EmptyState
                icon="recipe"
                title="No recipes set up yet"
                message="Someone needs to add a recipe before production can be recorded."
                action={<Button onClick={() => router.push('/products')}>Go to recipes</Button>}
              />
            ) : (
              <div className="grid cols-2" style={{ gap: 14 }}>
                {products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className={`product-card${Number(productId) === product.id ? ' selected' : ''}`}
                    onClick={() => setProductId(String(product.id))}
                    aria-pressed={Number(productId) === product.id}
                  >
                    <div className="flex between items-center gap-8">
                      <span className="product-card-name">{product.name}</span>
                      {Number(productId) === product.id && <Badge tone="brand">Chosen</Badge>}
                    </div>
                    <div className="mt-8">
                      {product.can_produce ? (
                        <Badge tone="green">
                          You can make up to {num(product.max_producible)}
                        </Badge>
                      ) : (
                        <Badge tone="red">Not enough ingredients</Badge>
                      )}
                    </div>
                    {!product.can_produce && product.blocking_items.length > 0 && (
                      <div className="cell-sub mt-8">
                        You have run out of: {product.blocking_items.slice(0, 3).join(', ')}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ step 2: amount -- */}
        {selectedProduct && (
          <div className="card mb-16">
            <div className="card-body">
              <Step
                number="2"
                title="How many did you make?"
                sub={`Counted in ${selectedProduct.unit_code}`}
              />

              <div className="form-row">
                <Field
                  label={`Number of ${selectedProduct.unit_code}`}
                  required
                  hint={`Today you can make up to ${num(selectedProduct.max_producible)}`}
                >
                  <NumberInput
                    value={quantity}
                    min="0"
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </Field>
                <Field label="When did you make it?" required>
                  <DateInput
                    value={producedAt}
                    max={isoDate()}
                    onChange={(e) => setProducedAt(e.target.value)}
                  />
                </Field>
              </div>

              {showNotes ? (
                <Field label="Notes" optional>
                  <Textarea
                    value={notes}
                    rows={2}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything worth remembering about this batch"
                  />
                </Field>
              ) : (
                <Button onClick={() => setShowNotes(true)} icon="edit">
                  Add a note
                </Button>
              )}
            </div>
          </div>
        )}

        {/* --------------------------------------------- step 3: check list -- */}
        {previewError && (
          <div className="mb-16">
            <Alert tone="error">{previewError.message}</Alert>
          </div>
        )}

        {previewing && (
          <div className="card mb-16">
            <Loading label="Working out what you used…" />
          </div>
        )}

        {preview && !previewing && (
          <div className="card mb-16">
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <Step
                number="3"
                title="Check what will be used"
                sub="These amounts come off your kitchen stock"
              />
            </div>

            {preview.can_produce ? (
              <div className="card-body" style={{ paddingTop: 0, paddingBottom: 12 }}>
                <Alert tone="success" title="You have everything you need">
                  All {preview.requirements.length} ingredients are in your kitchen.
                </Alert>
              </div>
            ) : (
              <div className="card-body" style={{ paddingTop: 0, paddingBottom: 12 }}>
                <Alert tone="warn" title="You do not have enough of everything">
                  Lower the number, or ask for more of the ingredients marked in red below.
                </Alert>
              </div>
            )}

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th className="num">You will use</th>
                    <th className="num">You have</th>
                    <th className="num">Left after</th>
                    <th>Enough?</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.requirements.map((req) => (
                    <tr key={req.item_id}>
                      <td>
                        <span className="cell-title">{req.item_name}</span>
                      </td>
                      <td className="num">
                        <strong>{qty(req.required_quantity, req.unit_code)}</strong>
                      </td>
                      <td className="num">{qty(req.available_quantity, req.unit_code)}</td>
                      <td className="num">
                        <span className={req.remaining_after < 0 ? 'pos-down' : ''}>
                          {qty(req.remaining_after, req.unit_code)}
                        </span>
                      </td>
                      <td>
                        {req.is_sufficient ? (
                          <Badge tone="green">Yes</Badge>
                        ) : (
                          <Badge tone="red">
                            Short by {num(req.shortfall)} {req.unit_code}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card-foot">
              <span className="strong">
                Ingredients cost about {money(preview.estimated_cost)}
              </span>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------- the button -- */}
        <div className="card">
          <div className="card-body">
            <Button
              variant="primary"
              size="lg"
              className="btn-block"
              disabled={!preview?.can_produce || previewing}
              onClick={() => setConfirming(true)}
              icon="cooking"
            >
              {preview
                ? `Record ${num(preview.output_quantity)} × ${preview.product.name}`
                : 'Record this production'}
            </Button>
            <p className="muted mt-12 center">
              Nothing changes until you press this and confirm on the next screen.
            </p>
          </div>
        </div>
      </div>

      <Modal
        open={confirming}
        size="wide"
        title="Is this right?"
        subtitle={
          preview
            ? `${num(preview.output_quantity)} × ${preview.product.name} at ${preview.kitchen.name}`
            : ''
        }
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={saving} icon="arrow-left">
              No, let me change it
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} icon="check-circle">
              Yes, record it
            </Button>
          </>
        }
      >
        {preview && (
          <>
            <Alert tone="info">
              We will take these {preview.requirements.length} ingredients out of your kitchen
              stock. This cannot be undone.
            </Alert>

            <table className="data mt-16">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th className="num">Taking out</th>
                  <th className="num">You will have left</th>
                </tr>
              </thead>
              <tbody>
                {preview.requirements.map((req) => (
                  <tr key={req.item_id}>
                    <td>{req.item_name}</td>
                    <td className="num">
                      <strong className="pos-down">
                        {qty(req.required_quantity, req.unit_code)}
                      </strong>
                    </td>
                    <td className="num">{qty(req.remaining_after, req.unit_code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Modal>
    </Layout>
  );
}
