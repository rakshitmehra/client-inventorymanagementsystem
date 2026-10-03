'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { Icon } from './Icon';

/**
 * The bell in the top bar.
 *
 * It asks one cheap question every minute - how many are unread - and only
 * fetches the list when somebody opens it. Tapping a notification marks it as
 * read and takes you to what it is about; "Mark all as read" clears the lot.
 * Each person's list is their own, so reading yours never clears anyone else's.
 */
const POLL_MS = 60_000;

const TONE = { danger: 'danger', warn: 'warn', success: 'success', info: 'info' };

export default function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  const refreshCount = useCallback(async () => {
    try {
      const result = await api.get('/notifications/unread-count');
      setUnread(result.data.unread);
    } catch {
      /* a missed poll is not worth an error on every screen */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/notifications?page_size=30');
      setItems(result.data);
      setUnread(result.meta.unread);
    } catch {
      setItems((current) => current ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll while the tab is visible, and catch up the moment it comes back.
  useEffect(() => {
    refreshCount();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshCount();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refreshCount();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  // Close on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    const esc = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function openOne(note) {
    setOpen(false);
    if (!note.is_read) {
      // Shown as read at once; the request catches up behind it.
      setItems((list) => list?.map((n) => (n.id === note.id ? { ...n, is_read: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
      api.post(`/notifications/${note.id}/read`).catch(() => refreshCount());
    }
    if (note.link) router.push(note.link);
  }

  async function readAll() {
    setItems((list) => list?.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
    try {
      await api.post('/notifications/read-all');
    } catch {
      refreshCount();
    }
  }

  return (
    <div className="notif no-print" ref={boxRef}>
      <button
        type="button"
        className="notif-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Icon name="bell" size={22} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button type="button" className="notif-readall" onClick={readAll} disabled={unread === 0}>
              Mark all as read
            </button>
          </div>

          <div className="notif-list">
            {loading && items === null ? (
              <div className="notif-empty">Loading…</div>
            ) : !items || items.length === 0 ? (
              <div className="notif-empty">
                <Icon name="check-circle" size={26} />
                <div>You are all caught up.</div>
              </div>
            ) : (
              items.map((note) => (
                <button
                  type="button"
                  key={note.id}
                  className={`notif-item${note.is_read ? '' : ' unread'}`}
                  onClick={() => openOne(note)}
                >
                  <span className={`notif-dot ${TONE[note.severity] ?? 'info'}`} aria-hidden="true" />
                  <span className="notif-text">
                    <span className="notif-title">{note.title}</span>
                    {note.body && <span className="notif-body">{note.body}</span>}
                    <span className="notif-time">{relative(note.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
