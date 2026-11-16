// Bulk import (KYC + AML layout, phase 8): one MT940 / CAMT.053 file with statements for several accounts.
// Known accounts are processed; unknown IBANs wait in the Unmatched accounts queue until linked to a customer.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Upload, Link2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const OUTCOME = {
  processed: ['Processed', 'bg-emerald-100 text-emerald-700'],
  needs_review: ['Needs review', 'bg-amber-100 text-amber-800'],
  unmatched: ['Unmatched', 'bg-orange-100 text-orange-700'],
  already_imported: ['Already imported', 'bg-slate-100 text-slate-600'],
  empty: ['No transactions', 'bg-slate-100 text-slate-600'],
  failed: ['Failed', 'bg-red-100 text-red-700'],
};
const REASON = {
  unknown_iban: 'No customer has this account',
  ambiguous: 'More than one customer has this account',
  no_account_reference: 'The statement names no account',
};
const period = (r) => (r.period_from || r.period_to ? `${r.period_from || '…'} – ${r.period_to || '…'}` : '—');

export function BulkImportDialog({ open, onOpenChange, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => { if (open) { setFile(null); setError(''); setResult(null); } }, [open]);

  async function run() {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      const res = await base44.functions.invoke('bulkImportStatements', { file_url: file_uri, file_name: file.name });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      onDone?.();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import file</DialogTitle></DialogHeader>
        {!result ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              One MT940 or CAMT.053 file with statements for several accounts. Each statement is matched to a customer account on IBAN and
              runs the same checks as a single upload. Statements for an unknown IBAN wait under Unmatched accounts.
            </p>
            <div>
              <Label className="text-xs mb-1.5 block">File</Label>
              <Input type="file" accept=".sta,.mt940,.940,.txt,.xml,.camt" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            {error && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={run} disabled={!file || busy} className="gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {busy ? 'Importing…' : 'Import'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              {result.summary.accounts} account(s) in the file: <strong>{result.summary.processed}</strong> processed,{' '}
              <strong>{result.summary.needs_review}</strong> to review, <strong>{result.summary.unmatched}</strong> unmatched
              {result.summary.already_imported ? `, ${result.summary.already_imported} already imported` : ''}{result.summary.failed ? `, ${result.summary.failed} failed` : ''}.
            </p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="bg-muted/40 text-muted-foreground text-left">
                  <th className="px-3 py-2">Account</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Result</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {result.statements.map((r, i) => {
                    const [label, cls] = OUTCOME[r.outcome] || [r.outcome, 'bg-slate-100 text-slate-600'];
                    return (
                      <tr key={`${r.iban}-${i}`} className="align-top">
                        <td className="px-3 py-2 font-mono">{r.iban || '—'}<div className="font-sans text-muted-foreground">{r.tx_count} transaction(s)</div></td>
                        <td className="px-3 py-2">{r.client_id ? <Link className="hover:underline" to={`/client/${r.client_id}`}>{r.client_name || 'Customer'}</Link> : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{period(r)}</td>
                        <td className="px-3 py-2">
                          <span className={cn('px-2 py-0.5 rounded-full font-medium', cls)}>{label}</span>
                          <div className="text-muted-foreground mt-1">
                            {r.outcome === 'processed' && `${r.accepted} added (${r.recent} recent, ${r.historical} historical), ${r.duplicates} duplicate(s)${r.alerts ? `, ${r.alerts} alert(s)` : ''}`}
                            {r.outcome === 'needs_review' && `${r.reason}. Open the customer's accounts to review the statement.`}
                            {r.outcome === 'unmatched' && (REASON[r.reason] || r.reason)}
                            {r.outcome === 'failed' && r.error}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ entry, clients, onClose, onDone }) {
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function link() {
    setBusy(true); setError('');
    try {
      const res = await base44.functions.invoke('resolveUnmatchedStatement', { id: entry.id, action: 'link', client_id: clientId });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      onDone(data);
    } catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Link to customer</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-0.5">
            <div className="font-mono text-sm">{entry.iban}</div>
            <div className="text-muted-foreground">{entry.tx_count} transaction(s) · {period(entry)} · {entry.file_name}</div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Customer *</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">The account is added to this customer (unless they already have it) and the held statement is processed with the normal checks.</p>
          {error && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={link} disabled={!clientId || busy} className="gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link and process</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DismissDialog({ entry, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function dismiss() {
    setBusy(true); setError('');
    try {
      const res = await base44.functions.invoke('resolveUnmatchedStatement', { id: entry.id, action: 'dismiss', reason: reason.trim() });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      onDone();
    } catch (e) { setError(errText(e)); setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Dismiss unmatched statement</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">The {entry.tx_count} held transaction(s) for {entry.iban || 'this statement'} are not imported.</p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. not a customer account)" className="text-sm min-h-16" />
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={dismiss} disabled={reason.trim().length < 5 || busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Dismiss</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Unmatched accounts queue on the Transactions page. Renders nothing while the queue is empty. */
export function UnmatchedAccountsCard({ tenantId, clients, version, canManage, onChanged }) {
  const [rows, setRows] = useState([]);
  const [linking, setLinking] = useState(null);
  const [dismissing, setDismissing] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await base44.entities.UnmatchedStatement.filter({ tenant_id: tenantId, status: 'open' }, '-created_date', 100);
      setRows(Array.isArray(res) ? res : res?.items || []);
    } catch { setRows([]); }
  }, [tenantId]);
  useEffect(() => { load(); }, [load, version]);

  if (!rows.length && !note) return null;
  return (
    <div className="bg-card border border-orange-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-orange-600" />
        <span className="text-sm font-semibold">Unmatched accounts ({rows.length})</span>
        <span className="text-xs text-muted-foreground">Statements from a bulk import whose account is not linked to a customer. Their transactions are held until linked.</span>
      </div>
      {note && <div className="px-4 py-2 text-xs bg-emerald-50 text-emerald-800 border-b border-border">{note}</div>}
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-muted-foreground text-left">
            <th className="px-4 py-2">Account</th><th className="px-4 py-2">Transactions</th><th className="px-4 py-2">Period</th><th className="px-4 py-2">File</th><th className="px-4 py-2" />
          </tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-mono">{r.iban || '—'}<div className="font-sans text-muted-foreground">{REASON[r.reason] || ''}</div></td>
                <td className="px-4 py-2">{r.tx_count ?? '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{period(r)}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.file_name}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canManage && r.iban && <Button size="sm" className="h-7 text-xs mr-2" onClick={() => setLinking(r)}>Link to customer</Button>}
                  {canManage && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDismissing(r)}>Dismiss</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {linking && (
        <LinkDialog entry={linking} clients={clients} onClose={() => setLinking(null)}
          onDone={(d) => {
            setLinking(null);
            setNote(d.outcome === 'processed' ? `Linked: ${d.accepted} transaction(s) added (${d.recent} recent, ${d.historical} historical).` : 'Linked. The statement waits for review in the customer\'s accounts.');
            load(); onChanged?.();
          }} />
      )}
      {dismissing && <DismissDialog entry={dismissing} onClose={() => setDismissing(null)} onDone={() => { setDismissing(null); load(); }} />}
    </div>
  );
}
