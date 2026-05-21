import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Loader2, Mail, Eye, X } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { cn } from '@/lib/utils';

const SITUATIONS = [
  { value: 'Welcome',               label: 'Welcome' },
  { value: 'Documentation_Request', label: 'Documentation Request' },
  { value: 'First_Reminder',        label: 'First Reminder' },
  { value: 'Second_Reminder',       label: 'Second Reminder' },
  { value: 'Third_Reminder',        label: 'Third Reminder' },
  { value: 'Additional_Info',       label: 'Additional Info' },
];

const VARIABLES = [
  '{{client_name}}', '{{tenant_name}}', '{{portal_link}}', '{{due_date}}', '{{analyst_name}}'
];

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ],
};
const QUILL_FORMATS = ['header', 'bold', 'italic', 'underline', 'list', 'bullet', 'link'];

const BLANK = { name: '', situation: 'Documentation_Request', subject: '', body_html: '', is_active: true };

export default function EmailTemplatesTab({ tenant, currentUser }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null); // { mode: 'add'|'edit', data }
  const [previewTmpl, setPreviewTmpl] = useState(null);
  const [saving, setSaving]       = useState(false);
  const quillRef = useRef(null);

  useEffect(() => { if (tenant?.id) load(); }, [tenant]);

  async function load() {
    const data = await base44.entities.EmailTemplate.filter({ tenant_id: tenant.id });
    setTemplates(data || []);
    setLoading(false);
  }

  async function save() {
    if (!modal?.data?.name || !modal?.data?.subject || !modal?.data?.body_html) return;
    setSaving(true);
    const d = { ...modal.data, tenant_id: tenant.id, created_by: currentUser?.full_name };
    if (modal.mode === 'add') {
      await base44.entities.EmailTemplate.create(d);
    } else {
      await base44.entities.EmailTemplate.update(d.id, d);
    }
    setModal(null);
    setSaving(false);
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this email template?')) return;
    await base44.entities.EmailTemplate.delete(id);
    load();
  }

  async function toggleActive(tmpl) {
    await base44.entities.EmailTemplate.update(tmpl.id, { is_active: !tmpl.is_active });
    load();
  }

  function insertVariable(v) {
    const editor = quillRef.current?.getEditor();
    if (editor) {
      const range = editor.getSelection(true);
      const idx = range ? range.index : editor.getLength();
      editor.insertText(idx, v);
      editor.setSelection(idx + v.length);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Email Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Branded email templates used when sending outreach requests. Use variables for dynamic content.
          </p>
        </div>
        <Button size="sm" className="text-xs gap-1.5" onClick={() => setModal({ mode: 'add', data: { ...BLANK } })}>
          <Plus className="w-3.5 h-3.5" /> Add Template
        </Button>
      </div>

      {/* Variables hint */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
        <p className="text-xs text-blue-700 font-medium mb-1.5">Available variables:</p>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map(v => (
            <code key={v} className="text-xs bg-white border border-blue-200 text-blue-700 px-2 py-0.5 rounded font-mono">{v}</code>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : templates.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No email templates yet. Create your first template above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Situation</th>
                <th className="text-left px-4 py-3">Subject</th>
                <th className="text-left px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {templates.map(tmpl => (
                <tr key={tmpl.id} className={cn('hover:bg-muted/20 transition-colors', !tmpl.is_active && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span className="font-medium text-xs">{tmpl.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                      {SITUATIONS.find(s => s.value === tmpl.situation)?.label || tmpl.situation}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-xs">{tmpl.subject}</td>
                  <td className="px-4 py-3"><Switch checked={!!tmpl.is_active} onCheckedChange={() => toggleActive(tmpl)} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreviewTmpl(tmpl)}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setModal({ mode: 'edit', data: { ...tmpl } })}>
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

      {/* Edit / Create Modal */}
      <Dialog open={!!modal} onOpenChange={v => !v && setModal(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{modal?.mode === 'add' ? 'Create Email Template' : 'Edit Email Template'}</DialogTitle>
          </DialogHeader>
          {modal && (
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5">Template Name *</label>
                  <Input
                    value={modal.data.name}
                    onChange={e => setModal(m => ({ ...m, data: { ...m.data, name: e.target.value } }))}
                    placeholder="e.g. Onboarding Welcome Email"
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5">Situation *</label>
                  <Select value={modal.data.situation} onValueChange={v => setModal(m => ({ ...m, data: { ...m.data, situation: v } }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SITUATIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5">Subject Line *</label>
                <Input
                  value={modal.data.subject}
                  onChange={e => setModal(m => ({ ...m, data: { ...m.data, subject: e.target.value } }))}
                  placeholder="e.g. Action Required: Documents needed for your KYC review"
                  className="h-9 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium">Email Body *</label>
                  <div className="flex flex-wrap gap-1">
                    {VARIABLES.map(v => (
                      <button key={v} type="button" onClick={() => insertVariable(v)}
                        className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono hover:bg-blue-100 transition-colors">
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border border-input rounded-md overflow-hidden [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-input [&_.ql-toolbar]:bg-muted/30 [&_.ql-container]:border-0 [&_.ql-editor]:text-sm [&_.ql-editor]:min-h-[160px]">
                  <ReactQuill
                    ref={quillRef}
                    value={modal.data.body_html || ''}
                    onChange={v => setModal(m => ({ ...m, data: { ...m.data, body_html: v } }))}
                    modules={QUILL_MODULES}
                    formats={QUILL_FORMATS}
                    placeholder="Dear {{client_name}}, as part of our KYC review process..."
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-border">
                <Button variant="outline" onClick={() => setModal(null)}>Cancel</Button>
                <Button onClick={save} disabled={saving || !modal.data.name || !modal.data.subject || !modal.data.body_html} className="gap-2">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save Template
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Preview Modal */}
      <Dialog open={!!previewTmpl} onOpenChange={v => !v && setPreviewTmpl(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4" /> Preview — {previewTmpl?.name}
            </DialogTitle>
          </DialogHeader>
          {previewTmpl && (
            <div className="space-y-3">
              <div className="bg-muted/30 rounded-lg px-4 py-2 text-sm">
                <span className="text-muted-foreground text-xs">Subject: </span>
                <span className="font-medium">{previewTmpl.subject}</span>
              </div>
              <div className="border border-border rounded-lg p-4 bg-white">
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: previewTmpl.body_html }} />
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setPreviewTmpl(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}