import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import InlineError from '@/components/shared/InlineError';
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatementDropZone from '@/components/tm/statement/StatementDropZone';
import StatementTargetPicker from '@/components/tm/statement/StatementTargetPicker';
import StatementChecks, { LifecyclePills } from '@/components/tm/statement/StatementChecks';
import StatementRowsPreview from '@/components/tm/statement/StatementRowsPreview';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const STEPS = ['Account', 'File', 'Checks & preview', 'Result'];
const TYPE_LABEL = { own: 'Own account', external_psd2: 'External account (PSD2)', joint: 'Joint account', business: 'Business account' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Stepper({ current }) {
  return (
    <ol className="flex items-center gap-1 text-[11px]" aria-label="Upload steps">
      {STEPS.map((name, i) => {
        const n = i + 1;
        return (
          <li key={name} aria-current={n === current ? 'step' : undefined}
            className={cn('flex-1 rounded-md border px-2 py-1 text-center font-medium',
              n < current ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : n === current ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
            {n < current ? '✓ ' : `${n}. `}{name}
          </li>
        );
      })}
    </ol>
  );
}

function ResultLine({ ok = true, children }) {
  return (
    <li className="flex items-start gap-2 px-3 py-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />}
      <span>{children}</span>
    </li>
  );
}

/**
 * Props: open, onOpenChange, clientId (fixes the client), bankAccountId (optional),
 * clients (for the picker when clientId is not given), onCommitted(result).
 * With the aml_nav_v2 flag the dialog has four steps (Account, File, Checks & preview, Result); without it the
 * layout is the earlier one (select, review, done).
 */
export default function StatementUploadDrawer({ open, onOpenChange, clientId, bankAccountId, clients = [], onCommitted }) {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const v2 = isFeatureEnabled(tenant, 'aml_nav_v2');
  const [clientSel, setClientSel] = useState(clientId || '');
  const [accountSel, setAccountSel] = useState(bankAccountId || 'auto');
  const [phase, setPhase] = useState('select'); // select | working | error | review | committing | done
  const [fileStep, setFileStep] = useState(false); // v2: step 1 (account) confirmed, now on step 2 (file)
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [lastFile, setLastFile] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [upload, setUpload] = useState(null);
  const [excluded, setExcluded] = useState({});
  const [result, setResult] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [otherAccount, setOtherAccount] = useState('');

  const activeClient = clientId || clientSel;

  // v2: the client's accounts, for the account summary in step 1 and "choose another account" on a mismatch
  useEffect(() => {
    let live = true;
    if (!v2 || !open || !activeClient || !tenantId) { setAccounts([]); return undefined; }
    base44.entities.BankAccount.filter({ tenant_id: tenantId, client_id: activeClient }).then((l) => { if (live) setAccounts(l || []); }).catch(() => {});
    return () => { live = false; };
  }, [v2, open, activeClient, tenantId]);

  function reset() {
    setPhase('select'); setFileStep(false); setError(''); setLastFile(null); setUploadId(null); setUpload(null); setExcluded({}); setResult(null);
    setClientSel(clientId || ''); setAccountSel(bankAccountId || 'auto'); setOtherAccount('');
  }

  function handleOpenChange(next) {
    if (!next && ['working', 'committing'].includes(phase)) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function parse(id) {
    setStep('Reading and checking the statement…');
    await base44.functions.invoke('parseStatement', { statement_upload_id: id });
    const list = await base44.entities.StatementUpload.filter({ tenant_id: tenantId, id });
    setUpload(list[0]); setExcluded({}); setPhase('review');
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
      await parse(id);
    } catch (e) {
      setError(errMsg(e)); setPhase('error');
    }
  }

  // IBAN mismatch: point the upload at another account (existing, or newly added for the IBAN in the file) and check again.
  async function retarget(accountId) {
    setError(''); setPhase('working');
    try {
      await base44.entities.StatementUpload.update(uploadId, { bank_account_id: accountId });
      await base44.entities.AuditEvent.create({
        tenant_id: tenantId, client_id: activeClient, actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
        event_type: 'tm_statement_account_changed', before_state: { bank_account_id: upload?.bank_account_id || null }, after_state: { statement_upload_id: uploadId, bank_account_id: accountId },
        notes: 'Statement upload moved to another bank account after an IBAN mismatch',
      });
      setAccountSel(accountId);
      await parse(uploadId);
    } catch (e) {
      setError(errMsg(e)); setPhase('review');
    }
  }

  async function addFileIban(iban) {
    setError(''); setPhase('working'); setStep('Adding the account…');
    try {
      const res = await base44.functions.invoke('manageBankAccount', { action: 'create', client_id: activeClient, iban_or_number: iban, source_type: 'upload', currency: upload?.currency || undefined });
      const account = res?.data?.account;
      if (!account?.id) throw new Error(res?.data?.error || 'The account could not be added');
      setAccounts((l) => [...l, account]);
      await retarget(account.id);
    } catch (e) {
      setError(errMsg(e)); setPhase('review');
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
  const duplicateRows = rows.filter((r) => r.duplicate).length;
  const mismatch = (upload?.blocking || []).find((b) => b.code === 'iban_mismatch');
  const blocked = (upload?.blocking || []).length > 0;
  const selectedAccount = accounts.find((a) => a.id === accountSel) || null;
  const fileAccount = mismatch ? accounts.find((a) => String(a.iban_or_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === mismatch.file_iban) : null;
  const currentStep = phase === 'done' ? 4 : ['review', 'committing'].includes(phase) ? 3 : (fileStep || phase === 'working' || uploadId) ? 2 : 1;
  const nothingNew = v2 && toCommit === 0 && duplicateRows > 0 && !Object.values(excluded).some(Boolean);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className={cn('w-full overflow-y-auto', v2 ? 'sm:max-w-2xl' : 'sm:max-w-xl')}>
        <SheetHeader>
          <SheetTitle>{v2 ? 'Upload statement' : 'Upload bank statement'}</SheetTitle>
          <SheetDescription>Upload, check and review a statement before its transactions are added.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          {v2 && <Stepper current={currentStep} />}

          {/* v2 · step 1: Account */}
          {v2 && (phase === 'select' || phase === 'error') && !fileStep && !uploadId && (
            <>
              <StatementTargetPicker
                tenantId={tenantId} clients={clients} clientId={activeClient} onClientChange={setClientSel}
                accountId={accountSel} onAccountChange={setAccountSel} lockClient={!!clientId}
              />
              {selectedAccount ? (
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2.5 text-xs">
                  <dt className="text-muted-foreground">Account</dt><dd className="font-mono">{selectedAccount.iban_or_number}</dd>
                  <dt className="text-muted-foreground">Type</dt><dd>{TYPE_LABEL[selectedAccount.account_type] || 'Not set'}</dd>
                  <dt className="text-muted-foreground">Holders</dt>
                  <dd>{(selectedAccount.holders || []).map((h) => h.name).filter(Boolean).join(', ') || selectedAccount.holder_name || 'Not set'}</dd>
                  <dt className="text-muted-foreground">Source</dt><dd>{selectedAccount.source_type || '—'}{selectedAccount.institution ? ` · ${selectedAccount.institution}` : ''}</dd>
                </dl>
              ) : activeClient ? (
                <p className="text-xs text-muted-foreground">No account chosen: the account is read from the statement. If the customer has no account with that number yet, it is added when the statement is processed.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Select a client first.</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
                <Button onClick={() => setFileStep(true)} disabled={!activeClient}>Next</Button>
              </div>
            </>
          )}

          {/* File (legacy: together with the target picker; v2: step 2) */}
          {(phase === 'select' || phase === 'error') && (!v2 || fileStep || uploadId) && (
            <>
              {!v2 && (
                <StatementTargetPicker
                  tenantId={tenantId} clients={clients} clientId={activeClient} onClientChange={setClientSel}
                  accountId={accountSel} onAccountChange={setAccountSel} lockClient={!!clientId} disabled={!!uploadId}
                />
              )}
              {error && <InlineError message={error} onRetry={lastFile ? () => run(lastFile) : undefined} />}
              <StatementDropZone onFile={run} disabled={!activeClient} />
              {!activeClient && <div className="text-xs text-muted-foreground">Select a client to enable upload.</div>}
              {v2 && !uploadId && <div className="flex justify-start"><Button variant="outline" onClick={() => { setFileStep(false); setError(''); }}>Back</Button></div>}
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
              <StatementChecks upload={upload} v2={v2} />

              {/* IBAN mismatch: processing is blocked (also without the v2 layout) */}
              {mismatch && (
                <div className="space-y-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-900" role="alert">
                  <div className="flex items-start gap-2">
                    <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                    <div>
                      <div className="font-semibold">This statement belongs to another account</div>
                      <div>The file is for <span className="font-mono">{mismatch.file_iban}</span>; you selected <span className="font-mono">{mismatch.account_iban}</span>. It cannot be processed on this account.</div>
                    </div>
                  </div>
                  {v2 ? (
                    <div className="space-y-2 pl-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={otherAccount || fileAccount?.id || ''} onValueChange={setOtherAccount}>
                          <SelectTrigger className="h-8 w-64 bg-white text-xs"><SelectValue placeholder="Choose another account" /></SelectTrigger>
                          <SelectContent>
                            {accounts.filter((a) => a.id !== upload.bank_account_id).map((a) => <SelectItem key={a.id} value={a.id}>{a.iban_or_number}{a.institution ? ` · ${a.institution}` : ''}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" className="h-8 bg-white text-xs" disabled={phase === 'committing' || !(otherAccount || fileAccount?.id)} onClick={() => retarget(otherAccount || fileAccount.id)}>Use this account</Button>
                      </div>
                      {!fileAccount && (
                        <Button size="sm" variant="outline" className="h-8 bg-white text-xs" disabled={phase === 'committing'} onClick={() => addFileIban(mismatch.file_iban)}>
                          Add {mismatch.file_iban} as an account for this customer
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="pl-6">Discard this upload and start again on the right account, or add the account first.</div>
                  )}
                </div>
              )}

              {!v2 && <LifecyclePills rows={rows} />}
              <StatementRowsPreview rows={rows} excluded={excluded} onToggle={(i) => setExcluded((p) => ({ ...p, [i]: !p[i] }))} v2={v2} />
              {error && <InlineError message={error} />}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" disabled={phase === 'committing'} onClick={() => handleOpenChange(false)}>{v2 ? 'Cancel' : 'Discard'}</Button>
                <Button onClick={commit} disabled={phase === 'committing' || blocked || (toCommit === 0 && !nothingNew)} className="gap-2">
                  {phase === 'committing' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {nothingNew ? 'Finish (nothing new to add)' : v2 ? `Process ${plural(toCommit, 'transaction')}` : `Commit ${toCommit} transaction${toCommit === 1 ? '' : 's'}`}
                </Button>
              </div>
            </>
          )}

          {phase === 'done' && result && !v2 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              <div className="text-sm font-medium">{result.accepted} transaction{result.accepted === 1 ? '' : 's'} added</div>
              <div className="text-xs text-muted-foreground">
                {result.duplicates} duplicate{result.duplicates === 1 ? '' : 's'} skipped · {result.gap_days} gap day{result.gap_days === 1 ? '' : 's'} recorded
              </div>
              <Button onClick={() => handleOpenChange(false)}>Close</Button>
            </div>
          )}

          {/* v2 · step 4: Result */}
          {phase === 'done' && result && v2 && (
            <div role="status" className="space-y-3">
              <ul className="divide-y divide-border rounded-xl border border-border">
                <ResultLine>
                  <b>{plural(result.accepted || 0, 'transaction')} added</b> to the ledger
                  {result.accepted > 0 && <> ({result.historical || 0} historical, analysis only)</>}
                  {result.duplicates > 0 && <> · {plural(result.duplicates, 'duplicate')} skipped</>}
                </ResultLine>
                {result.accepted > 0 && (
                  <>
                    <ResultLine>{plural(result.recent || 0, 'recent transaction')} sent for screening (Didit); historical ones are not screened and raise no alerts</ResultLine>
                    <ResultLine ok={!result.gap_days}>
                      Coverage filled for {upload?.period_from} → {upload?.period_to}
                      {result.covered_days > 0 && <>: {plural(result.covered_days, 'day')} without transactions recorded as covered</>}
                      {result.gap_days > 0 && <> · {plural(result.gap_days, 'day')} missing</>}
                    </ResultLine>
                    <ResultLine>{plural(result.counterparties || 0, 'counterparty').replace('counterpartys', 'counterparties')} found</ResultLine>
                  </>
                )}
                {(result.rejected || []).length > 0 && <ResultLine ok={false}>{plural(result.rejected.length, 'row')} could not be added: {result.rejected.slice(0, 2).map((r) => r.reason).join('; ')}</ResultLine>}
              </ul>
              <p className="text-xs text-muted-foreground">Alerts from screening appear under Alerts once Didit has answered.</p>
              <div className="flex justify-end"><Button onClick={() => handleOpenChange(false)}>Close</Button></div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
