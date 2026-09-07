import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Plus, Pencil, Trash2, Loader2, Mail, Eye, X, Sparkles, RefreshCw,
  GripVertical, CheckCircle2, ChevronDown, LibraryBig, FileText
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import FormTemplatePreview from './FormTemplatePreview';

const CLIENT_TYPES  = ['NP', 'ORG'];
const CASE_TYPES    = ['Onboarding', 'Periodic_Review', 'Event_Driven_Review', 'Offboarding'];
const CHANNELS      = ['Email', 'Portal'];

const BLANK = {
  name: '',
  description: '',
  applicable_client_types: [],
  applicable_case_types: [],
  default_deadline_days: 14,
  default_channel: 'Email',
  items: [],
  email_template_id: '',
  is_active: true,
};

function SectionHeading({ children }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function CheckChip({ label, checked, onChange }) {
  return (
    <label className={cn(
      'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-all select-none',
      checked ? 'bg-primary/10 border-primary/40 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/30'
    )}>
      <input type="checkbox" className="hidden" checked={checked} onChange={onChange} />
      {checked && <CheckCircle2 className="w-3 h-3" />}
      {label.replace('_', ' ')}
    </label>
  );
}

// Draggable item row
function ItemRow({ item, index, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const ft = item.field_type || (item.item_type === 'document' ? 'file_upload' : 'textarea');
  const typeColors = {
    file_upload: 'bg-blue-50 text-blue-700',
    text: 'bg-slate-50 text-slate-600',
    textarea: 'bg-slate-50 text-slate-600',
    number: 'bg-purple-50 text-purple-700',
    date: 'bg-green-50 text-green-700',
    dropdown: 'bg-amber-50 text-amber-700',
    multi_select: 'bg-amber-50 text-amber-700',
    checkbox: 'bg-orange-50 text-orange-700',
    yes_no: 'bg-pink-50 text-pink-700',
    signature: 'bg-rose-50 text-rose-700',
    section_header: 'bg-gray-50 text-gray-600',
  };

  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-white border border-border rounded-lg group hover:border-primary/30 transition-colors">
      <div className="flex flex-col gap-0.5">
        <button onClick={onMoveUp} disabled={isFirst} className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors">
          <ChevronDown className="w-3 h-3 rotate-180" />
        </button>
        <button onClick={onMoveDown} disabled={isLast} className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors">
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{item.label}</div>
        {item.description && <div className="text-xs text-muted-foreground truncate">{item.description?.replace(/<[^>]*>/g, '')}</div>}
      </div>
      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', typeColors[ft] || 'bg-slate-50 text-slate-600')}>
        {ft.replace('_', ' ')}
      </span>
      {item.is_mandatory && <span className="text-xs text-red-500 font-bold">*</span>}
      <button onClick={() => onRemove(index)} className="text-muted-foreground hover:text-destructive transition-colors ml-1">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Library picker dialog
function FieldLibraryPicker({ open, onClose, tenantId, alreadySelected, onAdd }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !tenantId) return;
    setLoading(true);
    base44.entities.OutreachTemplate.filter({ tenant_id: tenantId, is_active: true })
      .then(d => { setAll(d || []); setLoading(false); });
  }, [open, tenantId]);

  const selectedIds = new Set(alreadySelected.map(i => i.outreach_template_id));
  const filtered = all.filter(t => !search || t.label?.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="text-sm">Add from Field Library</DialogTitle>
        </DialogHeader>
        <div className="px-4 py-2 border-b border-border">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fields…" className="h-8 text-xs" />
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {!loading && filtered.length === 0 && <div className="text-xs text-muted-foreground text-center py-8">No fields found.</div>}
          {!loading && filtered.map(tmpl => {
            const isAdded = selectedIds.has(tmpl.id);
            const ft = tmpl.field_type || (tmpl.item_type === 'document' ? 'file_upload' : 'textarea');
            return (
              <div key={tmpl.id} className={cn('flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all',
                isAdded ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted/20'
              )} onClick={() => !isAdded && onAdd(tmpl)}>
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{tmpl.label}</div>
                  {tmpl.description && <div className="text-xs text-muted-foreground truncate">{tmpl.description?.replace(/<[^>]*>/g, '')}</div>}
                </div>
                <span className="text-xs text-muted-foreground">{ft.replace('_', ' ')}</span>
                {isAdded && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
              </div>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t border-border">
          <Button variant="outline" size="sm" className="text-xs w-full" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FormTemplatesTab({ tenant }) {
  const [templates, setTemplates]     = useState([]);
  const [emailTmpls, setEmailTmpls]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [modal, setModal]             = useState(null); // { mode, data }
  const [saving, setSaving]           = useState(false);
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [aiOpen, setAiOpen]           = useState(false);
  const [aiDesc, setAiDesc]           = useState('');
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiStatus, setAiStatus]       = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    if (tenant?.id) load();
  }, [tenant]);

  async function load() {
    setLoading(true);
    const [ft, et] = await Promise.all([
      base44.entities.OutreachFormTemplate.filter({ tenant_id: tenant.id }),
      base44.entities.EmailTemplate.filter({ tenant_id: tenant.id, is_active: true }),
    ]);
    setTemplates(ft || []);
    setEmailTmpls(et || []);
    setLoading(false);
  }

  async function save() {
    if (!modal?.data?.name) return;
    setSaving(true);
    const d = { ...modal.data, tenant_id: tenant.id };
    if (modal.mode === 'add') {
      await base44.entities.OutreachFormTemplate.create(d);
    } else {
      await base44.entities.OutreachFormTemplate.update(d.id, d);
    }
    setSaving(false);
    setModal(null);
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this form template?')) return;
    await base44.entities.OutreachFormTemplate.delete(id);
    load();
  }

  async function toggleActive(tmpl) {
    await base44.entities.OutreachFormTemplate.update(tmpl.id, { is_active: !tmpl.is_active });
    load();
  }

  function toggleClientType(ct) {
    setModal(m => {
      const cur = m.data.applicable_client_types || [];
      return { ...m, data: { ...m.data, applicable_client_types: cur.includes(ct) ? cur.filter(x => x !== ct) : [...cur, ct] } };
    });
  }

  function toggleCaseType(ct) {
    setModal(m => {
      const cur = m.data.applicable_case_types || [];
      return { ...m, data: { ...m.data, applicable_case_types: cur.includes(ct) ? cur.filter(x => x !== ct) : [...cur, ct] } };
    });
  }

  function addFieldFromLibrary(tmpl) {
    const newItem = {
      outreach_template_id:           tmpl.id,
      sort_order:                     (modal.data.items?.length || 0),
      is_mandatory:                   tmpl.validation_required || tmpl.is_mandatory || false,
      label:                          tmpl.label,
      field_type:                     tmpl.field_type || (tmpl.item_type === 'document' ? 'file_upload' : 'textarea'),
      item_type:                      tmpl.item_type,
      description:                    tmpl.description || '',
      field_options:                  tmpl.field_options || [],
      validation_required:            tmpl.validation_required ?? false,
      validation_accepted_file_types: tmpl.validation_accepted_file_types || [],
      validation_max_file_size_mb:    tmpl.validation_max_file_size_mb || 25,
      idv_accepted_doc_types:         tmpl.idv_accepted_doc_types || [],
      idv_min_match_score:            tmpl.idv_min_match_score ?? 75,
      idv_liveness_required:          tmpl.idv_liveness_required ?? true,
      idv_workflow_id:                tmpl.idv_workflow_id   || '',
      idv_workflow_name:              tmpl.idv_workflow_name || '',
    };
    setModal(m => ({ ...m, data: { ...m.data, items: [...(m.data.items || []), newItem] } }));
  }

  function removeItem(idx) {
    setModal(m => ({ ...m, data: { ...m.data, items: m.data.items.filter((_, i) => i !== idx) } }));
  }

  function moveItem(idx, dir) {
    setModal(m => {
      const items = [...(m.data.items || [])];
      const target = idx + dir;
      if (target < 0 || target >= items.length) return m;
      [items[idx], items[target]] = [items[target], items[idx]];
      return { ...m, data: { ...m.data, items } };
    });
  }

  async function generateWithAi() {
    if (!aiDesc.trim()) return;
    setAiLoading(true);
    setAiStatus(null);

    // Fetch library items for context
    const library = await base44.entities.OutreachTemplate.filter({ tenant_id: tenant.id, is_active: true });
    const libraryList = (library || []).map(t => `- id:${t.id} | label:"${t.label}" | type:${t.field_type || t.item_type}`).join('\n');
    const emailList = emailTmpls.map(e => `- id:${e.id} | name:"${e.name}" | situation:${e.situation}`).join('\n');

    const prompt = `You are a KYC compliance expert. Based on the description below, create a form template configuration.

Description: ${aiDesc}

Available outreach template items from library:
${libraryList || 'None yet'}

Available email templates:
${emailList || 'None yet'}

Return JSON:
{
  "name": "string — template name",
  "description": "string — short description",
  "applicable_client_types": ["NP"|"ORG"],
  "applicable_case_types": ["Onboarding"|"Periodic_Review"|"Event_Driven_Review"|"Offboarding"],
  "default_deadline_days": number,
  "default_channel": "Email"|"Portal",
  "items": [{ "outreach_template_id": "id from library above", "is_mandatory": boolean }],
  "suggested_email_template_id": "id from email templates above or null",
  "suggested_email_situation": "Documentation_Request"|"Welcome"|"First_Reminder"|etc (if no match)
}

Only include items whose ids exist in the library list above. Return valid JSON only.`;

    const res = await base44.integrations.Core.InvokeLLM({ prompt });
    const raw = typeof res?.result === 'string' ? res.result : JSON.stringify(res?.result || res || '');
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      setAiStatus('error');
      setAiLoading(false);
      return;
    }

    // Enrich items with display data from library
    const libMap = Object.fromEntries((library || []).map(t => [t.id, t]));
    const enrichedItems = (parsed.items || [])
      .filter(i => libMap[i.outreach_template_id])
      .map((i, idx) => {
        const t = libMap[i.outreach_template_id];
        return { ...i, sort_order: idx, label: t.label, field_type: t.field_type, item_type: t.item_type, description: t.description };
      });

    setModal(m => ({
      ...m,
      data: {
        ...m.data,
        name: parsed.name || m.data.name,
        description: parsed.description || m.data.description,
        applicable_client_types: parsed.applicable_client_types || m.data.applicable_client_types,
        applicable_case_types: parsed.applicable_case_types || m.data.applicable_case_types,
        default_deadline_days: parsed.default_deadline_days || m.data.default_deadline_days,
        default_channel: parsed.default_channel || m.data.default_channel,
        items: enrichedItems,
        email_template_id: parsed.suggested_email_template_id || m.data.email_template_id,
      }
    }));

    setAiStatus('success');
    setAiLoading(false);
    setAiOpen(false);
    toast({ description: 'AI generated form template — review and save.' });
  }

  const emailTmplMap = Object.fromEntries(emailTmpls.map(e => [e.id, e]));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Form Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Form templates let you package a set of fields with an email into a reusable one-click outreach pack.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1.5"
            onClick={() => { setModal({ mode: 'add', data: { ...BLANK } }); setAiOpen(true); }}>
            <Sparkles className="w-3.5 h-3.5" /> Generate with AI
          </Button>
          <Button size="sm" className="text-xs gap-1.5"
            onClick={() => setModal({ mode: 'add', data: { ...BLANK } })}>
            <Plus className="w-3.5 h-3.5" /> New Template
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No form templates yet. Create your first template above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Client Types</th>
                <th className="text-left px-4 py-3">Channel</th>
                <th className="text-left px-4 py-3">Fields</th>
                <th className="text-left px-4 py-3">Email Template</th>
                <th className="text-left px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {templates.map(tmpl => (
                <tr key={tmpl.id} className={cn('hover:bg-muted/20 transition-colors', !tmpl.is_active && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <LibraryBig className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <div>
                        <div className="font-medium text-xs">{tmpl.name}</div>
                        {tmpl.description && <div className="text-xs text-muted-foreground truncate max-w-[180px]">{tmpl.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {(tmpl.applicable_client_types || []).map(ct => (
                        <span key={ct} className="text-xs bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">{ct}</span>
                      ))}
                      {(!tmpl.applicable_client_types?.length) && <span className="text-xs text-muted-foreground">All</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      {tmpl.default_channel || 'Email'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {(tmpl.items || []).length} fields
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {tmpl.email_template_id
                      ? (emailTmplMap[tmpl.email_template_id]?.name || <span className="italic opacity-50">Unknown</span>)
                      : <span className="italic opacity-40">None</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Switch checked={!!tmpl.is_active} onCheckedChange={() => toggleActive(tmpl)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                        onClick={() => setPreviewTemplate(tmpl)} title="Preview in portal">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={async () => {
                          const library = await base44.entities.OutreachTemplate.filter({
                            tenant_id: tenant.id, is_active: true
                          });
                          const libMap = Object.fromEntries((library || []).map(t => [t.id, t]));
                          const hydratedItems = (tmpl.items || []).map(item => {
                            const lib = libMap[item.outreach_template_id];
                            if (!lib) return item;
                            return {
                              outreach_template_id:           item.outreach_template_id,
                              sort_order:                     item.sort_order ?? 0,
                              is_mandatory:                   item.is_mandatory ?? lib.validation_required ?? false,
                              label:                          lib.label,
                              field_type:                     lib.field_type || (lib.item_type === 'document' ? 'file_upload' : 'textarea'),
                              item_type:                      lib.item_type,
                              description:                    lib.description || '',
                              field_options:                  lib.field_options || [],
                              validation_required:            lib.validation_required ?? false,
                              validation_accepted_file_types: lib.validation_accepted_file_types || [],
                              validation_max_file_size_mb:    lib.validation_max_file_size_mb || 25,
                              idv_accepted_doc_types:         lib.idv_accepted_doc_types || [],
                              idv_min_match_score:            lib.idv_min_match_score ?? 75,
                              idv_liveness_required:          lib.idv_liveness_required ?? true,
                              idv_workflow_id:                lib.idv_workflow_id   || '',
                              idv_workflow_name:              lib.idv_workflow_name || '',
                            };
                          });
                          setModal({ mode: 'edit', data: { ...tmpl, items: hydratedItems } });
                        }}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => remove(tmpl.id)}>
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

      {/* Create / Edit Modal */}
      <Dialog open={!!modal} onOpenChange={v => { if (!v) { setModal(null); setAiOpen(false); setAiStatus(null); setAiDesc(''); } }}>
        <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base">
                {modal?.mode === 'add' ? 'New Form Template' : 'Edit Form Template'}
              </DialogTitle>
              <Button size="sm" variant="outline" className="text-xs gap-1.5 h-7"
                onClick={() => setAiOpen(o => !o)}>
                <Sparkles className="w-3 h-3" /> Generate with AI
              </Button>
            </div>
          </DialogHeader>

          {modal && (
            <div className="px-6 pb-6 pt-4 space-y-5 flex-1 overflow-y-auto min-w-0">
              {/* AI Panel */}
              {aiOpen && (
                <div className="border border-primary/20 bg-primary/5 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-primary">AI Template Generator</div>
                  <div>
                    <label className="text-xs font-medium block mb-1">
                      Describe this form template — who it's for and what you're collecting
                    </label>
                    <textarea
                      rows={3}
                      value={aiDesc}
                      onChange={e => setAiDesc(e.target.value)}
                      className="w-full text-xs border border-input rounded-lg px-3 py-2 bg-white resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                      placeholder="e.g. Individual onboarding pack for NP clients — collect passport, proof of address, source of funds declaration and expected transaction behaviour…"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      {aiStatus === 'success' && (
                        <span className="flex items-center gap-1 text-xs text-green-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Fields populated — review below
                        </span>
                      )}
                      {aiStatus === 'error' && (
                        <span className="text-xs text-destructive">Generation failed — try rephrasing.</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={() => setAiOpen(false)}>
                        Dismiss
                      </Button>
                      <Button type="button" size="sm" className="text-xs h-7 gap-1" onClick={generateWithAi} disabled={aiLoading || !aiDesc.trim()}>
                        {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {aiLoading ? 'Generating…' : 'Generate'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 1: Template Info */}
              <SectionHeading>1 — Template Info</SectionHeading>

              <div>
                <label className="text-xs font-medium block mb-1.5">Template Name *</label>
                <Input
                  value={modal.data.name}
                  onChange={e => setModal(m => ({ ...m, data: { ...m.data, name: e.target.value } }))}
                  placeholder="e.g. NP Onboarding Pack"
                  className="h-9 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5">Description</label>
                <textarea
                  rows={2}
                  value={modal.data.description || ''}
                  onChange={e => setModal(m => ({ ...m, data: { ...m.data, description: e.target.value } }))}
                  className="w-full text-sm border border-input rounded-md px-3 py-2 bg-transparent resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                  placeholder="Short description for internal use…"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1.5">Applicable Client Types</label>
                  <div className="flex gap-2 flex-wrap">
                    {CLIENT_TYPES.map(ct => (
                      <CheckChip key={ct} label={ct} checked={(modal.data.applicable_client_types || []).includes(ct)} onChange={() => toggleClientType(ct)} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Leave empty = all types</p>
                </div>

                <div>
                  <label className="text-xs font-medium block mb-1.5">Default Channel</label>
                  <Select value={modal.data.default_channel || 'Email'}
                    onValueChange={v => setModal(m => ({ ...m, data: { ...m.data, default_channel: v } }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5">Applicable Case Types</label>
                <div className="flex gap-2 flex-wrap">
                  {CASE_TYPES.map(ct => (
                    <CheckChip key={ct} label={ct} checked={(modal.data.applicable_case_types || []).includes(ct)} onChange={() => toggleCaseType(ct)} />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5">Default Deadline</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={1}
                      value={modal.data.default_deadline_days || 14}
                      onChange={e => setModal(m => ({ ...m, data: { ...m.data, default_deadline_days: Number(e.target.value) } }))}
                      className="h-9 text-sm w-20"
                    />
                    <span className="text-xs text-muted-foreground">days from send date</span>
                  </div>
                </div>
              </div>

              {/* SECTION 2: Form Fields */}
              <SectionHeading>2 — Form Fields</SectionHeading>

              <div className="space-y-2">
                {(!modal.data.items?.length) && (
                  <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                    No fields added yet. Use the button below to add from your field library.
                  </div>
                )}
                {(modal.data.items || []).map((item, idx) => (
                  <ItemRow
                    key={idx}
                    item={item}
                    index={idx}
                    onRemove={removeItem}
                    onMoveUp={() => moveItem(idx, -1)}
                    onMoveDown={() => moveItem(idx, 1)}
                    isFirst={idx === 0}
                    isLast={idx === (modal.data.items?.length || 0) - 1}
                  />
                ))}
                <Button type="button" variant="outline" size="sm" className="text-xs gap-1.5 w-full"
                  onClick={() => setPickerOpen(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add from Library
                </Button>
              </div>

              {/* SECTION 3: Email Wrapper */}
              <SectionHeading>3 — Email Wrapper</SectionHeading>

              <div>
                <label className="text-xs font-medium block mb-1.5">Email template to use when sending</label>
                <Select
                  value={modal.data.email_template_id || '__none__'}
                  onValueChange={v => setModal(m => ({ ...m, data: { ...m.data, email_template_id: v === '__none__' ? '' : v } }))}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select email template…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {emailTmpls.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {emailTmpls.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No active email templates found. Create one in the Email Templates tab first.</p>
                )}
              </div>

              {/* Preview of selected email template */}
              {modal.data.email_template_id && emailTmplMap[modal.data.email_template_id] && (
                <div className="border border-border rounded-lg p-3 bg-muted/20 overflow-hidden min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-medium truncate">{emailTmplMap[modal.data.email_template_id].name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate flex-shrink-0">{emailTmplMap[modal.data.email_template_id].subject}</span>
                  </div>
                  <div
                    className="text-xs text-muted-foreground line-clamp-3 prose prose-xs overflow-hidden break-words overflow-x-hidden w-full"
                    dangerouslySetInnerHTML={{ __html: emailTmplMap[modal.data.email_template_id].body_html }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          {modal && (
            <div className="flex gap-2 justify-end px-6 py-4 border-t border-border flex-shrink-0">
              <Button variant="outline" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="button" variant="outline" className="gap-1.5"
                onClick={() => setPreviewTemplate(modal.data)}>
                <Eye className="w-3.5 h-3.5" /> Preview in Portal
              </Button>
              <Button onClick={save} disabled={saving || !modal.data.name} className="gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Template
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Field Library Picker */}
      {modal && (
        <FieldLibraryPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          tenantId={tenant?.id}
          alreadySelected={modal.data.items || []}
          onAdd={addFieldFromLibrary}
        />
      )}

      <FormTemplatePreview
        open={!!previewTemplate}
        template={previewTemplate}
        tenant={tenant}
        emailTemplates={emailTmpls}
        onClose={() => setPreviewTemplate(null)}
      />
    </div>
  );
}