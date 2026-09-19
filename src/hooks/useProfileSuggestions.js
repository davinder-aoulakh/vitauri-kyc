import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { getNestedValue, buildFieldUpdatePayload } from '@/lib/clientNameUtils';

export const CONFIDENCE_THRESHOLD = 70;

export const NP_FIELD_LABELS = {
  full_name:           'Full Name',
  first_names:         'First Names',
  last_name:           'Last Name',
  initials:            'Initials',
  preferred_name:      'Preferred Name',
  gender:              'Gender',
  date_of_birth:       'Date of Birth',
  country_of_birth:    'Country of Birth',
  place_of_birth:      'Place of Birth',
  nationality:         'Nationality',
  country_of_residence:'Country of Residence',
  id_type:             'ID Type',
  id_number:           'ID Number',
  'residential_address.country': 'Residential Address — Country',
  'residential_address.street':  'Residential Address — Street',
  'residential_address.number':  'Residential Address — Number',
  'residential_address.zipcode': 'Residential Address — Zipcode',
  'residential_address.city':    'Residential Address — City',
};
export const ORG_FIELD_LABELS = {
  full_name:           'Legal Entity Name',
  legal_form:          'Legal Form',
  registration_number: 'Registration Number',
  registered_country:  'Registered Country',
  registered_address:  'Registered Address',
  sector:              'Sector / Industry',
  lei_code:            'LEI Code',
};

/**
 * Shared pipeline logic for the Structured Profile Fields grid.
 * Used by OutreachStep (Step 1 — unified verification grid).
 */
