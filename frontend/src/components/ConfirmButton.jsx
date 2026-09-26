'use client';

import { useState } from 'react';
import { Button, ConfirmDialog } from './ui';

/**
 * A button that asks before it acts.
 *
 * Deleting already asked; changing an existing record did not, and that is
 * the one people get wrong - a wrong edit is quieter than a wrong delete and
 * so easier to make without noticing. Wrapping the action here keeps the
 * question identical everywhere instead of each screen inventing its own
 * wording, and makes adding it to a screen a one-line change.
 *
 * Creating something new is deliberately not wrapped. There is nothing to
 * lose by making a thing that did not exist a moment ago, and a confirmation
 * on every save is how people learn to click through confirmations without
 * reading them - which is what breaks the ones that matter.
 */
export function ConfirmButton({
  onConfirm,
  title = 'Save these changes?',
  message,
  confirmLabel = 'Save changes',
  tone = 'primary',
  children,
  loading = false,
  disabled = false,
  ...rest
}) {
  const [asking, setAsking] = useState(false);

  async function go() {
    try {
      await onConfirm();
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <Button {...rest} loading={loading} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </Button>

      <ConfirmDialog
        open={asking}
        tone={tone}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        loading={loading}
        onConfirm={go}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
