'use client';

import { useState } from 'react';
import Layout from '@/components/Layout';
import AdminOnly from '@/components/AdminOnly';
import { FETCH_ALL, useClientTable, useFetch, useListState } from '@/lib/hooks';
import { qs } from '@/lib/api';
import { dateTime, humanise, initials, isoDate } from '@/lib/format';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  Modal,
  FilterBar,
  Pagination,
  SearchInput,
  Select,
} from '@/components/ui';

const ENTITY_TYPES = [
  'ITEM',
  'KITCHEN',
  'USER',
  'TRANSFER',
  'PRODUCTION',
  'WASTAGE',
  'ADJUSTMENT',
  'RECEIPT',
  'PRODUCT',
  'RECIPE',
  'CATEGORY',
  'SUPPLIER',
  'KITCHEN_INVENTORY',
];

/** Actions that changed stock are worth highlighting in the list. */
const TONE_FOR = {
  LOGIN: 'gray',
  LOGOUT: 'gray',
  LOGIN_FAILED: 'red',
  LOGIN_BLOCKED: 'red',
  STOCK_TRANSFERRED: 'blue',
  STOCK_RECEIVED: 'green',
  PRODUCTION_RECORDED: 'violet',
  WASTAGE_RECORDED: 'red',
  STOCK_ADJUSTED: 'amber',
};

export default function AuditLogsPage() {
  return (
    <AdminOnly>
      <AuditLogs />
    </AdminOnly>
  );
}

function AuditLogs() {
  const [state, update] = useListState();
  const [viewing, setViewing] = useState(null);

  // Same reasoning as the stock ledger: the dates bound the fetch, the rest
  // is filtered here.
  const { data, loading, error } = useFetch(
    `/audit-logs${qs({ from: state.from, to: state.to, page_size: FETCH_ALL })}`,
  );

  const table = useClientTable(data?.data, {
    search: state.search ?? '',
    searchKeys: ['description', 'entity_label', 'full_name', 'username', 'entity_type'],
    filters: {
      action: state.action ?? '',
      entity_type: state.entity_type ?? '',
      user_id: state.user_id ?? '',
      status: state.status ?? '',
    },
    serverTotal: data?.meta?.total,
    resetKey: state,
  });
  const actions = useFetch('/audit-logs/actions');
  const users = useFetch('/users?include_inactive=true');

  return (
    <Layout title="Audit Log" subtitle="Every action taken in the system, by whom and when">
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="card">
        <div className="card-head">
          <FilterBar
            more={
              <>
                <Select
                  value={state.action ?? ''}
                  onChange={(e) => update({ action: e.target.value })}
                  placeholder="All actions"
                  options={(actions.data?.data ?? []).map((a) => ({
                    value: a.action,
                    label: `${humanise(a.action)} (${a.count})`,
                  }))}
                />
                <Select
                  value={state.entity_type ?? ''}
                  onChange={(e) => update({ entity_type: e.target.value })}
                  placeholder="All record types"
                  options={ENTITY_TYPES.map((t) => ({ value: t, label: humanise(t) }))}
                />
                <Select
                  value={state.user_id ?? ''}
                  onChange={(e) => update({ user_id: e.target.value })}
                  placeholder="All users"
                  options={(users.data?.data ?? []).map((u) => ({ value: u.id, label: u.full_name }))}
                />
                <Select
                  value={state.status ?? ''}
                  onChange={(e) => update({ status: e.target.value })}
                  placeholder="Any outcome"
                  options={[
                    { value: 'SUCCESS', label: 'Successful' },
                    { value: 'FAILURE', label: 'Failed' },
                  ]}
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
              placeholder="Search description, record or user…"
            />
          </FilterBar>
        </div>

        <DataTable
          loading={loading}
          rows={table.rows}
          startIndex={table.startIndex}
          onRowClick={(r) => setViewing(r)}
          columns={[
            {
              key: 'created_at',
              label: 'When',
              render: (r) => <span className="small nowrap">{dateTime(r.created_at)}</span>,
            },
            {
              key: 'user',
              label: 'User',
              render: (r) => (
                <div className="flex items-center gap-8">
                  <div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                    {initials(r.full_name || r.username || '?')}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{r.full_name || r.username || 'System'}</div>
                    {r.role_code && <div className="cell-sub">{humanise(r.role_code)}</div>}
                  </div>
                </div>
              ),
            },
            {
              key: 'action',
              label: 'Action',
              render: (r) => <Badge tone={TONE_FOR[r.action] ?? 'gray'}>{humanise(r.action)}</Badge>,
            },
            {
              key: 'description',
              label: 'Description',
              render: (r) => <span className="small">{r.description}</span>,
            },
            {
              key: 'entity',
              label: 'Record',
              render: (r) =>
                r.entity_type ? (
                  <div>
                    <div className="small">{humanise(r.entity_type)}</div>
                    <div className="cell-sub mono">{r.entity_label || `#${r.entity_id}`}</div>
                  </div>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: 'status',
              label: 'Outcome',
              render: (r) => (
                <Badge tone={r.status === 'SUCCESS' ? 'green' : 'red'} dot>
                  {r.status === 'SUCCESS' ? 'OK' : 'Failed'}
                </Badge>
              ),
            },
          ]}
          empty={
            <EmptyState
              icon="printer"
              title="No log entries match"
              message="Every sign-in and stock change is recorded here. Try widening the filters."
            />
          }
        />

        <Pagination meta={table.meta} onPage={table.setPage} />
      </div>

      <Modal
        open={!!viewing}
        size="wide"
        title={viewing ? humanise(viewing.action) : ''}
        subtitle={viewing ? dateTime(viewing.created_at) : ''}
        onClose={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing && (
          <>
            <dl className="kv mb-16">
              <dt>Description</dt>
              <dd>{viewing.description || '—'}</dd>
              <dt>User</dt>
              <dd>
                {viewing.full_name || viewing.username || 'System'}
                {viewing.role_code ? ` (${humanise(viewing.role_code)})` : ''}
              </dd>
              <dt>Record</dt>
              <dd>
                {viewing.entity_type
                  ? `${humanise(viewing.entity_type)} — ${
                      viewing.entity_label || `#${viewing.entity_id}`
                    }`
                  : '—'}
              </dd>
              <dt>Outcome</dt>
              <dd>
                <Badge tone={viewing.status === 'SUCCESS' ? 'green' : 'red'}>{viewing.status}</Badge>
              </dd>
              <dt>IP address</dt>
              <dd className="mono">{viewing.ip_address || '—'}</dd>
              <dt>Client</dt>
              <dd className="small muted">{viewing.user_agent || '—'}</dd>
            </dl>

            {viewing.metadata && (
              <>
                <h4
                  style={{
                    fontSize: 12.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--ink-500)',
                    marginBottom: 6,
                  }}
                >
                  Recorded detail
                </h4>
                <pre
                  className="mono"
                  style={{
                    background: 'var(--ink-50)',
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 11.5,
                    overflow: 'auto',
                    maxHeight: 320,
                    margin: 0,
                    border: '1px solid var(--ink-200)',
                  }}
                >
                  {JSON.stringify(viewing.metadata, null, 2)}
                </pre>
              </>
            )}
          </>
        )}
      </Modal>
    </Layout>
  );
}
