import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';
import { toCsv, download } from '@/lib/tmQuality';
import { Download, Loader2 } from 'lucide-react';

const rows = async (entity, query, sort) => (await entity.filter(query, { sort, limit: 1000 })).items || [];

/** Export for model validation: tenant-scoped; backtests and samples are bounded to the selected period. */
export default function ExportMenu({ tenantId, period }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const run = async (kind) => {
    setBusy(true);
    try {
      const created = { $gte: `${period.from}T00:00:00.000Z`, $lte: `${period.to}T23:59:59.999Z` };
      const t = { tenant_id: tenantId };
      const [risks, scenarios, rules, backtests, samples] = await Promise.all([
        rows(base44.entities.TmRisk, t, 'code'), rows(base44.entities.TmScenario, t, 'code'), rows(base44.entities.TmRule, t, '-created_date'),
        rows(base44.entities.RuleBacktest, { ...t, created_date: created }, '-created_date'),
        rows(base44.entities.QualitySample, { ...t, created_date: created }, '-created_date'),
      ]);
      const flat = (s) => ({ ...s, items: undefined, item_count: s.items?.length || 0 });
      const data = { risks, scenarios, rules, backtests, samples: samples.map(flat) };
      const name = `tm-model-validation_${period.from}_${period.to}`;
      if (kind === 'json') download(`${name}.json`, JSON.stringify({ tenant_id: tenantId, period, exported_at: new Date().toISOString(), ...data, samples }, null, 2), 'application/json');
      else download(`${name}.csv`, toCsv(data), 'text/csv');
    } catch (e) {
      toast({ title: 'Export failed', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Export for model validation
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run('json')}>JSON (with sample items)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('csv')}>CSV (one section per table)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}