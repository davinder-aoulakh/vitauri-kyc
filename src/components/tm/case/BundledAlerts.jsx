import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import AddAlertPicker from '@/components/tm/case/AddAlertPicker';
import { alertShortId } from '@/lib/tmCase';

const WORKABLE = ['open', 'investigating'];

export default function BundledAlerts({ tmCase, alerts, scenarios, canWork, tenantId, run, busy }) {
  const total = alerts.reduce((s, a) => s + (a.score || 0), 0);
  const scenarioName = (a) => scenarios.find((s) => s.id === a.scenario_id)?.name || '—';
  const editable = canWork && WORKABLE.includes(tmCase.status);
  const remove = (id) => run('remove_alerts', { alert_ids: [id] }, { success: 'Alert removed from case' });
  const add = async (id) => !!(await run('add_alerts', { alert_ids: [id] }, { success: 'Alert added to case' }));

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-sm font-semibold mb-3">Bundled alerts</h2>
      {alerts.length === 0 ? <p className="text-sm text-muted-foreground">No alerts are linked to this case.</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 font-medium">Alert</th><th className="pb-2 font-medium">Scenario</th><th className="pb-2 font-medium text-right">Score</th><th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="py-2 pr-2"><Link to="/tm/alerts" className="font-mono text-xs text-primary hover:underline">{alertShortId(a.id)}</Link></td>
                <td className="py-2 pr-2 truncate max-w-[10rem]">{scenarioName(a)}</td>
                <td className="py-2 text-right tabular-nums">{a.score ?? '—'}{total > 0 && a.score ? <span className="text-xs text-muted-foreground"> · {Math.round((a.score / total) * 100)}%</span> : null}</td>
                <td className="py-2 text-right">
                  {editable && alerts.length > 1 && (
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="Remove from case" disabled={!!busy} onClick={() => remove(a.id)}><X className="w-3.5 h-3.5" /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editable && <AddAlertPicker tenantId={tenantId} onAdd={add} busy={!!busy} />}
    </section>
  );
}