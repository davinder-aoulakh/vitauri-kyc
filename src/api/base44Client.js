import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { createRequestQueue } from '@/lib/requestQueue';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

const rawClient = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// ─────────────────────────────────────────────────────────────────────────
// Central request throttle + 429 retry for entity calls.
// Caps concurrent in-flight entity requests app-wide and automatically
// retries rate-limited (429) responses with exponential backoff, so every
// page benefits without per-page changes. Does not touch auth, integrations,
// functions, or `.subscribe()` (realtime, not an HTTP request).
// ─────────────────────────────────────────────────────────────────────────
const MAX_CONCURRENT = 10;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 60000;
// Writes (update/create/delete/...) jump ahead of queued reads — a user action
// like "Mark Complete" must never sit behind a page's background list/filter
// calls, which can easily fill every concurrency slot on a busy workspace page.
const WRITE_METHODS = new Set(['create', 'update', 'delete', 'bulkCreate', 'bulkUpdate', 'updateMany', 'deleteMany']);

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.status = 408;
  }
}

// Races a throttled call against a 60s timeout. On timeout the slot is
// released (via the throttle()'s finally) and a TimeoutError is thrown,
// which flows into the caller's normal catch block like any other error.
function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError('Request timed out after 60s')), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isRateLimited(err) {
  return err?.status === 429 || /rate limit/i.test(err?.message || '');
}

// Reads started on the page the user is on now go before reads still queued from the page they left.
const queueRuns = createRequestQueue({
  max: MAX_CONCURRENT,
  getScope: () => (typeof window !== 'undefined' ? window.location.pathname : ''),
});

/** Timing of recent entity calls (label, queue wait, network time, retries) — used by the case-open trace. No data. */
export const recentEntityCalls = (since) => queueRuns.recentSince(since);

function throttle(fn, priority = false, label = '') {
  return function throttled(...args) {
    return queueRuns.run(() => withTimeout(fn(...args)), {
      priority,
      label,
      retryIf: (err, attempt) => (isRateLimited(err) && attempt < MAX_RETRIES ? 1000 * 2 ** attempt : null),
    });
  };
}

const entityProxyCache = new Map();

const entitiesProxy = new Proxy(rawClient.entities, {
  get(target, entityName) {
    const entity = target[entityName];
    if (typeof entity !== 'object' || entity === null) return entity;
    if (entityProxyCache.has(entityName)) return entityProxyCache.get(entityName);
    const wrapped = new Proxy(entity, {
      get(entityTarget, methodName) {
        const method = entityTarget[methodName];
        if (typeof method !== 'function') return method;
        // Realtime subscriptions are websocket-based, not HTTP — never throttle them
        if (methodName === 'subscribe') return method.bind(entityTarget);
        return throttle(method.bind(entityTarget), WRITE_METHODS.has(methodName), `${String(entityName)}.${String(methodName)}`);
      },
    });
    entityProxyCache.set(entityName, wrapped);
    return wrapped;
  },
});

export const base44 = new Proxy(rawClient, {
  get(target, prop) {
    if (prop === 'entities') return entitiesProxy;
    return target[prop];
  },
});