'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { FETCH_ALL, useClientTable, useFetch, useListState } from '@/lib/hooks';
import { dateTime, isoDate, money, num, qty } from '@/lib/format';
import {
  Alert,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  Loading,
  Modal,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
} from '@/components/ui';

export default function GoodsReceiptsPage() {
  return (
    <AdminOnly>
      <GoodsReceipts />
    </AdminOnly>
  );
}

function GoodsReceipts() {
  const router = useRouter();
  const [state, update] = useListState();
  const [viewing, setViewing] = useState(null);

  const { data, loading, error } = useFetch(
    `/main-inventory/receipts?page_size=${FETCH_ALL}`,
  );

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['receipt_no', 'invoice_no', 'supplier_name'],
    filters: { supplier_id: state.supplier_id ?? '' },
    predicate: (row) => {
      const day = (row.received_at ?? '').slice(0, 10);
      if (state.from && day < state.from) return false;
      if (state.to && day > state.to) return false;
      return true;
    },
    serverTotal: data?.meta?.total,
    resetKey: state,
  });
  const suppliers = useFetch('/suppliers');

  return (
    <Layout
      title="Goods Receipts"
      subtitle="Stock arriving from suppliers into the Main Inventory"
      actions={
        <Button variant="primary" onClick={() => router.push('/goods-receipts/new')}>
          Receive stock
        </Button>
      }
    >
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <FilterBar
            more={
              <>
                <Select
                  value={state.supplier_id ?? ''}
                  onChange={(e) => update({ supplier_id: e.target.value })}
                  placeholder="All suppliers"
                  options={(suppliers.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
                />
                <DateInput
                  value={state.from ?? ''}
                  max={isoDate()}
                  onChange={(e) => update({ from: e.target.value })}
                  title="From date"
                />
                <DateInput
                  value={state.to ?? ''}
                  max={isoDate()}
                  onChange={(e) => update({ to: e.target.value })}
                  title="To date"
                />
              </>
            }
          >
            <SearchInput
              value={state.search ?? ''}
              onChange={(search) => update({ search })}
              placeholder="Search receipt or invoice number…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          onRowClick={(r) => setViewing(r.id)}
          columns={[
            {
              key: 'receipt_no',
              label: 'Receipt',
              render: (r) => (
                <div>
                  <div className="cell-title mono">{r.receipt_no}</div>
                  <div className="cell-sub">{dateTime(r.received_at)}</div>
                </div>
              ),
            },
            {
              key: 'supplier_name',
              label: 'Supplier',
              render: (r) => (
                <div>
                  <div>{r.supplier_name || 'External supplier'}</div>
                  {r.invoice_no && <div className="cell-sub">Invoice {r.invoice_no}</div>}
                </div>
              ),
            },
            { key: 'total_items', label: 'Lines', align: 'right', render: (r) => num(r.total_items) },
            { key: 'total_cost', label: 'Value', align: 'right', render: (r) => money(r.total_cost) },
            {
              key: 'created_by_name',
              label: 'Received by',
              render: (r) => <span className="muted">{r.created_by_name || '—'}</span>,
            },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/print/receipt/${r.id}`);
                  }}
                >
                  Print
                </Button>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="inbox"
              title="No goods receipts yet"
              message="Record stock arriving from a supplier to build up the Main Inventory."
              action={
                <Button variant="primary" onClick={() => router.push('/goods-receipts/new')}>
                  Receive stock
                </Button>
              }
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>

      <ReceiptModal
        id={viewing}
        onClose={() => setViewing(null)}
        onPrint={(rid) => router.push(`/print/receipt/${rid}`)}
      />
    </Layout>
  );
}

function ReceiptModal({ id, onClose, onPrint }) {
  const { data, loading } = useFetch(id ? `/main-inventory/receipts/${id}` : null, { skip: !id });
  const receipt = data?.data;

  return (
    <Modal
      open={!!id}
      size="wide"
      title={receipt ? `Goods receipt ${receipt.receipt_no}` : 'Goods receipt'}
      subtitle={
        receipt
          ? `${receipt.supplier_name || 'External supplier'} · ${dateTime(receipt.received_at)}`
          : ''
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => onPrint(id)}>
            Print receipt
          </Button>
        </>
      }
    >
      {loading && <Loading />}
      {receipt && (
        <>
          <dl className="kv mb-16">
            <dt>Supplier</dt>
            <dd>{receipt.supplier_name || 'External supplier'}</dd>
            <dt>Invoice</dt>
            <dd>{receipt.invoice_no || '—'}</dd>
            <dt>Received by</dt>
            <dd>{receipt.created_by_name || '—'}</dd>
            {receipt.notes && (
              <>
                <dt>Notes</dt>
                <dd>{receipt.notes}</dd>
              </>
            )}
          </dl>

          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Entered</th>
                <th className="num">Added to stock</th>
                <th className="num">Unit cost</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((line) => (
                <tr key={line.id}>
                  <td>
                    <div className="cell-title">{line.item_name}</div>
                    <div className="cell-sub mono">{line.sku}</div>
                    {(line.batch_no || line.expiry_date) && (
                      <div className="cell-sub">
                        {line.batch_no ? `Batch ${line.batch_no}` : ''}
                        {line.expiry_date ? ` · expires ${line.expiry_date}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="num">{qty(line.quantity, line.unit_code)}</td>
                  <td className="num">
                    <strong>{qty(line.base_quantity, line.item_unit_code)}</strong>
                  </td>
                  <td className="num muted">{money(line.unit_cost)}</td>
                  <td className="num">{money(line.total_cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="right">
                  Total
                </td>
                <td className="num">{money(receipt.total_cost)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </Modal>
  );
}
