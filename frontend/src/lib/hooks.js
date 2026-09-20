'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * Fetch a path and keep it in local state. Re-runs whenever the path changes,
 * ignoring responses that arrive after a newer request has been issued.
 */
export function useFetch(path, { skip = false, initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!skip && !!path);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (skip || !path) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get(path);
      if (id === requestId.current) setData(result);
    } catch (err) {
      if (id === requestId.current) setError(err);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path, skip]);

  useEffect(() => {
    load();
  }, [load]);

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
