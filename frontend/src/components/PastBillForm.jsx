'use client';

import { useMemo, useState } from 'react';
import { useFetch } from '@/lib/hooks';
import { isoDate, money } from '@/lib/format';
import { Alert, Button, DateInput, Field, Input, NumberInput, Textarea } from './ui';
import { SuggestInput } from './SuggestInput';

/**
 * Typing in an old bill.
 *
 * It is laid out like the paper: who it was from, which bill, what day, then
 * a line for each thing on it. Names are typed as printed, with suggestions
 * from the catalogue to save typing, because old bills mention things that
 * are no longer sold and an audit copy should say what the paper said.
 *
 * Price and amount keep each other in step. Some bills show a rate, some only
 * a line total; whichever is typed, the other follows.
 */

const blankLine = () => ({ item_name: '', item_id: null, quantity: '', unit: '', unit_price: '', amount: '' });

const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10000) / 10000;

/** Lines as the API sends them, into what the form edits. */
function fromBill(bill) {
  return {
    supplier_name: bill.supplier_name,
    invoice_no: bill.invoice_no ?? '',
    bill_date: bill.bill_date,
    notes: bill.notes ?? '',
    lines: bill.items.map((line) => ({
      item_name: line.item_name,
      item_id: line.item_id,
      quantity: String(line.quantity),
      unit: line.unit ?? '',
      unit_price: String(line.unit_price),
      amount: String(line.line_total),
    })),
    total: bill.total_amount,
  };
}

