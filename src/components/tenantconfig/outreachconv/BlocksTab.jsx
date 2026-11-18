import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Download, Loader2, Plus, Puzzle } from 'lucide-react';
import { describeCondition } from '@/lib/outreachConditions';
import { currentOf } from '@/lib/outreachConfigView';
import BlockEditor from './BlockEditor';
import OutreachSettingsCard from './OutreachSettingsCard';

/** Conversation view of "Outreach Templates": the building blocks of the guided conversation, plus the settings card. */
export default function BlocksTab({ cfg }) {
  const { data, busy, act, blocks } = cfg;
  const [open, setOpen] = useState(null); // key, or '__new'
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const entries = useMemo(() => Object.values(blocks).sort((a, b) => a.key.localeCompare(b.key)), [blocks]);
  const allBlocks = entries.map(currentOf).filter(Boolean);
  const shown = entries.filter((e) => {
    const r = currentOf(e);
    if (type !== 'all' && !(r.client_types || []).includes(type)) return false;
    const t = q.trim().toLowerCase();
    return !t || r.key.includes(t) || String(r.label || '').toLowerCase().includes(t);
  });
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (data.error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{data.error}</div>;
  const canEdit = !!data.can_edit;
  const entry = open && open !== '__new' ? blocks[open] : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Puzzle className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-semibold">Building blocks</div>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">Each block is one question (or small group) of the guided conversation, with its datapoints, conditions, follow-ups and evidence. The required set lives in the form template.</p>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => act('seed', {}, (r) => `Imported ${r.created_blocks} block(s) and ${r.created_templates} template(s); ${r.skipped.length} already present`)}>
                {busy === 'seed' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Import starter library
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setOpen('__new')}><Plus className="h-3.5 w-3.5" /> New block</Button>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input className="h-8 w-60 text-xs" placeholder="Search key or label" value={q} onChange={(e) => setQ(e.target.value)} />
          {['all', 'NP', 'ORG', 'RP'].map((t) => <Button key={t} size="sm" variant={type === t ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setType(t)}>{t === 'all' ? 'All' : t}</Button>)}
          <span className="ml-auto text-xs text-muted-foreground">{shown.length} of {entries.length}</span>
        </div>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No blocks yet. {canEdit ? 'Use "Import starter library" to load the blocks and templates of the pack.' : ''}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Key</th><th className="py-2 pr-3 font-medium">Label</th><th className="py-2 pr-3 font-medium">Section</th>
                <th className="py-2 pr-3 font-medium">Client</th><th className="py-2 pr-3 font-medium">Widget</th><th className="py-2 pr-3 font-medium">Show if</th>
                <th className="py-2 pr-3 font-medium">Follow-ups</th><th className="py-2 pr-3 font-medium">Version</th><th className="py-2 font-medium">Active by default</th>
              </tr></thead>
              <tbody>
                {shown.map((e) => {
                  const r = currentOf(e);
                  return (
                    <tr key={e.key} className="cursor-pointer border-b border-border/60 hover:bg-muted/30" onClick={() => setOpen(e.key)}>
                      <td className="py-2 pr-3 font-mono">{r.key}</td>
                      <td className="py-2 pr-3">{r.label}</td>
                      <td className="py-2 pr-3">{r.section_key}</td>
                      <td className="py-2 pr-3">{(r.client_types || []).join(', ')}</td>
                      <td className="py-2 pr-3">{r.widget}</td>
                      <td className="max-w-[220px] truncate py-2 pr-3" title={describeCondition(r.show_if)}>{r.show_if ? describeCondition(r.show_if) : '—'}</td>
                      <td className="py-2 pr-3">{(r.follow_ups || []).length || '—'}</td>
                      <td className="py-2 pr-3">
                        {e.published ? <Badge variant="outline">v{e.published.version}</Badge> : null}
                        {e.draft ? <Badge className="ml-1 bg-amber-100 text-amber-900 hover:bg-amber-100">draft v{e.draft.version}</Badge> : null}
                      </td>
                      <td className="py-2">{r.active_default !== false ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <OutreachSettingsCard settings={data.settings} registry={data.registry} canEdit={canEdit} busy={busy} onSave={(s) => act('save_settings', { settings: s }, 'Settings saved')} />
      <BlockEditor open={!!open} onOpenChange={(v) => !v && setOpen(null)} entry={entry} isNew={open === '__new'} allBlocks={allBlocks} canEdit={canEdit} busy={busy}
        onSave={async (key, block) => { const r = await act('save_block', { key, block }, 'Draft saved'); if (r && open === '__new') setOpen(key); }}
        onPublish={(key) => act('publish_block', { key }, (r) => `Published as version ${r.version}`)} />
    </div>
  );
}
