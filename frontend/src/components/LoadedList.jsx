'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { Button, ConfirmDialog, useToast } from './ui';

/**
 * Shown once a standard list has filled a form, offering to take the changes
 * back.
 *
 * Without this, correcting a list meant correcting it twice: once on the form
 * to get today's order right, and again on the list itself so next month is
 * right too. Nobody does the second one, so the lists rot and everybody goes
 * back to typing. The fix is to offer it at the moment the difference is in
 * front of you.
 *
 * The two actions are kept apart on purpose. The form you are filling in is
 * this delivery; the list is what normal looks like from now on. Saving back
 * is a separate, deliberate press with its own confirmation, so a one-off
 * change cannot become the standing order by accident.
 */
export function LoadedList({ list, lines, onCleared }) {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!list) return null;

  // Only the lines that amount to something; a blank row is not a change.
  const usable = (lines ?? []).filter((l) => l.item_id && Number(l.quantity) > 0);
  const changed =
    usable.length !== (list.items ?? []).length ||
    usable.some((line) => {
      const saved = (list.items ?? []).find((i) => i.item_id === line.item_id);
      return !saved || Number(saved.quantity) !== Number(line.quantity);
    });

  async function saveBack() {
    setSaving(true);
    try {
      const result = await api.put(`/standard-lists/${list.id}`, {
        name: list.name,
        purpose: list.purpose,
        frequency: list.frequency,
        kitchen_id: list.kitchen_id ?? undefined,
        supplier_id: list.supplier_id ?? undefined,
        notes: list.notes || undefined,
        is_active: true,
        items: usable.map((line) => ({
          item_id: line.item_id,
          quantity: Number(line.quantity),
          unit_id: line.unit_id ?? undefined,
        })),
      });
      toast.success(result.message);
      setAsking(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="loaded-list mb-16">
        <div className="loaded-list-text">
          <strong>{list.name}</strong>
          <span className="muted small">
            {changed
              ? ` — you have changed this from the saved ${list.total_items} items`
              : ` — ${list.total_items} items, as saved`}
          </span>
        </div>

        <div className="flex gap-8 nowrap">
          {isAdmin && (
            <Button
              size="sm"
              icon="check"
              disabled={!changed || usable.length === 0}
              onClick={() => setAsking(true)}
            >
              Save changes to the list
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push(`/standard-lists/${list.id}`)}
          >
            Open the list
          </Button>
          <Button size="sm" variant="ghost" onClick={onCleared}>
            Clear
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={asking}
        tone="primary"
        title={`Update '${list.name}'?`}
        message={`The list becomes these ${usable.length} items and quantities, for every future run. This does not receive or send anything now - the form in front of you is unchanged and still has to be submitted.`}
        confirmLabel="Update the list"
        loading={saving}
        onConfirm={saveBack}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
