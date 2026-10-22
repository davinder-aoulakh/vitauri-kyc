// Tenant API key helpers (generation, hashing, Bearer extraction). Plaintext keys are never stored.
import { sha256Hex } from './tmCanonical.js';

export const KEY_PREFIX_LEN = 12;

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes → 'vt_live_' + base64url. Returns { key, key_prefix, key_hash }. */
export async function generateApiKey() {
  const key = 'vt_live_' + toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { key, key_prefix: key.slice(0, KEY_PREFIX_LEN), key_hash: await sha256Hex(key) };
}

export function extractBearer(req) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export function publicKey(k) {
  return {
    id: k.id, label: k.label, key_prefix: k.key_prefix, created_date: k.created_date,
    last_used_at: k.last_used_at || null, revoked_at: k.revoked_at || null, scopes: k.scopes || ['ingest:write'],
    status: k.revoked_at ? 'revoked' : 'active',
  };
}