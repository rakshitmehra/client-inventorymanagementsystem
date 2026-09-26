'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { StockTabs } from '@/components/StockTabs';
import { useAuth } from '@/lib/auth';
import { FETCH_ALL, useClientTable, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { isoDate, num, qty } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DateInput,
  EmptyState,
  Field,
  Loading,
  NumberInput,
  Pagination,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

/**
 * One screen for a kitchen asking the main store for stock.
 *
 * This replaces two that did nearly the same thing - a blank line-by-line
 * form, and a separate "run my usual order" page. Both ended in the same
 * request, so a manager had to work out which door to use before they could
 * ask for flour. Now there is one list of everything their kitchen stocks,
 * showing what they hold and what is running out, and they type a number
 * beside anything they want. The standard list is a button on this page that
 * fills those numbers in, rather than a page of its own.
 *
 * No costs appear here. A kitchen manager does not need to know what the
 * business pays for flour to ask for more of it.
 */
export default function AskForStockPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const kitchen = user?.kitchens?.[0];

  const stock = useFetch(
    kitchen ? `/kitchens/${kitchen.id}/inventory?page_size=${FETCH_ALL}` : null,
    { skip: !kitchen },
  );
  const lists = useFetch('/standard-lists');

  /** How much of each item to ask for, keyed by item id. */
  const [wanted, setWanted] = useState({});
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState('');
  /** Which shopping run to show - everyday, weekly, monthly, or all. */
  const [run, setRun] = useState('');
  const [category, setCategory] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const rows = stock.data?.data ?? [];

  // The three buying lists double as a grouping of the catalogue: which items
  // belong to the everyday run, which to the weekly order, which to monthly.
  // The manager cannot run them - they just say which items to show.
  const runs = (lists.data?.data ?? []).filter((l) => l.purpose === 'REFILL');
  const itemsInRun = useMemo(() => {
    const chosen = runs.find((l) => l.frequency === run);
    return chosen ? new Set((chosen.items ?? []).map((i) => i.item_id)) : null;
  }, [runs, run]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category_name).filter(Boolean))].sort(),
    [rows],
  );

  const table = useClientTable(rows, {
    search,
    searchKeys: ['item_name', 'sku', 'category_name'],
    predicate: (row) => {
      if (itemsInRun && !itemsInRun.has(row.item_id)) return false;
      if (category && row.category_name !== category) return false;
      if (only === 'SHORT') return row.stock_status !== 'OK';
      if (only === 'ASKED') return Number(wanted[row.item_id] ?? 0) > 0;
      return true;
    },
    resetKey: [search, only, run, category],
  });

  const asking = useMemo(
    () =>
      rows
        .filter((r) => Number(wanted[r.item_id] ?? 0) > 0)
        .map((r) => ({
          item_id: r.item_id,
          quantity: Number(wanted[r.item_id]),
          unit_id: r.unit_id,
          name: r.item_name,
          unit_code: r.unit_code,
        })),
    [rows, wanted],
  );

  /** Fill the boxes from the kitchen's saved standard list. */
  function loadUsualOrder(list) {
    const filled = { ...wanted };
    for (const line of list.items ?? []) {
      filled[line.item_id] = String(line.quantity);
    }
    setWanted(filled);
    toast.success(`Filled in ${list.items?.length ?? 0} items from '${list.name}'`);
  }

  async function submit() {
    setSaving(true);
    try {
      const result = await api.post('/requests', {
        kitchen_id: kitchen.id,
        needed_by: neededBy || undefined,
        notes: notes || undefined,
        items: asking.map(({ item_id, quantity, unit_id }) => ({ item_id, quantity, unit_id })),
      });
      toast.success(result.message);
      router.push(`/requests/${result.data.id}`);
    } catch (err) {
      toast.error(err.message);
      setSaving(false);
      setConfirming(false);
    }
  }

  if (!kitchen) {
    return (
      <Layout title="Ask for Stock">
        <Alert tone="warn" title="No kitchen assigned">
          Your account is not linked to a kitchen yet, so there is nowhere to send stock. Ask an
          administrator to assign you one.
        </Alert>
      </Layout>
    );
  }

  const usual = (lists.data?.data ?? []).filter((l) => l.kitchen_id === kitchen.id);

  return (
    <Layout
      title="Ask for Stock"
      subtitle={`Everything ${kitchen.name} stocks — type a number beside what you need`}
      actions={
        <Button onClick={() => router.push('/requests')} icon="documents">
          My requests
        </Button>
      }
    >

      <StockTabs />

      {usual.length > 0 && (
        <Alert tone="info" title="Your usual order">
          {usual.map((list) => (
            <span key={list.id} style={{ marginRight: 12 }}>
              <button type="button" className="link-button" onClick={() => loadUsualOrder(list)}>
                Fill in &lsquo;{list.name}&rsquo; ({list.total_items} items)
              </button>
            </span>
          ))}
        </Alert>
      )}

      <div className="card mb-16">
        <div className="card-head">
          <SearchInput value={search} onChange={setSearch} placeholder="Search your items…" />
          <div className="card-head-actions">
            {runs.length > 0 && (
              <Select
                value={run}
                onChange={(e) => setRun(e.target.value)}
                options={[
                  { value: '', label: 'Any list' },
                  { value: 'EVERYDAY', label: 'Everyday list' },
                  { value: 'WEEKLY', label: 'Weekly list' },
                  { value: 'MONTHLY', label: 'Monthly list' },
                ]}
              />
            )}
            {categories.length > 1 && (
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Any category"
                options={categories.map((c) => ({ value: c, label: c }))}
              />
            )}
            <Select
              value={only}
              onChange={(e) => setOnly(e.target.value)}
              options={[
                { value: '', label: 'Everything you stock' },
                { value: 'SHORT', label: 'Only what is low' },
                { value: 'ASKED', label: 'Only what I am asking for' },
              ]}
            />
            {asking.length > 0 && (
              <Button onClick={() => setWanted({})} icon="close">
                Clear all
              </Button>
            )}
          </div>
        </div>

        {stock.loading ? (
          <Loading label="Loading your items…" />
        ) : (
          <>
            <DataTable
              rows={table.rows}
              startIndex={table.startIndex}
              rowKey={(r) => r.item_id}
              columns={[
                {
                  key: 'item_name',
                  label: 'Item',
                  render: (r) => (
                    <div>
                      <div className="cell-title">{r.item_name}</div>
                      <div className="cell-sub">
                        <span className="mono">{r.sku}</span>
                        {r.category_name ? ` · ${r.category_name}` : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'quantity',
                  label: 'You have',
                  align: 'right',
                  render: (r) => (
                    <div className="stack-right">
                      <strong>{qty(r.quantity, r.unit_code)}</strong>
                      {r.stock_status === 'OUT' ? (
                        <Badge tone="red" dot>All gone</Badge>
                      ) : r.stock_status === 'LOW' ? (
                        <Badge tone="amber" dot>Running low</Badge>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'ask',
                  label: 'Ask for',
                  align: 'right',
                  render: (r) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <NumberInput
                        value={wanted[r.item_id] ?? ''}
                        min={0}
                        placeholder="0"
                        onChange={(e) =>
                          setWanted((w) => ({ ...w, [r.item_id]: e.target.value }))
                        }
                      />
                      <span className="muted small nowrap">{r.unit_code}</span>
                    </div>
                  ),
                },
              ]}
              empty={
                <EmptyState
                  icon="box"
                  title="Nothing to show"
                  message="No item in your kitchen matches that. Clear the search to see everything."
                />
              }
            />
            <Pagination meta={table.meta} onPage={table.setPage} />
          </>
        )}
      </div>

      <div className="card">
        <div className="card-body">
          <div className="form-row">
            <Field label="Needed by" optional hint="Leave blank if there is no particular day">
              <DateInput
                value={neededBy}
                min={isoDate()}
                onChange={(e) => setNeededBy(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Anything the main store should know" optional>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Running low before the weekend rush…"
            />
          </Field>

          <div className="kv mb-16 mt-16">
            <dt>Asking for</dt>
            <dd>{kitchen.name}</dd>
            <dt>Items</dt>
            <dd>{num(asking.length)}</dd>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="btn-block"
            icon="request"
            disabled={asking.length === 0}
            onClick={() => setConfirming(true)}
          >
            {asking.length === 0
              ? 'Type a number beside something you need'
              : `Send this request (${asking.length} item${asking.length === 1 ? '' : 's'})`}
          </Button>

          <p className="muted small mt-8" style={{ textAlign: 'center' }}>
            Nothing moves yet. The main store decides what to send, and you will see the result in
            My Requests.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        tone="primary"
        title={`Send this request for ${kitchen.name}?`}
        message={
          asking.length
            ? `You are asking the main store for ${asking.length} item${asking.length === 1 ? '' : 's'}: ${asking
                .slice(0, 4)
                .map((a) => `${a.name} (${a.quantity} ${a.unit_code})`)
                .join(', ')}${asking.length > 4 ? `, and ${asking.length - 4} more` : ''}. Nothing moves until an administrator approves it.`
            : ''
        }
        confirmLabel="Send the request"
        loading={saving}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </Layout>
  );
}
