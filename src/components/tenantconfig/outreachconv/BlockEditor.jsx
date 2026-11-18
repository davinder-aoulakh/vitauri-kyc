import React, { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
import ConditionBuilder from './ConditionBuilder';
import JsonField from './JsonField';
import { WIDGET_OPTIONS, FOLLOW_UP_ACTIONS, SOURCE_LABEL } from '@/lib/outreachConfigView';

const sel = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm';
const F = ({ label, hint, children }) => (
  <div className="space-y-1">
    <label className="text-xs font-medium">{label}</label>
    {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    {children}
  </div>
);
const lines = (v) => (v || []).join('\n');
const fromLines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

/** Editor for one OutreachBlock (spec 4.2). Saving writes a draft; Publish makes it the version new requests use. */
export default function BlockEditor({ open, onOpenChange, entry, isNew, allBlocks, canEdit, busy, onSave, onPublish }) {
  const row = entry?.draft || entry?.published || null;
  const [b, setB] = useState({});
  const [key, setKey] = useState('');
  const [jsonErr, setJsonErr] = useState({});
  useEffect(() => {
    if (!open) return;
    setKey(row?.key || '');
    setB(row ? { ...row } : { label: '', client_types: ['NP'], widget: 'chips', options: [], datapoints: [], follow_ups: [], active_default: true, multi: false });
    setJsonErr({});
  }, [open, row?.id]);
  const set = (k, v) => setB((x) => ({ ...x, [k]: v }));
  const setJson = (k) => (r) => { setJsonErr((e) => ({ ...e, [k]: r.error || '' })); if (!r.error) set(k, r.value); };
  const condBlocks = useMemo(() => allBlocks.map((x) => ({ key: x.key, label: x.label, options: x.options || [] })), [allBlocks]);
  const hasJsonErr = Object.values(jsonErr).some(Boolean);
  const ro = !canEdit;
  const fields = ['label', 'section_key', 'client_types', 'widget', 'question_template', 'variants', 'why_text', 'options', 'multi', 'none_option', 'datapoints',
    'kyc_mapping', 'show_if', 'follow_ups', 'evidence', 'prefill', 'validation', 'edit', 'active_default', 'translations'];
  const payload = () => Object.fromEntries(fields.map((k) => [k, b[k] ?? null]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {isNew ? 'New block' : `Block ${row?.key}`}
            {entry?.published && <Badge variant="outline">Published v{entry.published.version}</Badge>}
            {entry?.draft && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Draft v{entry.draft.version}</Badge>}
          </SheetTitle>
          <SheetDescription>Saving stores a draft. Requests use the published version only; requests already sent keep the version they were sent with.</SheetDescription>
        </SheetHeader>
        <fieldset disabled={ro} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Key" hint="Stable id, lower case (e.g. sof). Cannot change later."><Input value={key} disabled={!isNew} onChange={(e) => setKey(e.target.value.trim())} /></F>
            <F label="Label"><Input value={b.label || ''} onChange={(e) => set('label', e.target.value)} /></F>
            <F label="Section key"><Input value={b.section_key || ''} onChange={(e) => set('section_key', e.target.value)} /></F>
            <F label="Widget">
              <select className={sel} value={b.widget || ''} onChange={(e) => set('widget', e.target.value)}>{WIDGET_OPTIONS.map((w) => <option key={w}>{w}</option>)}</select>
            </F>
            <F label="Client types">
              <div className="flex gap-3 pt-1.5 text-sm">
                {['NP', 'ORG', 'RP'].map((c) => (
                  <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={(b.client_types || []).includes(c)}
                    onChange={(e) => set('client_types', e.target.checked ? [...new Set([...(b.client_types || []), c])] : (b.client_types || []).filter((x) => x !== c))} /> {c}</label>
                ))}
              </div>
            </F>
            <div className="flex items-center gap-6 pt-5 text-sm">
              <label className="flex items-center gap-2"><Switch checked={b.active_default !== false} onCheckedChange={(v) => set('active_default', v)} /> Active by default</label>
              <label className="flex items-center gap-2"><Switch checked={!!b.multi} onCheckedChange={(v) => set('multi', v)} /> Multiple choice</label>
            </div>
          </div>
          <F label="Question" hint="Placeholders such as {first_name}, {company}, {tenant_name} are filled in when the request is sent."><Textarea rows={3} value={b.question_template || ''} onChange={(e) => set('question_template', e.target.value)} /></F>
          <F label='Why do we ask this?'><Textarea rows={2} value={b.why_text || ''} onChange={(e) => set('why_text', e.target.value)} /></F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Options" hint="One per line."><Textarea rows={5} value={lines(b.options)} onChange={(e) => set('options', fromLines(e.target.value))} /></F>
            <div className="space-y-3">
              <F label='"None" option' hint="Clears the other choices (multiple choice only)."><Input value={b.none_option || ''} onChange={(e) => set('none_option', e.target.value)} /></F>
              <F label="KYC mapping"><Input value={b.kyc_mapping || ''} onChange={(e) => set('kyc_mapping', e.target.value)} /></F>
              <F label="Prefill"><Input value={b.prefill || ''} onChange={(e) => set('prefill', e.target.value)} /></F>
            </div>
          </div>

          <ConditionBuilder label="Show if" value={b.show_if || null} blocks={condBlocks} onChange={(v) => set('show_if', v)} />

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              Follow-ups ({(b.follow_ups || []).length})
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => set('follow_ups', [...(b.follow_ups || []), { id: `f${(b.follow_ups || []).length + 1}`, action: 'ask_text', when: null, question: '', key: '' }])}><Plus className="h-3 w-3" /> Add follow-up</Button>
            </div>
            {(b.follow_ups || []).map((f, i) => {
              const upd = (patch) => set('follow_ups', b.follow_ups.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const { id, action, when, question, message, key: fk, ...rest } = f;
              return (
                <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="h-8 w-32 text-xs" value={id || ''} onChange={(e) => upd({ id: e.target.value })} aria-label="Follow-up id" />
                    <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={action} onChange={(e) => upd({ action: e.target.value })}>{FOLLOW_UP_ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
                    <Input className="h-8 w-40 text-xs" placeholder="Datapoint key" value={fk || ''} onChange={(e) => upd({ key: e.target.value })} />
                    <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label="Remove follow-up" onClick={() => set('follow_ups', b.follow_ups.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                  <ConditionBuilder label="When" value={when || null} blocks={condBlocks} onChange={(v) => upd({ when: v })} />
                  <Textarea rows={2} className="text-xs" placeholder={action === 'explain_and_reask' || action === 're_request' ? 'Message' : 'Question'}
                    value={(action === 'explain_and_reask' || action === 're_request' ? message : question) || ''}
                    onChange={(e) => upd(action === 'explain_and_reask' || action === 're_request' ? { message: e.target.value } : { question: e.target.value })} />
                  <JsonField label="Other settings" hint="label, options, allow_defer, document_checks, tag, effect … as JSON." rows={3} value={rest}
                    onChange={(r) => { setJsonErr((e) => ({ ...e, [`fu${i}`]: r.error || '' })); if (!r.error) set('follow_ups', b.follow_ups.map((x, j) => (j === i ? { id, action, when, question, message, key: fk, ...(r.value || {}) } : x))); }} />
                </div>
              );
            })}
          </div>

          <JsonField label="Datapoints" kind="array" rows={6} hint={`[{ "key", "label", "type", "sources": [${Object.keys(SOURCE_LABEL).map((s) => `"${s}"`).join(', ')}], "profile_field" }]`} value={b.datapoints || []} onChange={setJson('datapoints')} />
          <JsonField label="Evidence" hint='{ "required", "allow_defer", "defer_creates_open_request", "document_checks": [], "max_age_months" }' value={b.evidence || null} onChange={setJson('evidence')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <JsonField label="Variants" hint="Alternative texts, e.g. per legal form or route." value={b.variants || null} onChange={setJson('variants')} />
            <JsonField label="Validation" value={b.validation || null} onChange={setJson('validation')} />
            <JsonField label="Edit in review" hint='e.g. { "type": "multi" }' value={b.edit || null} onChange={setJson('edit')} />
            <JsonField label="Translations" hint='{ "nl": { "question": "…" } }' value={b.translations || null} onChange={setJson('translations')} />
          </div>
        </fieldset>
        {canEdit && (
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-background py-3">
            {hasJsonErr && <span className="text-xs text-red-700">Fix the JSON fields first.</span>}
            <Button variant="outline" className="ml-auto gap-1.5" disabled={!!busy || hasJsonErr || !key || !b.label} onClick={() => onSave(key, payload())}>
              {busy === 'save_block' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
            </Button>
            <Button className="gap-1.5" disabled={!!busy || !entry?.draft} title={entry?.draft ? '' : 'Save a draft first'} onClick={() => onPublish(key)}>
              {busy === 'publish_block' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish{entry?.draft ? ` v${entry.draft.version}` : ''}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
