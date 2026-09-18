/**
 * ProfileVerificationStep — dedicated step shown right after Outreach & Documents.
 * Wraps the shared ProfileVerificationSection grid; keeps matching OutreachRequest
 * items in sync (marks them Verified) and hands "email client" requests back to
 * the Outreach step where the outreach builder lives.
 */
import React from 'react';
import { base44 } from '@/api/base44Client';
import ProfileVerificationSection from '@/components/case/outreach/ProfileVerificationSection';
import { isFieldMappedLabel } from '@/lib/outreachFieldMatch';

export default function ProfileVerificationStep({ kycCase, client, currentUser, onCaseUpdate, onNavigateToStep, onAddNote }) {
  async function handleFieldVerified(fieldKey, fieldLabel) {
    if (!fieldLabel || !kycCase?.id) return;
    const reqs = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
    const updates = [];
    for (const req of (reqs || [])) {
      let changed = false;
      const updatedItems = (req.items || []).map(item => {
        if (item.status !== 'Verified' && isFieldMappedLabel(item.label, { [fieldKey]: fieldLabel })) {
          changed = true;
          return { ...item, status: 'Verified' };
        }
        return item;
      });
      if (changed) updates.push(base44.entities.OutreachRequest.update(req.id, { items: updatedItems }));
    }
    if (updates.length > 0) await Promise.all(updates);
  }

  function handleRequestInfoEmail(fieldLabel) {
    onAddNote?.(`[Profile Verification] Clarification needed for "${fieldLabel}" — create an outreach request on the Outreach & Documents step.`);
    onNavigateToStep?.(1);
  }

  return (
    <ProfileVerificationSection
      kycCase={kycCase}
      client={client}
      currentUser={currentUser}
      onFieldVerified={handleFieldVerified}
      onRequestInfoEmail={handleRequestInfoEmail}
      onAddNote={onAddNote}
      onCaseUpdate={onCaseUpdate}
    />
  );
}