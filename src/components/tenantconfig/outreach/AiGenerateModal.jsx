import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Sparkles, Check, X, RefreshCw, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_TYPES } from './FieldTypePicker';

function getIcon(ft) { return FIELD_TYPES.find(f => f.value === ft)?.icon || '📄'; }
function getLabel(ft) { return FIELD_TYPES.find(f => f.value === ft)?.label || ft; }

const SYSTEM_PROMPT = `You are a KYC compliance specialist helping configure a document collection form. Generate structured form field definitions.`;

function buildPrompt({ description, clientType, situation, tone }) {
  return `${description}
Client type: ${clientType}
Situation: ${situation}
Tone of instructions: ${tone}

Return a JSON array of form fields. Each field must have:
- label (string): clear field label shown to client
- field_type (one of: file_upload, text, textarea, number, date, dropdown, multi_select, checkbox, yes_no, section_header)
- description (string): plain-language instructions for the client (1-2 sentences)
- is_mandatory (boolean)
- client_types (array: ['NP'] or ['ORG'] or ['NP','ORG'])
- field_options (array of strings, only if field_type is dropdown or multi_select)
- section_title (string, only if field_type is section_header)

Return ONLY valid JSON, no markdown, no preamble.`;
}

function EditableField({ field, onChange }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-base leading-none mt-0.5 flex-shrink-0">{getIcon(field.field_type)}</span>
        <div className="flex-1 min-w-0">
          <Input
            value={field.label}
            onChange={e => onChange({ ...field, label: e.target.value })}
            className="h-7 text-xs font-medium border-0 border-b border-dashed border-border rounded-none px-0 bg-transparent focus-visible:ring-0"
          />
          {field.description && !expanded && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{field.description}</p>
          )}
          {expanded && (
            <textarea
              value={field.description || ''}
              onChange={e => onChange({ ...field, description: e.target.value })}
              className="w-full mt-1 text-xs border border-input rounded-md px-2 py-1.5 bg-transparent resize-none min-h-[52px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={cn('text-xs px-1.5 py-0.5 rounded-full', field.is_mandatory ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500')}>
            {field.is_mandatory ? 'Req' : 'Opt'}
          </span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{getLabel(field.field_type)}</span>
          <button type="button" onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground p-0.5">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="pl-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-1.5">
            <Switch checked={!!field.is_mandatory} onCheckedChange={v => onChange({ ...field, is_mandatory: v })} />
            <span className="text-xs text-muted-foreground">Required</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Type:</span>
            <Select value={field.field_type} onValueChange={v => onChange({ ...field, field_type: v })}>
              <SelectTrigger className="h-6 text-xs w-32 px-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map(ft => (
                  <SelectItem key={ft.value} value={ft.value} className="text-xs">{ft.icon} {ft.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiGenerateModal({ open, onClose, onSave, existingCount }) {
  const [step, setStep] = useState('input'); // 'input' | 'loading' | 'review' | 'error'
  const [description, setDescription] = useState('');
  const [clientType, setClientType] = useState('Both');
  const [situation, setSituation] = useState('Onboarding');
  const [tone, setTone] = useState('Professional');
  const [fields, setFields] = useState([]);
  const [included, setIncluded] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  function reset() {
    setStep('input');
    setFields([]);
    setIncluded([]);
    setErrorMsg('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function generate() {
    if (!description.trim()) return;
    setStep('loading');
    setErrorMsg('');
    const prompt = buildPrompt({ description, clientType, situation, tone });
    const res = await base44.integrations.Core.InvokeLLM({
      system_prompt: SYSTEM_PROMPT,
      prompt,
    });
    const raw = res?.result || res?.text || res || '';
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // Strip possible markdown fences
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error('Not an array');
    } catch {
      setErrorMsg('Generation failed — try rephrasing your description.');
      setStep('error');
      return;
    }
    setFields(parsed.map((f, i) => ({ ...f, _id: i })));
    setIncluded(parsed.map((_, i) => i));
    setStep('review');
  }

  async function handleSave() {
    setSaving(true);
    const toSave = fields
      .filter((_, i) => included.includes(i))
      .map((f, idx) => ({
        label: f.label || 'Untitled',
        description: f.description || '',
        field_type: f.field_type || 'text',
        item_type: f.field_type === 'file_upload' ? 'document' : 'data_point',
        is_mandatory: !!f.is_mandatory,
        client_types: f.client_types || ['NP', 'ORG'],
        case_types: ['Onboarding', 'Periodic_Review', 'Event_Driven_Review', 'Offboarding'],
        field_options: f.field_options || [],
        section_title: f.section_title || '',
        is_active: true,
        sort_order: existingCount + idx,
        validation_max_file_size_mb: 25,
      }));
    await onSave(toSave);
    setSaving(false);
    handleClose();
  }

  function toggleInclude(idx) {
    setIncluded(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]);
  }

  function updateField(idx, updated) {
    setFields(prev => prev.map((f, i) => i === idx ? updated : f));
  }

  const selectedCount = included.length;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Generate with AI
          </DialogTitle>
        </DialogHeader>

        {/* INPUT STEP */}
        {(step === 'input' || step === 'error') && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium block mb-1.5">Describe what you need to collect</label>
              <textarea
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full text-sm border border-input rounded-md px-3 py-2 bg-transparent resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                placeholder="e.g. KYC documents for a new corporate client — I need company registration, UBO details, source of funds, and a FATCA self-certification"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Client Type</label>
                <Select value={clientType} onValueChange={setClientType}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NP">NP (Individual)</SelectItem>
                    <SelectItem value="ORG">ORG (Corporate)</SelectItem>
                    <SelectItem value="Both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Situation</label>
                <Select value={situation} onValueChange={setSituation}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Onboarding">Onboarding</SelectItem>
                    <SelectItem value="Periodic Review">Periodic Review</SelectItem>
                    <SelectItem value="Event-Driven">Event-Driven</SelectItem>
                    <SelectItem value="General">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Tone</label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Professional">Professional</SelectItem>
                    <SelectItem value="Plain language">Plain language</SelectItem>
                    <SelectItem value="Formal">Formal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {step === 'error' && (
              <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{errorMsg}</p>
            )}

            <div className="flex justify-end gap-2 pt-1 border-t border-border">
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={generate} disabled={!description.trim()} className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Generate
              </Button>
            </div>
          </div>
        )}

        {/* LOADING STEP */}
        {step === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-7 h-7 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating fields…</p>
          </div>
        )}

        {/* REVIEW STEP */}
        {step === 'review' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{fields.length} fields generated — select which to add</p>
              <button type="button" onClick={() => setIncluded(fields.map((_, i) => i))}
                className="text-xs text-primary hover:underline">Select all</button>
            </div>

            <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
              {fields.map((field, idx) => (
                <div key={idx} className={cn(
                  'flex gap-2 items-start border rounded-lg px-3 py-2.5 transition-colors',
                  included.includes(idx) ? 'bg-card border-border' : 'bg-muted/30 border-border/50 opacity-60'
                )}>
                  {/* Toggle */}
                  <button
                    type="button"
                    onClick={() => toggleInclude(idx)}
                    className={cn(
                      'flex-shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
                      included.includes(idx)
                        ? 'bg-primary border-primary text-white'
                        : 'border-border text-transparent hover:border-primary/60'
                    )}
                  >
                    <Check className="w-3 h-3" />
                  </button>

                  {/* Editable field */}
                  <div className="flex-1 min-w-0">
                    <EditableField field={field} onChange={updated => updateField(idx, updated)} />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => { setStep('input'); }}>
                <RefreshCw className="w-3 h-3" /> Regenerate
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
                <Button size="sm" onClick={handleSave} disabled={saving || selectedCount === 0} className="gap-1.5">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add {selectedCount} Field{selectedCount !== 1 ? 's' : ''} to Library
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}