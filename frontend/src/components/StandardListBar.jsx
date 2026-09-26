'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/hooks';
import { num } from '@/lib/format';
import { Icon } from './Icon';
import { ConfirmDialog } from './ui';

/**
 * The three shopping runs, offered wherever stock gets added.
 *
 * The business does not buy from one flat list - it does an everyday run for
 * milk and vegetables, a weekly grocery order, and a monthly order for boxes
 * and bags. Those are different trips with different suppliers and different
 * urgency, so they are offered as three, in that order, rather than as one
 * list somebody has to scroll and filter.
 *
 * `onPick` receives the whole list, including its lines, so the caller can
 * fill a form in with it.
 */

const FREQUENCY = {
  EVERYDAY: {
    label: 'Everyday',
    hint: 'Dairy, vegetables — things that will not keep',
    icon: 'clock',
    tone: 'green',
  },
  WEEKLY: {
    label: 'Weekly',
    hint: 'The grocery order: flour, spices, sauces, oils',
    icon: 'documents',
    tone: 'blue',
  },
  MONTHLY: {
    label: 'Monthly',
    hint: 'Boxes, bags and containers, bought by the carton',
    icon: 'box',
    tone: 'violet',
  },
};

export function StandardListBar({ onPick, purpose = 'REFILL', title = 'Start from a standard list' }) {
  const { data, loading } = useFetch('/standard-lists');
  const lists = (data?.data ?? []).filter((l) => l.purpose === purpose);

  /** The list awaiting confirmation, if any. */
  const [asking, setAsking] = useState(null);

  if (loading || lists.length === 0) return null;

  // Always in calendar order, whatever order the API returned them in.
  const ordered = ['EVERYDAY', 'WEEKLY', 'MONTHLY']
    .map((frequency) => ({ frequency, list: lists.find((l) => l.frequency === frequency) }))
    .filter((row) => row.list);

  return (
    <div className="card mb-16">
      <div className="card-head">
        <h3>{title}</h3>
        <span className="muted small">Fills the form in — you can change anything afterwards</span>
      </div>
      <div className="card-body">
        <div className="list-picker">
          {ordered.map(({ frequency, list }) => {
            const meta = FREQUENCY[frequency];
            return (
              <button
                key={list.id}
                type="button"
                className="list-pick"
                onClick={() => setAsking(list)}
              >
                <span className={`list-pick-icon ${meta.tone}`}>
                  <Icon name={meta.icon} size={20} />
                </span>
                <span className="list-pick-body">
                  <span className="list-pick-title">{meta.label}</span>
                  <span className="list-pick-sub">{meta.hint}</span>
                  <span className="list-pick-count">{num(list.total_items)} items</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Picking a list replaces every line already on the form, which is not
          obvious from a button that just says "Everyday" - so it says so, and
          says how many lines are coming, before anything is thrown away. */}
      <ConfirmDialog
        open={!!asking}
        tone="primary"
        title={asking ? `Use the ${asking.frequency.toLowerCase()} list?` : ''}
        message={
          asking
            ? `This fills the form with the ${asking.total_items} items on '${asking.name}', replacing anything already entered. Nothing is ordered or received until you submit the form yourself.`
            : ''
        }
        confirmLabel="Fill in the form"
        onConfirm={() => {
          onPick(asking);
          setAsking(null);
        }}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
