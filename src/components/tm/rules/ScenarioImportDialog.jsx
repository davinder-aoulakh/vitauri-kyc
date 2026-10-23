import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import { Loader2, Upload } from 'lucide-react';

const HEADER = 'code,name,jurisdiction,indicator_type,fiu_codes,description';

/** Minimal CSV parser: comma-separated, double-quoted fields with "" escapes, first line is the header. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  const [head, ...body] = rows;
  const keys = (head || []).map((h) => h.trim().toLowerCase());
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])));
}

function parse(text) {
  const t = text.trim();
  if (!t) return { rows: [] };
  try {
    if (t.startsWith('[') || t.startsWith('{')) {
      const json = JSON.parse(t);
      const rows = Array.isArray(json) ? json : json.rows;
      if (!Array.isArray(rows)) return { error: 'JSON must be an array of rows or { "rows": [...] }.' };
      return { rows };
    }
    return { rows: parseCsv(t) };
  } catch (e) {
    return { error: `Could not read the file: ${e.message}` };
  }
}

/** Import official FIU indicator lists into the scenario library (CSV or JSON). Mount only while open. */
export default function ScenarioImportDialog({ tenantId, onOpenChange }) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const parsed = useMemo(() => parse(raw), [raw]);
  const rows = parsed.rows || [];

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (file) setRaw(await file.text());
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const res = (await base44.functions.invoke('importTmScenarios', { rows }))?.data;
      if (res?.error) throw new Error(res.error);
      setResult(res);
      await qc.invalidateQueries({ queryKey: ['tmScenarios', tenantId] });
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Import failed.');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import indicators</DialogTitle>
          <DialogDescription>
            Load the official FIU Curaçao or Wwft indicator list into the scenario library. Existing scenarios with the same code are updated. Use the codes exactly as published by the FIU.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">{result.created}</span> created · <span className="font-medium">{result.updated}</span> updated · <span className="font-medium">{result.skipped?.length || 0}</span> skipped</p>
            {result.skipped?.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-md border border-border p-2 text-xs text-muted-foreground">
                {result.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-foreground hover:bg-muted">
                <Upload className="h-3.5 w-3.5" /> Choose CSV or JSON
                <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" onChange={onFile} />
              </label>
              <span>or paste below. CSV header: <code className="rounded bg-muted px-1">{HEADER}</code> (separate several FIU codes with “;”).</span>
            </div>
            <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={6} className="font-mono text-xs" placeholder={HEADER} />
            {parsed.error && <InlineError message={parsed.error} />}
            {rows.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                    <tr><th className="px-2 py-1.5">Code</th><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Jurisdiction</th><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">FIU codes</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.slice(0, 20).map((r, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 font-medium">{r.code || <span className="text-destructive">missing</span>}</td>
                        <td className="px-2 py-1">{r.name || <span className="text-destructive">missing</span>}</td>
                        <td className="px-2 py-1">{r.jurisdiction || 'ALL'}</td>
                        <td className="px-2 py-1">{r.indicator_type || '—'}</td>
                        <td className="px-2 py-1">{Array.isArray(r.fiu_codes) ? r.fiu_codes.join('; ') : r.fiu_codes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 20 && <p className="px-2 py-1.5 text-xs text-muted-foreground">…and {rows.length - 20} more rows</p>}
              </div>
            )}
            {error && <InlineError message={error} />}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{result ? 'Close' : 'Cancel'}</Button>
          {!result && <Button onClick={submit} disabled={busy || !rows.length || !!parsed.error} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Import {rows.length || ''} rows</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
