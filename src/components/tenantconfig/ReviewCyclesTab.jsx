import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, Loader2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULTS = [
  { risk_class: 'Low',           cycle_years: 5    },
  { risk_class: 'Medium',        cycle_years: 3    },
  { risk_class: 'High',          cycle_years: 1    },
  { risk_class: 'Unacceptable',  cycle_years: 0.25 },
];

const RISK_COLORS = {
  Low:           'bg-emerald-50 border-emerald-200 text-emerald-700',
  Medium:        'bg-amber-50 border-amber-200 text-amber-700',
  High:          'bg-red-50 border-red-200 text-red-700',
  Unacceptable:  'bg-rose-100 border-rose-300 text-rose-800',
};

function yearsLabel(y) {
  if (y < 1) return `${Math.round(y * 12)} months`;
  if (y === 1) return '12 months';
  return `${y} years`;
}

export default function ReviewCyclesTab({ tenant }) {
  const [cycles, setCycles] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (tenant?.id) load(); }, [tenant]);

  async function load() {
    const data = await base44.entities.ReviewCycle.filter({ tenant_id: tenant.id });
    if (data?.length > 0) {
      setCycles(DEFAULTS.map(d => {
        const found = data.find(r => r.risk_class === d.risk_class);
        return found ? { ...d, cycle_years: found.cycle_years, id: found.id } : d;
      }));
    }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    for (const cycle of cycles) {
      if (cycle.id) {
        await base44.entities.ReviewCycle.update(cycle.id, { cycle_years: cycle.cycle_years });
      } else {
        await base44.entities.ReviewCycle.create({ tenant_id: tenant.id, risk_class: cycle.risk_class, cycle_years: cycle.cycle_years });
      }
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    load();
  }

  function update(i, val) {
    const v = Math.max(0.25, Number(val));
    setCycles(c => c.map((r, idx) => idx === i ? { ...r, cycle_years: v } : r));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Periodic Review Cycles</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Set review frequency per risk class. Changes apply to new cases only — not retroactive.</p>
        </div>
        <Button size="sm" className="gap-2" onClick={save} disabled={saving || loading}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? '✓ Saved' : 'Save Cycles'}
        </Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <span className="text-xs text-blue-700">Changes apply to newly created cases only. Existing open cases retain their original review schedule.</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-3">
          {cycles.map((cycle, i) => (
            <div key={cycle.risk_class} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
              <span className={cn('text-xs font-semibold px-3 py-1.5 rounded-full border w-32 text-center flex-shrink-0', RISK_COLORS[cycle.risk_class])}>
                {cycle.risk_class}
              </span>
              <div className="flex items-center gap-2 flex-1">
                <Input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={cycle.cycle_years}
                  onChange={e => update(i, e.target.value)}
                  className="h-9 w-24 text-sm font-mono"
                />
                <span className="text-xs text-muted-foreground">years</span>
              </div>
              <div className="text-xs text-muted-foreground">{yearsLabel(cycle.cycle_years)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}