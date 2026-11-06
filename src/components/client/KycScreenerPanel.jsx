import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { Bot, Download, Loader2, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);
const LIST_LABEL = { sanctions: 'Sanctions', pep: 'PEP', adverse_media: 'Adverse media' };
const AGREE = {
  agree_clear: ['Agree: clear', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
  agree_hit: ['Agree: hit', 'bg-red-50 text-red-800 border-red-200'],
  claude_only: ['Claude only', 'bg-amber-50 text-amber-900 border-amber-200'],
  didit_only: ['Didit only', 'bg-amber-50 text-amber-900 border-amber-200'],
  review: ['Review', 'bg-sky-50 text-sky-800 border-sky-200'],
  claude_only_clear: ['Didit not screened', 'bg-muted text-muted-foreground border-border'],
};
const STAGE = { doc_reader: 'Reading documents (isolated)', screening: 'Screening parties (web search)', rules: 'Applying the rules grid', export: 'Building Excel and PDF', done: 'Done' };
const RATING_TONE = { low: 'bg-emerald-100 text-emerald-800', medium: 'bg-amber-100 text-amber-900', high: 'bg-red-100 text-red-800' };
const RESULT_TONE = { hit: 'text-red-700 font-semibold', clear: 'text-emerald-700', no_match: 'text-emerald-700', inconclusive: 'text-amber-800', not_screened: 'text-muted-foreground' };

const Pill = ({ className, children }) => <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', className)}>{children}</span>;
const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
    {children}
  </section>
);

async function openFile(runId, kind) {
  try {
    const res = (await base44.functions.invoke('runKycScreener', { action: 'signed_url', run_id: runId, kind }))?.data;
    if (res?.signed_url) window.open(res.signed_url, '_blank', 'noopener');
  } catch (e) {
    toast({ variant: 'destructive', title: 'Could not open the file', description: e?.response?.data?.error || e?.message });
  }
}

