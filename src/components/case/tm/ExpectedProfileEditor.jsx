import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import StatusPill from '@/components/tm/kit/StatusPill';
import { toast } from '@/components/ui/use-toast';
import { ChevronDown, ChevronUp, LineChart, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);

// Editable dimensions of the expected profile. money: amount in the profile currency.
export const PROFILE_FIELDS = [
  { key: 'inbound_max_month', label: 'Inbound per month', money: true },
  { key: 'inbound_max_count_month', label: 'Inbound transactions per month' },
  { key: 'max_single_txn', label: 'Largest single transaction', money: true },
  { key: 'outbound_max_month', label: 'Outbound per month', money: true },
  { key: 'outbound_foreign_max_month', label: 'Outbound abroad per month', money: true },
  { key: 'cash_max_month', label: 'Cash per month', money: true },
  { key: 'countries_out', label: 'Countries for outbound transfers', countries: true },
  { key: 'allowed_countries', label: 'All counterparty countries', countries: true },
];

const toCountries = (s) => [...new Set(String(s || '').split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))];
const fromValue = (f, v) => (v == null ? '' : f.countries ? (v || []).join(', ') : String(v));
export const showValue = (f, v, cur) => (v == null || (Array.isArray(v) && !v.length) ? '—'
  : f.countries ? v.join(', ') : `${f.money ? `${cur} ` : ''}${Number(v).toLocaleString()}`);

/**
 * Step 4 · 1C — the expected profile monitoring tests against. Saves a draft ExpectedProfile for this case
 * (proposeExpectedProfile mode 'draft'); the draft is proposed and, where the approver may, approved at sign-off.
 * Prefill: this case's draft, else the signed-off transaction analysis proposal, else the current approved version.
 */
export default function ExpectedProfileEditor({ kycCase, client, readOnly = false }) {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const tmOn = isFeatureEnabled(tenant, 'tm_core');
  const [open, setOpen] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const key = ['case-expected-profile', kycCase?.id];

  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: tmOn && !!kycCase?.id,
    queryFn: async () => {
      const [mine, approved, analysis] = await Promise.all([
        base44.entities.ExpectedProfile.filter({ client_id: kycCase.client_id, case_id: kycCase.id }, '-version', 5).then(list),
        base44.entities.ExpectedProfile.filter({ client_id: kycCase.client_id, status: 'approved' }, '-version', 1).then(list),
        kycCase.kyc_txn_analysis_id ? base44.entities.KycTransactionAnalysis.filter({ id: kycCase.kyc_txn_analysis_id }).then(list) : Promise.resolve([]),
      ]);
      return { draft: mine.find((p) => ['draft', 'proposed'].includes(p.status)) || null, decided: mine.find((p) => ['approved', 'rejected'].includes(p.status)) || null, approved: approved[0] || null, analysis: analysis[0] || null };
    },
  });

  const cur = data?.draft?.currency || data?.approved?.currency || tenant?.tm_reporting_currency || 'USD';
  const base = useMemo(() => {
    if (!data) return null;
    const src = data.draft || null;
    const suggestion = data.analysis?.proposed_profile_limits || null;
    const out = {};
    for (const f of PROFILE_FIELDS) out[f.key] = fromValue(f, src?.[f.key] ?? suggestion?.[f.key] ?? data.approved?.[f.key]);
    out.rationale = src?.rationale || '';
    return out;
  }, [data]);
  useEffect(() => { if (base) setForm(base); }, [base]);

  if (!tmOn) return null;
  const status = data?.draft?.status || null;
  const locked = readOnly || status === 'proposed';
  const dirty = form && base && JSON.stringify(form) !== JSON.stringify(base);
  const fromAnalysis = !data?.draft && !!data?.analysis?.proposed_profile_limits;

  const save = async () => {
    setSaving(true);
    try {
      const overrides = { currency: cur, rationale: form.rationale || undefined };
      for (const f of PROFILE_FIELDS) {
        const v = form[f.key];
        overrides[f.key] = f.countries ? toCountries(v) : v === '' ? null : Number(v);
      }
      const res = await base44.functions.invoke('proposeExpectedProfile', { client_id: kycCase.client_id, case_id: kycCase.id, source: 'kyc_case', mode: 'draft', overrides });
      if (res?.data?.error) throw new Error(res.data.error);
      toast({ title: 'Expected profile saved', description: 'It is proposed for approval when the case is signed off.' });
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: 'Could not save the expected profile', description: e?.response?.data?.error || e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/20 transition-colors" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-2">
          <LineChart className="w-4 h-4 text-teal-600" />
          <span className="font-semibold text-sm">1C — Expected profile for monitoring</span>
          {status && <StatusPill status={status} />}
          {data?.approved && <span className="text-xs text-muted-foreground">current: v{data.approved.version}</span>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-border space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            Transaction monitoring tests every transaction against this profile. Deviating behaviour never becomes the new normal by itself: each version needs a rationale and approval.
          </p>
          {fromAnalysis && (
            <p className="flex items-center gap-1.5 text-xs text-purple-700"><Sparkles className="w-3.5 h-3.5" /> Prefilled from the transaction analysis in step 5. Check and adjust before saving.</p>
          )}
          {isLoading || !form ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Dimension</th>
                      <th className="pb-2 font-medium">{data.approved ? `Current v${data.approved.version}` : 'Current'}</th>
                      <th className="pb-2 font-medium">Proposed ({cur})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PROFILE_FIELDS.map((f) => {
                      const before = showValue(f, data.approved?.[f.key], cur);
                      const changed = data.approved && fromValue(f, data.approved?.[f.key]) !== form[f.key];
                      return (
                        <tr key={f.key} className="border-t border-border align-middle">
                          <td className="py-1.5 pr-3 text-muted-foreground">{f.label}</td>
                          <td className="py-1.5 pr-3 text-xs tabular-nums">{before}</td>
                          <td className="py-1.5">
                            <Input
                              value={form[f.key]} disabled={locked} inputMode={f.countries ? 'text' : 'decimal'}
                              placeholder={f.countries ? 'e.g. CW, VE' : 'Not limited'}
                              onChange={(e) => setForm((s) => ({ ...s, [f.key]: f.countries ? e.target.value.toUpperCase() : e.target.value.replace(/[^\d.]/g, '') }))}
                              className={cn('h-8 text-sm', changed && 'border-amber-400 bg-amber-50/50 dark:bg-amber-500/10')}
                              aria-label={f.label}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" htmlFor="profile-rationale">Rationale (why these limits fit this customer)</label>
                <Textarea id="profile-rationale" value={form.rationale} disabled={locked} onChange={(e) => setForm((s) => ({ ...s, rationale: e.target.value }))}
                  placeholder="e.g. Salary XCG 3,880/month from Aqualectra; small family remittances to Venezuela." className="text-sm min-h-14 resize-none" />
              </div>
              {!locked && (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={save} disabled={saving || !dirty}>{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save profile draft</Button>
                  {!dirty && status === 'draft' && <span className="text-xs text-muted-foreground">Saved. It is proposed for approval at sign-off.</span>}
                </div>
              )}
              {status === 'proposed' && <p className="text-xs text-muted-foreground">Proposed for approval. Changes need a new draft after the decision.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
