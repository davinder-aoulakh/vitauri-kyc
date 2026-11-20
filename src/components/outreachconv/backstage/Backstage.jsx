// Guided conversation outreach, staff side: "Behind the scenes" of one conversation (spec section 11, seven parts).
// Data from manageOutreachConversation 'backstage'; the ORG Active checkbox saves to the published template through
// manageOutreachConfig (Tenant Config permission) and applies to the next request only.
import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import StructureCard from '@/components/outreachconv/widgets/StructureCard';
import '@/lib/outreachConvTokens.css';

const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const fmt = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const TONE = { green: 'border-emerald-300 bg-emerald-50 text-emerald-800', indigo: 'border-indigo-300 bg-indigo-50 text-indigo-800', neutral: 'border-slate-300 bg-slate-50 text-slate-700' };
const STATE_TONE = { now: 'border-blue-300 text-blue-800', answered: 'border-emerald-300 text-emerald-800', skipped: 'border-slate-300 text-slate-500', off: 'border-slate-300 text-slate-400', 'not yet': 'border-slate-200 text-slate-500' };
const SOURCE = { idv: 'ID check', doc: 'Document', kvk: 'KvK', didit_reg: 'Didit registry', ai: 'AI', client: 'Client', pre: 'Prefilled', rep: 'Representative', prop: 'Proposal', calc: 'Calculated', rule: 'Rule' };

function Section({ n, title, children }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{n}. {title}</h3>
      {children}
    </section>
  );
}

