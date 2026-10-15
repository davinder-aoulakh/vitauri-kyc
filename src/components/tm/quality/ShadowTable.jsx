import React from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { releaseEligibility, shortDate } from '@/lib/tmQuality';
import { Loader2 } from 'lucide-react';

function Toggle({ label, on, canToggle, eligible, busy, onChange }) {
  const blocked = !on && !eligible.ok;
  const title = !canToggle ? 'Only a Director or Compliance Officer can change this' : blocked ? eligible.reason : '';
  return (
    <label className="flex items-center gap-2 text-xs" title={title}>
      <Switch checked={on} disabled={!canToggle || blocked || !!busy} onCheckedChange={onChange} aria-label={label} />
      {label}
    </label>
  );
}

export default function ShadowTable({ scenarios, latest, canRelease, maxPct, busy, onRun, onRelease }) {
  return (
    <section className="mt-5">
      <h2 className="text-sm font-semibold mb-2">✦ AI performance per scenario (shadow mode)</h2>
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              {['Scenario', 'Missed', 'Wrongly closed (x / n)', 'Citations OK %', 'Release status', ''].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const sample = latest.get(s.id);
              const m = sample?.metrics;
              const elig = releaseEligibility(sample, maxPct);
              return (
                <tr key={s.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2.5 font-medium">{s.code} · {s.name}</td>
                  <td className="px-3 py-2.5 tabular-nums">{m ? m.missed : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">{m ? `${m.wrongly_closed} / ${m.close_proposals}` : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">{m?.citations_ok_pct != null ? `${m.citations_ok_pct}%` : '—'}
                    {sample && <div className="text-[11px] text-muted-foreground">{shortDate(sample.completed_at)}</div>}</td>
                  <td className="px-3 py-2.5 space-y-1.5">
                    <Toggle label="Bulk close" on={s.bulk_close_released === true} canToggle={canRelease} eligible={elig} busy={busy} onChange={(v) => onRelease(s.id, 'bulk_close_released', v)} />
                    <Toggle label="Sample review" on={s.ai_sample_review_released === true} canToggle={canRelease} eligible={elig} busy={busy} onChange={(v) => onRelease(s.id, 'ai_sample_review_released', v)} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onRun(s.id)}>{busy === `shadow:${s.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Run sample</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">Only scenarios that meet the agreed thresholds are released for sample-based review.</p>
    </section>
  );
}