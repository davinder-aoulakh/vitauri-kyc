import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { CLASSES } from '@/lib/signoffRouting';

const OVERRIDE_LABEL = { auto: 'Auto (rules)', analyst: 'Analyst', manager: 'Manager', senior: 'Senior Management', senior_advice: 'Senior + Compliance advice' };
const EXISTING = ['New', ...CLASSES.filter((c) => c !== 'Unacceptable')];

// Module-level so inputs inside keep focus while typing (a component defined in render remounts each time).
const Row = ({ title, desc, children }) => (
  <div className="flex items-start justify-between gap-4 py-3">
    <div><div className="text-sm font-medium">{title}</div><p className="text-xs text-muted-foreground">{desc}</p></div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

/** Sign-off routing settings (build spec §2 TenantConfig.SignOffMatrix). value = sign_off_matrix object, onChange(patch). */
export default function SignOffRoutingSettings({ value, onChange }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const overrides = v.overrides || {};
  const strict = { Low: 'light', Medium: 'light', High: 'strict', Unacceptable: 'strict', ...(v.qc_strictness || {}) };
  const headings = Array.isArray(v.advice_template_headings) && v.advice_template_headings.length ? v.advice_template_headings : ['Assessment', 'Risks', 'Mitigating measures', 'Conclusion'];
  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-xl border border-border bg-card px-4">
        <Row title="Compliance Advice step" desc="When on, cases rated High or Unacceptable (effective class) need Compliance advice before sign-off. When off, the step is hidden.">
          <Switch checked={v.compliance_advice_enabled !== false} onCheckedChange={(x) => set({ compliance_advice_enabled: x })} />
        </Row>
        <Row title="Use the highest of existing and proposed classification" desc="Reviews of existing clients are routed on the higher of the previous and the new classification. A downgrade always needs a motivation.">
          <Switch checked={v.highest_of_existing_and_proposed !== false} onCheckedChange={(x) => set({ highest_of_existing_and_proposed: x })} />
        </Row>
        <Row title="Low-risk mode" desc="Self sign-off by the analyst (Low and Low), or automatic approval (policy auto-1) when every condition holds: Low/Low, no downgrade, not previously declined, QC passed without human decisions or open findings, no confirmed screening match, not TM-triggered. Otherwise the analyst signs off.">
          <Select value={v.low_risk_mode === 'automatic' ? 'automatic' : 'self'} onValueChange={(x) => set({ low_risk_mode: x })}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="self">Analyst self sign-off</SelectItem><SelectItem value="automatic">Automatic approval + sample review</SelectItem></SelectContent>
          </Select>
        </Row>
        {v.low_risk_mode === 'automatic' && (
          <Row title="Sample review rate" desc="Share of automatic approvals drawn at random for a review by a second person (Manager, Director or Compliance).">
            <div className="flex items-center gap-1.5">
              <Input type="number" min={0} max={100} className="h-8 w-20 text-xs" value={v.auto_approval_sample_pct ?? 10}
                onChange={(e) => set({ auto_approval_sample_pct: e.target.value === '' ? '' : Math.min(100, Math.max(0, Number(e.target.value))) })} />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </Row>
        )}
        <Row title="pKYC model" desc="Periodic reviews only, or periodic reviews plus event-driven reviews (EDR triggers) between them. Shown on approved cases.">
          <Select value={v.pkyc_model === 'periodic' ? 'periodic' : 'periodic_plus_events'} onValueChange={(x) => set({ pkyc_model: x })}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="periodic">Periodic only</SelectItem><SelectItem value="periodic_plus_events">Periodic + event-driven</SelectItem></SelectContent>
          </Select>
        </Row>
        <Row title="Retention of declined and terminated files" desc="Months a declined / terminated record is kept for re-application matching. No default: Compliance and the privacy officer must set it. Records are never deleted automatically.">
          <div className="flex items-center gap-1.5">
            <Input type="number" min={1} max={240} className="h-8 w-20 text-xs" placeholder="—" value={v.retention_months ?? ''}
              onChange={(e) => set({ retention_months: e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))) })} />
            <span className="text-xs text-muted-foreground">months</span>
          </div>
        </Row>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-medium">QC confirmation strictness</div>
        <p className="mb-3 text-xs text-muted-foreground">Strict: evidence checkboxes and a reason of at least 30 characters for human decisions in QC. Light: reason optional.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CLASSES.map((c) => (
            <label key={c} className="space-y-1 text-xs">
              <span className="font-medium">{c}</span>
              <Select value={strict[c]} onValueChange={(x) => set({ qc_strictness: { ...strict, [c]: x } })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="light">Light</SelectItem><SelectItem value="strict">Strict</SelectItem></SelectContent>
              </Select>
            </label>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card p-4">
        <div className="text-sm font-medium">Route overrides (existing × proposed)</div>
        <p className="mb-3 text-xs text-muted-foreground">Leave on Auto to follow the rules (Low → Analyst, Medium → Manager, High+ → Senior Management, advice from High). Unacceptable is always decided by Senior Management.</p>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">Existing ↓ / Proposed →</th>{CLASSES.map((c) => <th key={c} className="px-1 py-1">{c}</th>)}</tr></thead>
          <tbody>
            {EXISTING.map((e) => (
              <tr key={e}>
                <td className="py-1 pr-2 font-medium">{e === 'New' ? 'New client' : e}</td>
                {CLASSES.map((p) => {
                  const k = `${e}|${p}`;
                  return (
                    <td key={k} className="px-1 py-1">
                      <Select value={overrides[k] || 'auto'} onValueChange={(x) => { const o = { ...overrides }; if (x === 'auto') delete o[k]; else o[k] = x; set({ overrides: o }); }}>
                        <SelectTrigger className="h-7 min-w-32 text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(OVERRIDE_LABEL).map(([val, l]) => <SelectItem key={val} value={val} className="text-xs">{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div><div className="text-sm font-medium">Compliance advice template headings</div><p className="text-xs text-muted-foreground">Used by “Insert template” and the AI draft in the Compliance Advice step.</p></div>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => set({ advice_template_headings: [...headings, ''] })}><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>
        <div className="mt-2 space-y-1.5">
          {headings.map((h, i) => (
            <div key={i} className="flex gap-2">
              <Input value={h} className="h-8 text-sm" onChange={(e) => set({ advice_template_headings: headings.map((x, j) => (j === i ? e.target.value : x)) })} />
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Remove heading" onClick={() => set({ advice_template_headings: headings.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
