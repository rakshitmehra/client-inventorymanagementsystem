'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { dateTime, qty } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  PagedTable,
  Field,
  Loading,
  Modal,
  NumberInput,
  Textarea,
  useToast,
} from '@/components/ui';

const STATUS_TONE = { PENDING: 'amber', APPROVED: 'green', DECLINED: 'red', CANCELLED: 'gray' };
const STATUS_LABEL = {
  PENDING: 'Waiting on the main store',
  APPROVED: 'Sent',
  DECLINED: 'Turned down',
  CANCELLED: 'Withdrawn',
};

export default function RequestDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const { data, loading, error, reload } = useFetch(`/requests/${id}`);
  const request = data?.data;

  /** What the administrator is willing to send, keyed by line id. */
  const [approved, setApproved] = useState({});
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Start from what the kitchen asked for: the common case is "yes, all of it",
  // so that should take no typing at all.
  useEffect(() => {
    if (request?.items) {
      setApproved(Object.fromEntries(request.items.map((l) => [l.id, String(l.quantity)])));
    }
  }, [request?.id, request?.items]);

  if (loading) return <Layout title="Request"><Loading label="Opening the request…" /></Layout>;
  if (error) return <Layout title="Request"><Alert tone="error">{error.message}</Alert></Layout>;
  if (!request) return null;

  const pending = request.status === 'PENDING';
  const canDecide = isAdmin && pending;
  const sending = request.items.filter((l) => Number(approved[l.id] ?? 0) > 0);

  async function act(fn, done) {
    setBusy(true);
    try {
      const result = await fn();
      toast.success(result.message);
      done?.(result);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const approve = () =>
    act(() =>
      api.post(`/requests/${id}/approve`, {
        items: request.items.map((l) => ({
          id: l.id,
          approved_quantity: Number(approved[l.id] ?? 0),
        })),
      }),
    );

  const decline = () =>
    act(
      () => api.post(`/requests/${id}/decline`, { decision_note: declineNote }),
      () => {
        setDeclining(false);
        setDeclineNote('');
      },
    );

  const withdraw = () =>
    act(
      () => api.post(`/requests/${id}/cancel`, {}),
      () => setWithdrawing(false),
    );

  return (
    <Layout
      title={`Request ${request.request_no}`}
      subtitle={`${request.kitchen_name} · asked by ${request.requested_by_name ?? 'unknown'}`}
      actions={
        <>
          <Button onClick={() => router.push('/requests')} icon="arrow-left">
            Back
          </Button>
          {request.transfer_id && (
            <Button
              variant="primary"
              icon="truck"
              onClick={() => router.push(`/transfers/${request.transfer_id}`)}
            >
              See the delivery
            </Button>
          )}
        </>
      }
    >

      <div className="grid cols-4 mb-16">
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Status</div>
            <div className="mt-4">
              <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Asked on</div>
            <div className="stat-value" style={{ fontSize: 'var(--text-md)' }}>
              {dateTime(request.requested_at)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Needed by</div>
            <div className="stat-value" style={{ fontSize: 'var(--text-md)' }}>
              {request.needed_by ?? <span className="muted">No particular day</span>}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Items</div>
            <div className="stat-value">{request.items.length}</div>
          </div>
        </div>
      </div>

      {request.notes && (
        <Alert tone="info" title="From the kitchen">
          {request.notes}
        </Alert>
      )}

      {!pending && request.decision_note && (
        <Alert
          tone={request.status === 'APPROVED' ? 'success' : 'warn'}
          title={`${request.decided_by_name ?? 'The main store'} said`}
        >
          {request.decision_note}
        </Alert>
      )}

      <div className="card">
        <div className="card-head">
          <h3>{canDecide ? 'Decide what to send' : 'What was asked for'}</h3>
          {canDecide && (
            <div className="card-head-actions">
              <Button
                onClick={() =>
                  setApproved(
                    Object.fromEntries(request.items.map((l) => [l.id, String(l.quantity)])),
                  )
                }
              >
                Send all of it
              </Button>
            </div>
          )}
        </div>

        <PagedTable
          rows={request.items}
          columns={[
            {
              key: 'item_name',
              label: 'Item',
              render: (l) => (
                <>
                  <div className="strong">{l.item_name}</div>
                  <div className="cell-sub mono">{l.item_sku}</div>
                </>
              ),
            },
            {
              key: 'quantity',
              label: 'Asked for',
              align: 'right',
              render: (l) => qty(l.quantity, l.unit_code),
            },
            canDecide
              ? {
                  key: 'approved',
                  label: 'Send',
                  align: 'right',
                  render: (l) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <NumberInput
                        value={approved[l.id] ?? ''}
                        min={0}
                        onChange={(e) =>
                          setApproved((a) => ({ ...a, [l.id]: e.target.value }))
                        }
                      />
                      <span className="muted small nowrap">{l.unit_code}</span>
                    </div>
                  ),
                }
              : {
                  key: 'approved_quantity',
                  label: 'Sent',
                  align: 'right',
                  render: (l) =>
                    l.approved_quantity === null ? (
                      <span className="muted">—</span>
                    ) : Number(l.approved_quantity) === 0 ? (
                      <Badge tone="red">None</Badge>
                    ) : (
                      <strong>{qty(l.approved_quantity, l.unit_code)}</strong>
                    ),
                },
          ]}
        />

        {canDecide && (
          <div className="card-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <p className="muted small">
              Change any amount before approving. Set a line to <strong>0</strong> to refuse just
              that item and still send the rest. Approving moves the stock straight away and
              creates a delivery slip.
            </p>
            <div className="flex gap-12">
              <Button variant="danger" icon="close" onClick={() => setDeclining(true)} disabled={busy}>
                Turn it down
              </Button>
              <Button
                variant="primary"
                icon="check"
                loading={busy}
                disabled={sending.length === 0}
                onClick={approve}
                style={{ flex: 1 }}
              >
                {sending.length === 0
                  ? 'Nothing to send — turn it down instead'
                  : `Approve and send ${sending.length} item${sending.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )}

        {!isAdmin && pending && (
          <div className="card-foot">
            <p className="muted small" style={{ flex: 1 }}>
              The main store has not decided yet.
            </p>
            <Button icon="close" onClick={() => setWithdrawing(true)} disabled={busy}>
              Withdraw this request
            </Button>
          </div>
        )}
      </div>

      <Modal
        open={declining}
        title={`Turn down ${request.request_no}?`}
        subtitle="The kitchen will see your reason, so say what they should do instead"
        onClose={() => setDeclining(false)}
        footer={
          <>
            <Button onClick={() => setDeclining(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={declineNote.trim().length < 3}
              onClick={decline}
            >
              Turn it down
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          <Textarea
            rows={3}
            value={declineNote}
            onChange={(e) => setDeclineNote(e.target.value)}
            placeholder="The main store is short too — try again on Monday"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={withdrawing}
        title={`Withdraw ${request.request_no}?`}
        message="The main store will no longer see this request. You can always raise a new one."
        confirmLabel="Withdraw it"
        onConfirm={withdraw}
        onCancel={() => setWithdrawing(false)}
      />
    </Layout>
  );
}
