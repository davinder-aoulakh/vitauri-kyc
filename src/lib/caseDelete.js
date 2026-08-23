import { base44 } from '@/api/base44Client';

/**
 * Permanently deletes a KYC case and its related records.
 * Order: AuditEvent (kept) → cascade related → KycCase last.
 */
export async function deleteCase(kycCase, currentUser) {
  // 1. Log audit event BEFORE deletion (append-only, intentionally kept)
  await base44.entities.AuditEvent.create({
    tenant_id:     kycCase.tenant_id,
    case_id:       kycCase.id,
    client_id:     kycCase.client_id,
    actor_user_id: currentUser?.id,
    actor_name:    currentUser?.full_name,
    actor_type:    'User',
    event_type:    'case_record_deleted',
    notes:         `Permanent deletion of case by Tenant Admin. Case type: ${kycCase.case_type}. Status at deletion: ${kycCase.status}. Related records (ScreeningHit, ControlMeasure, KycReport, OutreachRequest) cascade-deleted.`,
    is_override:   true,
  });

  // 2. Cascade delete related records (Documents stay — case_id is nullable on Document)
  await Promise.all([
    base44.entities.ScreeningHit.deleteMany({ case_id: kycCase.id }),
    base44.entities.ControlMeasure.deleteMany({ case_id: kycCase.id }),
    base44.entities.KycReport.deleteMany({ case_id: kycCase.id }),
    base44.entities.OutreachRequest.deleteMany({ case_id: kycCase.id }),
  ]);

  // 3. Delete the case itself last
  await base44.entities.KycCase.delete(kycCase.id);
}