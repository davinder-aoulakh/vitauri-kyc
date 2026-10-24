/**
 * SuggestedKybUpdatesCard — the organisation counterpart of SuggestedProfileUpdatesCard.
 * Shows company data from the Didit KYB registry check next to the client profile and lets the analyst accept it.
 * Nothing is written until accepted. Accepted fields are marked on the kyb_verification outreach item
 * (idv_profile_applied_fields), the same marker the Profile Verification grid reads, so both stay in sync.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Building2, Loader2 } from 'lucide-react';

// Must match extractFromKyb in base44/functions/buildProfileSuggestions/entry.ts.
const FIELDS = [
  { key: 'full_name', label: 'Legal entity name', pick: (r) => r.company_name || r.name },
  { key: 'registration_number', label: 'Registration number', pick: (r) => r.registration_number },
  { key: 'legal_form', label: 'Legal form', pick: (r) => r.company_type || r.legal_form },
  { key: 'registered_country', label: 'Registered country', pick: (r) => r.country_code || r.country },
  { key: 'registered_address', label: 'Registered address', pick: (r) => (typeof r.registered_address === 'object' ? Object.values(r.registered_address || {}).filter(Boolean).join(', ') : r.registered_address) },
  { key: 'lei_code', label: 'LEI code', pick: (r) => r.legal_entity_identifier || r.lei },
  { key: 'business_activity', label: 'Business activity', pick: (r) => r.nature_of_business || r.business_activity },
  { key: 'nature_of_business_code', label: 'Nature of business code', pick: (r) => r.industry_code || r.sic_code || r.nace_code || (Array.isArray(r.sic_codes) ? r.sic_codes[0] : undefined) },
];
const INACTIVE = /dissolv|struck|strike|liquidat|inactive|closed|cancel|deregist|bankrupt|insolv|ceased/i;
const asList = (r) => (Array.isArray(r) ? r : r?.items || []);
const text = (v) => (v == null ? '' : String(v).trim());

export default function SuggestedKybUpdatesCard({ client, kycCase, currentUser, onAccepted, onCaseUpdate }) {
  const { data: kyb, refetch } = useQuery({
    queryKey: ['kyb-latest', client?.id],
    enabled: client?.client_type === 'ORG' && !!client?.id,
    queryFn: async () => asList(await base44.entities.KybVerification.filter({ tenant_id: client.tenant_id, client_id: client.id }, '-created_date', 5)).find((k) => k.registry) || null,
  });
  const { data: request, refetch: refetchRequest } = useQuery({
    queryKey: ['kyb-request', kyb?.outreach_id],
    enabled: !!kyb?.outreach_id,
    queryFn: async () => asList(await base44.entities.OutreachRequest.filter({ tenant_id: client.tenant_id, id: kyb.outreach_id }, undefined, 1))[0] || null,
  });
  const item = request?.items?.find((i) => i.item_id === kyb?.item_id) || null;

  const rows = useMemo(() => {
    if (!kyb?.registry) return [];
    const applied = new Set(item?.idv_profile_applied_fields || []);
    return FIELDS.map((f) => {
      const diditValue = text(f.pick(kyb.registry)).slice(0, 500);
      if (!diditValue || applied.has(f.key)) return null;
      const currentValue = text(client?.[f.key]);
      if (currentValue.toLowerCase() === diditValue.toLowerCase()) return null;
      return { ...f, diditValue, currentValue, isEmpty: !currentValue };
    }).filter(Boolean);
  }, [kyb, item, client]);

  const signature = rows.map((r) => r.key).join(',');
  const [checked, setChecked] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChecked(Object.fromEntries(rows.map((r) => [r.key, r.isEmpty]))); }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = kyb?.registry_status || kyb?.registry?.status;
  const inactive = status && INACTIVE.test(String(status));
  if (!kyb?.registry || (!rows.length && !inactive)) return null;

  async function acceptSelected() {
    const toAccept = rows.filter((r) => checked[r.key]);
    if (!toAccept.length) return;
    setBusy(true);
    try {
      const updates = Object.fromEntries(toAccept.map((r) => [r.key, r.diditValue]));
      const before = Object.fromEntries(toAccept.map((r) => [r.key, r.currentValue || null]));
      await base44.entities.Client.update(client.id, updates);

      // Mark applied on the KYB outreach item: the grid then shows these as Didit · confirmed and stops re-offering them.
      if (request && item) {
        const items = (request.items || []).map((i) => (i.item_id === item.item_id
          ? { ...i, idv_profile_applied_fields: [...new Set([...(i.idv_profile_applied_fields || []), ...toAccept.map((r) => r.key)])] }
          : i));
        await base44.entities.OutreachRequest.update(request.id, { items });
      }
      // Keep the Profile Verification grid in step without waiting for a pipeline re-run.
      if (kycCase?.profile_suggestions?.client_fields) {
        const cf = { ...kycCase.profile_suggestions.client_fields };
        for (const r of toAccept) cf[r.key] = { ...(cf[r.key] || {}), value: r.diditValue, confidence: 95, source_type: 'didit', source_ref: 'Didit KYB registry', status: 'confirmed', conflict_note: null, applied: true };
        const profile_suggestions = { ...kycCase.profile_suggestions, client_fields: cf };
        await base44.entities.KycCase.update(kycCase.id, { profile_suggestions });
        onCaseUpdate?.((prev) => (prev ? { ...prev, profile_suggestions } : prev));
      }
      await base44.entities.AuditEvent.create({
        tenant_id: client.tenant_id, client_id: client.id, case_id: kycCase?.id, actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
        actor_type: 'User', event_type: 'kyb_registry_fields_accepted', before_state: before, after_state: updates,
        notes: `Company fields accepted from the Didit KYB registry: ${toAccept.map((r) => r.label).join(', ')}.`,
      });
      await Promise.all([refetch(), refetchRequest()]);
      onAccepted?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-indigo-600" />
        <h3 className="text-sm font-semibold">Suggested profile updates from Didit KYB</h3>
        <span className="text-xs text-muted-foreground ml-auto">Registry check{kyb.decided_at ? ` · ${String(kyb.decided_at).slice(0, 10)}` : ''}</span>
      </div>
      {inactive && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> Registry status: <strong>{status}</strong>. Confirm the company is still active.
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="divide-y divide-indigo-100 rounded-lg border border-indigo-100 bg-white">
            {rows.map((r) => (
              <label key={r.key} className="flex items-start gap-2.5 px-3 py-2 text-xs cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={!!checked[r.key]} onChange={() => setChecked((c) => ({ ...c, [r.key]: !c[r.key] }))} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.label}</div>
                  <div className="text-muted-foreground">
                    {r.isEmpty ? <span>Not recorded</span> : <span className="line-through">{r.currentValue}</span>}
                    {' → '}<span className="font-medium text-foreground">{r.diditValue}</span>
                  </div>
                </div>
                {!r.isEmpty && <span className="text-[11px] rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5">Differs</span>}
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">Empty fields are pre-selected. Differing values stay as recorded unless you select them; you can also edit them in Profile Verification.</p>
            <Button size="sm" className="h-8 text-xs gap-1.5" disabled={busy || !rows.some((r) => checked[r.key])} onClick={acceptSelected}>
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Accept selected
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
