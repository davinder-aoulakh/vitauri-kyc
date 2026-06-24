import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, Pencil, Trash2, Loader2, GripVertical, Eye, Tag, ChevronDown, Sparkles, Copy } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { cn } from '@/lib/utils';
import FieldTypePicker, { FIELD_TYPES } from './outreach/FieldTypePicker';
import FieldTypeConfig from './outreach/FieldTypeConfig';
import PortalPreviewModal from './outreach/PortalPreviewModal';
import AiGenerateModal from './outreach/AiGenerateModal';

const CLIENT_TYPES = ['NP', 'ORG'];
const CASE_TYPES   = ['Onboarding', 'Periodic_Review', 'Event_Driven_Review', 'Offboarding'];

const BLANK = {
  label: '', description: '', item_type: 'document', field_type: 'file_upload',
  client_types: ['NP', 'ORG'], case_types: ['Onboarding'],
  is_mandatory: false, is_active: true, sort_order: 0,
  field_options: [], validation_accepted_file_types: [], validation_max_file_size_mb: 25,
};

const IDV_DOC_TYPES = ['Passport', 'Driving_Licence', 'National_ID', 'Residence_Permit'];

const IDV_DEFAULTS = {
  idv_accepted_doc_types: ['Passport', 'Driving_Licence', 'National_ID'],
  idv_min_match_score: 75,
  idv_liveness_required: true,
  idv_auto_proceed: false,
  idv_workflow_id:   '',
  idv_workflow_name: '',
};

const PLACEHOLDERS = [
  { group: 'Client', tokens: [
    { label: 'Full Name',       value: '{{client.full_name}}' },
    { label: 'Client Type',     value: '{{client.client_type}}' },
    { label: 'Email',           value: '{{client.primary_contact_email}}' },
    { label: 'Risk Level',      value: '{{client.risk_classification}}' },
  ]},
  { group: 'Case', tokens: [
    { label: 'Case Type',       value: '{{case.case_type}}' },
    { label: 'Due Date',        value: '{{case.due_date}}' },
    { label: 'Status',          value: '{{case.status}}' },
  ]},
  { group: 'Institution', tokens: [
    { label: 'Institution Name', value: '{{tenant.name}}' },
    { label: 'Today\'s Date',   value: '{{today}}' },
  ]},
];

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'], ['clean'],
  ],
};
const QUILL_FORMATS = ['header', 'bold', 'italic', 'underline', 'list', 'bullet', 'link'];

