import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RuleSentence from '@/components/tm/rules/RuleSentence';
import StatusPill from '@/components/tm/kit/StatusPill';
import { errorMessage } from '@/lib/tmAlerts';
import { humanise } from '@/lib/diditReadable';
import { Loader2, Search } from 'lucide-react';

const CATEGORIES = ['all', 'finance', 'aml_ctf', 'anomaly_detection', 'fatf'];
const PAGE = 25;

/** Browse Didit's preset rule library and import a rule as an inactive Vitauri draft (it still needs approval before it runs). */
export default function DiditLibraryDialog({ open, onOpenChange, tenantId, scenarios, call, busy, onImported }) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('all');
  const [offset, setOffset] = useState(0);
  const [scenarioId, setScenarioId] = useState('');

  useEffect(() => { const t = setTimeout(() => { setTerm(search.trim()); setOffset(0); }, 350); return () => clearTimeout(t); }, [search]);

  const q = useQuery({
    queryKey: ['diditRuleLibrary', tenantId, term, category, offset],
    enabled: open && !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (await base44.functions.invoke('diditRuleLibrary', { action: 'list', search: term, category: category === 'all' ? '' : category, limit: PAGE, offset })).data,
  });
  const rules = q.data?.rules || [];

  const use = async (r) => {
    const res = await call('diditRuleLibrary', { action: 'import', library_key: r.library_key, title: r.title, scenario_id: scenarioId || undefined }, 'Draft created from the Didit library');
    if (res?.rule_id) { q.refetch(); onImported(res.rule_id); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Didit rule library</DialogTitle>
          <DialogDescription>
            Didit's preset rules. "Use as draft" copies a rule into Vitauri as an inactive draft. It runs only after a second person approves it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the library" className="pl-8 h-9 text-sm" aria-label="Search the Didit library" />
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v); setOffset(0); }}>
            <SelectTrigger className="h-9 text-sm sm:w-44" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c === 'all' ? 'All categories' : humanise(c).replace('Aml Ctf', 'AML / CTF').replace('Fatf', 'FATF')}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={scenarioId || 'none'} onValueChange={(v) => setScenarioId(v === 'none' ? '' : v)}>
            <SelectTrigger className="h-9 text-sm sm:w-48" aria-label="Link drafts to scenario"><SelectValue placeholder="Scenario (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No scenario yet</SelectItem>
              {(scenarios || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.code} · {s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="max-h-[28rem] overflow-y-auto divide-y divide-border -mx-1 px-1">
          {q.isLoading && <div className="flex justify-center py-10" role="status"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
          {q.error && <p className="py-6 text-sm text-destructive text-center">{errorMessage(q.error)}</p>}
          {!q.isLoading && !q.error && rules.length === 0 && <p className="py-6 text-sm text-muted-foreground text-center">No library rules match.</p>}
          {rules.map((r) => (
            <div key={r.library_key} className="py-3 flex flex-col sm:flex-row gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{r.title}</span>
                  {r.category && <StatusPill tone="neutral">{humanise(r.category).replace('Aml Ctf', 'AML / CTF').replace('Fatf', 'FATF')}</StatusPill>}
                  {r.installed_in_didit && <StatusPill tone="warning" title="Installed directly in Didit, outside Vitauri">Installed in Didit</StatusPill>}
                  {r.imported_rule_id && <StatusPill tone="success">In Vitauri</StatusPill>}
                </div>
                {r.description && <p className="text-xs text-muted-foreground line-clamp-3">{r.description}</p>}
                <RuleSentence definition={r.definition} className="text-xs" />
                {r.industries?.length > 0 && <p className="text-[11px] text-muted-foreground">For: {r.industries.map(humanise).join(', ')}</p>}
                {!r.importable && <p className="text-[11px] text-amber-700">Can't be imported yet: {r.problem}</p>}
              </div>
              <div className="shrink-0">
                <Button size="sm" variant="outline" className="text-xs" disabled={!r.importable || !!r.imported_rule_id || busy === 'import'}
                  onClick={() => (r.imported_rule_id ? onImported(r.imported_rule_id) : use(r))}>
                  {r.imported_rule_id ? 'Already imported' : 'Use as draft'}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {(q.data?.count || 0) > PAGE && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{offset + 1}–{Math.min(offset + PAGE, q.data.count)} of {q.data.count}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
              <Button size="sm" variant="outline" className="text-xs" disabled={!q.data?.next} onClick={() => setOffset(offset + PAGE)}>Next</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
