import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import { Loader2, CheckCircle2 } from 'lucide-react';
import StatementDropZone from '@/components/tm/statement/StatementDropZone';
import StatementTargetPicker from '@/components/tm/statement/StatementTargetPicker';
import StatementChecks, { LifecyclePills } from '@/components/tm/statement/StatementChecks';
import StatementRowsPreview from '@/components/tm/statement/StatementRowsPreview';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

/**
 * Props: open, onOpenChange, clientId (fixes the client), bankAccountId (optional),
 * clients (for the picker when clientId is not given), onCommitted(result).
 */
export default function StatementUploadDrawer({ open, onOpenChange, clientId, bankAccountId, clients = [], onCommitted }) {
  const { currentUser } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const [clientSel, setClientSel] = useState(clientId || '');
  const [accountSel, setAccountSel] = useState(bankAccountId || 'auto');
  const [phase, setPhase] = useState('select'); // select | working | error | review | committing | done
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [lastFile, setLastFile] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [upload, setUpload] = useState(null);
  const [excluded, setExcluded] = useState({});
  const [result, setResult] = useState(null);

  const activeClient = clientId || clientSel;

  function reset() {
    setPhase('select'); setError(''); setLastFile(null); setUploadId(null); setUpload(null); setExcluded({}); setResult(null);
    setClientSel(clientId || ''); setAccountSel(bankAccountId || 'auto');
  }

  function handleOpenChange(next) {
    if (!next && ['working', 'committing'].includes(phase)) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function run(file) {
    setError(''); setPhase('working'); setLastFile(file);
    try {
      let id = uploadId;
      if (!id) {
        setStep('Uploading file…');
        // Stored privately: file_url holds the private file_uri; the backend reads it through a signed URL.
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
        const rec = await base44.entities.StatementUpload.create({
          tenant_id: tenantId, client_id: activeClient, file_url: file_uri, file_name: file.name, status: 'uploaded',
          uploaded_by_user_id: currentUser.id, ...(accountSel !== 'auto' ? { bank_account_id: accountSel } : {}),
        });
        await base44.entities.AuditEvent.create({
          tenant_id: tenantId, client_id: activeClient, actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
          event_type: 'tm_statement_uploaded', before_state: {}, after_state: { statement_upload_id: rec.id, status: 'uploaded' },
          notes: `Uploaded bank statement ${file.name}`,
        });
        id = rec.id; setUploadId(id);
      }
      setStep('Reading and checking the statement…');
      await base44.functions.invoke('parseStatement', { statement_upload_id: id });
      const list = await base44.entities.StatementUpload.filter({ tenant_id: tenantId, id });
      setUpload(list[0]); setPhase('review');
    } catch (e) {
      setError(errMsg(e)); setPhase('error');
    }
  }

  async function commit() {
    setPhase('committing'); setError('');
    try {
      const row_overrides = Object.fromEntries(Object.keys(excluded).filter((k) => excluded[k]).map((k) => [k, { exclude: true }]));
      const res = await base44.functions.invoke('commitStatement', { statement_upload_id: uploadId, row_overrides });
      setResult(res.data); setPhase('done');
      onCommitted?.(res.data);
    } catch (e) {
      setError(errMsg(e)); setPhase('review');
    }
  }

  const rows = upload?.parsed_rows || [];
  const toCommit = rows.filter((r) => !r.duplicate && !excluded[r.idx]).length;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Upload bank statement</SheetTitle>
          <SheetDescription>Upload, check and review a statement before its transactions are added.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          {(phase === 'select' || phase === 'error') && (
            <>
              <StatementTargetPicker
                tenantId={tenantId} clients={clients} clientId={activeClient} onClientChange={setClientSel}
                accountId={accountSel} onAccountChange={setAccountSel} lockClient={!!clientId} disabled={!!uploadId}
              />
              {error && <InlineError message={error} onRetry={lastFile ? () => run(lastFile) : undefined} />}
              <StatementDropZone onFile={run} disabled={!activeClient} />
              {!activeClient && <div className="text-xs text-muted-foreground">Select a client to enable upload.</div>}
            </>
          )}

          {phase === 'working' && (
            <div className="flex flex-col items-center gap-3 py-12" role="status">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              <div className="text-sm font-medium">{step}</div>
              <div className="text-xs text-muted-foreground">PDFs can take up to a minute.</div>
            </div>
          )}

          {(phase === 'review' || phase === 'committing') && upload && (
            <>
              <div className="text-xs text-muted-foreground">
                {upload.file_name} · {upload.format?.toUpperCase()} · {upload.period_from} → {upload.period_to} {upload.currency}
              </div>
              <StatementChecks upload={upload} />
              <LifecyclePills rows={rows} />
              <StatementRowsPreview rows={rows} excluded={excluded} onToggle={(i) => setExcluded((p) => ({ ...p, [i]: !p[i] }))} />
              {error && <InlineError message={error} />}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" disabled={phase === 'committing'} onClick={() => handleOpenChange(false)}>Discard</Button>
                <Button onClick={commit} disabled={phase === 'committing' || toCommit === 0} className="gap-2">
                  {phase === 'committing' && <Loader2 className="w-4 h-4 animate-spin" />}
                  Commit {toCommit} transaction{toCommit === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          )}

          {phase === 'done' && result && (
            <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              <div className="text-sm font-medium">{result.accepted} transaction{result.accepted === 1 ? '' : 's'} added</div>
              <div className="text-xs text-muted-foreground">
                {result.duplicates} duplicate{result.duplicates === 1 ? '' : 's'} skipped · {result.gap_days} gap day{result.gap_days === 1 ? '' : 's'} recorded
              </div>
              <Button onClick={() => handleOpenChange(false)}>Close</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}