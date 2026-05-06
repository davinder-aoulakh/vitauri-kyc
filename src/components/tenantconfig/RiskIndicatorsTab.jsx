import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, GripVertical, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const APPLICABILITY_OPTIONS = ['NP_Client', 'ORG_Client', 'NP_Related_Party', 'ORG_Related_Party'];

const DEFAULT_INDICATORS = [
  { name: 'PEP Status', description: 'Entity is a Politically Exposed Person or closely associated.', applies_to: ['NP_Client','NP_Related_Party'] },
  { name: 'Sanctions Exposure', description: 'Entity appears on EU/UN/OFAC sanctions lists.', applies_to: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { name: 'Adverse Media', description: 'Entity linked to credible adverse media reports.', applies_to: ['NP_Client','ORG_Client','NP_Related_Party','ORG_Related_Party'] },
  { name: 'High-Risk Jurisdiction', description: 'Client resides in or entity is registered in a FATF high-risk or non-cooperative jurisdiction.', applies_to: ['NP_Client','ORG_Client'] },
  { name: 'Complex Ownership Structure', description: 'Entity has a layered or opaque beneficial ownership structure.', applies_to: ['ORG_Client'] },
  { name: 'Cash-Intensive Business', description: 'Business operates predominantly in cash.', applies_to: ['ORG_Client'] },
  { name: 'Unusual Transaction Patterns', description: 'Transactions inconsistent with stated business purpose or profile.', applies_to: ['NP_Client','ORG_Client'] },
  { name: 'Source of Wealth Unclear', description: 'Origin of wealth cannot be verified or is implausible.', applies_to: ['NP_Client','NP_Related_Party'] },
  { name: 'Correspondent Banking Exposure', description: 'Client operates or has exposure via correspondent banking relationships.', applies_to: ['ORG_Client'] },
  { name: 'Crypto / Virtual Asset Exposure', description: 'Client has significant exposure to virtual assets or crypto businesses.', applies_to: ['NP_Client','ORG_Client'] },
];

const BLANK = { name: '', description: '', applies_to: [], default_weight: 1.0, is_active: true };

export default function RiskIndicatorsTab({ tenant }) {
  const [indicators, setIndicators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: 'add'|'edit', data }
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  useEffect(() => { if (tenant?.id) load(); }, [tenant]);

  async function load() {
    const data = await base44.entities.RiskIndicator.filter({ tenant_id: tenant.id }, 'sort_order');
    setIndicators(data || []);
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const d = modal.data;
    if (modal.mode === 'add') {
      await base44.entities.RiskIndicator.create({ ...d, tenant_id: tenant.id, sort_order: indicators.length });
    } else {
      await base44.entities.RiskIndicator.update(d.id, d);
    }
    setModal(null);
    setSaving(false);
    load();
  }

  async function toggleActive(ind) {
    await base44.entities.RiskIndicator.update(ind.id, { is_active: !ind.is_active });
    load();
  }

  async function seedDefaults() {
    setSeeding(true);
    for (let i = 0; i < DEFAULT_INDICATORS.length; i++) {
      await base44.entities.RiskIndicator.create({ ...DEFAULT_INDICATORS[i], tenant_id: tenant.id, default_weight: 1.0, is_active: true, sort_order: i });
    }
    setSeeding(false);
    load();
  }

  // Simple drag-and-drop reorder
  function onDragStart(i) { setDragIdx(i); }
  function onDragOver(e, i) { e.preventDefault(); setOverIdx(i); }
  async function onDrop(e, i) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return; }
    const reordered = [...indicators];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(i, 0, moved);
    setIndicators(reordered);
    setDragIdx(null); setOverIdx(null);
    await Promise.all(reordered.map((ind, idx) => base44.entities.RiskIndicator.update(ind.id, { sort_order: idx })));
  }

  const toggleApplicability = (key) => {
    setModal(m => {
      const prev = m.data.applies_to || [];
      const next = prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key];
      return { ...m, data: { ...m.data, applies_to: next } };
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Risk Indicators</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Drag to reorder. Deactivated indicators are hidden from new assessments.</p>
        </div>
        <div className="flex gap-2">
          {indicators.length === 0 && (
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={seedDefaults} disabled={seeding}>
              {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Seed Defaults
            </Button>
          )}
          <Button size="sm" className="text-xs gap-1.5" onClick={() => setModal({ mode: 'add', data: { ...BLANK } })}>
            <Plus className="w-3.5 h-3.5" /> Add Indicator
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : indicators.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">No indicators yet. Seed defaults or add manually.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="w-6 px-2 py-3" />
                <th className="text-left px-4 py-3">Indicator</th>
                <th className="text-left px-4 py-3">Applies To</th>
                <th className="text-left px-4 py-3">Weight</th>
                <th className="text-left px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {indicators.map((ind, i) => (
                <tr
                  key={ind.id}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={e => onDragOver(e, i)}
                  onDrop={e => onDrop(e, i)}
                  className={cn('transition-colors', overIdx === i && 'bg-primary/5', !ind.is_active && 'opacity-50')}
                >
                  <td className="px-2 py-3 cursor-grab text-muted-foreground/50 hover:text-muted-foreground"><GripVertical className="w-4 h-4" /></td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-xs">{ind.name}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-xs">{ind.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(ind.applies_to || []).map(a => (
                        <span key={a} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full">{a.replace(/_/g,' ')}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">{ind.default_weight ?? 1.0}</td>
                  <td className="px-4 py-3">
                    <Switch checked={!!ind.is_active} onCheckedChange={() => toggleActive(ind)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setModal({ mode: 'edit', data: { ...ind } })}>
                      <Pencil className="w-3 h-3" /> Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!modal} onOpenChange={v => !v && setModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{modal?.mode === 'add' ? 'Add Risk Indicator' : 'Edit Risk Indicator'}</DialogTitle></DialogHeader>
          {modal && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium block mb-1.5">Name *</label>
                <Input value={modal.data.name} onChange={e => setModal(m => ({ ...m, data: { ...m.data, name: e.target.value } }))} className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Description</label>
                <Textarea value={modal.data.description} onChange={e => setModal(m => ({ ...m, data: { ...m.data, description: e.target.value } }))} className="text-sm min-h-16 resize-none" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Applies To</label>
                <div className="flex flex-wrap gap-2">
                  {APPLICABILITY_OPTIONS.map(opt => (
                    <button key={opt} type="button"
                      className={cn('text-xs px-2.5 py-1 rounded-full border transition-colors',
                        modal.data.applies_to?.includes(opt)
                          ? 'bg-primary text-white border-primary'
                          : 'border-border hover:bg-muted/50 text-muted-foreground'
                      )}
                      onClick={() => toggleApplicability(opt)}
                    >{opt.replace(/_/g,' ')}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Default Weight</label>
                <Input type="number" step="0.1" min="0.1" value={modal.data.default_weight ?? 1.0}
                  onChange={e => setModal(m => ({ ...m, data: { ...m.data, default_weight: Number(e.target.value) } }))} className="h-9 text-sm w-28" />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setModal(null)}>Cancel</Button>
                <Button onClick={save} disabled={saving || !modal.data.name.trim()} className="gap-2">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}