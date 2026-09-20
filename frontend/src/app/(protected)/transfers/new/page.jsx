'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { useAction, useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { isoDate, money, qty, withCurrentTime } from '@/lib/format';
import { LineItemEditor, toPayloadLines } from '@/components/LineItems';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DateInput,
  Field,
  Loading,
  Modal,
  Select,
  Step,
  Textarea,
  useToast,
} from '@/components/ui';

const EMPTY_LINE = { item_id: null, quantity: '', unit_id: null };

export default function NewTransferPage() {
  return (
    <AdminOnly>
      <Suspense fallback={<Loading />}>
        <NewTransfer />
      </Suspense>
    </AdminOnly>
  );
}

/**
 * Two steps down one column: choose the kitchen, list what is going. Sending
 * back from a kitchen is the rare case, so it sits behind a checkbox instead of
 * a direction selector everyone has to read past.
 */
function NewTransfer() {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { run, loading: saving } = useAction();

  const [isReturn, setIsReturn] = useState(false);
  const [kitchenId, setKitchenId] = useState(searchParams.get('kitchen') ?? '');
  const [transferDate, setTransferDate] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const kitchens = useFetch('/kitchens');
  const units = useFetch('/units');
  const items = useFetch('/items?page_size=300');

  // Stock at the source, so the form can warn before anything is submitted.
  const sourcePath = isReturn
    ? kitchenId
      ? `/kitchens/${kitchenId}/inventory?page_size=500`
      : null
    : '/main-inventory?page_size=500';
  const source = useFetch(sourcePath, { skip: !sourcePath });

  const availability = useMemo(() => {
    const map = {};
    for (const row of source.data?.data ?? []) map[row.item_id] = Number(row.quantity);
    return map;
  }, [source.data]);

  // Switching direction invalidates the stock figures the lines were based on.
  useEffect(() => {
    setLines([{ ...EMPTY_LINE }]);
  }, [isReturn]);

  const itemList = (items.data?.data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    unit_id: i.unit_id,
    unit_code: i.unit_code,
    unit_cost: i.unit_cost,
  }));
  const unitList = units.data?.data ?? [];
  const activeKitchens = (kitchens.data?.data ?? []).filter((k) => k.is_active);
  const selectedKitchen = activeKitchens.find((k) => k.id === Number(kitchenId));

  const itemsById = Object.fromEntries(itemList.map((i) => [i.id, i]));
  const toBase = (line) => {
    const item = itemsById[line.item_id];
    if (!item) return 0;
    const entered = unitList.find((u) => u.id === (line.unit_id ?? item.unit_id));
    const base = unitList.find((u) => u.id === item.unit_id);
    if (!entered || !base || entered.dimension !== base.dimension) return 0;
    return (Number(line.quantity || 0) * Number(entered.factor)) / Number(base.factor);
  };

  const payloadLines = toPayloadLines(lines);
  const shortages = lines.filter((line) => {
    if (!line.item_id || !line.quantity) return false;
    const available = availability[line.item_id];
    return available !== undefined && toBase(line) > available + 1e-9;
  });

  const estimatedValue = lines.reduce(
    (sum, line) => sum + toBase(line) * Number(itemsById[line.item_id]?.unit_cost ?? 0),
    0,
  );

  const fromLabel = isReturn ? selectedKitchen?.name ?? 'the kitchen' : 'Main Store';
  const toLabel = isReturn ? 'Main Store' : selectedKitchen?.name ?? 'the kitchen';

  async function submit() {
    setError(null);
    try {
      const result = await run(() =>
        api.post('/transfers', {
          from_location_type: isReturn ? 'KITCHEN' : 'MAIN',
          from_kitchen_id: isReturn ? Number(kitchenId) : null,
          to_location_type: isReturn ? 'MAIN' : 'KITCHEN',
          to_kitchen_id: isReturn ? null : Number(kitchenId),
          transfer_date: withCurrentTime(transferDate),
          notes: notes || null,
          items: payloadLines,
        }),
      );
      setConfirming(false);
      toast.success(result.message);
      router.push(`/transfers/${result.data.id}`);
    } catch (err) {
      setConfirming(false);
      setError(err);
    }
  }

  if (items.loading || units.loading || kitchens.loading) {
    return (
      <Layout title="Send to a Kitchen">
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout
      title={isReturn ? 'Take Stock Back' : 'Send to a Kitchen'}
      subtitle="Move ingredients between the main store and a kitchen"
    >
      {error && (
        <div className="mb-16" style={{ maxWidth: 940 }}>
          <Alert tone="error" title={error.message}>
            {error.details?.shortages && (
              <ul>
                {error.details.shortages.map((s) => (
                  <li key={s.item_id}>
                    {s.item_name}: you need {s.required} {s.unit_code} but only have {s.available}{' '}
                    {s.unit_code}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}

      <div style={{ maxWidth: 940 }}>
        {/* ---------------------------------------------- step 1: where to -- */}
        <div className="card mb-16">
          <div className="card-body">
            <Step number="1" title="Which kitchen?" />

            <Field label="Kitchen" required hint={selectedKitchen?.location}>
              <Select
                value={kitchenId}
                onChange={(e) => setKitchenId(e.target.value)}
                placeholder="Choose a kitchen…"
                options={activeKitchens.map((k) => ({ value: k.id, label: k.name }))}
              />
            </Field>

            <div className="form-row">
              <Field label="What date?" required>
                <DateInput
                  value={transferDate}
                  max={isoDate()}
                  onChange={(e) => setTransferDate(e.target.value)}
                />
              </Field>
              <Field label="Direction">
                <Checkbox
                  label="This is stock coming back to the main store"
                  checked={isReturn}
                  onChange={(e) => setIsReturn(e.target.checked)}
                />
              </Field>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------- step 2: what -- */}
        <div className="card mb-16">
          <div className="card-body">
            <Step
              number="2"
              title="What are you sending?"
              sub={`Taking it out of ${fromLabel}`}
            />

            {isReturn && !kitchenId ? (
              <Alert tone="info">
                Choose the kitchen first so we can show you what it is holding.
              </Alert>
            ) : (
              <LineItemEditor
                lines={lines}
                onChange={setLines}
                items={itemList}
                units={unitList}
                availability={availability}
              />
            )}

            <div className="divider" />

            {showNotes ? (
              <Field label="Notes" optional>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Who collected it, why it was sent…"
                />
              </Field>
            ) : (
              <Button onClick={() => setShowNotes(true)} icon="edit">
                Add a note
              </Button>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------- the button -- */}
        {shortages.length > 0 && (
          <div className="mb-16">
            <Alert tone="warn" title="Some amounts are more than you have">
              Lower the amounts shown in red above before sending.
            </Alert>
          </div>
        )}

        <div className="card">
          <div className="card-body">
            <dl className="kv mb-16">
              <dt>Taking from</dt>
              <dd>{fromLabel}</dd>
              <dt>Going to</dt>
              <dd>{toLabel}</dd>
              {selectedKitchen?.managers?.[0] && (
                <>
                  <dt>Kitchen run by</dt>
                  <dd>{selectedKitchen.managers[0].full_name}</dd>
                </>
              )}
              <dt>Things being sent</dt>
              <dd>{payloadLines.length}</dd>
              <dt>Worth about</dt>
              <dd>{money(estimatedValue)}</dd>
            </dl>

            <Button
              variant="primary"
              size="lg"
              className="btn-block"
              disabled={!kitchenId || payloadLines.length === 0 || shortages.length > 0 || saving}
              onClick={() => setConfirming(true)}
              icon="truck"
            >
              {isReturn ? 'Take this stock back' : `Send ${payloadLines.length} item(s) to the kitchen`}
            </Button>
            <p className="muted mt-12 center">
              Nothing moves until you press this and confirm on the next screen.
            </p>
          </div>
        </div>
      </div>

      <Modal
        open={confirming}
        size="wide"
        title="Is this right?"
        subtitle={`${fromLabel} → ${toLabel}`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={saving} icon="arrow-left">
              No, let me change it
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} icon="check-circle">
              Yes, send it
            </Button>
          </>
        }
      >
        <table className="data">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th className="num">Amount</th>
              <th className="num">{fromLabel} will have left</th>
            </tr>
          </thead>
          <tbody>
            {lines
              .filter((l) => l.item_id && Number(l.quantity) > 0)
              .map((line, index) => {
                const item = itemsById[line.item_id];
                const base = toBase(line);
                const available = availability[line.item_id] ?? 0;
                return (
                  <tr key={index}>
                    <td>
                      <span className="cell-title">{item.name}</span>
                    </td>
                    <td className="num">
                      <strong>{qty(base, item.unit_code)}</strong>
                    </td>
                    <td className="num">
                      <Badge tone={available - base <= 0 ? 'red' : 'gray'}>
                        {qty(available - base, item.unit_code)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        <p className="muted mt-16">
          Once you confirm, you can print a delivery slip for {toLabel}.
        </p>
      </Modal>
    </Layout>
  );
}
