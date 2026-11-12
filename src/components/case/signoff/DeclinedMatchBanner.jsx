import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { errText } from '@/hooks/useSignoff';

const fmt = (d) => { try { return d ? format(new Date(d), 'd MMM yyyy') : ''; } catch { return ''; } };
const OBLIGATION = { no_report_required: 'no report required', report_filed: 'report filed', report_to_be_filed: 'report to be filed' };

/**
 * Re-application banner (spec §9): this client or its people match a declined / terminated relationship.
 * Everyone sees what matched; only Compliance can open the internal reason (audited server-side).
 */
export default function DeclinedMatchBanner({ caseId, matches = [], canView }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (!matches.length) return null;
  const review = matches.filter((m) => m.strength === 'strong' && !m.info_only);
  const possible = matches.filter((m) => m.strength !== 'strong' && !m.info_only);
  const info = matches.filter((m) => m.info_only);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await base44.functions.invoke('caseSignoffAction', { case_id: caseId, action: 'declined_detail' });
      setDetail(r?.data?.records || []);
    } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  };
  const tone = review.length ? 'border-red-300 bg-red-50 text-red-900' : possible.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-800';
  return (
    <div className={`space-y-2 rounded-xl border p-3 text-xs ${tone}`}>
      <div className="flex items-start gap-2">
        {review.length || possible.length ? <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> : <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />}
        <div className="flex-1">
          <div className="text-sm font-semibold">
            {review.length ? 'Previously declined — Compliance review is mandatory' : possible.length ? 'Possible match with a declined relationship' : 'Linked to an earlier case that was closed without completion'}
          </div>
          <ul className="mt-1 space-y-0.5">
            {[...review, ...possible, ...info].map((m, i) => (
              <li key={i}>{m.status}{m.decided_at ? ` (${fmt(m.decided_at)})` : ''} · {m.strength === 'strong' ? 'strong' : 'possible'} match on {m.matched_on.join(', ')}</li>
            ))}
          </ul>
          {possible.length > 0 && !review.length && <p className="mt-1">Check whether this is the same person or company; Compliance decides on a possible match.</p>}
        </div>
        {canView && !detail && <Button size="sm" variant="outline" className="h-7 bg-white text-xs" disabled={loading} onClick={load}>{loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'View reasons'}</Button>}
      </div>
      {error && <p className="text-red-700">{error}</p>}
      {detail && (
        <div className="space-y-1.5 rounded-lg border border-border bg-white p-2 text-slate-800">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Internal — Compliance only</div>
          {detail.map((r) => (
            <div key={r.id}>
              <span className="font-medium">{r.status}</span> · {fmt(r.decided_at)}{r.reporting_obligation_assessment ? ` · reporting: ${OBLIGATION[r.reporting_obligation_assessment] || r.reporting_obligation_assessment}` : ''}{r.retention_until ? ` · kept until ${fmt(r.retention_until)}` : ''}
              {r.internal_reason && <p className="text-muted-foreground">{r.internal_reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
