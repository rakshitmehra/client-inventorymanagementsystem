'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button, ConfirmDialog, useToast } from './ui';

/**
 * The button that runs a standard list, wherever it appears.
 *
 * Running a list is the same act whether it is pressed from the home screen
 * or from the list of lists, and the sentence that describes it has to be the
 * same too - it is what somebody reads before agreeing to move stock. Keeping
 * the button and its confirmation together in one component is what stops the
 * two places drifting into saying slightly different things about what is
 * about to happen.
 */

/** What pressing the button will actually do, in the reader's own terms. */
export function runLabelFor(list, isAdmin) {
  if (!list) return 'Run';
  if (list.purpose === 'REFILL') return 'Top up the main store';
  return isAdmin ? `Send to ${list.kitchen_name}` : 'Ask for this';
}

function describe(list, isAdmin) {
  if (!list) return '';
  const count = `all ${list.total_items} items on '${list.name}'`;
  if (list.purpose === 'REFILL') {
    return (
      `This will book in ${count} as a delivery into the main store` +
      `${list.supplier_name ? ` from ${list.supplier_name}` : ''}. ` +
      'To change the quantities first, open the list instead.'
    );
  }
  if (isAdmin) {
    return (
      `This will send ${count} from the main store to ${list.kitchen_name}, straight away. ` +
      'To change the quantities first, open the list instead.'
    );
  }
  return (
    `This will ask the main store for ${count}. ` +
    'Nothing moves until an administrator approves it.'
  );
}

export function RunListButton({
  list,
  onDone,
  size = 'sm',
  variant = 'primary',
  label = 'Run',
  goToResult = true,
}) {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      // An empty body means "exactly as saved" - that is the single click.
      const result = await api.post(`/standard-lists/${list.id}/run`, {});
      toast.success(result.message);
      setAsking(false);
      onDone?.(result);
      if (goToResult) {
        router.push(
          result.outcome === 'receipt'
            ? '/goods-receipts'
            : result.outcome === 'transfer'
              ? '/transfers'
              : '/requests',
        );
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        icon="check"
        onClick={(e) => {
          e.stopPropagation();
          setAsking(true);
        }}
      >
        {label}
      </Button>

      <ConfirmDialog
        open={asking}
        tone="primary"
        title={runLabelFor(list, isAdmin)}
        message={describe(list, isAdmin)}
        confirmLabel={runLabelFor(list, isAdmin)}
        loading={busy}
        onConfirm={run}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
