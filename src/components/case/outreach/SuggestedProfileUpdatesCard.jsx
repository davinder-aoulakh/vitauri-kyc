/**
 * SuggestedProfileUpdatesCard — shown in the Outreach step right after the Didit summary card.
 * Lets analysts accept Didit-extracted profile fields (name, DOB, nationality, gender, address)
 * straight from the outreach view. Fully synced with the Profile Verification grid via the
 * shared idv_profile_applied_fields marker and KycCase.profile_suggestions.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, UserCheck } from 'lucide-react';
import { getNestedValue, buildFieldUpdatePayload, computeFullName } from '@/lib/clientNameUtils';
import { ISO3_MAP } from '@/lib/diditIso3Map';

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
const FIELD_ISSUING_COUNTRY = {
  key: 'country_of_residence', label: 'Issuing Country',
  extract: item => ISO3_MAP[item.idv_issuing_country] || item.idv_issuing_country || '',
  getCurrent: client => client?.country_of_residence,
};
const FIELD_ADDRESS = {
  key: 'residential_address.street', label: 'Address',
  extract: item => item.idv_extracted_address,
  getCurrent: client => getNestedValue(client, 'residential_address.street'),
};

function checkRow(cfg, item, client) {
  const diditValue = (cfg.extract(item) || '').toString().trim();
  if (!diditValue) return null;
  const appliedFields = new Set(item.idv_profile_applied_fields || []);
  if (appliedFields.has(cfg.key)) return null;
  const currentValue = (cfg.getCurrent(client) || '').toString().trim();
  const isEmpty = currentValue === '';
  const differs = !isEmpty && currentValue.toLowerCase() !== diditValue.toLowerCase();
  return { rowKey: `${item.item_id}:${cfg.key}`, fieldKey: cfg.key, label: cfg.label, currentValue, diditValue, defaultChecked: isEmpty, differs, item };
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

export default function SuggestedProfileUpdatesCard({ diditSummary, requests, client, kycCase, currentUser, onAccepted }) {
  const groups = useMemo(() => {
    if (!diditSummary?.items?.length) return [];
    return diditSummary.items
      .map(item => ({ item, rows: buildRowsForItem(item, client) }))
      .filter(g => g.rows.length > 0);
  }, [diditSummary, client]);

  const rowSignature = groups.map(g => g.rows.map(r => r.rowKey).join(',')).join('|');
  const [checked, setChecked] = useState({});
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const defaults = {};
    groups.forEach(g => g.rows.forEach(r => { if (!r.displayOnly) defaults[r.rowKey] = r.defaultChecked; }));
    setChecked(defaults);
  }, [rowSignature]);

  if (groups.length === 0) return null;

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
          clientUpdates = { ...clientUpdates, ...buildFieldUpdatePayload({ ...client, ...clientUpdates }, row.fieldKey, row.diditValue) };
        } else {
          clientUpdates = { ...clientUpdates, [row.fieldKey]: row.diditValue };
        }
      }
      await base44.entities.Client.update(client.id, clientUpdates);

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
      const currentSuggestions = kycCase?.profile_suggestions || {};
      const fieldUpdates = { ...(currentSuggestions.client_fields || {}) };
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
      await base44.entities.KycCase.update(kycCase.id, {
        profile_suggestions: { ...currentSuggestions, client_fields: fieldUpdates },
      });

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
      </div>

      <div className="space-y-4">
        {groups.map(({ item, rows }) => (
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