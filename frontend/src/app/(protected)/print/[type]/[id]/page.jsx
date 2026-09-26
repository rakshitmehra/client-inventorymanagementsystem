'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useFetch } from '@/lib/hooks';
import { api } from '@/lib/api';
import { date, dateTime, money, num } from '@/lib/format';
import { Alert, Button, Loading } from '@/components/ui';

export default function PrintDocumentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PrintDocument />
    </Suspense>
  );
}

/**
 * One print layout serving every document type. The service returns a uniform
 * envelope (header, parties, lines, totals, signatures) so a transfer slip, a
 * production slip, a goods receipt, a wastage note and an adjustment note all
 * render through this single component.
 */
function PrintDocument() {
  const { type, id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoPrinted = useRef(false);

  const { data, loading, error } = useFetch(`/documents/${type}/${id}`);
  const doc = data?.data;

  // Auto-open the print dialog when arrived at with ?print=1.
  useEffect(() => {
    if (doc && searchParams.get('print') === '1' && !autoPrinted.current) {
      autoPrinted.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [doc, searchParams]);

  async function printNow() {
    window.print();
    try {
      await api.post(`/documents/${type}/${id}/print`);
    } catch {
      // A failed print-log must never block the actual printing.
    }
  }

  if (loading) {
    return (
      <div className="print-page">
        <Loading label="Preparing the document…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="print-page">
        <div className="print-toolbar">
          <Button onClick={() => router.back()} icon="arrow-left">
            Back
          </Button>
        </div>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <Alert tone="error">{error.message}</Alert>
        </div>
      </div>
    );
  }

  if (!doc) return null;

  const showsCost = doc.lines.some((line) => Number(line.total_cost) > 0);
  const hasBaseUnits = doc.lines.some(
    (line) => line.base_unit_code && line.base_unit_code !== line.unit_code,
  );
  const isAdjustment = doc.document_type === 'ADJUSTMENT';
  const isProduction = doc.document_type === 'PRODUCTION';

  const footerSpan =
    1 + (hasBaseUnits ? 1 : 0) + (isAdjustment ? 2 : 0) + (isProduction ? 1 : 0) + (showsCost ? 1 : 0);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Button onClick={() => router.back()} icon="arrow-left">
            Back
          </Button>
        <Button variant="primary" onClick={printNow}>
          Print / Save as PDF
        </Button>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {doc.print_count > 0
            ? `Printed ${doc.print_count} time${doc.print_count === 1 ? '' : 's'} before`
            : 'Not printed yet'}
        </span>
      </div>

      <div className="slip">
        {/* ------------------------------------------------------ header -- */}
        <div className="slip-head">
          <div>
            <div className="slip-company-name">{doc.company.name}</div>
            <div className="slip-company-meta">
              {doc.company.address}
              {doc.company.phone && (
                <>
                  <br />
                  {doc.company.phone}
                </>
              )}
              {doc.company.email && <> · {doc.company.email}</>}
              {/* A food business in India has to show both on its paperwork.
                  Rendered only when set, so an unconfigured system prints a
                  clean document rather than an empty label. */}
              {(doc.company.gstin || doc.company.fssai) && (
                <>
                  <br />
                  {doc.company.gstin && (
                    <span className="slip-reg">GSTIN: {doc.company.gstin}</span>
                  )}
                  {doc.company.gstin && doc.company.fssai && <> · </>}
                  {doc.company.fssai && (
                    <span className="slip-reg">FSSAI Lic. No: {doc.company.fssai}</span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="slip-doc">
            <div className="slip-doc-title">{doc.title}</div>
            <div className="slip-doc-no">{doc.document_no}</div>
            <div className="slip-doc-date">{dateTime(doc.document_date)}</div>
          </div>
        </div>

        {/* ----------------------------------------------------- parties -- */}
        <div className="slip-parties">
          {doc.kitchen ? (
            <div>
              <div className="slip-party-label">Kitchen</div>
              <div className="slip-party-value">{doc.kitchen.name}</div>
              <div className="slip-party-meta">
                Code: {doc.kitchen.code}
                {doc.kitchen.location && (
                  <>
                    <br />
                    {doc.kitchen.location}
                  </>
                )}
                {doc.kitchen.manager_name && (
                  <>
                    <br />
                    Manager: {doc.kitchen.manager_name}
                  </>
                )}
                {doc.kitchen.manager_phone && <> · {doc.kitchen.manager_phone}</>}
              </div>
            </div>
          ) : doc.supplier ? (
            <div>
              <div className="slip-party-label">Supplier</div>
              <div className="slip-party-value">{doc.supplier.name || 'External supplier'}</div>
              <div className="slip-party-meta">
                {doc.supplier.contact_person && (
                  <>
                    {doc.supplier.contact_person}
                    <br />
                  </>
                )}
                {doc.supplier.phone && (
                  <>
                    {doc.supplier.phone}
                    <br />
                  </>
                )}
                {doc.supplier.address}
                {doc.supplier.invoice_no && (
                  <>
                    <br />
                    Invoice: {doc.supplier.invoice_no}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="slip-party-label">Location</div>
              <div className="slip-party-value">Main Inventory</div>
            </div>
          )}

          {doc.parties && (
            <div>
              <div className="slip-party-label">Movement</div>
              <div className="slip-party-value">{doc.parties.source}</div>
              <div className="slip-party-meta">
                ↓ to
                <br />
                <strong>{doc.parties.destination}</strong>
              </div>
            </div>
          )}

          {doc.product && (
            <div>
              <div className="slip-party-label">Produced</div>
              <div className="slip-party-value">
                {num(doc.product.output_quantity)} × {doc.product.name}
              </div>
              <div className="slip-party-meta">
                SKU: {doc.product.sku}
                <br />
                Recipe: {doc.product.recipe}
                <br />
                Batches: {num(doc.product.batches)}
              </div>
            </div>
          )}

          <div>
            <div className="slip-party-label">Issued by</div>
            <div className="slip-party-value">{doc.performed_by.name || '—'}</div>
            <div className="slip-party-meta">
              {doc.performed_by.username && (
                <>
                  {doc.performed_by.username}
                  <br />
                </>
              )}
              Status: {doc.status}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------- lines -- */}
        <table className="slip-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Item</th>
              <th>SKU</th>
              {isAdjustment && <th className="num">Previous</th>}
              <th className="num">Quantity</th>
              {hasBaseUnits && <th className="num">Stock units</th>}
              {isAdjustment && <th className="num">New</th>}
              {isProduction && <th className="num">Balance after</th>}
              {showsCost && <th className="num">Rate</th>}
              {showsCost && <th className="num">Value</th>}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>
                  <strong>{line.item_name}</strong>
                  {line.category && (
                    <div style={{ fontSize: 10.4, color: '#78879c' }}>{line.category}</div>
                  )}
                  {line.batch_no && (
                    <div style={{ fontSize: 10.4, color: '#78879c' }}>Batch {line.batch_no}</div>
                  )}
                  {line.reason && (
                    <div style={{ fontSize: 10.4, color: '#78879c' }}>Reason: {line.reason}</div>
                  )}
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{line.sku}</td>
                {isAdjustment && (
                  <td className="num">
                    {num(line.previous_quantity)} {line.unit_code}
                  </td>
                )}
                <td className="num">
                  <strong>
                    {num(line.quantity)} {line.unit_code}
                  </strong>
                </td>
                {hasBaseUnits && (
                  <td className="num">
                    {line.base_quantity ? `${num(line.base_quantity)} ${line.base_unit_code}` : '—'}
                  </td>
                )}
                {isAdjustment && (
                  <td className="num">
                    <strong>
                      {num(line.new_quantity)} {line.unit_code}
                    </strong>
                  </td>
                )}
                {isProduction && (
                  <td className="num">
                    {num(line.balance_after)} {line.unit_code}
                  </td>
                )}
                {showsCost && <td className="num">{money(line.unit_cost)}</td>}
                {showsCost && <td className="num">{money(line.total_cost)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>{doc.totals.line_count}</strong> line item(s)
              </td>
              <td className="num" colSpan={footerSpan}>
                {showsCost ? 'Value at cost' : ''}
              </td>
              {showsCost && <td className="num">{money(doc.totals.total_cost)}</td>}
            </tr>
          </tfoot>
        </table>

        {/* A stock movement between our own locations is not a sale. Say so on
            the document itself, so nobody downstream mistakes it for one. */}
        <div className="slip-declaration">
          {showsCost && (
            <>
              <strong>Value shown is at cost, for internal stock accounting only.</strong>{' '}
            </>
          )}
          {doc.document_type === 'TRANSFER'
            ? 'Internal stock transfer between company locations - not a sale.'
            : 'Internal stock record - not a sale.'}
        </div>

        {doc.notes && (
          <div className="slip-notes">
            <strong>Notes: </strong>
            {doc.notes}
          </div>
        )}

        {/* -------------------------------------------------- signatures -- */}
        <div className="slip-signatures">
          {doc.signatures.map((label) => (
            <div className="slip-signature" key={label}>
              {label}
              <div style={{ fontSize: 10, marginTop: 2 }}>Name, signature &amp; date</div>
            </div>
          ))}
        </div>

        <div className="slip-foot">
          <span>
            {doc.document_no} · {doc.title} · generated {date(doc.generated_at)} by{' '}
            {doc.generated_for}
          </span>
          <span>KitchenStock</span>
        </div>
      </div>
    </div>
  );
}