function RunView({ run }) {
  const r = run.rules || {};
  const cmp = run.comparison || {};
  const d = run.doc_record || {};
  const [showClear, setShowClear] = useState(false);
  const rows = (cmp.rows || []).filter((x) => showClear || x.agreement !== 'agree_clear');
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>AI recommendation from the KYC Screener (Claude). Nothing was changed in the client file; the compliance officer decides.</span>
      </div>

      <Section title="Recommendation">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold capitalize', RATING_TONE[r.risk_rating] || 'bg-muted')}>Claude: {r.risk_rating} risk</span>
          <span className="text-xs text-muted-foreground">Vitauri rating: <strong className="text-foreground">{cmp.risk?.vitauri || '—'}</strong>
            {cmp.risk?.relation === 'claude_higher' && ' · Claude rates higher'}{cmp.risk?.relation === 'claude_lower' && ' · Claude rates lower'}</span>
          <Pill className="bg-card border-border">Disposition: {r.disposition}</Pill>
        </div>
        {r.summary && <p className="text-sm leading-relaxed">{r.summary}</p>}
        {(r.escalation_reasons || []).length > 0 && <ul className="list-disc pl-5 text-sm space-y-0.5">{r.escalation_reasons.map((e) => <li key={e}>{e}</li>)}</ul>}
      </Section>

      <Section title="Screening: Didit vs Claude">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(cmp.totals || {}).filter(([, n]) => n).map(([k, n]) => <Pill key={k} className={AGREE[k]?.[1]}>{AGREE[k]?.[0]}: {n}</Pill>)}
          <button type="button" className="text-[11px] text-primary hover:underline ml-auto" onClick={() => setShowClear(!showClear)}>{showClear ? 'Hide agreed clear' : 'Show all rows'}</button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              {['Party', 'List', 'Didit', 'Claude', 'Agreement'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-muted-foreground">Didit and Claude agree: no hits on any party.</td></tr>}
              {rows.map((x) => (
                <tr key={`${x.party_key}-${x.list}`} className="align-top">
                  <td className="px-2 py-1.5"><div className="font-medium">{x.party}</div><div className="text-[10px] text-muted-foreground">{x.role}</div></td>
                  <td className="px-2 py-1.5">{LIST_LABEL[x.list]}</td>
                  <td className="px-2 py-1.5"><div className={RESULT_TONE[x.didit]}>{String(x.didit).replace('_', ' ')}</div><div className="text-[10px] text-muted-foreground">{x.didit_detail}</div></td>
                  <td className="px-2 py-1.5">
                    <div className={RESULT_TONE[x.claude]}>{String(x.claude).replace('_', ' ')}</div>
                    {x.claude_detail && <div className="text-[10px] text-muted-foreground">{x.claude_detail}</div>}
                    {(x.sources || []).map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-primary hover:underline break-all"><ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />{u.replace(/^https?:\/\//, '').slice(0, 60)}</a>)}
                  </td>
                  <td className="px-2 py-1.5"><Pill className={AGREE[x.agreement]?.[1]}>{AGREE[x.agreement]?.[0]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">Claude screened with web search; Didit results were not shown to Claude. Check sources before acting on a Claude-only finding.</p>
      </Section>

      <Section title="Rule outcomes">
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(r.rule_outcomes || []).map((o) => (
            <li key={o.rule_id} className="flex gap-2 px-2.5 py-1.5 text-xs">
              <span className="w-10 font-mono font-semibold">{o.rule_id}</span>
              <span className={cn('w-10 font-semibold uppercase', o.outcome === 'fail' ? 'text-red-700' : o.outcome === 'pass' ? 'text-emerald-700' : 'text-muted-foreground')}>{o.outcome}</span>
              <span className="flex-1">{o.evidence}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Documents and gaps">
        <div className="flex flex-wrap gap-1.5">
          {(r.required_documents || []).map((x) => <Pill key={x.document} className={x.status === 'received' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}>{x.document}: {x.status}</Pill>)}
        </div>
        {(d.inventory_gaps || []).length > 0 && <ul className="list-disc pl-5 text-xs">{d.inventory_gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
        <p className="text-[11px] text-muted-foreground">{(run.documents_used || []).length} document(s) read: {(run.documents_used || []).map((x) => x.label).join(' · ') || 'none'}</p>
      </Section>

      <Section title="Entity file (from documents)">
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-xs">
          {[['Legal name', d.legal_name], ['DOB / formation', d.dob_or_formation_date], ['Nationality / jurisdiction', d.nationality_or_jurisdiction], ['Address', d.registered_address], ['Source of funds', d.source_of_funds],
            ['UBOs', (d.beneficial_owners || []).map((b) => `${b.name}${b.ownership_pct != null ? ` (${b.ownership_pct}%)` : ''}`).join(', ')],
            ['Controllers', (d.controllers || []).map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}`).join(', ')]]
            .filter(([, v]) => v).map(([k, v]) => <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></React.Fragment>)}
        </dl>
      </Section>
    </div>
  );
}

/** "Run KYC Screener (Claude)" button + side sheet with the latest run and history. NP and ORG. */
export default function KycScreenerPanel({ client }) {
  const { currentUser } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const key = ['kycScreenerRuns', tenantId, client.id];
  const { data: runs = [] } = useQuery({
    queryKey: key,
    enabled: !!tenantId && open,
    queryFn: async () => list(await base44.entities.KycScreenerRun.filter({ tenant_id: tenantId, client_id: client.id }, '-created_date', 10)),
    refetchInterval: (q) => (list(q.state.data).some((r) => r.status === 'running') ? 4000 : false),
  });
  const run = runs.find((r) => r.id === selectedId) || runs[0];

  const start = async () => {
    setStarting(true);
    try {
      const res = (await base44.functions.invoke('runKycScreener', { client_id: client.id }))?.data || {};
      if (res.error) throw new Error(res.error);
      setSelectedId(res.run_id);
      setOpen(true);
      qc.invalidateQueries({ queryKey: key });
      toast({ title: res.already_running ? 'A KYC Screener run is already in progress' : 'KYC Screener started', description: 'This takes 1–3 minutes. You can keep working.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not start the KYC Screener', description: e?.response?.data?.error || e?.message });
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Bot className="w-3.5 h-3.5" /> KYC Screener (Claude)
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>KYC Screener (Claude)</SheetTitle>
            <SheetDescription>Reads the client documents, screens every named party and applies the rules grid. Compare its screening with Didit's.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="gap-1.5" disabled={starting || run?.status === 'running'} onClick={start}>
                {starting || run?.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {runs.length ? 'Run again' : 'Run KYC Screener'}
              </Button>
              {run?.status === 'completed' && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openFile(run.id, 'xlsx')}><Download className="w-3.5 h-3.5" /> Excel</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openFile(run.id, 'pdf')}><Download className="w-3.5 h-3.5" /> PDF</Button>
                </>
              )}
              {runs.length > 1 && (
                <select aria-label="Earlier runs" className="ml-auto h-8 rounded-md border border-border bg-background px-2 text-xs" value={run?.id || ''} onChange={(e) => setSelectedId(e.target.value)}>
                  {runs.map((x) => <option key={x.id} value={x.id}>{x.ran_at ? format(new Date(x.ran_at), 'd MMM yyyy HH:mm') : x.id} · {x.status}{x.risk_rating ? ` · ${x.risk_rating}` : ''}</option>)}
                </select>
              )}
            </div>
            {!run && <p className="text-sm text-muted-foreground">No run yet. Running it sends this client's documents and profile to Claude (Anthropic).</p>}
            {run?.status === 'running' && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> {STAGE[run.stage] || 'Working'}…
              </div>
            )}
            {run?.status === 'failed' && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">The run failed: {run.error}</div>}
            {run?.status === 'completed' && <RunView run={run} />}
            {run && <p className="text-[11px] text-muted-foreground">Run by {run.run_by_name || '—'}{run.model ? ` · ${run.model}` : ''}{run.tokens_input ? ` · ${run.tokens_input + (run.tokens_output || 0)} tokens` : ''}. Method: anthropics/financial-services kyc-screener (Apache-2.0).</p>}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