export default function Backstage({ conversationId, open, onOpenChange }) {
  const [v, setV] = useState(null);
  const [saving, setSaving] = useState('');
  const load = useCallback(async () => {
    if (!conversationId) return;
    try {
      const r = await base44.functions.invoke('manageOutreachConversation', { action: 'backstage', conversation_id: conversationId });
      setV(r.data);
    } catch (e) { toast({ title: 'Could not load the view', description: errText(e), variant: 'destructive' }); }
  }, [conversationId]);
  useEffect(() => { if (open) { setV(null); load(); } }, [open, load]);

  async function toggle(block, active) {
    setSaving(block.key);
    try {
      await base44.functions.invoke('manageOutreachConfig', { action: 'toggle_template_item', key: v.conversation.template_key, block_key: block.key, active, publish: true });
      toast({ title: 'Saved. The change applies to the next request.' });
      await load();
    } catch (e) { toast({ title: 'Not saved', description: errText(e), variant: 'destructive' }); } finally { setSaving(''); }
  }

  const isOrg = v?.conversation?.client_type === 'ORG';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Behind the scenes</SheetTitle>
          <SheetDescription>How this conversation was built and what it recorded{v?.conversation?.invited_name ? ` — ${v.conversation.invited_name}` : ''}.</SheetDescription>
        </SheetHeader>
        {!v ? <Loader2 className="mt-6 h-5 w-5 animate-spin text-muted-foreground" /> : (
          <div className="mt-4 space-y-5 text-xs">
            <Section n={1} title="Template">
              <table className="w-full"><tbody>
                {v.template.map((r) => <tr key={r.setting} className="border-b border-border/60"><td className="w-40 py-1 pr-3 text-muted-foreground">{r.setting}</td><td className="py-1">{r.value}</td></tr>)}
              </tbody></table>
            </Section>

            <Section n={2} title="Building blocks and rules">
              {isOrg && <p className="text-muted-foreground">Active switches change the template for the next request only{v.can_config ? '' : ' (Tenant Config permission needed)'}. This conversation keeps the version it was sent with.</p>}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-border text-left text-muted-foreground">
                    {isOrg && <th className="py-1 pr-2 font-medium">Active</th>}
                    <th className="py-1 pr-2 font-medium">Block</th><th className="py-1 pr-2 font-medium">Widget</th><th className="py-1 pr-2 font-medium">KYC field</th>
                    <th className="py-1 pr-2 font-medium">Shown when</th><th className="py-1 pr-2 font-medium">Follow-ups</th><th className="py-1 pr-2 font-medium">Prefill / evidence</th><th className="py-1 font-medium">State</th>
                  </tr></thead>
                  <tbody>
                    {v.blocks.map((b) => (
                      <tr key={b.key} className={`border-b border-border/60 align-top ${b.current ? 'bg-blue-50/60' : ''}`}>
                        {isOrg && <td className="py-1 pr-2"><input type="checkbox" aria-label={`Active: ${b.label}`} checked={b.active_now} disabled={!v.can_config || !!saving} onChange={(e) => toggle(b, e.target.checked)} />{saving === b.key && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}</td>}
                        <td className="py-1 pr-2"><div className="font-medium">{b.label}</div><div className="text-muted-foreground">{b.key}</div></td>
                        <td className="py-1 pr-2">{b.widget}</td>
                        <td className="py-1 pr-2">{b.kyc_mapping || '—'}</td>
                        <td className="py-1 pr-2">{b.show_if}</td>
                        <td className="py-1 pr-2">{b.follow_ups.length ? <ul>{b.follow_ups.map((f, i) => <li key={i}>{f}</li>)}</ul> : '—'}</td>
                        <td className="py-1 pr-2">{[b.prefill, b.evidence].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="py-1"><Badge variant="outline" className={`text-[10px] ${STATE_TONE[b.state] || ''}`}>{b.state}</Badge>{b.reason && <div className="text-muted-foreground">{b.reason}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section n={3} title="Data points and source">
              {v.datapoints.length === 0 ? <p className="text-muted-foreground">Nothing recorded yet.</p> : (
                <table className="w-full"><tbody>
                  {v.datapoints.map((d) => (
                    <tr key={d.key} className="border-b border-border/60 align-top">
                      <td className="w-44 py-1 pr-2 text-muted-foreground">{d.label}</td><td className="py-1 pr-2">{d.value || '—'}</td>
                      <td className="py-1 pr-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] ${TONE[d.tone]}`}>{SOURCE[d.source] || d.source}</span></td>
                      <td className="py-1 text-muted-foreground">{d.block}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </Section>

            <Section n={4} title="Active rules">
              <ul className="list-disc space-y-0.5 pl-4">{v.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </Section>

            <Section n={5} title="Audit trail">
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {v.audit.map((e) => <li key={e.id} className="flex gap-2 p-1.5"><span className="w-24 shrink-0 text-muted-foreground">{fmt(e.at)}</span><span className="w-40 shrink-0 font-medium">{e.event}</span><span className="min-w-0 flex-1">{e.text}</span></li>)}
              </ul>
            </Section>

            <Section n={6} title="Requests in the thread">
              {v.requests.length === 0 ? <p className="text-muted-foreground">None.</p> : (
                <table className="w-full"><tbody>
                  {v.requests.map((r) => <tr key={r.id} className="border-b border-border/60"><td className="py-1 pr-2">{r.title}</td><td className="py-1 pr-2 text-muted-foreground">{r.from}</td><td className="py-1 pr-2">{r.status}</td><td className="py-1 text-muted-foreground">{fmt(r.created)}</td></tr>)}
                </tbody></table>
              )}
            </Section>

            {isOrg && (
              <Section n={7} title="Structure and related parties">
                {v.structure ? <div className="oc"><StructureCard card={v.structure} text={v.structure.text} /></div> : <p className="text-muted-foreground">The structure is shown once the owners are known.</p>}
                {(v.parties || []).length > 0 && (
                  <table className="mt-2 w-full"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 pr-2 font-medium">Party</th><th className="py-1 pr-2 font-medium">Role</th><th className="py-1 pr-2 font-medium">Needs</th><th className="py-1 font-medium">Status</th></tr></thead>
                    <tbody>{v.parties.map((p) => <tr key={p.id} className="border-b border-border/60"><td className="py-1 pr-2">{p.name}</td><td className="py-1 pr-2">{p.roles}</td><td className="py-1 pr-2">{p.need}</td><td className="py-1">{p.status}</td></tr>)}</tbody>
                  </table>
                )}
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
