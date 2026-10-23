// Human-readable TM alert references: AL-<year>-<seq>, per tenant and year (same pattern as nextCaseRef / nextReportRef).
const asList = (res) => (Array.isArray(res) ? res : (res?.items || []));

export async function nextAlertRef(E, tenantId, at = new Date()) {
  const prefix = `AL-${new Date(at).getUTCFullYear()}-`;
  const last = asList(await E.TmAlert.filter({ tenant_id: tenantId, ref: { $regex: `^${prefix}` } }, '-ref', 1))[0];
  const n = last?.ref ? parseInt(last.ref.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(4, '0')}`;
}

/** Best effort: an alert is never blocked by a reference failure. */
export async function safeAlertRef(E, tenantId) {
  try { return await nextAlertRef(E, tenantId); } catch { return undefined; }
}
