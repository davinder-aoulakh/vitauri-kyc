/**
 * SuggestedProfileUpdatesCard — shown in the Outreach step right after the Didit summary card.
 * Lets analysts accept Didit-extracted profile fields (name, DOB, nationality, gender, address)
 * straight from the outreach view. Fully synced with the Profile Verification grid via the
 * shared idv_profile_applied_fields marker and KycCase.profile_suggestions.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { patchSuggestions } from '@/lib/profileSuggestionsStore';
import { Button } from '@/components/ui/button';
import { Loader2, UserCheck } from 'lucide-react';
import { getNestedValue, buildFieldUpdatePayload, computeFullName } from '@/lib/clientNameUtils';
import { ISO3_MAP } from '@/lib/diditIso3Map';
import { sameProfileValue, toFileValue } from '@/lib/profileValueMatch';

// Must match buildProfileSuggestions/entry.ts exactly — shared marker + confirmed-status logic
// relies on both sides mapping Didit codes to the same client field keys/values.
function mapDiditGender(raw) {
  const v = (raw || '').toString().trim().toUpperCase();
  if (v === 'M' || v === 'MALE') return 'Male';
  if (v === 'F' || v === 'FEMALE') return 'Female';
  return 'Other';
}

const FIELD_FULL_NAME = {
  key: 'full_name', label: 'Full Name',
  extract: item => [item.idv_extracted_first_name, item.idv_extracted_last_name].filter(Boolean).join(' '),
  getCurrent: client => client?.full_name,
};
const FIELD_DOB = {
  key: 'date_of_birth', label: 'Date of Birth',
  extract: item => item.idv_extracted_dob,
  getCurrent: client => client?.date_of_birth,
};
const FIELD_NATIONALITY = {
  key: 'nationality', label: 'Nationality',
  extract: item => item.idv_extracted_nationality,
  getCurrent: client => client?.nationality,
};
const FIELD_GENDER = {
  key: 'gender', label: 'Gender',
  extract: item => item.idv_extracted_gender ? mapDiditGender(item.idv_extracted_gender) : '',
  getCurrent: client => client?.gender,
};
// The ID's issuing country is not the country of residence: it is only offered as a suggestion when the file has none.
const FIELD_ISSUING_COUNTRY = {
  key: 'country_of_residence', label: 'Country of Residence — suggested from the ID\'s issuing country', onlyWhenEmpty: true,
  extract: item => ISO3_MAP[item.idv_issuing_country] || item.idv_issuing_country || '',
  getCurrent: client => client?.country_of_residence,
};
const FIELD_ADDRESS = {
  key: 'residential_address.street', label: 'Address',
  extract: item => item.idv_extracted_address,
  getCurrent: client => getNestedValue(client, 'residential_address.street'),
};

// One Didit value against the client file:
//   same   -> nothing to decide (confirmed automatically, see the effect in the card)
//   empty  -> offered, ticked by default
//   differs-> offered with a warning, unticked
function checkRow(cfg, item, client) {
  const raw = (cfg.extract(item) || '').toString().trim();
  if (!raw) return null;
  const diditValue = toFileValue(cfg.key, raw); // countries in the app's own format, never a bare "NLD"
  const currentValue = (cfg.getCurrent(client) || '').toString().trim();
  // Already accepted or confirmed earlier: kept only for the "matches the client file" line
  if (new Set(item.idv_profile_applied_fields || []).has(cfg.key)) {
    return cfg.onlyWhenEmpty ? null : { rowKey: `${item.item_id}:${cfg.key}`, fieldKey: cfg.key, label: cfg.label, currentValue, diditValue, same: true, done: true, item };
  }
  const isEmpty = currentValue === '';
  if (cfg.onlyWhenEmpty && !isEmpty) return null;
  const same = !isEmpty && sameProfileValue(cfg.key, currentValue, raw);
  return {
    rowKey: `${item.item_id}:${cfg.key}`, fieldKey: cfg.key, label: cfg.label, currentValue, diditValue,
    defaultChecked: isEmpty && !cfg.onlyWhenEmpty, differs: !isEmpty && !same, same, suggestionOnly: !!cfg.onlyWhenEmpty, item,
  };
}

// Builds the ordered row list for one Didit item — Full Name, DOB, Nationality, Gender,
// Issuing Country (display-only), Address. Returns [] when nothing is left to accept.
function buildRowsForItem(item, client) {
  const fullNameRow = checkRow(FIELD_FULL_NAME, item, client);
  const dobRow = checkRow(FIELD_DOB, item, client);
  const nationalityRow = checkRow(FIELD_NATIONALITY, item, client);
  const genderRow = checkRow(FIELD_GENDER, item, client);
  const issuingCountryRow = checkRow(FIELD_ISSUING_COUNTRY, item, client);
  const addressRow = checkRow(FIELD_ADDRESS, item, client);

  return [fullNameRow, dobRow, nationalityRow, genderRow, issuingCountryRow, addressRow].filter(Boolean);
}

export default function SuggestedProfileUpdatesCard({ diditSummary, requests, client, kycCase, currentUser, onAccepted, onCaseUpdate, onClientUpdate }) {
  // The latest client record: nested payloads (residential_address.*) must not be built on a stale copy
  const freshClient = async () => (await base44.entities.Client.filter({ id: client.id }))?.[0] || client;
  const groups = useMemo(() => {
    if (!diditSummary?.items?.length) return [];
    return diditSummary.items
      .map(item => { const all = buildRowsForItem(item, client); return { item, rows: all.filter(r => !r.same), matched: all.filter(r => r.same) }; })
      .filter(g => g.rows.length > 0 || g.matched.length > 0);
  }, [diditSummary, client]);

  // Values that already match the client file need no decision: they are recorded as confirmed by the ID check
  // (marker on the outreach item + confirmed suggestion + one audit event). The client record is not written.
  const autoConfirmed = useRef(new Set());
  const matchSignature = groups.map(g => g.matched.filter(r => !r.done).map(r => r.rowKey).join(',')).join('|');
  useEffect(() => {
    const todo = groups.flatMap(g => g.matched).filter(r => !r.done && !autoConfirmed.current.has(r.rowKey));
    if (!todo.length || !kycCase?.id) return;
    todo.forEach(r => autoConfirmed.current.add(r.rowKey));
    (async () => {
      try {
        const byReq = {};
        for (const r of todo) {
          const reqId = r.item.outreach_id;
          byReq[reqId] = byReq[reqId] || {};
          (byReq[reqId][r.item.item_id] = byReq[reqId][r.item.item_id] || new Set()).add(r.fieldKey);
        }
        for (const [reqId, byItem] of Object.entries(byReq)) {
          // Latest copy of the request: other saves (verify, Didit result) must not be overwritten
          const req = (await base44.entities.OutreachRequest.filter({ id: reqId }))?.[0];
          if (!req) continue;
          const items = (req.items || []).map(it => {
            const add = byItem[it.item_id];
            if (!add) return it;
            return { ...it, idv_profile_applied_fields: [...new Set([...(it.idv_profile_applied_fields || []), ...add])] };
          });
          await base44.entities.OutreachRequest.update(reqId, { items });
        }
        const fields = {};
        for (const r of todo) {
          fields[r.fieldKey] = {
            value: r.currentValue, confidence: 95, status: 'confirmed', source_type: 'outreach', source_ref: `Didit IDV: ${r.item.label}`,
            conflict_note: null, applied: true, source_request_id: r.item.outreach_id, source_item_id: r.item.item_id,
          };
        }
        const profile_suggestions = await patchSuggestions(kycCase.id, { fields });
        onCaseUpdate?.((prev) => (prev ? { ...prev, profile_suggestions } : prev));
        const sessionIds = [...new Set(todo.map(r => r.item.didit_session_id).filter(Boolean))];
        await base44.entities.AuditEvent.create({
          tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: kycCase.client_id,
          actor_user_id: currentUser?.id, actor_name: currentUser?.full_name, actor_type: 'System',
          event_type: 'profile_fields_confirmed_by_idv',
          before_state: {}, after_state: { fields: todo.map(r => r.fieldKey) },
          notes: `ID verification matched the client file on ${todo.map(r => r.label).join(', ')}: confirmed, no change to the client record. Session(s): ${sessionIds.join(', ') || 'unknown'}`,
        });
        await onAccepted?.();
      } catch (e) {
        console.warn('auto-confirm of matching ID fields failed', e?.message);
        todo.forEach(r => autoConfirmed.current.delete(r.rowKey));
      }
    })();
  }, [matchSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowSignature = groups.map(g => g.rows.map(r => r.rowKey).join(',')).join('|');
  const [checked, setChecked] = useState({});
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const defaults = {};
    groups.forEach(g => g.rows.forEach(r => { if (!r.displayOnly) defaults[r.rowKey] = r.defaultChecked; }));
    setChecked(defaults);
  }, [rowSignature]);

  if (groups.length === 0) return null;
  const matchedLabels = [...new Set(groups.flatMap(g => g.matched.map(r => r.label)))];
  const openGroups = groups.filter(g => g.rows.length > 0);
  // Everything matches: one line, nothing to do
  if (openGroups.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-xs text-emerald-800">
        <UserCheck className="w-4 h-4 flex-shrink-0" />
        <span>ID verification matches the client file: {matchedLabels.join(', ')}. Nothing to update.</span>
      </div>
    );
  }

  function toggle(rowKey) {
    setChecked(prev => ({ ...prev, [rowKey]: !prev[rowKey] }));
  }

  function clearSelection() {
    const defaults = {};
    groups.forEach(g => g.rows.forEach(r => { if (!r.displayOnly) defaults[r.rowKey] = r.defaultChecked; }));
    setChecked(defaults);
  }

  async function acceptSelected() {
    const toAccept = [];
    groups.forEach(g => g.rows.forEach(r => { if (!r.displayOnly && checked[r.rowKey]) toAccept.push(r); }));
    if (toAccept.length === 0) return;

    setAccepting(true);
    try {
      // 1. Client profile write — Full Name sets first_names + last_name + full_name together
      let clientUpdates = {};
      for (const row of toAccept) {
        if (row.fieldKey === 'full_name') {
          const first = row.item.idv_extracted_first_name || '';
          const last = row.item.idv_extracted_last_name || '';
          clientUpdates = { ...clientUpdates, first_names: first, last_name: last, full_name: computeFullName(first, last) };
        } else if (row.fieldKey === 'residential_address.street') {
          clientUpdates = { ...clientUpdates, ...buildFieldUpdatePayload({ ...(await freshClient()), ...clientUpdates }, row.fieldKey, row.diditValue) };
        } else {
          clientUpdates = { ...clientUpdates, [row.fieldKey]: row.diditValue };
        }
      }
      await base44.entities.Client.update(client.id, clientUpdates);
      onClientUpdate?.(clientUpdates);

      // 2. Mark applied on each source outreach item (dedup, append-only)
      const fieldsByRequestItem = {}; // reqId -> { itemId -> Set(fieldKey) }
      for (const row of toAccept) {
        const reqId = row.item.outreach_id;
        fieldsByRequestItem[reqId] = fieldsByRequestItem[reqId] || {};
        const itemId = row.item.item_id;
        fieldsByRequestItem[reqId][itemId] = fieldsByRequestItem[reqId][itemId] || new Set();
        fieldsByRequestItem[reqId][itemId].add(row.fieldKey);
      }
      for (const [reqId, byItem] of Object.entries(fieldsByRequestItem)) {
        const req = requests.find(r => r.id === reqId);
        if (!req) continue;
        const updatedItems = req.items.map(it => {
          const toApply = byItem[it.item_id];
          if (!toApply) return it;
          const applied = new Set(it.idv_profile_applied_fields || []);
          toApply.forEach(f => applied.add(f));
          return { ...it, idv_profile_applied_fields: [...applied] };
        });
        await base44.entities.OutreachRequest.update(reqId, { items: updatedItems });
      }

      // 3. Sync KycCase.profile_suggestions so the Profile Verification grid shows confirmed
      //    without needing a pipeline re-run.
      const fieldUpdates = {};
      for (const row of toAccept) {
        fieldUpdates[row.fieldKey] = {
          value: row.diditValue,
          confidence: 80,
          status: 'confirmed',
          source_type: 'outreach',
          source_ref: `Didit IDV: ${row.item.label}`,
          conflict_note: null,
          applied: true,
          source_request_id: row.item.outreach_id,
          source_item_id: row.item.item_id,
        };
      }
      // Field-level merge into the latest saved suggestions (never a stale copy)
      const profile_suggestions = await patchSuggestions(kycCase.id, { fields: fieldUpdates });
      onCaseUpdate?.((prev) => (prev ? { ...prev, profile_suggestions } : prev));

      // 4. Audit trail — one event per accepted field
      for (const row of toAccept) {
        await base44.entities.AuditEvent.create({
          tenant_id: kycCase.tenant_id,
          case_id: kycCase.id,
          client_id: kycCase.client_id,
          actor_user_id: currentUser?.id,
          actor_name: currentUser?.full_name,
          actor_type: 'User',
          event_type: 'profile_field_confirmed',
          before_state: { [row.fieldKey]: row.currentValue || null },
          after_state: { [row.fieldKey]: row.diditValue },
          notes: `field=${row.fieldKey} source=Didit IDV: ${row.item.label} (accepted from Outreach step)`,
        });
      }

      // 5. Combined audit event — single record showing every changed field + contributing session(s)
      const combinedBefore = {};
      const combinedAfter = {};
      for (const row of toAccept) {
        combinedBefore[row.fieldKey] = row.currentValue || null;
        combinedAfter[row.fieldKey] = row.diditValue;
      }
      const sessionIds = [...new Set(toAccept.map(r => r.item.didit_session_id).filter(Boolean))];
      await base44.entities.AuditEvent.create({
        tenant_id: kycCase.tenant_id,
        case_id: kycCase.id,
        client_id: kycCase.client_id,
        actor_user_id: currentUser?.id,
        actor_name: currentUser?.full_name,
        actor_type: 'User',
        event_type: 'client_profile_updated_from_idv',
        before_state: combinedBefore,
        after_state: combinedAfter,
        notes: `Accepted ${toAccept.length} field(s) from Didit IDV. Session(s): ${sessionIds.length ? sessionIds.join(', ') : 'unknown'}`,
      });

      await onAccepted?.();
    } finally {
      setAccepting(false);
    }
  }

  const anyChecked = Object.values(checked).some(Boolean);

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <UserCheck className="w-4 h-4 text-emerald-600" />
        <h4 className="text-sm font-semibold">Suggested Profile Updates from ID Verification</h4>
        {matchedLabels.length > 0 && <span className="ml-auto text-xs text-emerald-700">{matchedLabels.length} other field{matchedLabels.length === 1 ? '' : 's'} match the client file</span>}
      </div>

      <div className="space-y-4">
        {openGroups.map(({ item, rows }) => (
          <div key={item.item_id} className="border border-border/60 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/30 text-xs font-medium border-b border-border/50">
              {item.label || 'ID Verification'}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/50">
                  <th className="px-3 py-1.5 font-medium">Field</th>
                  <th className="px-3 py-1.5 font-medium">Current</th>
                  <th className="px-3 py-1.5 font-medium">Didit Value</th>
                  <th className="px-3 py-1.5 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.rowKey} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{row.label}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.displayOnly ? '—' : (row.currentValue || <span className="italic text-muted-foreground/50">empty</span>)}
                    </td>
                    <td className="px-3 py-2">
                      <span>{row.diditValue}</span>
                      {!row.displayOnly && row.differs && (
                        <span className="ml-2 inline-block text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                          ⚠ differs from current record
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {!row.displayOnly && (
                        <input
                          type="checkbox"
                          checked={!!checked[row.rowKey]}
                          onChange={() => toggle(row.rowKey)}
                          className="rounded border-border"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={acceptSelected} disabled={!anyChecked || accepting}>
          {accepting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
          Accept Selected
        </Button>
        <Button size="sm" variant="outline" className="text-xs" onClick={clearSelection} disabled={accepting}>
          Clear Selection
        </Button>
      </div>
    </div>
  );
}