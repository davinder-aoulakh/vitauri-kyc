import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { upsertRelatedParty, findLinkedMatch } from '@/lib/relatedPartyUpsert';
import { CheckCircle, FileText, Loader2, RefreshCw, ShieldAlert, UserPlus, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import KeyPeopleVerification, { keyRoleKind } from './KeyPeopleVerification';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);
const STATUS_CLS = {
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'In Review': 'bg-amber-50 text-amber-700 border-amber-200',
  'Awaiting User': 'bg-sky-50 text-sky-700 border-sky-200',
  Declined: 'bg-red-50 text-red-700 border-red-200',
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A registry person as a related-party candidate (same shape the Profile Verification grid uses).
const toCandidate = (p) => ({
  full_name: p.name, party_type: p.entity_type === 'company' ? 'ORG' : 'NP',
  role_in_relationship: p.source === 'beneficial_owner' ? 'UBO' : (p.designation || p.role || 'Director'),
  ownership_percentage: p.ownership_percent != null && Number.isFinite(Number(p.ownership_percent)) ? Number(p.ownership_percent) : null,
  nationality: p.nationality || null, date_of_birth: p.date_of_birth || null, registration_number: p.registration_number || null,
  source_type: 'didit',
});

// Fields where the registry differs from (or adds to) what is recorded for a linked party.
function registryDiffs(c, { rp, link }) {
  const d = {};
  const recOwn = link?.ownership_percentage ?? rp.ownership_percentage;
  if (c.ownership_percentage != null && (recOwn == null || Math.abs(Number(recOwn) - c.ownership_percentage) >= 0.01)) d.ownership_percentage = { recorded: recOwn ?? null, registry: c.ownership_percentage };
  if (c.nationality && norm(rp.nationality) !== norm(c.nationality)) d.nationality = { recorded: rp.nationality || null, registry: c.nationality };
  if (c.date_of_birth && !rp.date_of_birth) d.date_of_birth = { recorded: null, registry: c.date_of_birth };
  const recRole = link?.role || rp.role_in_relationship;
  if (c.role_in_relationship && recRole && norm(recRole) !== norm(c.role_in_relationship)) d.role_in_relationship = { recorded: recRole, registry: c.role_in_relationship };
  return d;
}

function Fact({ label, value }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || '—'}</span>
    </div>
  );
}

/**
 * Step 2 for organisation clients when Didit KYB is on: business verification (registry, company documents, company AML)
 * and identity verification of each UBO / director. Replaces the person ID step for ORG only.
 */
