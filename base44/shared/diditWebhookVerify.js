/**
 * Didit webhook signature verification (X-Signature-V2).
 * Canonicalisation: shortenFloats -> sortKeys -> JSON.stringify (unescaped Unicode) -> HMAC-SHA256.
 */

export function shortenFloats(v) {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shortenFloats(x)]));
  }
  if (typeof v === 'number' && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
  return v;
}

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => {
      acc[k] = sortKeys(v[k]);
      return acc;
    }, {});
  }
  return v;
}

export function canonicalize(parsedBody) {
  return JSON.stringify(sortKeys(shortenFloats(parsedBody)));
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/** Computes the hex HMAC-SHA256 signature for a raw JSON body string using Web Crypto. */
export async function computeDiditSignature(rawBody, secret) {
  const parsed = JSON.parse(rawBody);
  const canonical = canonicalize(parsed);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Verifies a raw JSON body string against the X-Signature-V2 header value. */
export async function verifyDiditSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = await computeDiditSignature(rawBody, secret);
  return constantTimeEqual(expected, signature);
}

/** Timestamp freshness check — rejects deliveries older/newer than 300s. */
export function isTimestampFresh(timestampHeader, toleranceSeconds = 300) {
  const ts = Number(timestampHeader);
  if (!ts || Number.isNaN(ts)) return false;
  return Math.abs(Date.now() / 1000 - ts) <= toleranceSeconds;
}