export function PastBillForm({ bill, saving, error, submitLabel = 'Save this bill', onSubmit, onCancel }) {
  const start = useMemo(() => (bill ? fromBill(bill) : null), [bill]);

  const [supplier, setSupplier] = useState(start?.supplier_name ?? '');
  const [invoiceNo, setInvoiceNo] = useState(start?.invoice_no ?? '');
  const [billDate, setBillDate] = useState(start?.bill_date ?? isoDate());
  const [notes, setNotes] = useState(start?.notes ?? '');
  const [lines, setLines] = useState(
    start?.lines?.length ? start.lines : [blankLine(), blankLine(), blankLine()],
  );

  const sum = lines.reduce((total, line) => total + (Number(line.amount) || 0), 0);
  // The total follows the lines until somebody types one in. A bill that was
  // saved with a total the lines do not add up to opens with that total kept.
  const startedAway = start && Math.abs(Number(start.total) - sum) > 0.005;
  const [typedTotal, setTypedTotal] = useState(startedAway ? String(start.total) : '');
  const total = typedTotal !== '' ? Number(typedTotal) : round2(sum);

  const suppliers = useFetch('/suppliers');
  const items = useFetch('/items?page_size=2000');
  const itemList = useMemo(() => items.data?.data ?? [], [items.data]);
  const byName = useMemo(
    () => Object.fromEntries(itemList.map((i) => [i.name.toLowerCase(), i])),
    [itemList],
  );
  const units = useFetch('/units');
  const itemNames = useMemo(() => itemList.map((i) => i.name), [itemList]);
  const supplierNames = useMemo(() => (suppliers.data?.data ?? []).map((x) => x.name), [suppliers.data]);
  const unitCodes = useMemo(() => (units.data?.data ?? []).map((u) => u.code), [units.data]);

  function edit(index, patch) {
    setLines((current) =>
      current.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };

        if ('item_name' in patch) {
          const match = byName[String(patch.item_name).trim().toLowerCase()];
          next.item_id = match ? match.id : null;
          if (match && !next.unit) next.unit = match.unit_code;
        }

        const quantity = Number(next.quantity);
        if ('quantity' in patch || 'unit_price' in patch) {
          if (quantity > 0 && next.unit_price !== '') {
            next.amount = String(round2(quantity * Number(next.unit_price)));
          }
        } else if ('amount' in patch) {
          if (quantity > 0 && next.amount !== '') {
            next.unit_price = String(round4(Number(next.amount) / quantity));
          }
        }
        return next;
      }),
    );
  }

  const filled = lines.filter((line) => line.item_name.trim() && Number(line.quantity) > 0);
  const canSave = supplier.trim() && billDate && filled.length > 0;

  function submit() {
    onSubmit({
      supplier_name: supplier.trim(),
      invoice_no: invoiceNo.trim() || null,
      bill_date: billDate,
      total_amount: typedTotal !== '' ? Number(typedTotal) : null,
      notes: notes.trim() || null,
      items: filled.map((line) => ({
        item_name: line.item_name.trim(),
        item_id: line.item_id,
        quantity: Number(line.quantity),
        unit: line.unit.trim() || null,
        unit_price: Number(line.unit_price) || 0,
        line_total: line.amount !== '' ? Number(line.amount) : null,
      })),
    });
  }

  return (
    <div>
      {error && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <div className="card mb-16">
        <div className="card-head">
          <h3>About the bill</h3>
        </div>
        <div className="card-body">
          <div className="form-row three">
            <Field label="Bought from" required>
              <SuggestInput
                value={supplier}
                onChange={setSupplier}
                options={supplierNames}
                placeholder="Shop or supplier name"
              />
            </Field>
            <Field label="Bill number" optional>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </Field>
            <Field label="Date on the bill" required>
              <DateInput value={billDate} max={isoDate()} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h3>What was on it</h3>
          <span className="muted small">Leave a row empty if you do not need it.</span>
        </div>
        <div className="card-body">
          <div className="bill-line bill-line-head">
            <span>Item</span>
            <span>How much</span>
            <span>Unit</span>
            <span>Price each (₹)</span>
            <span>Amount (₹)</span>
            <span />
          </div>

          <div className="bill-lines">
            {lines.map((line, index) => (
              <div className="bill-line" key={index}>
                <div className="bill-line-top">
                  <span>Item {index + 1}</span>
                  <Button
                    disabled={lines.length === 1}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
                <label>
                  <span className="bill-line-label">Item</span>
                  <SuggestInput
                    value={line.item_name}
                    onChange={(name) => edit(index, { item_name: name })}
                    options={itemNames}
                    placeholder="Type the item name"
                  />
                </label>
                <label>
                  <span className="bill-line-label">How much</span>
                  <NumberInput
                    value={line.quantity}
                    min="0"
                    onChange={(e) => edit(index, { quantity: e.target.value })}
                  />
                </label>
                <label>
                  <span className="bill-line-label">Unit</span>
                  <SuggestInput
                    value={line.unit}
                    onChange={(unit) => edit(index, { unit })}
                    options={unitCodes}
                    limit={12}
                    placeholder="kg, pcs…"
                  />
                </label>
                <label>
                  <span className="bill-line-label">Price each (₹)</span>
                  <NumberInput
                    value={line.unit_price}
                    min="0"
                    onChange={(e) => edit(index, { unit_price: e.target.value })}
                  />
                </label>
                <label>
                  <span className="bill-line-label">Amount (₹)</span>
                  <NumberInput
                    value={line.amount}
                    min="0"
                    onChange={(e) => edit(index, { amount: e.target.value })}
                  />
                </label>
                <Button
                  className="btn-icon bill-remove"
                  aria-label="Remove this row"
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>

          <Button className="mt-16 bill-add" icon="plus" onClick={() => setLines((c) => [...c, blankLine()])}>
            Add another item
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="form-row">
            <Field
              label="Bill total (₹)"
              hint={`The items above add up to ${money(round2(sum))}. Change this only if the bill shows a different total, for example with tax.`}
            >
              <NumberInput
                value={typedTotal !== '' ? typedTotal : round2(sum) || ''}
                min="0"
                onChange={(e) => setTypedTotal(e.target.value)}
              />
            </Field>
            <Field label="Notes" optional>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything worth remembering about this bill"
              />
            </Field>
          </div>
        </div>
        <div className="card-foot bill-foot">
          <strong>
            {filled.length} item{filled.length === 1 ? '' : 's'} · {money(total)}
          </strong>
          <span className="push-end" />
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" size="lg" loading={saving} disabled={!canSave} onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      </div>

      <p className="muted small mt-16">
        Past bills are only kept on file. They do not add or remove any stock.
      </p>
    </div>
  );
}
