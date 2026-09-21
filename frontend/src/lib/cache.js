'use client';

/**
 * A tiny response cache, so going back to a screen shows it immediately.
 *
 * Without this, every navigation refetches: leaving a list to open one row and
 * pressing Back put a spinner over data the browser had held a second earlier.
 * On a cold connection to Supabase that is a real wait for something the user
 * has already seen.
 *
 * The strategy is stale-while-revalidate. A cached response renders at once,
 * and a fresh request goes out behind it; if the data moved on, the screen
 * updates in place. Nobody stares at a spinner, and nobody reads stale numbers
 * for longer than one round trip.
 *
 * It lives in memory only. A reload starts empty, which is the right default
 * for stock figures - they should never survive longer than the tab.
 */

const store = new Map();

/** Entries older than this are refetched without showing their cached copy. */
const MAX_AGE_MS = 5 * 60 * 1000;

export function readCache(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MAX_AGE_MS) {
    store.delete(key);
    return null;
  }
  return hit;
}

export function writeCache(key, data) {
  store.set(key, { data, at: Date.now() });
}

/**
 * Drop cached responses after a write.
 *
 * Deliberately blunt: recording a transfer moves stock, which changes the main
 * store, the kitchen, the ledger, the dashboard and several reports. Working
 * out exactly which keys that touches would be a source of stale-data bugs, so
 * any mutation clears everything and the next screen re-reads.
 */
export function clearCache() {
  store.clear();
}
