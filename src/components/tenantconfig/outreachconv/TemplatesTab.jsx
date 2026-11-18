import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { LayoutList, Loader2, Plus } from 'lucide-react';
import { currentOf } from '@/lib/outreachConfigView';
import TemplateEditor from './TemplateEditor';

/** Conversation view of "Form Templates": templates assembled from blocks, with a per-template Active switch per block. */
export default function TemplatesTab({ cfg }) {
  const { data, busy, act, blocks, templates } = cfg;
  const [open, setOpen] = useState(null);
  const [expanded, setExpanded] = useState(null);
  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (data.error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{data.error}</div>;
  const canEdit = !!data.can_edit;
  const entries = Object.values(templates).sort((a, b) => a.key.localeCompare(b.key));
  const blockRows = Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, currentOf(v)]));
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <LayoutList className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Conversation templates</div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">A template fixes which blocks are asked and in what order. Switch a block off here to leave it out for this template; a switched-off block is logged as skipped.</p>
          </div>
        </div>
        {canEdit && <Button size="sm" className="gap-1.5" onClick={() => setOpen('__new')}><Plus className="h-3.5 w-3.5" /> New template</Button>}
      </div>
      {entries.length === 0 && <p className="text-sm text-muted-foreground">No templates yet. Import the starter library on the Outreach Templates tab (Guided conversation).</p>}
      <div className="space-y-2">
        {entries.map((e) => {
          const r = currentOf(e);
          const isOpen = expanded === e.key;
          return (
            <div key={e.key} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                <button type="button" className="font-medium hover:underline" onClick={() => setExpanded(isOpen ? null : e.key)}>{r.name}</button>
                <Badge variant="outline">{r.client_type}</Badge>
                <span className="text-xs text-muted-foreground">{(r.items || []).filter((i) => i.active !== false).length} of {(r.items || []).length} blocks active · {(r.sections || []).length} sections{r.expected_minutes ? ` · about ${r.expected_minutes} min` : ''}</span>
                {e.published && <Badge variant="outline">v{e.published.version}</Badge>}
                {e.draft && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">draft v{e.draft.version}</Badge>}
                <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setOpen(e.key)}>{canEdit ? 'Edit' : 'View'}</Button>
              </div>
              {isOpen && (
                <ol className="space-y-1 border-t border-border px-3 py-2">
                  {(r.items || []).map((it, i) => (
                    <li key={it.block_key} className="flex items-center gap-2 text-xs">
                      <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
                      <span className="font-mono">{it.block_key}</span>
                      <span className="text-muted-foreground">{blockRows[it.block_key]?.label || 'unknown block'}</span>
                      <label className="ml-auto flex items-center gap-1.5">
                        <Switch checked={it.active !== false} disabled={!canEdit || !!busy}
                          onCheckedChange={(v) => act('toggle_template_item', { key: e.key, block_key: it.block_key, active: v }, `${it.block_key} switched ${v ? 'on' : 'off'} (draft)`)} /> Active
                      </label>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      <TemplateEditor open={!!open} onOpenChange={(v) => !v && setOpen(null)} entry={open && open !== '__new' ? templates[open] : null} isNew={open === '__new'}
        blocks={blockRows} canEdit={canEdit} busy={busy}
        onSave={async (key, template) => { const r = await act('save_template', { key, template }, 'Draft saved'); if (r && open === '__new') setOpen(key); }}
        onPublish={(key) => act('publish_template', { key }, (r) => `Published as version ${r.version}`)} />
    </div>
  );
}