export default function KybStep({ kycCase, client, currentUser, tenant, onStepComplete }) {
  const qc = useQueryClient();
  const tenantId = kycCase?.tenant_id || client?.tenant_id;
  const key = ['kyb-step', client?.id];
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!client?.id && !!tenantId,
    queryFn: async () => {
      const [kybs, links, requests] = await Promise.all([
        base44.entities.KybVerification.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 5).then(list),
        base44.entities.ClientRelatedPartyLink.filter({ tenant_id: tenantId, client_id: client.id }).then(list),
        base44.entities.OutreachRequest.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 100).then(list),
      ]);
      const ids = [...new Set(links.map((l) => l.related_party_id).filter(Boolean))];
      const parties = ids.length ? list(await base44.entities.RelatedParty.filter({ tenant_id: tenantId, id: { $in: ids } })) : [];
      return { kyb: kybs[0] || null, links, parties, requests: requests.filter((r) => r.related_party_id) };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const kyb = data?.kyb;
  const people = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.parties.map((p) => [p.id, p]));
    return data.links.map((l) => {
      const p = byId.get(l.related_party_id);
      if (!p) return null;
      const role = l.role || p.role_in_relationship;
      const kind = keyRoleKind(role);
      return kind ? { ...p, role, kind, ownership_percentage: l.ownership_percentage ?? p.ownership_percentage } : null;
    }).filter(Boolean);
  }, [data]);
  const linked = useMemo(() => (data ? data.links.map((link) => ({ link, rp: data.parties.find((p) => p.id === link.related_party_id) })).filter((x) => x.rp) : []), [data]);
  // Each registry person: not linked yet (Add), linked and agreeing (Recorded), or linked with differences (review).
  const registryPeople = (kyb?.key_people_found || []).filter((p) => p.name && p.is_active !== false).map((p) => {
    const candidate = toCandidate(p);
    const match = findLinkedMatch(linked, candidate);
    return { ...p, candidate, match, diffs: match ? registryDiffs(candidate, match) : {} };
  });

  const sync = async () => {
    if (!kyb) return;
    setSyncing(true);
    try {
      const res = await base44.functions.invoke('getDiditKybResult', { kyb_verification_id: kyb.id });
      if (res?.data?.error) throw new Error(res.data.error);
      toast({ title: `Business verification: ${res?.data?.status || 'no result yet'}` });
      refresh();
      // Refresh the Profile Verification suggestions so new registry data shows up for review (as the NP pipeline does).
      if (kycCase?.id) base44.functions.invoke('buildProfileSuggestions', { case_id: kycCase.id, client_id: client.id, client_type: 'ORG' }).catch(() => {});
    } catch (e) {
      toast({ title: 'Sync failed', description: e?.response?.data?.error || e.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  // Adds the person, or applies the registry's differing values to the party already linked — never a duplicate.
  const addFromRegistry = async (p) => {
    setAdding(p.name);
    try {
      const { created, updatedFields } = await upsertRelatedParty({
        tenant, tenantId, clientId: client.id, caseId: kycCase?.id, currentUser,
        candidate: p.candidate, matchRpId: p.match?.rp.id, acceptFields: p.match ? Object.keys(p.diffs) : undefined,
      });
      toast({ title: created ? `${p.name} added as ${p.candidate.role_in_relationship}` : `${p.name}: ${updatedFields.join(', ').replace(/_/g, ' ') || 'no changes'} updated from the registry` });
      refresh();
    } catch (e) {
      toast({ title: 'Could not add related party', description: e.message, variant: 'destructive' });
    } finally {
      setAdding(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const reg = kyb?.registry || {};
  const allVerified = people.length > 0 && people.every((p) => p.verification_status === 'Verified');
  const canComplete = kyb?.status === 'Approved' && allVerified;
  const stepDone = kycCase?.step_2_status === 'complete';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Business verification (Didit KYB)</h3>
          {kyb && <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', STATUS_CLS[kyb.status] || 'bg-muted text-muted-foreground border-border')}>{kyb.status}</span>}
          {kyb && (
            <Button size="sm" variant="outline" className="ml-auto h-7 gap-1.5 text-xs" onClick={sync} disabled={syncing}>
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync from Didit
            </Button>
          )}
        </div>
        {!kyb ? (
          <p className="text-xs text-muted-foreground">
            No business verification yet. Add a <strong>Business Verification</strong> item to the outreach in Step 1; the company representative completes it in the client portal.
          </p>
        ) : (
          <>
            <div className="grid gap-x-6 md:grid-cols-2">
              <Fact label="Company name" value={reg.company_name} />
              <Fact label="Registration number" value={reg.registration_number} />
              <Fact label="Country" value={[reg.country_code, reg.region].filter(Boolean).join(' / ')} />
              <Fact label="Company type" value={reg.company_type} />
              <Fact label="Incorporated" value={reg.incorporation_date} />
              <Fact label="Registry status" value={kyb.registry_status} />
              <Fact label="Registered address" value={reg.registered_address} />
              <Fact label="LEI" value={reg.legal_entity_identifier} />
              <Fact label="Didit company risk" value={reg.risk_level} />
              <Fact label="Last checked" value={kyb.checked_at ? new Date(kyb.checked_at).toLocaleString() : null} />
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              <span className="inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> {(kyb.documents || []).length} company document(s) — in the Documents tab</span>
              <span className={cn('inline-flex items-center gap-1', (kyb.aml?.total_hits || 0) > 0 && 'text-destructive font-medium')}>
                <ShieldAlert className="w-3.5 h-3.5" /> Company AML: {kyb.aml?.total_hits ?? 0} hit(s){(kyb.aml?.total_hits || 0) > 0 ? ' — review in Step 3' : ''}
              </span>
            </div>
            {(kyb.documents || []).some((d) => d.is_tampered || d.store_error) && (
              <p className="text-xs text-destructive">
                {kyb.documents.filter((d) => d.is_tampered).length > 0 && 'Didit flagged a document as possibly tampered. '}
                {kyb.documents.filter((d) => d.store_error).length > 0 && 'Some documents could not be copied yet; Sync again.'}
              </p>
            )}
          </>
        )}
      </div>

      {registryPeople.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold">Officers and owners reported by the registry</h3>
          <div className="divide-y divide-border">
            {registryPeople.map((p, i) => {
              const diffKeys = Object.keys(p.diffs);
              return (
                <div key={`${p.name}-${i}`} className="py-2 text-xs space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">{p.source === 'beneficial_owner' ? 'Beneficial owner' : (p.designation || p.role || 'Officer')}{p.ownership_percent != null ? ` · ${p.ownership_percent}%` : ''}{p.nationality ? ` · ${p.nationality}` : ''}</span>
                    {p.kyc_status && <span className="text-muted-foreground">· Didit KYC: {p.kyc_status}</span>}
                    {p.match && !diffKeys.length && <span className="ml-auto text-emerald-700 inline-flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Recorded</span>}
                    {(!p.match || diffKeys.length > 0) && (
                      <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" disabled={adding === p.name} onClick={() => addFromRegistry(p)}>
                        {adding === p.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                        {p.match ? 'Apply registry values' : 'Add as related party'}
                      </Button>
                    )}
                  </div>
                  {p.match && diffKeys.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1.5 space-y-0.5">
                      <div className="text-amber-800 font-medium">Recorded, but the registry differs:</div>
                      {diffKeys.map((k) => (
                        <div key={k} className="text-muted-foreground">
                          <span className="capitalize">{k.replace(/_/g, ' ')}</span>: <span className="line-through">{p.diffs[k].recorded ?? 'not recorded'}</span> → <span className="font-medium text-foreground">{p.diffs[k].registry}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <KeyPeopleVerification client={client} kycCase={kycCase} tenant={tenant} people={people} requests={data?.requests || []} onChanged={refresh} />

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!stepDone && !canComplete && (
          <span className="text-xs text-muted-foreground">Complete when the business verification is Approved and every UBO and director is Verified.</span>
        )}
        <Button size="sm" disabled={stepDone || !canComplete} onClick={() => onStepComplete?.()} className="gap-1.5">
          <CheckCircle className="w-4 h-4" /> {stepDone ? 'Step complete' : 'Mark step complete'}
        </Button>
      </div>
    </div>
  );
}
