'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { FETCH_ALL, useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Loading,
  NumberInput,
  SearchInput,
  Select,
  useToast,
} from '@/components/ui';

export default function ItemPricesPage() {
  return (
    <AdminOnly>
      <ItemPrices />
    </AdminOnly>
  );
}

/** A search that shows today's shop and market prices for the item. */
const onlineCheck = (item) =>
  `https://www.google.com/search?q=${encodeURIComponent(
    `${item.name} price per ${item.unit_code} India`,
  )}`;

/**
 * One sheet for pricing the whole catalogue.
 *
 * Every price here is for a SINGLE unit - one kg, one piece, one litre. That is
 * the one number everything else is worked out from: what a kitchen used, what
 * stock on the shelf is worth, what a recipe costs. Enter it once per unit and
 * those stay right however a quantity is later typed (500 g of a price-per-kg
 * item, for instance).
 */
function ItemPrices() {
  const router = useRouter();
  const toast = useToast();
  const { run, loading: saving } = useAction();

  const { data, loading, error, reload } = useFetch(`/items?page_size=${FETCH_ALL}`);
  const [edits, setEdits] = useState({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState('MISSING');

  const items = useMemo(() => (data?.data ?? []).filter((i) => i.is_active), [data]);
  const missing = items.filter((i) => Number(i.unit_cost ?? 0) <= 0).length;
  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category_name).filter(Boolean))].sort(),
    [items],
  );

  const needle = search.trim().toLowerCase();
  const shown = items.filter((item) => {
    if (view === 'MISSING' && Number(item.unit_cost ?? 0) > 0 && edits[item.id] === undefined) return false;
    if (category && item.category_name !== category) return false;
    return !needle || item.name.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle);
  });

  const changed = Object.entries(edits).filter(([id, value]) => {
    const item = items.find((i) => String(i.id) === id);
    return item && value !== '' && Number(value) >= 0 && Number(value) !== Number(item.unit_cost);
  });

  async function save() {
    try {
      const result = await run(() =>
        api.put('/item-prices', {
          prices: changed.map(([id, value]) => ({ item_id: Number(id), unit_cost: Number(value) })),
        }),
      );
      toast.success(result.message);
      setEdits({});
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Layout
      title="Item Prices"
      subtitle="The price of ONE kg, one piece or one litre of each item"
      actions={<Button onClick={() => router.push('/items')}>Back to items</Button>}
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="use-howto mb-16">
        Type the price for <strong>a single unit</strong> — for an item counted in kg, the price of
        1 kg. Tap <strong>Check online</strong> to see today&apos;s shop prices. Prices found online
        are a guide, so enter what you really pay.
      </div>

      <div className="card">
        <div className="card-head">
          <SearchInput value={search} onChange={setSearch} placeholder="Find an item…" />
          <div className="card-head-actions">
            <Select
              value={view}
              onChange={(e) => setView(e.target.value)}
              options={[
                { value: 'MISSING', label: `Items with no price (${missing})` },
                { value: 'ALL', label: `All items (${items.length})` },
              ]}
            />
            {categories.length > 1 && (
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Any category"
                options={categories.map((c) => ({ value: c, label: c }))}
              />
            )}
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title={view === 'MISSING' ? 'Every item has a price' : 'No items match'}
            message={view === 'MISSING' ? 'Switch to "All items" to change a price.' : 'Try a different word.'}
          />
        ) : (
          <ul className="price-list">
            {shown.map((item) => {
              const value = edits[item.id] ?? String(Number(item.unit_cost) > 0 ? item.unit_cost : '');
              const dirty = edits[item.id] !== undefined && Number(edits[item.id]) !== Number(item.unit_cost);
              return (
                <li key={item.id} className={`price-row${dirty ? ' dirty' : ''}`}>
                  <div className="price-name">
                    <div className="cell-title">{item.name}</div>
                    <div className="cell-sub">
                      {item.category_name || 'No category'}
                      {Number(item.unit_cost) > 0 && ` · now ${money(item.unit_cost)} per ${item.unit_code}`}
                      {Number(item.unit_cost) <= 0 && (
                        <>
                          {' '}
                          <Badge tone="amber">No price</Badge>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="price-input">
                    <span className="muted">₹</span>
                    <NumberInput
                      value={value}
                      min="0"
                      placeholder="0"
                      aria-label={`Price per ${item.unit_code} of ${item.name}`}
                      onChange={(e) => setEdits((current) => ({ ...current, [item.id]: e.target.value }))}
                    />
                    <span className="muted nowrap">per {item.unit_code}</span>
                  </div>
                  <a
                    className="price-check"
                    href={onlineCheck(item)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Check online
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={`use-bar${changed.length ? ' show' : ''}`} role="region" aria-live="polite">
        <div className="use-bar-text">
          <strong>
            {changed.length} price{changed.length === 1 ? '' : 's'}
          </strong>{' '}
          changed
        </div>
        <Button onClick={() => setEdits({})}>Undo</Button>
        <Button variant="primary" size="lg" loading={saving} onClick={save}>
          Save prices
        </Button>
      </div>
    </Layout>
  );
}
