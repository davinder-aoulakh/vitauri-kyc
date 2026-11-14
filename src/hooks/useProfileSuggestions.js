import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { getNestedValue, buildFieldUpdatePayload } from '@/lib/clientNameUtils';
import { upsertRelatedParty } from '@/lib/relatedPartyUpsert';
import { loadSuggestions, patchSuggestions } from '@/lib/profileSuggestionsStore';

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
  primary_contact_email: 'Email Address',
  primary_contact_phone: 'Phone Number',
};
export const ORG_FIELD_LABELS = {
  full_name:           'Legal Entity Name',
  legal_form:          'Legal Form',
  registration_number: 'Registration Number',
  registered_country:  'Registered Country',
  registered_address:  'Registered Address',
  sector:              'Sector / Industry',
  lei_code:            'LEI Code',
  business_activity:   'Business Activity',
  nature_of_business_code: 'Nature of Business Code',
  primary_contact_email: 'Email Address',
  primary_contact_phone: 'Phone Number',
};

const partyKey = (r) => `${String(r?.full_name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(r?.date_of_birth || '').slice(0, 10)}`;
// Updates one related-party row in the latest suggestions: by person (name + DOB), else by position.
function markParty(latest, rp, rpIndex, patch) {
  const list = [...(latest.related_parties || [])];
  let i = rp ? list.findIndex((r) => partyKey(r) === partyKey(rp)) : -1;
  if (i < 0) i = rpIndex;
  if (list[i]) list[i] = { ...list[i], ...patch };
  return { ...latest, related_parties: list };
}

/**
 * Shared pipeline logic for the Structured Profile Fields grid.
 * Used by OutreachStep (Step 1 — unified verification grid).
 */
