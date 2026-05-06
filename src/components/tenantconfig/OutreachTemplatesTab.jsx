import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Loader2, FileText, Database } from 'lucide-react';
import { cn } from '@/lib/utils';

const CLIENT_TYPES = ['NP', 'ORG'];
const CASE_TYPES   = ['Onboarding', 'Periodic_Review', 'Event_Driven_Review', 'Offboarding'];
const BLANK = { label: '', description: '', item_type: 'document', client_types: ['NP','ORG'], case_types: ['Onboarding'], is_mandatory: false, is_active: true, sort_order: 0 };

export default function OutreachTemplatesTab({ tenant }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [filterType, setFilterType] = useState('all');

  useEffect(() => { if (tenant?.id) load(); }, [tenant]);

  async function load() {
    const data = await base44.entities.OutreachTemplate.filter({ tenant_id: tenant.id }, 'sort_order');
    setTemplates(data || []);
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const d = modal.data;
    if (modal.mode === 'add') {
      await base44.entities.OutreachTemplate.create({ ...d, tenant_id: tenant.id });
    } else {
      await base44.entities.OutreachTemplate.update(d.id, d);
    }
    setModal(null);
    setSaving(false);
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this template?')) return;
    await base44.entities.OutreachTemplate.delete(id);
    load();
  }

  async function toggleActive(tmpl) {
    await base44.entities.OutreachTemplate.update(tmpl.id, { is_active: !tmpl.is_active });
    load();
  }

  function toggleTag(field, val) {
    setModal(m => {
      const prev = m.data[field] || [];
      const next = prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val];
      return { ...m, data: { ...m.data, [field]: next } };
    });
  }

  const filtered = templates.filter(t => filterType === 'all' || t.item_type === filterType);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Outreach Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Document and data-point templates used when building outreach requests.</p>
        </div>
        <Button size="sm" className="text-xs gap-1.5" onClick={() => setModal({ mode: 'add', data: { ...BLANK } })}>
          <Plus className="w-3.5 h-3.5" /> Add Template
        </Button>
      </div>

      <div className="flex gap-2">
        {[['all','All'],['document','Documents'],['data_point','Data Points']].map(([v,l]) => (
          <button key={v} onClick={() => setFilterType(v)}
            className={cn('text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
              filterType === v ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}>{l}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">No templates. Add your first template above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Label</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Client Types</th>
                <th className="text-left px-4 py-3">Mandatory</th>
                <th className="text-left px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(tmpl => (
                <tr key={tmpl.id} className={cn('hover:bg-muted/20 transition-colors', !tmpl.is_active && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {tmpl.item_type === 'document' ? <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /> : <Database className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />}
                      <div>
                        <div className="font-medium text-xs">{tmpl.label}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-xs">{tmpl.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full', tmpl.item_type === 'document' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700')}>
                      {tmpl.item_type === 'document' ? 'Document' : 'Data Point'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {(tmpl.client_types || []).map(t => <span key={t} className="text-xs bg-muted px-1.5 py-0.5 rounded">{t}</span>)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full', tmpl.is_mandatory ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-500')}>
                      {tmpl.is_mandatory ? 'Mandatory' : 'Optional'}
                    </span>
                  </td>
                  <td className="px-4 py-3"><Switch checked={!!tmpl.is_active} onCheckedChange={() => toggleActive(tmpl)} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setModal({ mode: 'edit', data: { ...tmpl } })}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => remove(tmpl.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!modal} onOpenChange={v => !v && setModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{modal?.mode === 'add' ? 'Add Template' : 'Edit Template'}</DialogTitle></DialogHeader>
          {modal && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1.5">Label *</label>
                  <Input value={modal.data.label} onChange={e => setModal(m => ({ ...m, data: { ...m.data, label: e.target.value } }))} className="h-9 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1.5">Description</label>
                  <Textarea value={modal.data.description} onChange={e => setModal(m => ({ ...m, data: { ...m.data, description: e.target.value } }))} className="text-sm min-h-12 resize-none" />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5">Type</label>
                  <Select value={modal.data.item_type} onValueChange={v => setModal(m => ({ ...m, data: { ...m.data, item_type: v } }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="document">Document</SelectItem>
                      <SelectItem value="data_point">Data Point</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Switch checked={!!modal.data.is_mandatory} onCheckedChange={v => setModal(m => ({ ...m, data: { ...m.data, is_mandatory: v } }))} />
                  <label className="text-xs font-medium">Mandatory</label>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Client Types</label>
                <div className="flex gap-2">
                  {CLIENT_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => toggleTag('client_types', t)}
                      className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors',
                        modal.data.client_types?.includes(t) ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/50 text-muted-foreground'
                      )}>{t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Case Types</label>
                <div className="flex flex-wrap gap-2">
                  {CASE_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => toggleTag('case_types', t)}
                      className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors',
                        modal.data.case_types?.includes(t) ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/50 text-muted-foreground'
                      )}>{t.replace(/_/g,' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setModal(null)}>Cancel</Button>
                <Button onClick={save} disabled={saving || !modal.data.label.trim()} className="gap-2">
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