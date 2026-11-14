// Submission order for Didit (phase 3): velocity rules depend on it, so one customer's transactions go in the order
// they were executed, one after another. Different customers can still be sent side by side. Pure.
const time = (t) => { const n = Date.parse(t?.executed_at); return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER; };

/** [[txn, txn, …] per client], each list sorted by executed_at (ties keep the given order). */
export function submissionGroups(txns) {
  const by = new Map();
  (txns || []).forEach((t, i) => { if (!by.has(t.client_id)) by.set(t.client_id, []); by.get(t.client_id).push({ t, i }); });
  return [...by.values()].map((list) => list.sort((a, b) => time(a.t) - time(b.t) || a.i - b.i).map((x) => x.t));
}
