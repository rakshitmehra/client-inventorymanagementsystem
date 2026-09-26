'use client';

import { useMemo } from 'react';
import { useFetch } from '@/lib/hooks';
import { isoDate, num, qty } from '@/lib/format';
import { Badge, DataTable, EmptyState, Loading } from './ui';

/**
 * How stock actually reaches this kitchen: what comes daily, weekly, monthly.
 *
 * A kitchen manager does not run the buying, so the three shopping runs are
 * not theirs to change - but which run an item is on is exactly what tells
 * them whether to expect more tomorrow or to make what they have last a
 * month. That is the difference between "we are low on cream" being a shrug
 * and being a problem.
 *
 * Everything here is counted from the stock ledger over the last thirty days.
 * No costs appear, and none are fetched.
 */
export function DeliveryRhythm({ kitchenId }) {
  const activity = useFetch(
    kitchenId
      ? `/reports/kitchen-activity?kitchen_id=${kitchenId}&from=${isoDate(29)}&to=${isoDate()}`
      : null,
    { skip: !kitchenId },
  );
  const lists = useFetch('/standard-lists');

  const groups = useMemo(() => {
    const rows = activity.data?.data ?? [];
    const buying = (lists.data?.data ?? []).filter((l) => l.purpose === 'REFILL');

    // Which shopping run each item belongs to.
    const runOf = new Map();
    for (const list of buying) {
      for (const line of list.items ?? []) runOf.set(line.item_id, list.frequency);
    }

    const shape = (frequency, label, hint) => {
      const mine = rows.filter((r) => runOf.get(r.item_id) === frequency);
      return {
        frequency,
        label,
        hint,
        items: mine,
        delivered: mine.filter((r) => r.sent > 0).length,
        short: mine.filter((r) => r.stock_status !== 'OK').length,
        total: mine.length,
      };
    };

    return [
      shape('EVERYDAY', 'Every day', 'Dairy, vegetables — expect more tomorrow'),
      shape('WEEKLY', 'Every week', 'The grocery order — make it last the week'),
      shape('MONTHLY', 'Every month', 'Boxes and bags — ordered by the carton'),
    ].filter((g) => g.total > 0);
  }, [activity.data, lists.data]);

  if (activity.loading || lists.loading) {
    return <Loading label="Working out what arrives when…" />;
  }

  if (groups.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <h3>How stock reaches you</h3>
        </div>
        <EmptyState
          icon="truck"
          title="Nothing to show yet"
          message="Once the main store sets up its everyday, weekly and monthly lists, this shows which of your items arrive on each of them."
        />
      </div>
    );
  }

  return (
    <div className="card mb-16">
      <div className="card-head">
        <h3>How stock reaches you</h3>
        <span className="muted small">Deliveries over the last 30 days</span>
      </div>

      <div className="card-body">
        <div className="rhythm-row">
          {groups.map((group) => (
            <div key={group.frequency} className="rhythm">
              <div className="rhythm-label">{group.label}</div>
              <div className="rhythm-value">{num(group.total)}</div>
              <div className="rhythm-sub">items on this run</div>
              <div className="rhythm-meta">
                {group.delivered > 0
                  ? `${group.delivered} arrived in the last 30 days`
                  : 'Nothing arrived in the last 30 days'}
              </div>
              {group.short > 0 && (
                <div className="mt-8">
                  <Badge tone="amber" dot>
                    {group.short} running low
                  </Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* The lines that actually need attention, whatever run they are on. */}
      <DataTable
        numbered={false}
        rows={groups
          .flatMap((g) => g.items.map((i) => ({ ...i, run: g.label })))
          .filter((i) => i.stock_status !== 'OK')
          .slice(0, 8)}
        rowKey={(r) => r.item_id}
        columns={[
          {
            key: 'item_name',
            label: 'Running low',
            render: (r) => (
              <div>
                <div className="cell-title">{r.item_name}</div>
                <div className="cell-sub">{r.run}</div>
              </div>
            ),
          },
          {
            key: 'quantity',
            label: 'You have',
            align: 'right',
            render: (r) => <strong>{qty(r.quantity, r.unit_code)}</strong>,
          },
          {
            key: 'sent',
            label: 'Sent to you (30 days)',
            align: 'right',
            render: (r) =>
              r.sent > 0 ? qty(r.sent, r.unit_code) : <span className="muted">—</span>,
          },
        ]}
        empty={
          <EmptyState
            icon="check-circle"
            title="Nothing is running low"
            message="Every item on all three runs is above its minimum."
          />
        }
      />
    </div>
  );
}