export function useProfileSuggestions({ kycCase, client, currentUser, onFieldVerified, onCaseUpdate, onClientUpdate, tenant }) {
  const isOrg = client?.client_type === 'ORG';
  const fieldLabels = isOrg ? ORG_FIELD_LABELS : NP_FIELD_LABELS;

  const [suggestions, setSuggestions] = useState(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [acceptingField, setAcceptingField] = useState(null);
  const loaded = useRef(false);

  // Show the copy we were given at once, then the database copy: the prop can be stale (other cards, the
  // server pipeline and other steps change profile_suggestions too).
  useEffect(() => {
    if (kycCase?.profile_suggestions) setSuggestions(kycCase.profile_suggestions);
    loaded.current = true;
    let alive = true;
    loadSuggestions(kycCase?.id).then((fresh) => {
      if (!alive) return;
      if (fresh) {
        setSuggestions(fresh);
        onCaseUpdate?.(prev => (prev ? { ...prev, profile_suggestions: fresh } : prev));
      }
      autoRunIfNeeded(fresh || kycCase?.profile_suggestions || null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [kycCase?.id]);

  // The client as last written by this hook. Payloads for nested fields (residential_address.*) are built from it,
  // so accepting the street and then the city keeps both (the prop can lag behind our own writes).
  const liveClient = useRef(client);
  useEffect(() => { liveClient.current = client; }, [client]);
  async function writeClient(patch) {
    await base44.entities.Client.update(client.id, patch);
    liveClient.current = { ...(liveClient.current || {}), ...patch };
    onClientUpdate?.(patch);
  }

  // Field-level change on the latest saved suggestions (never a whole stale copy)
  async function applyPatch(change) {
    const next = await patchSuggestions(kycCase.id, change);
    setSuggestions(next);
    onCaseUpdate?.(prev => (prev ? { ...prev, profile_suggestions: next } : prev));
    return next;
  }

  async function runPipeline(forceOsint = false, { silent = false } = {}) {
    if (silent) setAutoRunning(true); else setPipelineRunning(true);
    try {
      const res = await base44.functions.invoke('buildProfileSuggestions', {
        case_id:             kycCase.id,
        client_id:           kycCase.client_id,
        client_type:         client?.client_type,
        force_osint_refresh: forceOsint,
        ...(silent ? { skip_osint: true } : {}),
      });
      const data = res?.data ?? res;
      if (data?.suggestion) {
        setSuggestions(data.suggestion);
        onCaseUpdate?.(prev => (prev ? { ...prev, profile_suggestions: data.suggestion } : prev));
      }
    } catch (err) {
      console.error('Pipeline error:', err);
    } finally {
      setPipelineRunning(false);
      setAutoRunning(false);
    }
  }

  // Automatic run: when the client has answered outreach items that the last run has not seen (or there was no full
  // run yet), the pipeline runs once in the background, without a web search. Analyst decisions are kept by the pipeline.
  const autoRanFor = useRef(null);
  async function autoRunIfNeeded(current) {
    if (!kycCase?.id || !client?.id || autoRanFor.current === kycCase.id) return;
    autoRanFor.current = kycCase.id;
    try {
      const reqs = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
      const answered = (reqs || []).reduce((n, r) => n + (r.items || []).filter(i => i.status !== 'Requested' && (i.response_text || i.file_url)).length, 0);
      const seen = current?.run_at ? current?.sources_summary?.outreach_answers : null;
      if (answered > 0 && seen !== answered) await runPipeline(false, { silent: true });
    } catch { /* the manual button remains */ }
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
    const before = { [fieldKey]: getNestedValue(liveClient.current, fieldKey) || null };
    const after  = { [fieldKey]: suggestion.value };

    await writeClient(buildFieldUpdatePayload(liveClient.current, fieldKey, suggestion.value));
    await markFieldApplied(fieldKey, suggestion);

    await applyPatch({ fields: { [fieldKey]: { ...suggestion, status: 'confirmed' } } });

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
    await applyPatch({ fields: { [fieldKey]: { status: 'rejected' } } });

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
    const before = { [fieldKey]: getNestedValue(liveClient.current, fieldKey) || null };
    const after  = { [fieldKey]: value };
    const existingSuggestion = suggestions?.client_fields?.[fieldKey];
    await writeClient(buildFieldUpdatePayload(liveClient.current, fieldKey, value));
    await markFieldApplied(fieldKey, existingSuggestion);
    await applyPatch({ fields: { [fieldKey]: { value, confidence: 100, source_type: 'manual', source_ref: 'Analyst manual entry', status: 'confirmed', conflict_note: null } } });
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
    await applyPatch({ fields: { [fieldKey]: { status: 'info_requested' } } });
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
    await applyPatch({ fields: { [fieldKey]: { status: 'suggested' } } });
  }

  async function acceptAllHighConfidence() {
    if (!suggestions?.client_fields) return;
    const toAccept = Object.entries(suggestions.client_fields).filter(([, s]) => {
      return s.status === 'suggested' && s.confidence >= CONFIDENCE_THRESHOLD && s.value;
    });
    if (toAccept.length === 0) return;

    let clientUpdates = {};
    const fieldUpdates = {};
    const beforeValues = Object.fromEntries(toAccept.map(([fieldKey]) => [fieldKey, getNestedValue(liveClient.current, fieldKey) || null]));

    for (const [fieldKey, s] of toAccept) {
      clientUpdates = { ...clientUpdates, ...buildFieldUpdatePayload({ ...liveClient.current, ...clientUpdates }, fieldKey, s.value) };
      fieldUpdates[fieldKey] = { ...s, status: 'confirmed' };
    }

    await writeClient(clientUpdates);
    await applyPatch({ fields: fieldUpdates });

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
        before_state:  { [fieldKey]: beforeValues[fieldKey] },
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
    const before = { [fieldKey]: getNestedValue(liveClient.current, fieldKey) || null };
    await writeClient(buildFieldUpdatePayload(liveClient.current, fieldKey, suggestion.value));
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

  // Adds the party, or — when it is already linked — applies only the differing values (acceptFields). Never duplicates.
  async function acceptRelatedParty(rpIndex, rp, acceptFields) {
    const { rp: rpRecord } = await upsertRelatedParty({
      tenant, tenantId: kycCase.tenant_id, clientId: kycCase.client_id, caseId: kycCase.id, currentUser,
      candidate: { ...rp, source_type: rp.source_type || rp.fields?.full_name?.source_type || 'document' },
      matchRpId: rp.match_rp_id || rp.rp_id || null,
      acceptFields: acceptFields || (rp.diffs && Object.keys(rp.diffs).length ? Object.keys(rp.diffs) : undefined),
    });

    await applyPatch({ merge: (latest) => markParty(latest, rp, rpIndex, { status: 'confirmed', rp_id: rpRecord.id, match_rp_id: rpRecord.id, match_status: 'matched', diffs: {} }) });

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
    const rp = suggestions?.related_parties?.[rpIndex];
    await applyPatch({ merge: (latest) => markParty(latest, rp, rpIndex, { status: 'rejected' }) });
  }

  const clientFields = suggestions?.client_fields || {};
  const fieldKeys = Object.keys(fieldLabels);
  const confirmed = fieldKeys.filter(k => clientFields[k]?.status === 'confirmed').length;
  // On file: the client record already holds a value and there is no open suggestion for the field
  const hasOnFile = (k) => { const v = getNestedValue(liveClient.current || client, k); return v != null && String(v).trim() !== '' && v !== 'null'; };
  const OPEN = ['suggested', 'low_confidence', 'conflict', 'info_requested'];
  const complete = fieldKeys.filter(k => clientFields[k]?.status === 'confirmed' || (hasOnFile(k) && !OPEN.includes(clientFields[k]?.status))).length;
  const conflicts = fieldKeys.filter(k => clientFields[k]?.status === 'conflict').length;
  const pending   = fieldKeys.filter(k => ['suggested', 'low_confidence'].includes(clientFields[k]?.status)).length;
  const highConfPending = fieldKeys.filter(k => clientFields[k]?.status === 'suggested' && clientFields[k]?.confidence >= CONFIDENCE_THRESHOLD).length;

  return {
    isOrg, fieldLabels, fieldKeys, clientFields,
    suggestions, pipelineRunning, autoRunning, acceptingField,
    confirmed, complete, conflicts, pending, highConfPending,
    runPipeline, acceptField, rejectField, handleManualEdit,
    markInfoRequested, reopenField, acceptAllHighConfidence,
    acceptRelatedParty, rejectRelatedParty, reapplyField,
  };
}