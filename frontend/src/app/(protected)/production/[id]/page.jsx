'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useFetch } from '@/lib/hooks';
import { dateTime, money, num, qty } from '@/lib/format';
import { Alert, Badge, Button, PagedTable, Loading, Stat } from '@/components/ui';

export default function ProductionDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data, loading, error } = useFetch(`/production/${id}`);
  const record = data?.data;

  if (loading) {
    return (
      <Layout title="Production">
        <Loading />
      </Layout>
    );
  }
  if (error) {
    return (
      <Layout title="Production">
        <Alert tone="error">{error.message}</Alert>
      </Layout>
    );
  }
  if (!record) return null;

  return (
    <Layout
      title={`Production ${record.production_no}`}
      subtitle={`${num(record.output_quantity)} × ${record.product_name} at ${record.kitchen_name}`}
      actions={
        <>
          <Button onClick={() => router.push('/production')}>Back to list</Button>
          <Button variant="primary" onClick={() => router.push(`/print/production/${id}`)}>
            Print slip
          </Button>
        </>
      }
    >
      <div className="grid cols-4 mb-16">
        <Stat icon="product" tone="violet" label="Product" value={record.product_name} meta={record.product_sku} />
        <Stat
          icon="cooking"
          tone="green"
          label="Produced"
          value={qty(record.output_quantity, record.output_unit_code)}
          meta={`${num(record.batch_quantity)} recipe batch(es)`}
        />
        <Stat
          icon="ingredient"
          tone="blue"
          label="Ingredients consumed"
          value={num(record.consumption.length)}
          meta="each tracked separately"
        />
        <Stat
          icon="rupee"
          tone="amber"
          label="Ingredient cost"
          value={money(record.total_cost)}
          meta={`${money(record.total_cost / (record.output_quantity || 1))} per unit`}
        />
      </div>

      <div className="card mb-16">
        <div className="card-head">
          <h3>Ingredients consumed</h3>
          <span className="muted small">
            Recipe: {record.recipe_name} (v{record.recipe_version})
          </span>
          <div className="card-head-actions">
            <Badge tone="green" dot>
              {record.status === 'COMPLETED' ? 'Completed' : record.status}
            </Badge>
          </div>
        </div>
        <PagedTable
          rows={record.consumption}
          columns={[
            {
              key: 'item_name',
              label: 'Ingredient',
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
              key: 'required_quantity',
              label: 'Required',
              align: 'right',
              render: (r) => <span className="muted">{qty(r.required_quantity, r.unit_code)}</span>,
            },
            {
              key: 'consumed_quantity',
              label: 'Consumed',
              align: 'right',
              render: (r) => (
                <strong className="pos-down">−{qty(r.consumed_quantity, r.unit_code)}</strong>
              ),
            },
            {
              key: 'balance_after',
              label: 'Kitchen balance after',
              align: 'right',
              render: (r) => qty(r.balance_after, r.unit_code),
            },
            {
              key: 'unit_cost',
              label: 'Unit cost',
              align: 'right',
              render: (r) => <span className="muted">{money(r.unit_cost)}</span>,
            },
            { key: 'total_cost', label: 'Cost', align: 'right', render: (r) => money(r.total_cost) },
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
              <td colSpan={5} className="right">
                Total ingredient cost
              </td>
              <td className="num">{money(record.total_cost)}</td>
              <td />
            </tr>
          }
        />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h3>Run details</h3>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>Run number</dt>
              <dd className="mono">{record.production_no}</dd>
              <dt>Kitchen</dt>
              <dd>
                {record.kitchen_name} ({record.kitchen_code})
              </dd>
              <dt>Location</dt>
              <dd>{record.kitchen_location || '—'}</dd>
              <dt>Produced at</dt>
              <dd>{dateTime(record.produced_at)}</dd>
              <dt>Recorded by</dt>
              <dd>
                {record.created_by_name} ({record.created_by_username})
              </dd>
              <dt>Recorded on</dt>
              <dd>{dateTime(record.created_at)}</dd>
              {record.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{record.notes}</dd>
                </>
              )}
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Method used</h3>
          </div>
          <div className="card-body">
            {record.instructions ? (
              <p className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {record.instructions}
              </p>
            ) : (
              <p className="muted small">No method recorded on this recipe version.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-head">
          <h3>Ledger entries</h3>
          <span className="muted small">
            One deduction per ingredient, written as this run was confirmed
          </span>
        </div>
        <PagedTable
          rows={record.movements}
          columns={[
            {
              key: 'movement_no',
              label: 'Entry',
              render: (r) => <span className="mono small">{r.movement_no}</span>,
            },
            { key: 'item_name', label: 'Item' },
            {
              key: 'quantity',
              label: 'Quantity',
              align: 'right',
              render: (r) => <strong className="pos-down">−{num(r.quantity)}</strong>,
            },
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
