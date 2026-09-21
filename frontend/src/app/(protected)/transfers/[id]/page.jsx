'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useFetch } from '@/lib/hooks';
import { MOVEMENT_LABELS, dateTime, money, num, qty } from '@/lib/format';
import { Alert, Badge, Button, PagedTable, Loading } from '@/components/ui';

export default function TransferDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data, loading, error } = useFetch(`/transfers/${id}`);
  const transfer = data?.data;

  if (loading) {
    return (
      <Layout title="Transfer">
        <Loading />
      </Layout>
    );
  }
  if (error) {
    return (
      <Layout title="Transfer">
        <Alert tone="error">{error.message}</Alert>
      </Layout>
    );
  }
  if (!transfer) return null;

  const kitchenNameFor = (movement) =>
    movement.location_type === 'MAIN'
      ? 'Main Inventory'
      : movement.kitchen_id === transfer.to_kitchen_id
        ? transfer.to_kitchen_name
        : transfer.from_kitchen_name;

  return (
    <Layout
      title={`Transfer ${transfer.transfer_no}`}
      subtitle={`${transfer.source_label} → ${transfer.destination_label}`}
      actions={
        <>
          <Button onClick={() => router.push('/transfers')}>Back to list</Button>
          <Button variant="primary" onClick={() => router.push(`/print/transfer/${id}`)}>
            Print slip
          </Button>
        </>
      }
    >
      <div className="grid cols-4 mb-16">
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Transfer number</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 600, marginTop: 3 }}>
              {transfer.transfer_no}
            </div>
            <div className="stat-meta">{dateTime(transfer.transfer_date)}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Source</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>
              {transfer.source_label}
            </div>
            <div className="stat-meta">
              {transfer.from_location_type === 'MAIN' ? 'Central store' : transfer.from_kitchen_code}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Destination</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>
              {transfer.destination_label}
            </div>
            <div className="stat-meta">
              {transfer.to_kitchen_location ||
                (transfer.to_location_type === 'MAIN' ? 'Central store' : '')}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Status</div>
            <div style={{ marginTop: 6 }}>
              <Badge tone={transfer.status === 'COMPLETED' ? 'green' : 'gray'} dot>
                {transfer.status === 'COMPLETED' ? 'Completed' : transfer.status}
              </Badge>
            </div>
            <div className="stat-meta">By {transfer.created_by_name}</div>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h3>Items transferred</h3>
          <span className="muted small">
            {num(transfer.total_items)} line(s) · {money(transfer.total_cost)}
          </span>
        </div>
        <PagedTable
          rows={transfer.items}
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
              label: 'Entered',
              align: 'right',
              render: (r) => qty(r.quantity, r.unit_code),
            },
            {
              key: 'base_quantity',
              label: 'Stock units moved',
              align: 'right',
              render: (r) => <strong>{qty(r.base_quantity, r.item_unit_code)}</strong>,
            },
            {
              key: 'unit_cost',
              label: 'Unit cost',
              align: 'right',
              render: (r) => <span className="muted">{money(r.unit_cost)}</span>,
            },
            {
              key: 'total_cost',
              label: 'Value',
              align: 'right',
              render: (r) => money(r.total_cost),
            },
            {
              key: 'link',
              label: '',
              render: (r) => (
                <Link className="small" href={`/movements/item/${r.item_id}`}>
                  History →
                </Link>
              ),
            },
          ]}
          footer={
            <tr>
              <td colSpan={4} className="right">
                Total
              </td>
              <td className="num">{money(transfer.total_cost)}</td>
              <td />
            </tr>
          }
        />
      </div>

      {transfer.notes && (
        <div className="card mb-16">
          <div className="card-head">
            <h3>Notes</h3>
          </div>
          <div className="card-body">
            <p className="muted">{transfer.notes}</p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Ledger entries</h3>
          <span className="muted small">
            Each item writes one entry out of the source and one into the destination
          </span>
        </div>
        <PagedTable
          rows={transfer.movements}
          columns={[
            {
              key: 'movement_no',
              label: 'Entry',
              render: (r) => <span className="mono small">{r.movement_no}</span>,
            },
            {
              key: 'movement_type',
              label: 'Type',
              render: (r) => {
                const label = MOVEMENT_LABELS[r.movement_type];
                return <Badge tone={label?.tone ?? 'gray'}>{label?.label ?? r.movement_type}</Badge>;
              },
            },
            { key: 'item_name', label: 'Item' },
            {
              key: 'quantity',
              label: 'Quantity',
              align: 'right',
              render: (r) => (
                <strong className={r.direction === 'IN' ? 'pos-up' : 'pos-down'}>
                  {r.direction === 'IN' ? '+' : '−'}
                  {num(r.quantity)}
                </strong>
              ),
            },
            { key: 'location', label: 'Affected balance', render: kitchenNameFor },
            {
              key: 'balance_before',
              label: 'Before',
              align: 'right',
              render: (r) => <span className="muted">{num(r.balance_before)}</span>,
            },
            {
              key: 'balance_after',
              label: 'After',
              align: 'right',
              render: (r) => <strong>{num(r.balance_after)}</strong>,
            },
            {
              key: 'created_at',
              label: 'Recorded',
              render: (r) => <span className="muted small nowrap">{dateTime(r.created_at)}</span>,
            },
          ]}
        />
      </div>
    </Layout>
  );
}
