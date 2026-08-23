import { base44 } from '@/api/base44Client';

/**
 * Actively resolves any outreach items whose Didit session hasn't reached a
 * terminal idv_status yet.
 *
 * The normal completion path is entirely client-side: either the Didit
 * callback redirect (ClientPortal.jsx) or the portal widget's own polling
 * loop (IdVerificationField.jsx — 3s interval, ~6 minute cap) calls
 * getDiditSessionResult once the session finishes. Both require the
 * client's browser tab to still be open when Didit finishes processing. If
 * it isn't — tab closed early, cross-device QR flow outlasts the desktop
 * tab's polling window, etc. — the session completes on Didit's side but
 * nothing ever reads the result back, and the item stays at
 * idv_status: 'Pending' indefinitely.
 *
 * This re-runs getDiditSessionResult (the same function, same logic —
 * decision fetch, field mapping, client enrichment, document/report
 * creation) for any such item. Safe to call on every load: items already at
 * a terminal status are skipped before this is even called, and
 * getDiditSessionResult itself is a no-op (returns Pending, no writes) if
 * Didit genuinely hasn't finished yet.
 *
 * @param {Array} outreaches - OutreachRequest records to scan
 * @param {string} tenantId
 * @returns {Promise<boolean>} true if at least one item reached a terminal status
 */
export async function resolvePendingDiditSessions(outreaches, tenantId) {
  const pending = [];
  for (const req of (outreaches || [])) {
    for (const item of (req.items || [])) {
      if (item.didit_session_id && (!item.idv_status || item.idv_status === 'Pending')) {
        pending.push({ outreachId: req.id, itemId: item.item_id, sessionId: item.didit_session_id });
      }
    }
  }
  if (pending.length === 0) return false;

  const results = await Promise.all(pending.map(async ({ outreachId, itemId, sessionId }) => {
    try {
      const res = await base44.functions.invoke('getDiditSessionResult', {
        session_id: sessionId,
        outreach_id: outreachId,
        item_id: itemId,
        tenant_id: tenantId,
      });
      const data = res?.data || res;
      return !!(data?.idv_status && data.idv_status !== 'Pending');
    } catch (err) {
      console.error(`resolvePendingDiditSessions: failed for session ${sessionId}:`, err);
      return false;
    }
  }));

  return results.some(Boolean);
}
