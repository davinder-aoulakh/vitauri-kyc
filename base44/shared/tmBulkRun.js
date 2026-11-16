// Shared by bulkImportStatements and resolveUnmatchedStatement: run one account's statement through the normal
// upload path (parseStatement, then commitStatement when nothing needs a person). Never throws.
import { invokeNext } from './tmAuth.js';
import { autoCommittable } from './tmBulkImport.js';

const msg = (e) => String(e?.response?.data?.error || e?.data?.error || e?.message || e).slice(0, 300);

export async function runStatement(ctx, { clientId, accountId, iban, fileUrl, fileName, asOf }) {
  const { base44, E, auth, tenantId } = ctx;
  const asOfArg = asOf ? { as_of: asOf } : {};
  let upload = null;
  try {
    upload = await E.StatementUpload.create({
      tenant_id: tenantId, client_id: clientId, bank_account_id: accountId, file_url: fileUrl, file_name: fileName,
      account_filter: iban, status: 'uploaded', uploaded_by_user_id: auth.actorUserId,
    });
    const parsed = await invokeNext(base44, auth, 'parseStatement', { statement_upload_id: upload.id, ...asOfArg });
    if (parsed?.error) return { outcome: 'failed', statement_upload_id: upload.id, error: String(parsed.error).slice(0, 300) };
    if (!autoCommittable(parsed)) {
      return {
        outcome: 'needs_review', statement_upload_id: upload.id, extracted: parsed.extracted_count || 0, duplicates: parsed.duplicates_removed || 0,
        reason: (parsed.blocking || []).length ? 'A blocking check needs a decision' : 'The balance does not reconcile',
      };
    }
    const done = await invokeNext(base44, auth, 'commitStatement', { statement_upload_id: upload.id, ...asOfArg });
    if (done?.error) return { outcome: 'needs_review', statement_upload_id: upload.id, extracted: parsed.extracted_count || 0, reason: String(done.error).slice(0, 300) };
    return {
      outcome: 'processed', statement_upload_id: upload.id, accepted: done.accepted || 0, duplicates: done.duplicates || 0,
      historical: done.historical || 0, recent: done.recent || 0, alerts: (done.alerts || []).length,
      change_of_circumstances: (done.change_of_circumstances || []).length,
    };
  } catch (e) {
    return { outcome: upload ? 'needs_review' : 'failed', statement_upload_id: upload?.id || null, ...(upload ? { reason: msg(e) } : { error: msg(e) }) };
  }
}
