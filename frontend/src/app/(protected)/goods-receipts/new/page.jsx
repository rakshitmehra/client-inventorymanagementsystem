'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { isoDate, money, withCurrentTime } from '@/lib/format';
import { LineItemEditor, toPayloadLines } from '@/components/LineItems';
import {
  Alert,
  Button,
  DateInput,
  Field,
  Input,
  Loading,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

export default function NewGoodsReceiptPage() {
  return (
    <AdminOnly>
      <NewGoodsReceipt />
    </AdminOnly>
  );
}

function NewGoodsReceipt() {
  const router = useRouter();
  const toast = useToast();
  const { run, loading: saving } = useAction();

  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [receivedAt, setReceivedAt] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ item_id: null, quantity: '', unit_id: null, unit_cost: '' }]);
  const [error, setError] = useState(null);

  const suppliers = useFetch('/suppliers');
  const units = useFetch('/units');
  const items = useFetch('/items?page_size=300');

  const itemList = (items.data?.data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    unit_id: i.unit_id,
    unit_code: i.unit_code,
    unit_cost: i.unit_cost,
  }));
  const unitList = units.data?.data ?? [];
  const itemsById = Object.fromEntries(itemList.map((i) => [i.id, i]));

  const toBase = (line) => {
    const item = itemsById[line.item_id];
    if (!item || !line.quantity) return 0;
    const entered = unitList.find((u) => u.id === (line.unit_id ?? item.unit_id));
    const base = unitList.find((u) => u.id === item.unit_id);
    if (!entered || !base || entered.dimension !== base.dimension) return 0;
    return (Number(line.quantity) * Number(entered.factor)) / Number(base.factor);
  };

  const payloadLines = toPayloadLines(lines);
  const total = lines.reduce((sum, line) => sum + toBase(line) * Number(line.unit_cost || 0), 0);

  async function submit() {
    setError(null);
    try {
      const result = await run(() =>
        api.post('/main-inventory/receipts', {
          supplier_id: supplierId ? Number(supplierId) : null,
          invoice_no: invoiceNo || null,
          received_at: withCurrentTime(receivedAt),
          notes: notes || null,
          items: payloadLines,
        }),
      );
      toast.success(result.message);
      router.push('/goods-receipts');
    } catch (err) {
      setError(err);
    }
  }

  if (items.loading || units.loading) {
    return (
      <Layout title="Receive Stock">
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout
      title="Receive Stock"
      subtitle="Record raw materials arriving into the Main Inventory"
      actions={<Button onClick={() => router.push('/goods-receipts')}>Cancel</Button>}
    >
      {error && (
        <div className="mb-16">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}

      <div className="grid sidebar-right">
        <div className="card">
          <div className="card-head">
            <h3>Receipt details</h3>
          </div>
          <div className="card-body">
            <div className="form-row three">
              <Field label="Supplier" optional>
                <Select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  placeholder="External supplier"
                  options={(suppliers.data?.data ?? [])
                    .filter((s) => s.is_active)
                    .map((s) => ({ value: s.id, label: s.name }))}
                />
              </Field>
              <Field label="Invoice number" optional>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="INV-2026001"
                />
              </Field>
              <Field label="Received on" required>
                <DateInput
                  value={receivedAt}
                  max={isoDate()}
                  onChange={(e) => setReceivedAt(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Notes" optional>
              <Textarea
                value={notes}
                rows={2}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery notes, quality checks…"
              />
            </Field>

            <div className="divider" />

            <h4 style={{ fontSize: 13.5, marginBottom: 12 }}>Items received</h4>
            <LineItemEditor
              lines={lines}
              onChange={setLines}
              items={itemList}
              units={unitList}
              showCost
            />
          </div>
        </div>

        <div className="card sticky-panel">
          <div className="card-head">
            <h3>Summary</h3>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>Supplier</dt>
              <dd>
                {(suppliers.data?.data ?? []).find((s) => s.id === Number(supplierId))?.name ??
                  'External supplier'}
              </dd>
              <dt>Destination</dt>
              <dd>Main Inventory</dd>
              <dt>Line items</dt>
              <dd>{payloadLines.length}</dd>
              <dt>Total value</dt>
              <dd>
                <strong>{money(total)}</strong>
              </dd>
            </dl>

            <Button
              variant="primary"
              className="btn-block mt-16"
              loading={saving}
              disabled={payloadLines.length === 0}
              onClick={submit}
            >
              Record goods receipt
            </Button>
            <p className="muted xs mt-8">
              Each line increases Main Inventory stock and writes a ledger entry. Unit costs entered
              here update the item&apos;s standard cost.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
