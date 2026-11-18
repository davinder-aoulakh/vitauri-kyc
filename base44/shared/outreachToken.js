// Guided conversation outreach: the link token. Pure apart from Web Crypto (available in Deno and node).
// 32 random bytes, shown once in the link (base64url, 43 characters), stored only as SHA-256 hex in OutreachRequest.token_hash.
// access_token stays empty on conversation requests, so the classic portal can never open them.

const B64URL = /^[A-Za-z0-9_-]{43}$/;

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new link token: 32 random bytes as base64url. */
export function newToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return b64url(bytes);
}

/** Shape check before any lookup, so junk never reaches the database. */
export const looksLikeToken = (t) => typeof t === 'string' && B64URL.test(t);

/** SHA-256 of the token as lower-case hex. */
export async function hashToken(token) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deadline from now (days) and the moment the link stops working (deadline + grace days). ISO strings. */
export function linkDates(now, deadlineDays, graceDays) {
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  const day = 24 * 60 * 60 * 1000;
  const deadline = new Date(t + Math.max(1, Number(deadlineDays) || 14) * day);
  const expires = new Date(deadline.getTime() + Math.max(0, Number(graceDays) || 0) * day);
  return { deadline: deadline.toISOString(), token_expires_at: expires.toISOString() };
}

/**
 * What a link may still do: 'valid' (open and answer), 'submitted' (open read-only, second round later), 'expired', 'cancelled'.
 * A submitted conversation stays reachable after its deadline, so the client can read the thread and answer staff questions.
 */
export function linkState(request, conversation, now = Date.now()) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const status = conversation?.status || request?.status;
  if (status === 'Cancelled') return 'cancelled';
  if (status === 'Submitted' || conversation?.submitted_at) return 'submitted';
  const exp = Date.parse(conversation?.token_expires_at || request?.token_expires_at || '');
  if (status === 'Expired' || (Number.isFinite(exp) && t > exp)) return 'expired';
  return 'valid';
}

/**
 * Counts failed link attempts per key (client IP, hash prefix) in a sliding window. In memory per function instance:
 * defence in depth on top of 256-bit tokens. now() is injectable for tests.
 */
export function createAttemptLimiter({ max = 20, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();
  const prune = (k) => {
    const cut = now() - windowMs;
    const list = (hits.get(k) || []).filter((x) => x > cut);
    if (list.length) hits.set(k, list); else hits.delete(k);
    return list;
  };
  return {
    blocked: (key) => !!key && prune(key).length >= max,
    fail: (key) => { if (!key) return; const l = prune(key); l.push(now()); hits.set(key, l); },
    size: () => hits.size,
  };
}
