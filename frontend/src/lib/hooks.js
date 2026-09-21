'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { readCache, writeCache } from './cache';

/**
 * Fetch a path and keep it in local state.
 *
 * A cached response for the same path renders immediately and is refreshed in
 * the background, so returning to a screen you just left shows it at once
 * instead of putting a spinner over data the browser already had.
 */
export function useFetch(path, { skip = false, initial = null } = {}) {
  const cached = !skip && path ? readCache(path) : null;

  // Data is kept with the path it came from. Holding them apart let a screen
  // render the previous path's response for one frame after the path changed -
  // which is how switching report tabs blanked the page: the new tab read a
  // `meta` block the old tab's response did not have.
  const [entry, setEntry] = useState({ path, data: cached?.data ?? initial });
  // Only the first sight of a path is a "loading" state. With something on
  // screen already, refreshing it is not worth a spinner.
  const [loading, setLoading] = useState(!skip && !!path && !cached);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  // Adjusting state during render, so the mismatch never reaches the screen.
  if (entry.path !== path) {
    const hit = !skip && path ? readCache(path) : null;
    setEntry({ path, data: hit?.data ?? initial });
    setLoading(!skip && !!path && !hit);
    setError(null);
  }

  const data = entry.data;
  const setData = useCallback(
    (value) => setEntry((current) => ({ ...current, data: value })),
    [],
  );

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (skip || !path) {
        setLoading(false);
        return;
      }
      const id = ++requestId.current;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const result = await api.get(path);
        if (id === requestId.current) {
          setEntry({ path, data: result });
          writeCache(path, result);
        }
      } catch (err) {
        if (id === requestId.current) setError(err);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [path, skip],
  );

  useEffect(() => {
    const hit = !skip && path ? readCache(path) : null;
    if (hit) {
      setEntry({ path, data: hit.data });
      setLoading(false);
      load({ quiet: true }); // revalidate behind what is already showing
    } else {
      load();
    }
  }, [load, path, skip]);

  return { data, loading, error, reload: load, setData };
}

/**
 * Query state for list screens: search, filters, sorting and paging, with the
 * page resetting whenever a filter changes.
 */
export function useListState(initial = {}) {
  const [state, setState] = useState({ page: 1, ...initial });

  const update = useCallback((patch) => {
    setState((current) => {
      const next = { ...current, ...patch };
      // Any change other than the page itself returns to the first page.
      if (!('page' in patch)) next.page = 1;
      return next;
    });
  }, []);

  const setSort = useCallback((key) => {
    setState((current) => ({
      ...current,
      sort: key,
      order: current.sort === key && current.order === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
  }, []);

  return [state, update, setSort];
}

/** Every table in the app shows this many rows per page. */
export const PAGE_SIZE = 20;

/**
 * How many rows a client-filtered screen asks the server for in one go.
 *
 * Matches the ceiling the API enforces. Asking for more is not an error, it is
 * just capped - which is why anything filtering in the browser must also check
 * the server's reported total and admit when it is holding only part of it.
 */
export const FETCH_ALL = 500;

/**
 * Search, filter, sort and paginate a list that is already in memory.
 *
 * The rows arrive from one request and everything after that happens in the
 * browser, so typing in a search box filters instantly instead of waiting on a
 * round trip to Supabase for each keystroke.
 *
 * `search` matches against whichever fields the caller names. `filters` is a
 * map of field to value, where an empty value means "no filter". `predicate`
 * covers anything those two cannot express.
 */
export function useClientTable(
  rows,
  {
    search = '',
    searchKeys = [],
    filters = {},
    predicate,
    sort,
    order = 'asc',
    pageSize = PAGE_SIZE,
    /** The server's own count, when it may exceed the rows we were given. */
    serverTotal,
    /**
     * Anything else that narrows the list - dates, a status, a toggle - that
     * the hook cannot see because it is applied inside `predicate`. Pass the
     * screen's filter state and changing it returns to the first page.
     */
    resetKey,
  } = {},
) {
  const [page, setPage] = useState(1);

  const all = useMemo(() => rows ?? [], [rows]);
  const filterKey = JSON.stringify(filters);

  // Narrowing the list puts you back at the start of it. Without this, typing
  // a search while on page 2 left you looking at the tail of the results -
  // "showing 21-24 of 24" - which reads as if the first twenty went missing.
  const signature = `${search}|${filterKey}|${JSON.stringify(resetKey ?? null)}`;
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setPage(1);
  }

  const matched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const active = Object.entries(JSON.parse(filterKey)).filter(
      ([, value]) => value !== '' && value !== null && value !== undefined,
    );

    return all.filter((row) => {
      if (needle && searchKeys.length) {
        const hit = searchKeys.some((key) =>
          String(row[key] ?? '').toLowerCase().includes(needle),
        );
        if (!hit) return false;
      }
      for (const [key, value] of active) {
        if (String(row[key] ?? '') !== String(value)) return false;
      }
      return predicate ? predicate(row) : true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, searchKeys.join('|'), filterKey, predicate]);

  const sorted = useMemo(() => {
    if (!sort) return matched;
    const direction = order === 'desc' ? -1 : 1;
    return [...matched].sort((a, b) => {
      const left = a[sort];
      const right = b[sort];
      if (left === right) return 0;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      const numeric = Number(left);
      const otherNumeric = Number(right);
      if (!Number.isNaN(numeric) && !Number.isNaN(otherNumeric) && left !== '' && right !== '') {
        return (numeric - otherNumeric) * direction;
      }
      return String(left).localeCompare(String(right)) * direction;
    });
  }, [matched, sort, order]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // Filtering down to fewer pages must not strand the view on page 7 of 3.
  const current = Math.min(page, totalPages);
  const offset = (current - 1) * pageSize;

  return {
    rows: sorted.slice(offset, offset + pageSize),
    /**
     * Every matching row, not just this page. Table footers that total a
     * column need this - summing `rows` would show the total of whichever 20
     * rows happen to be on screen and call it the total.
     */
    allRows: sorted,
    /** 1-based number of the first row on this page, for the # column. */
    startIndex: offset + 1,
    page: current,
    setPage,
    meta: {
      page: current,
      page_size: pageSize,
      total: sorted.length,
      total_pages: totalPages,
      filtered_from: all.length,
      /**
       * Set only when the server holds more rows than it sent. Filtering in
       * the browser can then never quietly present a slice as the whole list.
       */
      truncated: serverTotal > all.length ? serverTotal : null,
    },
  };
}

/** Run an async action with loading state and error capture. */
export function useAction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { run, loading, error, setError };
}

/** Reference lists (units, categories) used across the forms. */
export function useReference() {
  const units = useFetch('/units');
  const categories = useFetch('/categories');
  return {
    units: units.data?.data ?? [],
    categories: categories.data?.data ?? [],
    loading: units.loading || categories.loading,
  };
}

/** Convert an entered quantity into an item's stocking unit, for previews. */
export function useUnitConversion(units) {
  return useCallback(
    (quantity, enteredUnitId, item) => {
      if (!item || !quantity) return 0;
      const entered = units.find((u) => u.id === (enteredUnitId ?? item.unit_id));
      const base = units.find((u) => u.id === item.unit_id);
      if (!entered || !base || entered.dimension !== base.dimension) return 0;
      return (Number(quantity) * Number(entered.factor)) / Number(base.factor);
    },
    [units],
  );
}
