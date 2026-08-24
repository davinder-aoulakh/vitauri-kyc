import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import DiditVerificationPanel from '@/components/client/DiditVerificationPanel';
import { CheckCircle, XCircle, AlertTriangle, Loader2, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Score Ring ────────────────────────────────────────────────────────────────
function ScoreRing({ value, color, label, subLabel }) {
  if (value == null) return null;
  const r = 26;
  const c = 2 * Math.PI * r;
  const arc = (value / 100) * c;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="66" height="66" viewBox="0 0 66 66">
        <circle cx="33" cy="33" r={r} fill="none" stroke="#E5E7EB" strokeWidth="5.5" />
        <circle cx="33" cy="33" r={r} fill="none" stroke={color} strokeWidth="5.5"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          transform="rotate(-90 33 33)" />
        <text x="33" y="37" textAnchor="middle" fontSize="13" fontWeight="700" fill={color}>
          {Math.round(value)}%
        </text>
      </svg>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {subLabel && (
        <span className={cn('text-xs font-semibold',
          subLabel === 'Approved' ? 'text-emerald-600' : 'text-red-600')}>
          {subLabel}
        </span>
      )}
    </div>
  );
}

// ── Apply OCR Button (with saving feedback) ───────────────────────────────────
function ApplyOcrButton({ extractedData, clientId, onDone }) {
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  async function handleApply() {
    setSaving(true);
    const updates = {};
    if (extractedData.full_name)     updates.full_name     = extractedData.full_name;
    if (extractedData.date_of_birth) updates.date_of_birth = extractedData.date_of_birth;
    if (extractedData.nationality)   updates.nationality   = extractedData.nationality;
    if (extractedData.id_number)     updates.id_number     = extractedData.id_number;
    if (Object.keys(updates).length > 0) {
      await base44.entities.Client.update(clientId, updates).catch(console.error);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(onDone, 1200);
  }

  if (saved) return <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Saved to client profile</span>;
  return (
    <Button size="sm" className="h-7 text-xs" onClick={handleApply} disabled={saving}>
      {saving ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Saving…</> : 'Apply to Client Profile'}
    </Button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function IdentityVerificationStep({ kycCase, client, currentUser, tenant, onStepComplete, onCaseChanged, onIdvDataLoaded }) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [idvResults, setIdvResults] = useState([]);
  const [extractedData, setExtractedData] = useState(null);
  const [showExtractedPrompt, setShowExtractedPrompt] = useState(false);
  const [diditPanelOpen, setDiditPanelOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [autoCompleted, setAutoCompleted] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  // Track if prompt has been shown/dismissed this session so it doesn't re-appear on re-load
  const promptShownRef = React.useRef(false);

  useEffect(() => { loadResults(); }, [kycCase.id]);

  async function loadResults(opts = {}) {
    if (opts.sync) setSyncing(true);
    else setLoading(true);

    try {
      const caseOutreaches = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
      const caseIds = new Set((caseOutreaches || []).map(r => r.id));
      const clientOutreaches = await base44.entities.OutreachRequest.filter({ client_id: kycCase.client_id });
      const standalone = (clientOutreaches || []).filter(r => !caseIds.has(r.id));
      const all = [...(caseOutreaches || []), ...standalone];

      // On-demand pull: find items that have a session but no terminal status yet
      const pendingItems = [];
      for (const req of all) {
        for (const item of (req.items || [])) {
          const isIdvItem = item.field_type === 'id_verification' || item.didit_session_id ||
            (item.item_type === 'data_point' && (item.label || '').toLowerCase().match(/id[&\s]?v|identity\s*verif|idv/i)) ||
            // Legacy: response_text is a JSON blob containing a didit_session_id
            (item.response_text && (() => { try { return JSON.parse(item.response_text)?.didit_session_id; } catch { return false; } })());

          if (!isIdvItem) continue;

          // Check terminal status — also look inside response_text JSON (legacy storage)
          let hasTerminalStatus = item.idv_status && item.idv_status !== 'Pending';
          if (!hasTerminalStatus && item.response_text) {
            try { const p = JSON.parse(item.response_text); hasTerminalStatus = p?.idv_status && p.idv_status !== 'Pending'; } catch {}
          }
          const hasSessionOrResponse = item.didit_session_id || item.response_text;

          if (!hasTerminalStatus && hasSessionOrResponse) {
            pendingItems.push({ req, item });
          }
        }
      }

      // Pull from Didit for pending items
      if (pendingItems.length > 0) {
        setSyncing(true);
        for (const { req, item } of pendingItems) {
          try {
            await base44.functions.invoke('getDiditSessionResult', {
              session_id:  item.didit_session_id || null,
              outreach_id: req.id,
              item_id:     item.item_id,
              tenant_id:   kycCase.tenant_id,
            });
          } catch {}
        }
        setLastSynced(new Date());
      }

      // Re-fetch outreaches after potential sync
      const refreshedCaseOutreaches = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
      const refreshedClientOutreaches = await base44.entities.OutreachRequest.filter({ client_id: kycCase.client_id });
      const refreshedStandalone = (refreshedClientOutreaches || []).filter(r => !new Set((refreshedCaseOutreaches || []).map(r => r.id)).has(r.id));
      const refreshedAll = [...(refreshedCaseOutreaches || []), ...refreshedStandalone];

      const items = refreshedAll
        .flatMap(req =>
          (req.items || [])
            .filter(item => {
              const isIdv = item.field_type === 'id_verification' || item.didit_session_id ||
                (item.item_type === 'data_point' && (item.label || '').toLowerCase().match(/id[&\s]?v|identity\s*verif|idv/i)) ||
                (item.response_text && (() => { try { return JSON.parse(item.response_text)?.didit_session_id; } catch { return false; } })());
              if (!isIdv) return false;
              // Accept items with direct idv_status OR with idv data embedded in response_text
              if (item.idv_status && item.idv_status !== 'Pending') return true;
              try {
                const parsed = JSON.parse(item.response_text || '');
                return parsed?.idv_status && parsed.idv_status !== 'Pending';
              } catch { return false; }
            })
            .map(item => {
              // Unpack response_text JSON fields onto the item if direct fields are missing
              if (!item.idv_status && item.response_text) {
                try {
                  const parsed = JSON.parse(item.response_text);
                  if (parsed?.idv_status) return { ...parsed, ...item, ...parsed, _req_id: req.id };
                } catch {}
              }
              return { ...item, _req_id: req.id };
            })
        )
        .sort((a, b) => {
          if (!a.idv_checked_at && !b.idv_checked_at) return 0;
          if (!a.idv_checked_at) return 1;
          if (!b.idv_checked_at) return -1;
          return new Date(b.idv_checked_at) - new Date(a.idv_checked_at);
        });

      setIdvResults(items);

      // Expose IDV data to parent (for AI assistant)
      if (items.length > 0) {
        const best = items[0];
        onIdvDataLoaded?.({
          status: best.idv_status,
          similarity_score: best.idv_similarity_score,
          liveness_score: best.idv_liveness_score,
          liveness_passed: best.idv_liveness_passed,
          document_type: best.idv_document_type,
          issuing_country: best.idv_issuing_country,
          failure_reason: best.idv_failure_reason,
          aml_hits: best.idv_aml_hits,
          extracted: {
            full_name: [best.idv_extracted_first_name, best.idv_extracted_last_name].filter(Boolean).join(' ') || null,
            date_of_birth: best.idv_extracted_dob,
            nationality: best.idv_extracted_nationality,
            document_number: best.idv_document_number,
            expiry_date: best.idv_document_expiry,
          },
          total_sessions: items.length,
        });
      }

      // Auto-complete Step 2 on Pass
      const best = items[0];
      if (best?.idv_status === 'Pass' && kycCase.step_2_status !== 'complete') {
        await base44.entities.KycCase.update(kycCase.id, { step_2_status: 'complete' });
        await base44.entities.AuditEvent.create({
          tenant_id:     kycCase.tenant_id,
          case_id:       kycCase.id,
          client_id:     kycCase.client_id,
          actor_user_id: currentUser?.id,
          actor_name:    currentUser?.full_name,
          actor_type:    'System',
          event_type:    'step_2_autocompleted_didit_pass',
          notes:         `Step 2 auto-completed: Didit returned Pass (score: ${best.idv_similarity_score ?? '?'}%).`,
        });
        onStepComplete?.();
        onCaseChanged?.();
        setAutoCompleted(true);
      }

      // Auto-complete Step 1 if all case outreach items are done + IDV passed
      if (best?.idv_status === 'Pass' && kycCase.step_1_status !== 'complete') {
        const allItemsDone = (refreshedCaseOutreaches || []).every(req => {
          const countable = (req.items || []).filter(i => i.field_type !== 'section_header');
          return countable.length > 0 && countable.every(i => ['Received', 'Verified'].includes(i.status));
        });
        if (allItemsDone && refreshedCaseOutreaches.length > 0) {
          await base44.entities.KycCase.update(kycCase.id, { step_1_status: 'complete' });
          await base44.entities.AuditEvent.create({
            tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: kycCase.client_id,
            actor_type: 'System', actor_name: 'System',
            event_type: 'step_1_autocompleted',
            notes: 'Step 1 auto-completed: all outreach items received and IDV passed.',
          });
          onCaseChanged?.();
        }
      }

      // Prompt to apply OCR data only if client is missing the fields
      if (best?.idv_status === 'Pass' && !promptShownRef.current) {
        promptShownRef.current = true;
        const currentClient = (await base44.entities.Client.filter({ id: kycCase.client_id }))?.[0];
        const extractedName = [best.idv_extracted_first_name, best.idv_extracted_last_name].filter(Boolean).join(' ');
        const updates = {};
        if (extractedName && !currentClient?.full_name)     updates.full_name     = extractedName;
        if (best.idv_extracted_dob && !currentClient?.date_of_birth) updates.date_of_birth = best.idv_extracted_dob;
        if (best.idv_extracted_nationality && !currentClient?.nationality) updates.nationality = best.idv_extracted_nationality;
        if (best.idv_document_number && !currentClient?.id_number) updates.id_number = best.idv_document_number;
        if (Object.keys(updates).length > 0) {
          setExtractedData(updates);
          setShowExtractedPrompt(true);
        }
      }
    } catch (err) {
      console.error('IDV load error:', err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Didit verification results…
      </div>
    );
  }

  // Pending state — no Didit result yet
  if (idvResults.length === 0) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-8 text-center space-y-3">
        <Clock className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <div className="text-sm font-semibold text-foreground">Awaiting Didit Verification</div>
        <div className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
          No completed Didit verification session found for this client yet.
          Check Step 1 to confirm an outreach request with Identity Verification has been sent and completed.
        </div>
        <Button size="sm" variant="outline" onClick={() => loadResults({ sync: true })} className="gap-1.5" disabled={syncing}>
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {syncing ? 'Syncing from Didit…' : 'Sync from Didit'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {autoCompleted && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>Step auto-completed — Didit returned a Pass result.</span>
        </div>
      )}

      {/* Apply OCR data prompt */}
      {showExtractedPrompt && extractedData && (
        <div className="border border-primary/20 bg-primary/5 rounded-xl p-4 text-xs">
          <div className="font-medium mb-1.5">Apply Didit OCR data to client profile?</div>
          <div className="text-muted-foreground space-y-0.5 mb-3">
            {extractedData.full_name     && <div>Name: <span className="text-foreground font-medium">{extractedData.full_name}</span></div>}
            {extractedData.date_of_birth && <div>DOB: <span className="text-foreground font-medium">{extractedData.date_of_birth}</span></div>}
            {extractedData.nationality   && <div>Nationality: <span className="text-foreground font-medium">{extractedData.nationality}</span></div>}
            {extractedData.id_number     && <div>Document #: <span className="font-mono text-foreground">{extractedData.id_number}</span></div>}
          </div>
          <div className="flex gap-2 items-center">
            <ApplyOcrButton
              extractedData={extractedData}
              clientId={kycCase.client_id}
              onDone={() => setShowExtractedPrompt(false)}
            />
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowExtractedPrompt(false)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Didit result cards */}
      {idvResults.map((item, idx) => {
        const passed = item.idv_status === 'Pass';
        const score  = item.idv_similarity_score;
        const lScore = item.idv_liveness_score;

        return (
          <div key={idx} className={cn(
            'rounded-xl border-2 overflow-hidden',
            passed ? 'border-emerald-200' : 'border-red-200'
          )}>
            {/* Header */}
            <div className={cn(
              'flex items-center justify-between px-4 py-3 gap-3 flex-wrap',
              passed ? 'bg-emerald-50' : 'bg-red-50'
            )}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{passed ? '✅' : '❌'}</span>
                <div>
                  <div className="font-semibold text-sm">
                    {item.label || 'Identity Verification'}
                    <span className={cn('ml-2 text-xs font-bold px-2 py-0.5 rounded-full',
                      passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                      {item.idv_status}
                    </span>
                    {idx === 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        Most Recent
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.idv_document_type || '—'}
                    {item.idv_issuing_country && ` · ${item.idv_issuing_country}`}
                    {item.idv_checked_at && ` · ${new Date(item.idv_checked_at).toLocaleDateString()}`}
                    {lastSynced && <span className="ml-2 opacity-60">· Synced {lastSynced.toLocaleTimeString()}</span>}
                  </div>
                </div>
              </div>
              {item.didit_session_id && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => { setSelectedItem(item); setDiditPanelOpen(true); }}>
                  🪪 Full Didit Report →
                </Button>
              )}
            </div>

            {/* Biometric scores */}
            <div className="px-4 py-4 bg-card border-b border-border">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Biometric Verification
              </div>
              <div className="flex gap-8 items-start">
                <ScoreRing
                  value={score}
                  color={passed ? '#10B981' : '#EF4444'}
                  label="Face Match"
                  subLabel={score != null ? (score >= 75 ? 'Approved' : 'Below Threshold') : null}
                />
                <ScoreRing
                  value={lScore || (item.idv_liveness_passed ? 100 : null)}
                  color="#3B82F6"
                  label="Liveness"
                  subLabel={item.idv_liveness_passed ? 'Approved' : 'Not Confirmed'}
                />
                <div className="flex flex-col items-center gap-1">
                  <div className={cn('text-2xl font-bold',
                    (item.idv_aml_hits || 0) > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                    {item.idv_aml_hits || 0}
                  </div>
                  <span className="text-xs font-medium text-foreground">AML Hits</span>
                  <span className={cn('text-xs font-semibold',
                    (item.idv_aml_hits || 0) > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                    {(item.idv_aml_hits || 0) > 0 ? 'Review Required' : 'Clear'}
                  </span>
                </div>
              </div>
            </div>

            {/* OCR Extracted Data */}
            {(item.idv_extracted_first_name || item.idv_extracted_dob || item.idv_document_number) && (
              <div className="px-4 py-3 bg-muted/20 border-b border-border">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  OCR Extracted Data
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
                  {[
                    ['Verified Name',   [item.idv_extracted_first_name, item.idv_extracted_last_name].filter(Boolean).join(' ')],
                    ['Date of Birth',   item.idv_extracted_dob],
                    ['Nationality',     item.idv_extracted_nationality],
                    ['Document #',      item.idv_document_number],
                    ['Expiry Date',     item.idv_document_expiry],
                    ['Issuing Country', item.idv_issuing_country],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}>
                      <span className="text-muted-foreground">{label}: </span>
                      <span className="font-medium text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failure reason */}
            {item.idv_failure_reason && (
              <div className="px-4 py-2 bg-red-50 text-xs text-red-700 flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                Issue: {item.idv_failure_reason}
              </div>
            )}
          </div>
        );
      })}

      {/* Refresh / Sync */}
      <div className="flex justify-end">
        <Button
          size="sm" variant="ghost"
          className="text-xs gap-1.5 text-muted-foreground"
          onClick={() => loadResults({ sync: true })}
          disabled={syncing}
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {syncing ? 'Syncing…' : 'Sync from Didit'}
        </Button>
      </div>

      {/* Full Didit Report panel */}
      {diditPanelOpen && selectedItem?.didit_session_id && (
        <DiditVerificationPanel
          sessionId={selectedItem.didit_session_id}
          tenantId={kycCase?.tenant_id}
          diditApiKey={tenant?.didit_api_key}
          clientName={client?.full_name || 'Client'}
          onClose={() => { setDiditPanelOpen(false); setSelectedItem(null); }}
        />
      )}
    </div>
  );
}