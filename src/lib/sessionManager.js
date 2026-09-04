/**
 * Session Manager — handles 8-hour inactivity expiry + keep-me-signed-in + 5-min warning toast
 * Uses localStorage to track last-activity and session mode.
 */

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;           // 15 minutes
const EXTENDED_LIMIT_MS   = 30 * 24 * 60 * 60 * 1000; // 30 days
const WARNING_BEFORE_MS   = 5 * 60 * 1000;             // 5 minutes
const ACTIVITY_KEY        = 'vitauri_last_activity';
const EXTENDED_KEY        = 'vitauri_keep_signed_in';

export function recordActivity() {
  localStorage.setItem(ACTIVITY_KEY, Date.now().toString());
}

export function setKeepSignedIn(value) {
  localStorage.setItem(EXTENDED_KEY, value ? '1' : '0');
  recordActivity();
}

export function getKeepSignedIn() {
  return localStorage.getItem(EXTENDED_KEY) === '1';
}

export function getSessionLimit() {
  return getKeepSignedIn() ? EXTENDED_LIMIT_MS : INACTIVITY_LIMIT_MS;
}

export function getLastActivity() {
  const v = localStorage.getItem(ACTIVITY_KEY);
  return v ? parseInt(v, 10) : 0; // 0 = treat as expired if no record exists
}

export function getTimeUntilExpiry() {
  const limit = getSessionLimit();
  const last  = getLastActivity();
  return Math.max(0, last + limit - Date.now());
}

export function isSessionExpired() {
  return getTimeUntilExpiry() === 0;
}

export function isSessionAboutToExpire() {
  const t = getTimeUntilExpiry();
  return t > 0 && t <= WARNING_BEFORE_MS;
}

// Wire up activity events
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

export function startActivityTracking() {
  recordActivity();
  ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, recordActivity, { passive: true }));
}

export function stopActivityTracking() {
  ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, recordActivity));
}

export function clearSession() {
  localStorage.removeItem(ACTIVITY_KEY);
  localStorage.removeItem(EXTENDED_KEY);
}