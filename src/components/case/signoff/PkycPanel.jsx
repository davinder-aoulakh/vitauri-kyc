import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { addMonths, format } from 'date-fns';
import { CalendarClock, Loader2 } from 'lucide-react';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);
const TRIGGERS = {
  ubo_change: 'UBO change', director_change: 'Director change', business_activity_change: 'Business activity change', country_change: 'Country change',
  screening_hit: 'New screening hit', risk_band_rise: 'Customer risk rises', profile_breach: 'Expected profile breached', tm_case: 'TM case', transaction_verification: 'Transaction verification',
};
const DEFAULT_YEARS = { Low: 3, Medium: 2, High: 1, Unacceptable: 1 };
const fmt = (d) => { try { return d ? format(new Date(d), 'd MMM yyyy') : '—'; } catch { return '—'; } };

/** pKYC after approval (spec §8): model, next review from the review cycle, triggers, escalation ladder. */
export default function PkycPanel({ kycCase, client, model = 'periodic_plus_events', canEdit, act, busy }) {
  const [cycle, setCycle] = useState(null);
  const [open, setOpen] = useState([]);
  const cls = kycCase.risk_classification || client?.risk_classification;
  useEffect(() => {
    let alive = true;
    Promise.all([
      base44.entities.ReviewCycle.filter({ tenant_id: kycCase.tenant_id, risk_class: cls }, undefined, 1).then(list).catch(() => []),
      model === 'periodic' ? Promise.resolve([]) : base44.entities.EdrTrigger.filter({ tenant_id: kycCase.tenant_id, client_id: kycCase.client_id, status: 'proposed' }, '-created_date', 10).then(list).catch(() => []),
    ]).then(([c, t]) => { if (alive) { setCycle(c[0] || null); setOpen(t); } });
    return () => { alive = false; };
  }, [kycCase.tenant_id, kycCase.client_id, cls, model]);

  const months = cycle?.cycle_months_override || (cycle?.cycle_years ? cycle.cycle_years * 12 : (DEFAULT_YEARS[cls] || 1) * 12);
  const base = kycCase.closed_at || kycCase.sign_off_approved_at || new Date().toISOString();
  const next = format(addMonths(new Date(base), months), 'yyyy-MM-dd');
  const current = client?.next_review_date ? String(client.next_review_date).slice(0, 10) : null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 text-xs">
      <div className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4" /> Ongoing monitoring (pKYC)</div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <span>Model: <strong>{model === 'periodic' ? 'Periodic reviews' : 'Periodic + event-driven reviews'}</strong></span>
        <span>Review cycle ({cls || '—'}): <strong>{months % 12 === 0 ? `${months / 12} year(s)` : `${months} months`}</strong>{cycle ? '' : ' (default)'}</span>
        <span>Next review by cycle: <strong>{fmt(next)}</strong></span>
        <span>Next review on the client file: <strong>{fmt(current)}</strong></span>
      </div>
      {canEdit && current !== next && (
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => act('set_next_review', { date: next }, `Next review set to ${fmt(next)}`)}>
          {busy === 'set_next_review' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Apply next review date {fmt(next)}
        </Button>
      )}
      {model !== 'periodic' && (
        <div>
          <div className="font-medium">Event triggers that start an event-driven review</div>
          <div className="mt-1 flex flex-wrap gap-1">{Object.values(TRIGGERS).map((t) => <span key={t} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]">{t}</span>)}</div>
          {open.length > 0 && <p className="mt-1 text-amber-800">{open.length} proposed trigger(s) for this client wait for a decision: {open.map((t) => TRIGGERS[t.trigger_type] || t.trigger_type).join(', ')}.</p>}
        </div>
      )}
      <div>
        <div className="font-medium">Escalation when a review is overdue</div>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
          <li>Review case opened automatically on the review date (daily review job).</li>
          <li>{cycle?.max_extension_days ? `Extension up to ${cycle.max_extension_days} days${cycle.exception_requires_role ? `, approved by ${cycle.exception_requires_role}` : ''}.` : 'No extension configured.'}</li>
          <li>{cycle?.escalate_after_days_overdue ? `Escalated to management after ${cycle.escalate_after_days_overdue} days overdue.` : 'Escalation after overdue: not configured (Tenant Config → Review Cycles).'}</li>
        </ol>
      </div>
    </section>
  );
}
