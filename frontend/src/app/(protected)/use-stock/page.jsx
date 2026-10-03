'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { FETCH_ALL, useAction, useClientTable, useFetch } from '@/lib/hooks';
import { api, qs } from '@/lib/api';
import { dateTime, isoDate, qty, withCurrentTime } from '@/lib/format';
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
  Pagination,
  SearchInput,
  Textarea,
  useToast,
} from '@/components/ui';

/**
 * Take used-up stock off the shelf, in bulk.
 *
 * A kitchen cannot stop to log every pinch of flour, and nobody should have to
 * do sums at the end of a shift. So the whole shelf is one list: put a number
 * against whatever got used - a few items after a couple of orders, or
 * everything at close - and save once.
 *
 * What has been typed is kept on the device as a draft, per kitchen. A
 * manager can add to it between orders, close the browser, come back, and
 * nothing is lost and nothing has left the shelf yet. Only "Save" removes
 * stock, and it asks first.
 */

const draftKey = (kitchenId) => `kitchenstock.usage.draft.${kitchenId}`;

function readDraft(kitchenId) {
  try {
    const raw = localStorage.getItem(draftKey(kitchenId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeDraft(kitchenId, draft) {
  try {
    if (Object.keys(draft).length === 0) localStorage.removeItem(draftKey(kitchenId));
    else localStorage.setItem(draftKey(kitchenId), JSON.stringify(draft));
  } catch {
    /* a draft that cannot be remembered is still a working screen */
  }
}

/** How much one tap of + or - moves, in whatever the item is counted in. */
function stepFor(unitCode) {
  if (unitCode === 'kg' || unitCode === 'l') return 0.5;
  if (unitCode === 'g' || unitCode === 'ml') return 100;
  return 1;
}

const round = (value) => Math.round(value * 10000) / 10000;

export default function UseStockPage() {
  const { isAdmin, ready, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { run, loading: saving } = useAction();

  // This screen belongs to the kitchen managers; the administrator has the
  // reports and the stock history instead.
  useEffect(() => {
    if (ready && isAdmin) router.replace('/dashboard');
  }, [ready, isAdmin, router]);

  const kitchenId = isAdmin ? '' : String(user?.kitchens?.[0]?.id ?? '');
  const kitchenName = user?.kitchens?.[0]?.name;

  const stock = useFetch(
    kitchenId ? `/kitchens/${kitchenId}/inventory?page_size=${FETCH_ALL}&hide_zero=true` : null,
    { skip: !kitchenId },
  );
  const history = useFetch(kitchenId ? `/usage${qs({ kitchen_id: kitchenId, page_size: 8 })}` : null, {
    skip: !kitchenId,
  });

  const [search, setSearch] = useState('');
  const [onlyEntered, setOnlyEntered] = useState(false);
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [usedOn, setUsedOn] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);

  // Load the saved draft for this kitchen once it is known.
  useEffect(() => {
    setDraft(kitchenId ? readDraft(kitchenId) : {});
  }, [kitchenId]);

  const change = useCallback(
    (itemId, value) => {
      setDraft((current) => {
        const next = { ...current };
        if (value === '' || value === null || Number(value) <= 0) delete next[itemId];
        else next[itemId] = String(value);
        writeDraft(kitchenId, next);
        return next;
      });
    },
    [kitchenId],
  );

  const rows = useMemo(() => stock.data?.data ?? [], [stock.data]);

  // Three hundred items in one scroll is not a list anyone can use. Tabs by
  // category cut it to a screenful, and each tab says how many of its items
  // have been entered so nothing is lost behind a tab that was left.
  const categories = useMemo(() => {
    const groups = new Map();
    for (const row of rows) {
      const name = row.category_name || 'Other';
      const group = groups.get(name) ?? { name, total: 0, entered: 0 };
      group.total += 1;
      if (Number(draft[row.item_id]) > 0) group.entered += 1;
      groups.set(name, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, draft]);

  // Paged, so a kitchen with a thousand items still draws one screenful.
  const table = useClientTable(rows, {
    search,
    searchKeys: ['item_name', 'category_name'],
    predicate: (row) => {
      if (category && (row.category_name || 'Other') !== category) return false;
      if (onlyEntered && !draft[row.item_id]) return false;
      return true;
    },
    pageSize: 25,
    serverTotal: stock.data?.meta?.total,
    resetKey: [category, onlyEntered],
  });
  const visible = table.rows;

  const entered = useMemo(
    () => rows.filter((row) => Number(draft[row.item_id]) > 0),
    [rows, draft],
  );
  const tooMuch = entered.filter((row) => Number(draft[row.item_id]) > Number(row.quantity) + 1e-9);

  async function save() {
    setError(null);
    try {
      const result = await run(() =>
        api.post('/usage', {
          kitchen_id: Number(kitchenId),
          used_at: withCurrentTime(usedOn),
          notes: notes || null,
          items: entered.map((row) => ({
            item_id: row.item_id,
            quantity: Number(draft[row.item_id]),
          })),
        }),
      );
      toast.success(result.message);
      writeDraft(kitchenId, {});
      setDraft({});
      setNotes('');
      setUsedOn(isoDate());
      setReviewing(false);
      stock.reload();
      history.reload();
    } catch (err) {
      setError(err);
    }
  }

  const subtitle = kitchenName
    ? `${kitchenName} — tell us what you used and we will take it off the shelf`
    : 'Tell us what you used and we will take it off the shelf';

  return (
    <Layout title="Use Stock" subtitle={subtitle}>
      {!kitchenId && !isAdmin && (
        <Alert tone="info" title="No kitchen yet">
          You have not been given a kitchen. Ask the administrator to add you to one.
        </Alert>
      )}

      {kitchenId && (
        <>
          {stock.error && <Alert tone="error">{stock.error.message}</Alert>}

          <div className="use-howto mb-16">
            <strong>How this works:</strong> pick a category, then type or tap <strong>+</strong> next to
            everything the kitchen used. You can do it after a few orders or once at the end of the day. Nothing
            leaves the shelf until you press <strong>Save</strong>.
          </div>

          <div className="use-cats" role="tablist" aria-label="Categories">
            <button
              type="button"
              className={`use-cat${category === '' ? ' active' : ''}`}
              onClick={() => setCategory('')}
            >
              All <span className="use-cat-count">{rows.length}</span>
            </button>
            {categories.map((group) => (
              <button
                key={group.name}
                type="button"
                className={`use-cat${category === group.name ? ' active' : ''}`}
                onClick={() => setCategory(group.name)}
              >
                {group.name}
                <span className="use-cat-count">{group.total}</span>
                {group.entered > 0 && <span className="use-cat-done">{group.entered} ✓</span>}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="card-head">
              <SearchInput value={search} onChange={setSearch} placeholder="Find an item…" />
              <label className="use-toggle">
                <input
                  type="checkbox"
                  checked={onlyEntered}
                  onChange={(e) => setOnlyEntered(e.target.checked)}
                />
                Only show what I have entered
              </label>
            </div>

            {stock.loading ? (
              <Loading />
            ) : visible.length === 0 ? (
              <EmptyState
                icon="box"
                title={rows.length === 0 ? 'Nothing on the shelf' : 'No items match'}
                message={
                  rows.length === 0
                    ? 'There is no stock in this kitchen to take off.'
                    : 'Try a different word, or switch off the filter above.'
                }
              />
            ) : (
              <ul className="use-list">
                {visible.map((row) => {
                  const value = draft[row.item_id] ?? '';
                  const step = stepFor(row.unit_code);
                  const over = Number(value) > Number(row.quantity) + 1e-9;
                  return (
                    <li key={row.item_id} className={`use-row${value ? ' has-value' : ''}`}>
                      <div className="use-name">
                        <div className="cell-title">{row.item_name}</div>
                        <div className="cell-sub">On the shelf: {qty(row.quantity, row.unit_code)}</div>
                        {over && (
                          <div className="use-over">
                            Only {qty(row.quantity, row.unit_code)} is left
                          </div>
                        )}
                      </div>

                      <div className="use-stepper">
                        <button
                          type="button"
                          className="use-step"
                          aria-label={`One less ${row.item_name}`}
                          disabled={!value}
                          onClick={() => change(row.item_id, round(Number(value) - step))}
                        >
                          −
                        </button>
                        <NumberInput
                          value={value}
                          min="0"
                          error={over}
                          placeholder="0"
                          aria-label={`${row.item_name} used`}
                          onChange={(e) => change(row.item_id, e.target.value)}
                        />
                        <button
                          type="button"
                          className="use-step"
                          aria-label={`One more ${row.item_name}`}
                          onClick={() => change(row.item_id, round(Number(value || 0) + step))}
                        >
                          +
                        </button>
                        <span className="use-unit">{row.unit_code}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Pagination meta={table.meta} onPage={table.setPage} onPageSize={table.setPageSize} />
          </div>

          <div className="card mt-16">
            <div className="card-head">
              <h3>What you have saved lately</h3>
            </div>
            {history.loading ? (
              <Loading />
            ) : (history.data?.data ?? []).length === 0 ? (
              <EmptyState
                icon="clock"
                title="Nothing saved yet"
                message="After you save, each entry shows up here so you can see what was taken off."
              />
            ) : (
              <ul className="use-history">
                {history.data.data.map((entry) => (
                  <li key={entry.id}>
                    <div className="use-history-head">
                      <strong className="mono">{entry.usage_no}</strong>
                      <span className="muted small">{dateTime(entry.used_at)}</span>
                      {entry.recorded_by_name && (
                        <span className="muted small">by {entry.recorded_by_name}</span>
                      )}
                    </div>
                    <div className="use-history-items">
                      {entry.items.map((line) => (
                        <Badge key={line.item_id} tone="gray">
                          {line.item_name} · {qty(line.quantity, line.unit_code)}
                        </Badge>
                      ))}
                    </div>
                    {entry.notes && <div className="muted small">{entry.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Always within reach: the list is long and the button is the point. */}
          <div className={`use-bar${entered.length ? ' show' : ''}`} role="region" aria-live="polite">
            <div className="use-bar-text">
              <strong>
                {entered.length} item{entered.length === 1 ? '' : 's'}
              </strong>{' '}
              ready to take off
              {tooMuch.length > 0 && (
                <span className="use-over"> — {tooMuch.length} more than is on the shelf</span>
              )}
            </div>
            <Button
              onClick={() => {
                setDraft({});
                writeDraft(kitchenId, {});
              }}
            >
              Clear
            </Button>
            <Button
              variant="primary"
              size="lg"
              disabled={entered.length === 0 || tooMuch.length > 0}
              onClick={() => {
                setError(null);
                setReviewing(true);
              }}
            >
              Review &amp; save
            </Button>
          </div>
        </>
      )}

      <Modal
        open={reviewing}
        title="Take these off the shelf?"
        subtitle={kitchenName}
        onClose={saving ? undefined : () => setReviewing(false)}
        footer={
          <>
            <Button onClick={() => setReviewing(false)} disabled={saving}>
              No, go back
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              {saving ? 'Saving…' : 'Yes, save it'}
            </Button>
          </>
        }
      >
        {error && (
          <div className="mb-16">
            <Alert tone="error">{error.message}</Alert>
          </div>
        )}

        {saving && (
          <div className="mb-16">
            <Alert tone="info">Saving - please keep this page open for a moment.</Alert>
          </div>
        )}

        <ul className="use-review">
          {entered.map((row) => (
            <li key={row.item_id}>
              <span>{row.item_name}</span>
              <strong>{qty(draft[row.item_id], row.unit_code)}</strong>
            </li>
          ))}
        </ul>

        <div className="form-row mt-16">
          <Field label="Which day was this for?">
            <DateInput value={usedOn} max={isoDate()} onChange={(e) => setUsedOn(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" optional>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="For example: evening orders"
          />
        </Field>
      </Modal>
    </Layout>
  );
}
