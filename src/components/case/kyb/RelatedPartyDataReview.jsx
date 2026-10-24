/**
 * RelatedPartyDataReview — a UBO/director's own Didit ID verification next to what is recorded for them.
 * Same rule as the person (NP) path: nothing is written until the analyst accepts. Each value can be edited before
 * accepting, or the recorded value kept. Accepted keys go to RelatedParty.didit_applied_fields, kept ones to
 * didit_reviewed_fields, so a row is not offered again. Every change is audited.
 */
import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { ChevronDown, ChevronUp, Loader2, ShieldCheck } from 'lucide-react';

const ROWS = [
  { key: 'full_name', label: 'Full name', snap: 'full_name' },
  { key: 'date_of_birth', label: 'Date of birth', snap: 'date_of_birth' },
  { key: 'nationality', label: 'Nationality', snap: 'nationality' },
  { key: 'id_type', label: 'ID type', snap: 'id_type' },
  { key: 'id_number', label: 'ID number', snap: 'id_number' },
  { key: 'id_expiry_date', label: 'ID expiry', snap: 'id_expiry_date' },
  { key: 'residential_address', label: 'Address', snap: 'address' },
];
const text = (v) => (v == null ? '' : String(v).trim());
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();

/** Rows still to review for a party: Didit has a value that differs from (or fills) the recorded one. */
export function pendingDiditRows(party) {
  const snap = party?.didit_idv_snapshot;
  if (!snap) return [];
  const done = new Set([...(party.didit_applied_fields || []), ...(party.didit_reviewed_fields || [])]);
  return ROWS.map((r) => ({ ...r, didit: text(snap[r.snap]), recorded: text(party[r.key]) }))
    .filter((r) => r.didit && !done.has(r.key) && !same(r.didit, r.recorded));
}

export default function RelatedPartyDataReview({ party, clientId, caseId, currentUser, onChanged }) {
  const rows = useMemo(() => pendingDiditRows(party), [party]);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(null);
  if (!party?.didit_idv_snapshot) return null;
  const snap = party.didit_idv_snapshot;

  const audit = (event_type, before, after, notes) => base44.entities.AuditEvent.create({
    tenant_id: party.tenant_id, client_id: clientId, case_id: caseId || undefined, actor_user_id: currentUser?.id,
    actor_name: currentUser?.full_name, actor_type: 'User', event_type,
    before_state: { related_party_id: party.id, ...before }, after_state: { related_party_id: party.id, ...after }, notes,
  });

  const accept = async (r) => {
    const value = text(values[r.key] ?? r.didit);
    if (!value) return;
    setBusy(r.key);
    try {
      const edited = value !== r.didit;
      await base44.entities.RelatedParty.update(party.id, {
        [r.key]: value,
        didit_applied_fields: [...new Set([...(party.didit_applied_fields || []), r.key])],
      });
      await audit('related_party_didit_field_accepted', { [r.key]: r.recorded || null }, { [r.key]: value, edited },
        `${party.full_name}: ${r.label} ${edited ? 'set (edited from the Didit value)' : 'accepted from Didit ID verification'}.`);
      toast({ title: `${r.label} updated for ${party.full_name}` });
      onChanged?.();
    } catch (e) {
      toast({ title: 'Could not update', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const keep = async (r) => {
    setBusy(r.key);
    try {
      await base44.entities.RelatedParty.update(party.id, { didit_reviewed_fields: [...new Set([...(party.didit_reviewed_fields || []), r.key])] });
      await audit('related_party_didit_field_kept', { [r.key]: r.recorded || null }, { didit_value: r.didit },
        `${party.full_name}: recorded ${r.label} kept over the Didit value.`);
      onChanged?.();
    } catch (e) {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border border-indigo-100 bg-indigo-50/40 px-2.5 py-1.5 text-xs">
      <button type="button" className="flex w-full items-center gap-1.5 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
        <span className="font-medium">Didit ID data</span>
        <span className={rows.length ? 'text-amber-700' : 'text-muted-foreground'}>
          {rows.length ? `${rows.length} to review` : 'all reviewed'}
        </span>
        <span className="text-muted-foreground">
          {snap.checked_at ? `· ${String(snap.checked_at).slice(0, 10)}` : ''}{snap.issuing_country ? ` · issued in ${snap.issuing_country}` : ''}
        </span>
        <span className="ml-auto">{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {rows.length === 0 && <p className="text-muted-foreground">Everything Didit extracted matches the record or has been reviewed.</p>}
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-1 gap-1 sm:grid-cols-[7rem_1fr_auto] sm:items-center">
              <span className="text-muted-foreground">{r.label}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">{r.recorded ? <span className="line-through">{r.recorded}</span> : 'Not recorded'} →</span>
                <Input value={values[r.key] ?? r.didit} onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                  className="h-7 w-48 text-xs" aria-label={`${r.label} value`} />
              </div>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 text-xs" disabled={busy === r.key} onClick={() => accept(r)}>
                  {busy === r.key ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Accept'}
                </Button>
                {r.recorded && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === r.key} onClick={() => keep(r)}>Keep recorded</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
