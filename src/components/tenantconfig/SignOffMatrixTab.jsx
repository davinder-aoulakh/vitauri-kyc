import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Unacceptable'];
const APPROVER_OPTIONS = ['Analyst', 'QC Reviewer', 'Compliance Officer', 'Manager', 'Director', 'Compliance Admin'];

const RISK_COLORS = {
  Low:           'bg-emerald-50 border-emerald-200 text-emerald-700',
  Medium:        'bg-amber-50 border-amber-200 text-amber-700',
  High:          'bg-red-50 border-red-200 text-red-700',
  Unacceptable:  'bg-rose-100 border-rose-300 text-rose-800',
};

const DEFAULT_MATRIX = {
  Low:          { approver: 'Analyst',   compliance_mandatory: false },
  Medium:       { approver: 'Manager',   compliance_mandatory: false },
  High:         { approver: 'Director',  compliance_mandatory: false },
  Unacceptable: { approver: 'Director',  compliance_mandatory: false },
};

export default function SignOffMatrixTab({ tenant, currentUser, setTenant }) {
  const [matrix, setMatrix] = useState(DEFAULT_MATRIX);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (tenant?.sign_off_matrix && !hydrated.current) {
      hydrated.current = true;
      const merged = {};
      RISK_LEVELS.forEach(level => {
        merged[level] = {
          approver: tenant.sign_off_matrix[level]?.approver ?? DEFAULT_MATRIX[level].approver,
          compliance_mandatory: tenant.sign_off_matrix[level]?.compliance_mandatory ?? DEFAULT_MATRIX[level].compliance_mandatory,
        };
      });
      setMatrix(merged);
    }
  }, [tenant]);

  async function save() {
    setSaving(true);
    const updated = await base44.entities.Tenant.update(tenant.id, { sign_off_matrix: matrix });
    setTenant?.(updated);
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'sign_off_matrix_updated',
      notes: `Sign-off matrix updated by ${currentUser.full_name}`,
      after_state: matrix,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Sign-Off Matrix</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Define the required approver and compliance advisory settings per risk class.</p>
        </div>
        <Button size="sm" className="gap-2" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? '✓ Saved' : 'Save Matrix'}
        </Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <span className="text-xs text-blue-700">Compliance Advisory is Optional by default. Toggle Mandatory to require a Compliance Officer review for that risk class before approval.</span>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-3">Risk Class</th>
              <th className="text-left px-4 py-3">Required Approver</th>
              <th className="text-left px-4 py-3">Compliance Advisory</th>
              <th className="text-left px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {RISK_LEVELS.map(level => (
              <tr key={level} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <span className={cn('text-xs font-semibold px-3 py-1.5 rounded-full border inline-block', RISK_COLORS[level])}>
                    {level}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Select value={matrix[level].approver} onValueChange={v => setMatrix(m => ({ ...m, [level]: { ...m[level], approver: v } }))}>
                    <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {APPROVER_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={matrix[level].compliance_mandatory}
                      onCheckedChange={v => setMatrix(m => ({ ...m, [level]: { ...m[level], compliance_mandatory: v } }))}
                    />
                    <span className={cn('text-xs font-medium', matrix[level].compliance_mandatory ? 'text-amber-700' : 'text-muted-foreground')}>
                      {matrix[level].compliance_mandatory ? 'Mandatory' : 'Optional'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {level === 'Low' && 'Self sign-off by analyst'}
                  {level === 'Medium' && 'Manager or above required'}
                  {level === 'High' && 'Director sign-off required'}
                  {level === 'Unacceptable' && 'Director sign-off + escalation'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}