export function useProfileSuggestions({ kycCase, client, currentUser, onFieldVerified, onCaseUpdate }) {
  const isOrg = client?.client_type === 'ORG';
  const fieldLabels = isOrg ? ORG_FIELD_LABELS : NP_FIELD_LABELS;

  const [suggestions, setSuggestions] = useState(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [acceptingField, setAcceptingField] = useState(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (kycCase?.profile_suggestions) setSuggestions(kycCase.profile_suggestions);
    loaded.current = true;
  }, [kycCase?.id]);

  async function runPipeline(forceOsint = false) {
    setPipelineRunning(true);
    try {
      const res = await base44.functions.invoke('buildProfileSuggestions', {
        case_id:             kycCase.id,
        client_id:           kycCase.client_id,
        client_type:         client?.client_type,
        force_osint_refresh: forceOsint,
      });
      const data = res?.data ?? res;
      if (data?.suggestion) setSuggestions(data.suggestion);
    } catch (err) {
      console.error('Pipeline error:', err);
    } finally {
      setPipelineRunning(false);
    }
  }

  async function saveSuggestions(updated) {
    setSuggestions(updated);
    await base44.entities.KycCase.update(kycCase.id, { profile_suggestions: updated });
    // Keep the parent's kycCase in sync — otherwise re-mounting this step (e.g. switching
    // tabs and back) re-initialises from a stale kycCase.profile_suggestions and the run
    // appears to have been lost.
    onCaseUpdate?.(prev => (prev ? { ...prev, profile_suggestions: updated } : prev));
  }

  // Marks a field key as applied on the source outreach item that produced it, so the
  // pipeline emits it as 'confirmed' (instead of re-prompting) on the next re-run.
  // No-op when the suggestion didn't come from a trackable IDV-extraction source.
  async function markFieldApplied(fieldKey, suggestion) {
    if (!suggestion?.source_request_id || !suggestion?.source_item_id) return;
    try {
      const reqs = await base44.entities.OutreachRequest.filter({ id: suggestion.source_request_id });
      const outreachReq = reqs?.[0];
      if (!outreachReq) return;
      const items = (outreachReq.items || []).map(it => {
        if (it.item_id !== suggestion.source_item_id) return it;
        const applied = new Set(it.idv_profile_applied_fields || []);
        applied.add(fieldKey);
        return { ...it, idv_profile_applied_fields: [...applied] };
      });
      await base44.entities.OutreachRequest.update(outreachReq.id, { items });
    } catch (err) {
      console.error('Failed to mark field applied:', err);
    }
  }

  async function acceptField(fieldKey, suggestion) {
    setAcceptingField(fieldKey);
    const before = { [fieldKey]: getNestedValue(client, fieldKey) || null };
    const after  = { [fieldKey]: suggestion.value };

    await base44.entities.Client.update(client.id, buildFieldUpdatePayload(client, fieldKey, suggestion.value));
    await markFieldApplied(fieldKey, suggestion);

    const updated = {
      ...suggestions,
      client_fields: {
        ...suggestions.client_fields,
        [fieldKey]: { ...suggestion, status: 'confirmed' },
      },
    };
    await saveSuggestions(updated);

    await base44.entities.AuditEvent.create({
      tenant_id:      kycCase.tenant_id,
      case_id:        kycCase.id,
      client_id:      kycCase.client_id,
      actor_user_id:  currentUser?.id,
      actor_name:     currentUser?.full_name,
      actor_type:     'User',
      event_type:     'profile_field_confirmed',
      before_state:   before,
      after_state:    after,
      notes:          `field=${fieldKey} source=${suggestion.source_type}:${suggestion.source_ref} confidence=${suggestion.confidence}%`,
    });
    onFieldVerified?.(fieldKey, fieldLabels[fieldKey]);
    setAcceptingField(null);
  }

  async function rejectField(fieldKey) {
    const updated = {
      ...suggestions,
      client_fields: {
        ...suggestions.client_fields,
        [fieldKey]: { ...(suggestions.client_fields[fieldKey] || {}), status: 'rejected' },
      },
    };
    await saveSuggestions(updated);

    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_field_rejected',
      notes:         `field=${fieldKey} reason=analyst kept existing value`,
    });
    onFieldVerified?.(fieldKey, fieldLabels[fieldKey]);
  }

  async function handleManualEdit(fieldKey, value) {
    const before = { [fieldKey]: getNestedValue(client, fieldKey) || null };
    const after  = { [fieldKey]: value };
    const existingSuggestion = suggestions?.client_fields?.[fieldKey];
    await base44.entities.Client.update(client.id, buildFieldUpdatePayload(client, fieldKey, value));
    await markFieldApplied(fieldKey, existingSuggestion);
    const updated = {
      ...suggestions,
      client_fields: {
        ...(suggestions?.client_fields || {}),
        [fieldKey]: { value, confidence: 100, source_type: 'manual', source_ref: 'Analyst manual entry', status: 'confirmed', conflict_note: null },
      },
    };
    await saveSuggestions(updated);
    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_field_confirmed',
      before_state:  before,
      after_state:   after,
      notes:         `field=${fieldKey} source=manual confidence=100%`,
    });
    onFieldVerified?.(fieldKey, fieldLabels[fieldKey]);
  }

  // ── Amber — Request Info ────────────────────────────────────────────────────
  async function markInfoRequested(fieldKey) {
    const updated = {
      ...suggestions,
      client_fields: {
        ...(suggestions?.client_fields || {}),
        [fieldKey]: { ...(suggestions.client_fields[fieldKey] || {}), status: 'info_requested' },
      },
    };
    await saveSuggestions(updated);
    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_field_info_requested',
      notes:         `field=${fieldKey} flagged for internal review by ${currentUser?.full_name}`,
    });
  }

  async function reopenField(fieldKey) {
    const updated = {
      ...suggestions,
      client_fields: {
        ...suggestions.client_fields,
        [fieldKey]: { ...(suggestions.client_fields[fieldKey] || {}), status: 'suggested' },
      },
    };
    await saveSuggestions(updated);
  }

  async function acceptAllHighConfidence() {
    if (!suggestions?.client_fields) return;
    const toAccept = Object.entries(suggestions.client_fields).filter(([, s]) => {
      return s.status === 'suggested' && s.confidence >= CONFIDENCE_THRESHOLD && s.value;
    });
    if (toAccept.length === 0) return;

    let clientUpdates = {};
    const fieldUpdates = { ...suggestions.client_fields };

    for (const [fieldKey, s] of toAccept) {
      clientUpdates = { ...clientUpdates, ...buildFieldUpdatePayload({ ...client, ...clientUpdates }, fieldKey, s.value) };
      fieldUpdates[fieldKey] = { ...s, status: 'confirmed' };
    }

    await base44.entities.Client.update(client.id, clientUpdates);
    const updated = { ...suggestions, client_fields: fieldUpdates };
    await saveSuggestions(updated);

    for (const [fieldKey, s] of toAccept) {
      await markFieldApplied(fieldKey, s);
      await base44.entities.AuditEvent.create({
        tenant_id:     kycCase.tenant_id,
        case_id:       kycCase.id,
        client_id:     kycCase.client_id,
        actor_user_id: currentUser?.id,
        actor_name:    currentUser?.full_name,
        actor_type:    'User',
        event_type:    'profile_field_confirmed',
        before_state:  { [fieldKey]: getNestedValue(client, fieldKey) || null },
        after_state:   { [fieldKey]: s.value },
        notes:         `field=${fieldKey} source=${s.source_type}:${s.source_ref} confidence=${s.confidence}% (batch accept)`,
      });
      onFieldVerified?.(fieldKey, fieldLabels[fieldKey]);
    }
  }

  // Re-writes the retained extracted value to the client profile without changing status —
  // used when the analyst wants to force-sync a field that's already marked 'confirmed'.
  async function reapplyField(fieldKey) {
    const suggestion = suggestions?.client_fields?.[fieldKey];
    if (!suggestion?.value) return;
    const before = { [fieldKey]: getNestedValue(client, fieldKey) || null };
    await base44.entities.Client.update(client.id, buildFieldUpdatePayload(client, fieldKey, suggestion.value));
    await markFieldApplied(fieldKey, suggestion);
    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_field_reapplied',
      before_state:  before,
      after_state:   { [fieldKey]: suggestion.value },
      notes:         `field=${fieldKey} re-applied from ${suggestion.source_type}:${suggestion.source_ref}`,
    });
    onFieldVerified?.(fieldKey, fieldLabels[fieldKey]);
  }

  async function acceptRelatedParty(rpIndex, rp) {
    const rpRecord = await base44.entities.RelatedParty.create({
      tenant_id:            kycCase.tenant_id,
      party_type:           rp.party_type || 'NP',
      full_name:            rp.full_name,
      role_in_relationship: rp.role_in_relationship,
      ownership_percentage: rp.ownership_percentage ? Number(rp.ownership_percentage) : undefined,
      verification_status:  'Unverified',
    });

    await base44.entities.ClientRelatedPartyLink.create({
      tenant_id:        kycCase.tenant_id,
      client_id:        kycCase.client_id,
      related_party_id: rpRecord.id,
      role:             rp.role_in_relationship,
      ownership_percentage: rp.ownership_percentage ? Number(rp.ownership_percentage) : undefined,
      added_by_user_id: currentUser?.id,
    });

    const updatedRps = (suggestions.related_parties || []).map((r, i) =>
      i === rpIndex ? { ...r, status: 'confirmed', rp_id: rpRecord.id } : r
    );
    const updated = { ...suggestions, related_parties: updatedRps };
    await saveSuggestions(updated);

    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'profile_related_party_added',
      after_state:   { full_name: rp.full_name, role: rp.role_in_relationship, related_party_id: rpRecord.id },
      notes:         `Related party confirmed: ${rp.full_name} (${rp.role_in_relationship}) from source ${rp.fields?.full_name?.source_ref || 'unknown'}`,
    });
  }

  async function rejectRelatedParty(rpIndex) {
    const updatedRps = (suggestions.related_parties || []).map((r, i) =>
      i === rpIndex ? { ...r, status: 'rejected' } : r
    );
    const updated = { ...suggestions, related_parties: updatedRps };
    await saveSuggestions(updated);
  }

  const clientFields = suggestions?.client_fields || {};
  const fieldKeys = Object.keys(fieldLabels);
  const confirmed = fieldKeys.filter(k => clientFields[k]?.status === 'confirmed').length;
  const conflicts = fieldKeys.filter(k => clientFields[k]?.status === 'conflict').length;
  const pending   = fieldKeys.filter(k => ['suggested', 'low_confidence'].includes(clientFields[k]?.status)).length;
  const highConfPending = fieldKeys.filter(k => clientFields[k]?.status === 'suggested' && clientFields[k]?.confidence >= CONFIDENCE_THRESHOLD).length;

  return {
    isOrg, fieldLabels, fieldKeys, clientFields,
    suggestions, pipelineRunning, acceptingField,
    confirmed, conflicts, pending, highConfPending,
    runPipeline, acceptField, rejectField, handleManualEdit,
    markInfoRequested, reopenField, acceptAllHighConfidence,
    acceptRelatedParty, rejectRelatedParty, reapplyField,
  };
}