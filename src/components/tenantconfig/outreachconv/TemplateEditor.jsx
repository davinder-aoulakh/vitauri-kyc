import React, { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Send, X } from 'lucide-react';
import JsonField from './JsonField';
import { describeCondition } from '@/lib/outreachConditions';

const F = ({ label, hint, children }) => (<div className="space-y-1"><label className="text-xs font-medium">{label}</label>{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}{children}</div>);
const lines = (v) => (v || []).join('\n');
const fromLines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

/** Editor for one OutreachFlowTemplate (spec 4.3): ordered blocks with an Active switch each, sections, settings and intro. */
export default function TemplateEditor({ open, onOpenChange, entry, isNew, blocks, canEdit, busy, onSave, onPublish }) {
  const row = entry?.draft || entry?.published || null;
  const [t, setT] = useState(/** @type {any} */ ({}));
  const [key, setKey] = useState('');
  const [add, setAdd] = useState('');
  const [jsonErr, setJsonErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setKey(row?.key || '');
    setT(row ? { ...row } : { name: '', client_type: 'NP', case_types: ['Onboarding'], sections: [], items: [], settings: {}, intro_messages: [], start_chip: "Let's begin" });
    setJsonErr('');
  }, [open, row?.id]);
  const set = (k, v) => setT((x) => ({ ...x, [k]: v }));
  const items = t.items || [];
  const move = (i, d) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set('items', n); };
  const blockOf = (k) => blocks[k];
  const free = Object.keys(blocks).filter((k) => !items.some((i) => i.block_key === k)).sort();
  const fields = ['name', 'client_type', 'case_types', 'sections', 'items', 'settings', 'intro_messages', 'start_chip', 'expected_minutes', 'default_deadline_days', 'channel', 'notes'];
  const ro = !canEdit;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {isNew ? 'New template' : t.name || row?.key}
            {entry?.published && <Badge variant="outline">Published v{entry.published.version}</Badge>}
            {entry?.draft && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Draft v{entry.draft.version}</Badge>}
          </SheetTitle>
          <SheetDescription>The template fixes the required set and the order. Publishing pins each block to its current published version.</SheetDescription>
        </SheetHeader>
        <fieldset disabled={ro} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <F label="Key"><Input value={key} disabled={!isNew} onChange={(e) => setKey(e.target.value.trim())} /></F>
            <F label="Name"><Input value={t.name || ''} onChange={(e) => set('name', e.target.value)} /></F>
            <F label="Client type">
              <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={t.client_type || 'NP'} onChange={(e) => set('client_type', e.target.value)}>
                <option value="NP">NP</option><option value="ORG">ORG</option><option value="RP">RP (related party)</option>
              </select>
            </F>
            <F label="Case types" hint="Comma separated."><Input value={(t.case_types || []).join(', ')} onChange={(e) => set('case_types', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></F>
            <F label="Expected minutes"><Input type="number" value={t.expected_minutes ?? ''} onChange={(e) => set('expected_minutes', e.target.value === '' ? null : Number(e.target.value))} /></F>
            <F label="Deadline (days)"><Input type="number" value={t.default_deadline_days ?? ''} onChange={(e) => set('default_deadline_days', e.target.value === '' ? null : Number(e.target.value))} /></F>
          </div>
          <F label="Sections" hint="One per line: key | label (shown in the progress list).">
            <Textarea rows={4} className="font-mono text-xs" value={(t.sections || []).map((s) => `${s.key} | ${s.label}`).join('\n')}
              onChange={(e) => set('sections', fromLines(e.target.value).map((l) => { const [k, ...r] = l.split('|'); return { key: k.trim(), label: (r.join('|') || k).trim() }; }))} />
          </F>
          <div className="space-y-2">
            <div className="text-xs font-medium">Blocks in order ({items.length}, {items.filter((i) => i.active !== false).length} active)</div>
            <ol className="space-y-1">
              {items.map((it, i) => {
                const b = blockOf(it.block_key);
                return (
                  <li key={it.block_key} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                    <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
                    <span className="font-mono">{it.block_key}</span>
                    <span className="text-muted-foreground">{b?.label || 'unknown block'}</span>
                    {b?.show_if && <span className="max-w-[200px] truncate text-[11px] text-muted-foreground" title={describeCondition(b.show_if)}>· if {describeCondition(b.show_if)}</span>}
                    <Input className="ml-auto h-7 w-24 text-[11px]" placeholder={b?.section_key || 'section'} value={it.section_key || ''} title="Section override for this template"
                      onChange={(e) => set('items', items.map((x, j) => (j === i ? { ...x, section_key: e.target.value || undefined } : x)))} />
                    {it.block_version ? <span className="text-[11px] text-muted-foreground">v{it.block_version}</span> : null}
                    <label className="flex items-center gap-1"><Switch checked={it.active !== false} onCheckedChange={(v) => set('items', items.map((x, j) => (j === i ? { ...x, active: v } : x)))} /> Active</label>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Remove block" onClick={() => set('items', items.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
                  </li>
                );
              })}
            </ol>
            {free.length > 0 && (
              <div className="flex items-center gap-2">
                <select aria-label="Block to add" className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={add} onChange={(e) => setAdd(e.target.value)}>
                  <option value="">Add a block…</option>{free.map((k) => <option key={k} value={k}>{k} · {blocks[k]?.label}</option>)}
                </select>
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!add} onClick={() => { set('items', [...items, { block_key: add, active: blocks[add]?.active_default !== false }]); setAdd(''); }}><Plus className="h-3 w-3" /> Add</Button>
              </div>
            )}
          </div>
          <F label="Intro messages" hint="One message per line. Placeholders: {first_name}, {tenant_name}, {deadline_date}, {company}, {role_text}."><Textarea rows={4} value={lines(t.intro_messages)} onChange={(e) => set('intro_messages', fromLines(e.target.value))} /></F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Start button text"><Input value={t.start_chip || ''} onChange={(e) => set('start_chip', e.target.value)} /></F>
            <F label="Channel"><Input value={t.channel || ''} onChange={(e) => set('channel', e.target.value)} /></F>
          </div>
          <JsonField label="Template settings" hint='Overrides of the tenant settings for this template, e.g. { "uboThreshold": 25, "releaseInvitesAfterIdv": true }' value={t.settings || {}}
            onChange={(r) => { setJsonErr(r.error || ''); if (!r.error) set('settings', r.value || {}); }} />
        </fieldset>
        {canEdit && (
          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-background py-3">
            {jsonErr && <span className="text-xs text-red-700">Fix the settings JSON first.</span>}
            <Button variant="outline" className="ml-auto gap-1.5" disabled={!!busy || !!jsonErr || !key || !t.name} onClick={() => onSave(key, Object.fromEntries(fields.map((k) => [k, t[k] ?? null])))}>
              {busy === 'save_template' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
            </Button>
            <Button className="gap-1.5" disabled={!!busy || !entry?.draft} title={entry?.draft ? '' : 'Save a draft first'} onClick={() => onPublish(key)}>
              {busy === 'publish_template' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish{entry?.draft ? ` v${entry.draft.version}` : ''}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
