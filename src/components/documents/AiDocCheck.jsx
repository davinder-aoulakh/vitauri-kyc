import React from 'react';
import { Loader2, ShieldCheck, ShieldAlert, ShieldX, Sparkles, RotateCcw, CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// AI Document Checker Agent — UI pieces for the Documents tab. The verdict is advisory: the analyst decides.

/** Same rule as base44/shared/docCheckAgent.js isCheckable: the client's own uploads only. */
export function isCheckableDoc(doc) {
  if (!doc || doc.is_deleted || !doc.file_url) return false;
  if (['didit', 'didit_kyb'].includes(doc.source)) return false;
  if (doc.is_ai_generated || doc.doc_type === 'KYC_Report') return false;
  return !String(doc.file_name || '').startsWith('Didit_Verification_Report_');
}

export const VERDICT = {
  authentic:       { label: 'AI: looks authentic', short: 'Looks authentic', icon: ShieldCheck, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  needs_attention: { label: 'AI: needs attention', short: 'Needs attention', icon: ShieldAlert, cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  high_risk:       { label: 'AI: high risk',       short: 'High risk',       icon: ShieldX,     cls: 'bg-red-50 text-red-700 border-red-300' },
};

export function AiCheckChip({ doc, running, onCheck, onToggle }) {
  if (!isCheckableDoc(doc)) return null;
  if (running) {
    return <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200"><Loader2 className="w-3 h-3 animate-spin" /> AI checking…</span>;
  }
  const c = doc.ai_check;
  if (!c || c.status === 'error') {
    return (
      <button type="button" onClick={onCheck} title={c?.error ? `Last check failed: ${c.error}` : 'Check this document with the AI Document Checker'}
        className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border border-violet-200 text-violet-700 hover:bg-violet-50">
        <Sparkles className="w-3 h-3" /> {c?.status === 'error' ? 'AI check failed — retry' : 'Check with AI'}
      </button>
    );
  }
  const v = VERDICT[c.verdict] || VERDICT.needs_attention;
  const Icon = v.icon;
  return (
    <button type="button" onClick={onToggle} title={c.summary || v.label}
      className={cn('inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border font-medium', v.cls)}>
      <Icon className="w-3 h-3" /> {v.label}
    </button>
  );
}

const RESULT_ICON = {
  pass: <CheckCircle className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />,
  warn: <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />,
  fail: <XCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />,
  info: <Info className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />,
};

function CheckList({ title, checks }) {
  if (!checks.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <ul className="space-y-1">
        {checks.map((c, i) => (
          <li key={`${c.id}-${i}`} className="flex items-start gap-2 text-xs">
            {RESULT_ICON[c.result] || RESULT_ICON.info}
            <span><span className="font-medium">{c.label}</span>{c.detail ? <span className="text-muted-foreground"> — {c.detail}</span> : null}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiCheckPanel({ doc, client, onRecheck, running }) {
  const c = doc.ai_check;
  if (!c || c.status !== 'done') return null;
  const v = VERDICT[c.verdict] || VERDICT.needs_attention;
  const order = { fail: 0, warn: 1, pass: 2, info: 3 };
  const sort = (arr) => [...arr].sort((a, b) => (order[a.result] ?? 4) - (order[b.result] ?? 4));
  const fileChecks = sort((c.checks || []).filter((x) => x.source !== 'ai'));
  const aiChecks = sort((c.checks || []).filter((x) => x.source === 'ai'));
  const ex = c.extracted || {};
  const rows = [
    ['Name', ex.name, client?.full_name],
    [client?.client_type === 'ORG' ? 'Registration no.' : 'Date of birth', client?.client_type === 'ORG' ? ex.registration_number : ex.date_of_birth, client?.client_type === 'ORG' ? client?.registration_number : client?.date_of_birth],
    ['Address', ex.address, null],
  ].filter(([, a]) => a);

  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <Sparkles className="w-4 h-4 text-violet-600 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">AI Document Checker — <span className={cn('px-1.5 py-0.5 rounded-full border', v.cls)}>{v.short}</span> <span className="text-muted-foreground font-normal">score {c.score}/100</span></div>
          <p className="text-xs text-foreground/80 mt-1">{c.summary}</p>
          <div className="text-[11px] text-muted-foreground mt-1">
            {c.document_type_detected && <>Detected: {c.document_type_detected}{c.matches_request === false ? ' (not what was requested)' : ''} · </>}
            {c.issuer && <>Issuer: {c.issuer} · </>}
            {c.document_date && <>Dated: {c.document_date} · </>}
            Checked {c.run_at ? new Date(c.run_at).toLocaleString() : ''}
          </div>
        </div>
        <button type="button" onClick={onRecheck} disabled={running}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50">
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Re-check
        </button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <CheckList title="Content, consistency & validity (AI)" checks={aiChecks} />
        <CheckList title="File & metadata" checks={fileChecks} />
      </div>
      {rows.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Read from the document vs. client file</div>
          <div className="text-xs space-y-0.5">
            {rows.map(([label, docVal, fileVal]) => (
              <div key={label}><span className="text-muted-foreground w-28 inline-block">{label}</span> {docVal}{fileVal ? <span className="text-muted-foreground"> · on file: {fileVal}</span> : null}</div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground italic">AI indication — not a forensic certificate. The analyst decides whether to approve or reject the document.</p>
    </div>
  );
}

/** Banner for the tab header: counts of documents that need a look. */
export function AiCheckSummary({ documents, onShow }) {
  const docs = (documents || []).filter((d) => isCheckableDoc(d) && d.ai_check?.status === 'done' && (d.review_status || 'Pending_Review') === 'Pending_Review');
  const high = docs.filter((d) => d.ai_check.verdict === 'high_risk').length;
  const attention = docs.filter((d) => d.ai_check.verdict === 'needs_attention').length;
  if (!high && !attention) return null;
  return (
    <button type="button" onClick={onShow}
      className={cn('w-full text-left flex items-center gap-2 px-4 py-2 text-xs border-b', high ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900')}>
      <ShieldAlert className="w-4 h-4" />
      <span>
        <strong>AI Document Checker:</strong>{' '}
        {[high && `${high} high risk`, attention && `${attention} need${attention === 1 ? 's' : ''} attention`].filter(Boolean).join(', ')} — review before approving.
      </span>
      <span className="ml-auto underline">Show</span>
    </button>
  );
}