function PlaceholderPicker({ onInsert }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <Button type="button" size="sm" variant="outline" className="text-xs gap-1.5 h-7" onClick={() => setOpen(o => !o)}>
        <Tag className="w-3 h-3" /> Insert Placeholder <ChevronDown className="w-3 h-3" />
      </Button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
          {PLACEHOLDERS.map(group => (
            <div key={group.group}>
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40 border-b border-border">{group.group}</div>
              {group.tokens.map(tok => (
                <button key={tok.value} type="button" onClick={() => { onInsert(tok.value); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 transition-colors flex items-center justify-between group">
                  <span className="font-medium">{tok.label}</span>
                  <span className="font-mono text-muted-foreground text-xs opacity-60 group-hover:opacity-100 truncate ml-2">{tok.value}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getFieldTypeLabel(ft) {
  return FIELD_TYPES.find(f => f.value === ft)?.label || ft || 'Unknown';
}
function getFieldTypeIcon(ft) {
  return FIELD_TYPES.find(f => f.value === ft)?.icon || '📄';
}

export default function OutreachTemplatesTab({ tenant }) {
  const [templates, setTemplates]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [modal, setModal]               = useState(null);
  const [diditWorkflows, setDiditWorkflows] = useState([]);
  const [saving, setSaving]       = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTemplates, setPreviewTemplates] = useState(null); // null = all, otherwise [tmpl]
  const [previewTitle, setPreviewTitle] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const quillRef = useRef(null);
  const { toast } = useToast();

  useEffect(() => {
    if (tenant?.id) {
      load();
      try {
        const wfs = JSON.parse(tenant?.didit_workflows || '[]');
        setDiditWorkflows(Array.isArray(wfs) ? wfs : []);
      } catch { setDiditWorkflows([]); }
    }
  }, [tenant]);

  async function load() {
    const data = await base44.entities.OutreachTemplate.filter({ tenant_id: tenant.id }, 'sort_order');
    setTemplates(data || []);
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    const d = modal.data;
    if (modal.mode === 'add') {
      await base44.entities.OutreachTemplate.create({ ...d, tenant_id: tenant.id, sort_order: templates.length });
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

  async function cloneTemplate(tmpl) {
    const { id, created_date, updated_date, ...rest } = tmpl;
    const cloned = { ...rest, label: `Copy of ${tmpl.label}`, tenant_id: tenant.id, sort_order: templates.length };
    await base44.entities.OutreachTemplate.create(cloned);
    const newTemplates = await base44.entities.OutreachTemplate.filter({ tenant_id: tenant.id }, 'sort_order');
    setTemplates(newTemplates || []);
    const clonedRecord = (newTemplates || []).find(t => t.label === cloned.label);
    if (clonedRecord) setModal({ mode: 'edit', data: { ...clonedRecord } });
    toast({ description: 'Template cloned — editing copy now' });
  }

  function toggleTag(field, val) {
    setModal(m => {
      const prev = m.data[field] || [];
      const next = prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val];
      return { ...m, data: { ...m.data, [field]: next } };
    });
  }

  function handleInsertPlaceholder(token) {
    const editor = quillRef.current?.getEditor();
    if (editor) {
      const range = editor.getSelection(true);
      editor.insertText(range ? range.index : editor.getLength(), token);
      editor.setSelection((range ? range.index : editor.getLength()) + token.length);
    } else {
      setModal(m => ({ ...m, data: { ...m.data, description: (m.data.description || '') + token } }));
    }
  }

  async function onDragEnd(result) {
    if (!result.destination) return;
    const reordered = Array.from(templates);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    const withOrder = reordered.map((t, i) => ({ ...t, sort_order: i }));
    setTemplates(withOrder);
    // Batch update sort_order
    await Promise.all(withOrder.map(t => base44.entities.OutreachTemplate.update(t.id, { sort_order: t.sort_order })));
  }

  const isSectionHeader = modal?.data?.field_type === 'section_header';
  const showDescription = !isSectionHeader;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Outreach Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Field templates used when building outreach requests. Drag to reorder.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => { setPreviewTemplates(null); setPreviewTitle(null); setPreviewOpen(true); }}>
            <Eye className="w-3.5 h-3.5" /> Preview in Portal
          </Button>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/5" onClick={() => setAiOpen(true)}>
            <Sparkles className="w-3.5 h-3.5" /> Generate with AI
          </Button>
          <Button size="sm" className="text-xs gap-1.5" onClick={() => setModal({ mode: 'add', data: { ...BLANK } })}>
            <Plus className="w-3.5 h-3.5" /> Add Template
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : templates.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">No templates yet. Add your first template above.</div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="w-8 px-2 py-3" />
                  <th className="text-left px-4 py-3">Label</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Client Types</th>
                  <th className="text-left px-4 py-3">Required</th>
                  <th className="text-left px-4 py-3">Active</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <Droppable droppableId="templates">
                {(provided) => (
                  <tbody className="divide-y divide-border" ref={provided.innerRef} {...provided.droppableProps}>
                    {templates.map((tmpl, index) => (
                      <Draggable key={tmpl.id} draggableId={tmpl.id} index={index}>
                        {(dragProvided, snapshot) => (
                          <tr
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={cn('hover:bg-muted/20 transition-colors', !tmpl.is_active && 'opacity-50', snapshot.isDragging && 'bg-muted/40 shadow-md')}
                          >
                            <td className="px-2 py-3">
                              <div {...dragProvided.dragHandleProps} className="cursor-grab text-muted-foreground hover:text-foreground flex justify-center">
                                <GripVertical className="w-3.5 h-3.5" />
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm leading-none">{getFieldTypeIcon(tmpl.field_type || (tmpl.item_type === 'document' ? 'file_upload' : 'textarea'))}</span>
                                <div>
                                  <div className="font-medium text-xs">{tmpl.label}</div>
                                  {tmpl.description && (
                                    <div className="text-xs text-muted-foreground truncate max-w-xs"
                                      dangerouslySetInnerHTML={{ __html: tmpl.description.replace(/<[^>]*>/g,'').substring(0,60) }} />
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {tmpl.field_type === 'id_verification' ? (
                                <div>
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                                    🪪 Identity Verification
                                  </span>
                                  <div className="text-xs text-muted-foreground mt-0.5">Min match: {tmpl.idv_min_match_score ?? 75}%</div>
                                  {tmpl.idv_workflow_name ? (
                                    <div className="text-xs text-muted-foreground">Workflow: {tmpl.idv_workflow_name}</div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground">Workflow: tenant default</div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {getFieldTypeLabel(tmpl.field_type || (tmpl.item_type === 'document' ? 'file_upload' : 'textarea'))}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1 flex-wrap">
                                {(tmpl.client_types || []).map(ct => <span key={ct} className="text-xs bg-muted px-1.5 py-0.5 rounded">{ct}</span>)}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn('text-xs px-2 py-0.5 rounded-full', tmpl.is_mandatory ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-500')}>
                                {tmpl.is_mandatory ? 'Required' : 'Optional'}
                              </span>
                            </td>
                            <td className="px-4 py-3"><Switch checked={!!tmpl.is_active} onCheckedChange={() => toggleActive(tmpl)} /></td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-end">
                               <Button size="sm" variant="ghost" className="h-7 text-xs" title="Preview in Portal"
                                 onClick={() => { setPreviewTemplates([tmpl]); setPreviewTitle(`Document Request — ${tmpl.label}`); setPreviewOpen(true); }}>
                                 <Eye className="w-3 h-3" />
                               </Button>
                               <Button size="sm" variant="ghost" className="h-7 text-xs" title="Clone" onClick={() => cloneTemplate(tmpl)}>
                                 <Copy className="w-3 h-3" />
                               </Button>
                               <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setModal({ mode: 'edit', data: { ...tmpl } })}>
                                 <Pencil className="w-3 h-3" />
                               </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => remove(tmpl.id)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </tbody>
                )}
              </Droppable>
            </table>
          </DragDropContext>
        )}
      </div>

      {/* Edit / Add Modal */}
      <Dialog open={!!modal} onOpenChange={v => !v && setModal(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{modal?.mode === 'add' ? 'Add Template' : 'Edit Template'}</DialogTitle>
          </DialogHeader>
          {modal && (
            <div className="space-y-4">
              {/* Label */}
              {!isSectionHeader && (
                <div>
                  <label className="text-xs font-medium block mb-1.5">Label *</label>
                  <Input
                    value={modal.data.label}
                    onChange={e => setModal(m => ({ ...m, data: { ...m.data, label: e.target.value } }))}
                    className="h-9 text-sm"
                    placeholder="e.g. Passport Copy"
                  />
                </div>
              )}
              {isSectionHeader && (
                <div>
                  <label className="text-xs font-medium block mb-1.5">Internal Label *</label>
                  <Input
                    value={modal.data.label}
                    onChange={e => setModal(m => ({ ...m, data: { ...m.data, label: e.target.value } }))}
                    className="h-9 text-sm"
                    placeholder="e.g. Identity Documents Section"
                  />
                </div>
              )}

              {/* Field type picker */}
              <FieldTypePicker
                value={modal.data.field_type || 'file_upload'}
                onChange={v => {
                  const extra = v === 'id_verification' ? IDV_DEFAULTS : {};
                  setModal(m => ({ ...m, data: { ...m.data, field_type: v, item_type: v === 'file_upload' ? 'document' : 'data_point', ...extra } }));
                }}
              />

              {/* IDV-specific config */}
              {modal.data.field_type === 'id_verification' && (
                <div className="space-y-4 border border-indigo-100 bg-indigo-50/50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">🪪 Identity Verification Settings</div>

                  {/* Didit Workflow selector */}
                  {diditWorkflows.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium block">Didit Workflow</label>
                      <select
                        value={modal.data.idv_workflow_id || ''}
                        onChange={e => setModal(m => ({
                          ...m,
                          data: {
                            ...m.data,
                            idv_workflow_id:   e.target.value,
                            idv_workflow_name: diditWorkflows.find(w => w.workflow_id === e.target.value)?.name || '',
                          }
                        }))}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="">Use tenant default workflow</option>
                        {diditWorkflows.map(wf => (
                          <option key={wf.id} value={wf.workflow_id}>
                            {wf.name}{wf.is_default ? ' (default)' : ''}{wf.description ? ` — ${wf.description}` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">Select the Didit workflow for this verification field. Leave blank to use the tenant default.</p>
                    </div>
                  )}
                  {diditWorkflows.length === 0 && (
                    <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      ⚠ No Didit workflows configured. Ask your Vitauri Ops administrator to configure workflows in the platform console.
                    </div>
                  )}

                  {/* Accepted doc types */}
                  <div>
                    <label className="text-xs font-medium block mb-1.5">Accepted Document Types</label>
                    <div className="flex flex-wrap gap-2">
                      {IDV_DOC_TYPES.map(dt => {
                        const checked = (modal.data.idv_accepted_doc_types || []).includes(dt);
                        return (
                          <label key={dt} className={cn(
                            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-all select-none',
                            checked ? 'bg-indigo-100 border-indigo-400 text-indigo-700 font-medium' : 'border-border text-muted-foreground hover:border-indigo-300'
                          )}>
                            <input type="checkbox" className="hidden" checked={checked} onChange={() => {
                              setModal(m => {
                                const cur = m.data.idv_accepted_doc_types || [];
                                return { ...m, data: { ...m.data, idv_accepted_doc_types: checked ? cur.filter(x => x !== dt) : [...cur, dt] } };
                              });
                            }} />
                            {dt.replace(/_/g, ' ')}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Min match score */}
                  <div>
                    <label className="text-xs font-medium block mb-1.5">Minimum Match Score to Pass</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={50} max={100}
                        value={modal.data.idv_min_match_score ?? 75}
                        onChange={e => setModal(m => ({ ...m, data: { ...m.data, idv_min_match_score: Number(e.target.value) } }))}
                        className="h-9 text-sm w-24"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Clients scoring below this threshold will be flagged for manual review</p>
                  </div>

                  {/* Liveness check */}
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={!!modal.data.idv_liveness_required}
                      onCheckedChange={v => setModal(m => ({ ...m, data: { ...m.data, idv_liveness_required: v } }))}
                    />
                    <div>
                      <div className="text-xs font-medium">Require Liveness Check</div>
                      <p className="text-xs text-muted-foreground">Client must blink before the selfie is captured</p>
                    </div>
                  </div>

                  {/* Auto-proceed */}
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={!!modal.data.idv_auto_proceed}
                      onCheckedChange={v => setModal(m => ({ ...m, data: { ...m.data, idv_auto_proceed: v } }))}
                    />
                    <div>
                      <div className="text-xs font-medium">Auto-complete when passed</div>
                      <p className="text-xs text-muted-foreground">Automatically marks this item as received when the match passes</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Type-specific config (hidden for id_verification) */}
              {modal.data.field_type !== 'id_verification' && (
                <FieldTypeConfig
                  fieldType={modal.data.field_type || 'file_upload'}
                  data={modal.data}
                  setData={patch => setModal(m => ({ ...m, data: typeof patch === 'function' ? patch(m.data) : { ...m.data, ...patch } }))}
                />
              )}

              {/* Required toggle (hidden for section header) */}
              {!isSectionHeader && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!modal.data.is_mandatory}
                    onCheckedChange={v => setModal(m => ({ ...m, data: { ...m.data, is_mandatory: v } }))}
                  />
                  <label className="text-xs font-medium">Required</label>
                </div>
              )}

              {/* Description with placeholder picker (hidden for section header — it uses its own) */}
              {showDescription && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium">Description / Instructions</label>
                    <PlaceholderPicker onInsert={handleInsertPlaceholder} />
                  </div>
                  <div className="border border-input rounded-md overflow-hidden [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-input [&_.ql-toolbar]:bg-muted/30 [&_.ql-container]:border-0 [&_.ql-editor]:text-sm [&_.ql-editor]:min-h-[80px]">
                    <ReactQuill
                      ref={quillRef}
                      value={modal.data.description || ''}
                      onChange={v => setModal(m => ({ ...m, data: { ...m.data, description: v } }))}
                      modules={QUILL_MODULES}
                      formats={QUILL_FORMATS}
                      placeholder="Describe what the client should provide…"
                    />
                  </div>
                </div>
              )}

              {/* Client Types */}
              {!isSectionHeader && (
                <div>
                  <label className="text-xs font-medium block mb-1.5">Client Types</label>
                  <div className="flex gap-2">
                    {CLIENT_TYPES.map(ct => (
                      <button key={ct} type="button" onClick={() => toggleTag('client_types', ct)}
                        className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors',
                          modal.data.client_types?.includes(ct) ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/50 text-muted-foreground'
                        )}>{ct}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Case Types */}
              {!isSectionHeader && (
                <div>
                  <label className="text-xs font-medium block mb-1.5">Case Types</label>
                  <div className="flex flex-wrap gap-2">
                    {CASE_TYPES.map(ct => (
                      <button key={ct} type="button" onClick={() => toggleTag('case_types', ct)}
                        className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors',
                          modal.data.case_types?.includes(ct) ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/50 text-muted-foreground'
                        )}>{ct.replace(/_/g,' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2 border-t border-border">
                <Button variant="outline" onClick={() => setModal(null)}>Cancel</Button>
                <Button onClick={save} disabled={saving || !modal.data.label.trim()} className="gap-2">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save Template
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* AI Generate */}
      <AiGenerateModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        existingCount={templates.length}
        onSave={async (items) => {
          await Promise.all(items.map(item => base44.entities.OutreachTemplate.create({ ...item, tenant_id: tenant.id })));
          load();
        }}
      />

      {/* Portal Preview */}
      <PortalPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        templates={previewTemplates ?? templates}
        tenant={tenant}
        title={previewTitle}
      />
    </div>
  );
}