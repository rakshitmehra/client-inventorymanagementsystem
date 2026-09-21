import { clearCache } from './cache';

const TOKEN_KEY = 'kitchenstock.token';

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

const isBrowser = typeof window !== 'undefined';

export const getToken = () => (isBrowser ? localStorage.getItem(TOKEN_KEY) : null);
export const setToken = (token) => isBrowser && localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => isBrowser && localStorage.removeItem(TOKEN_KEY);

/** An error carrying the service's status and per-field details. */
export class ApiError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details || null;
    this.code = code || null;
  }
}

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, path, body, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    // The service is unreachable - distinguish that from an API error so the
    // UI can say something useful instead of "failed to fetch".
    throw new ApiError(0, 'Cannot reach the KitchenStock API. Is the service running?', null, 'OFFLINE');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // An expired or revoked token drops the user back to sign-in rather than
    // leaving a half-broken screen behind.
    if (response.status === 401 && !options.skipAuthRedirect && onUnauthorized) {
      onUnauthorized();
    }
    const error = payload?.error || {};
    throw new ApiError(
      response.status,
      error.message || `Request failed (${response.status})`,
      error.details,
      error.code,
    );
  }

  return payload;
}

/** Build a query string, skipping empty values. */
export function qs(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'ALL') continue;
    search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * Anything that changes data drops the read cache first.
 *
 * It happens before awaiting the response on purpose: if a write fails
 * half-way, the safe assumption is still that something moved.
 */
const mutate = (method, path, body, options) => {
  clearCache();
  return request(method, path, body, options);
};

export const api = {
  get: (path) => request('GET', path),
  post: (path, body, options) => mutate('POST', path, body ?? {}, options),
  put: (path, body) => mutate('PUT', path, body ?? {}),
  patch: (path, body) => mutate('PATCH', path, body ?? {}),
  del: (path) => mutate('DELETE', path),
};
