/**
 * Security utilities:
 * - Virus scan stub (flags for ClamAV integration)
 * - Rate limiting (portal upload counter, session-scoped)
 * - Signed URL wrapper (delegates to Core.CreateFileSignedUrl)
 */

import { base44 } from '@/api/base44Client';

// ─── Upload rate limiting ─────────────────────────────────────────────────────

const SESSION_KEY = 'vitauri_upload_count';
const MAX_UPLOADS_PER_SESSION = 10;

export function getSessionUploadCount() {
  return parseInt(sessionStorage.getItem(SESSION_KEY) || '0', 10);
}

export function incrementSessionUploadCount() {
  const n = getSessionUploadCount() + 1;
  sessionStorage.setItem(SESSION_KEY, String(n));
  return n;
}

export function checkUploadRateLimit() {
  const count = getSessionUploadCount();
  if (count >= MAX_UPLOADS_PER_SESSION) {
    throw new Error(`Upload limit reached (max ${MAX_UPLOADS_PER_SESSION} per session). Please contact your relationship manager.`);
  }
}

// ─── Virus scan stub ──────────────────────────────────────────────────────────

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.jar', '.msi', '.dll'];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * Client-side virus scan stub.
 * - Blocks dangerous file extensions
 * - Enforces max file size
 * - Returns { safe: boolean, reason: string | null }
 *
 * Note: For production, wire server-side ClamAV scan via a backend function
 * that accepts the file_url and returns a scan result before ingesting the file.
 */
export function virusScanStub(file) {
  if (!file) return { safe: false, reason: 'No file provided.' };

  // Size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { safe: false, reason: `File too large (max 25MB). Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB.` };
  }

  // Extension check
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { safe: false, reason: `File type not allowed: ${ext}` };
  }

  // MIME type check (basic)
  const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (file.type && !ALLOWED_MIME.some(m => file.type.startsWith(m.split('/')[0]) || file.type === m)) {
    // Only block clearly dangerous types; allow unknown MIME types through (they pass extension check)
    const BLOCKED_MIME = ['application/x-executable', 'application/x-sh', 'text/x-script'];
    if (BLOCKED_MIME.some(m => file.type.startsWith(m))) {
      return { safe: false, reason: `MIME type not allowed: ${file.type}` };
    }
  }

  // STUB: In production, this would trigger an async ClamAV scan via backend function
  // e.g.: await base44.functions.invoke('clamAvScan', { file_url })
  // For now, mark as pending_scan — file is accepted but flagged for async verification
  return { safe: true, reason: null, pendingScan: true };
}

// ─── Secure file upload with all checks ──────────────────────────────────────

/**
 * Performs: rate limit check → virus scan → upload → returns file_url
 * Use this in all internal (analyst) upload flows.
 */
export async function secureUpload(file, options = {}) {
  const { enforceRateLimit = false } = options;

  if (enforceRateLimit) {
    checkUploadRateLimit();
  }

  const scan = virusScanStub(file);
  if (!scan.safe) {
    throw new Error(scan.reason);
  }

  const { file_url } = await base44.integrations.Core.UploadFile({ file });

  if (enforceRateLimit) {
    incrementSessionUploadCount();
  }

  return file_url;
}

/**
 * Portal upload: enforces rate limit + virus scan
 */
export async function portalSecureUpload(file) {
  return secureUpload(file, { enforceRateLimit: true });
}

// ─── Signed URL ───────────────────────────────────────────────────────────────

/**
 * Get a 1-hour signed URL for a private file.
 * Use this instead of exposing raw file_urls in the UI.
 */
export async function getSignedUrl(fileUri, expiresIn = 3600) {
  if (!fileUri) return null;
  // If it's already a public URL (uploaded via UploadFile, not UploadPrivateFile),
  // return as-is — those are CDN-hosted and not sensitive.
  if (fileUri.startsWith('http')) return fileUri;
  const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: expiresIn });
  return signed_url;
}