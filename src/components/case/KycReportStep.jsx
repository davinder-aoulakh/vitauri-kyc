/**
 * KYC Investigation Report — Professional branded PDF export (builder: src/lib/kycReportPdf.js)
 * Sections: Cover · Client Profile · Related Parties · Screening Hits ·
 *           SoF/SoW · Risk Indicators · Consolidated Risk · Control Measures ·
 *           Sign-Off · 9 Annex (Didit report + all file documents inline) · 10 Audit Trail Appendix
 */
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { getSignedUrl } from '@/lib/securityUtils';
import { Button } from '@/components/ui/button';
import { FileText, Download, Loader2, Share2, CheckCircle, XCircle, Eye, RefreshCw, Shield } from 'lucide-react';
import DocumentViewer from '@/components/shared/DocumentViewer';
import InlineError from '@/components/shared/InlineError';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { isStepComplete, getStepStatus } from '@/lib/caseUtils';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { buildKycReportPdf, prepareAnnex } from '@/lib/kycReportPdf';
import { fetchTenantUsers } from '@/hooks/useTenantData';

// Tenant logo as a data URL, downscaled to at most 900 px wide so the PDF stays small. Null on any failure.
async function loadLogo(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmapUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = bitmapUrl; });
      const scale = Math.min(1, 900 / (img.naturalWidth || 900));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return { dataUrl: canvas.toDataURL('image/png'), format: 'PNG' };
    } finally {
      URL.revokeObjectURL(bitmapUrl);
    }
  } catch {
    return null;
  }
}

// ── Annex fetch helpers ────────────────────────────────────────────────────
async function fetchDiditPdfBytes(sessionId, tenantId) {
  try {
    const res = await base44.functions.invoke('diditProxy', { action: 'session_pdf', session_id: sessionId, tenant_id: tenantId });
    const d = res?.data ?? res;
    const base64 = d?.pdf_base64;
    if (!base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (e) {
    console.warn('Didit report fetch failed:', e);
    return null;
  }
}

async function fetchFileBytes(url) {
  try {
    // Private files hold a file_uri (e.g. Didit images, KYB documents): fetch them through a signed URL.
    if (url && !/^(https?:|data:|blob:)/i.test(url)) url = await getSignedUrl(url);
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.warn('Document fetch failed:', url, e);
    return null;
  }
}

// ── Step definitions (steps 1–7 must be complete before report) ────────────
const PREREQUISITE_STEPS = [
  { id: 1, label: 'Outreach & Documents',  stepKey: 'step_1_status' },
  { id: 2, label: 'Identity Verification', stepKey: 'step_2_status' },
  { id: 3, label: 'Screening',             stepKey: 'step_3_status' },
  { id: 4, label: 'Client Profile',        stepKey: 'step_4_status' },
  { id: 5, label: 'Source of Funds/Wealth',stepKey: 'step_5_status' },
  { id: 6, label: 'Risk Assessment',       stepKey: 'step_6_status' },
  { id: 7, label: 'Control Measures',      stepKey: 'step_7_status' },
];

// ── Component ──────────────────────────────────────────────────────────────
export default function KycReportStep({ kycCase, client, currentUser, onRefresh, refreshing }) {
  const [generating, setGenerating] = useState(false);
  const [reports, setReports]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState(null);
  const [shareLink, setShareLink]   = useState(null);
  const [viewerDoc, setViewerDoc]   = useState(null);
  const [genError, setGenError]     = useState(null);

  useEffect(() => { loadReports(); }, [kycCase.id]);

  async function loadReports() {
    setLoadError(null);
    try {
      const kycReports = await base44.entities.KycReport.filter({ case_id: kycCase.id });
      setReports((kycReports || []).sort((a, b) => b.version_number - a.version_number));
    } catch (err) {
      console.error('KycReportStep loadReports error:', err);
      setLoadError(err?.message || 'Failed to load reports.');
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    setGenerating(true);
    setGenError(null);
    try { await buildAndSave(); } catch (err) {
      console.error('KYC report generation failed:', err);
      setGenError(err?.message || 'The report could not be generated.');
    } finally {
      setGenerating(false);
    }
  }

  async function buildAndSave() {

    // Fetch all supporting data in parallel
    const [screeningHits, assessments, controlMeasures, auditEvents,
           relatedPartyLinks, relatedPartiesAll, tenantList,
           caseDocs, clientDocs, outreachRequests] = await Promise.all([
      base44.entities.ScreeningHit.filter({ case_id: kycCase.id }),
      base44.entities.RiskAssessment.filter({ case_id: kycCase.id }),
      base44.entities.ControlMeasure.filter({ case_id: kycCase.id }),
      base44.entities.AuditEvent.filter({ case_id: kycCase.id }, '-created_date', 50),
      base44.entities.ClientRelatedPartyLink.filter({ client_id: kycCase.client_id }),
      base44.entities.RelatedParty.filter({ tenant_id: kycCase.tenant_id }),
      base44.entities.Tenant.filter({ id: kycCase.tenant_id }),
      base44.entities.Document.filter({ case_id: kycCase.id, is_deleted: false }),
      base44.entities.Document.filter({ client_id: kycCase.client_id, is_deleted: false }),
      base44.entities.OutreachRequest.filter({ case_id: kycCase.id }),
    ]);

    const tenant = tenantList?.[0] || null;
    // Optional: only a signed-off transaction analysis is included in the report.
    const signedAnalyses = await base44.entities.KycTransactionAnalysis
      .filter({ tenant_id: kycCase.tenant_id, case_id: kycCase.id, status: 'signed_off' }, '-signed_off_at', 1)
      .catch(() => []);
    const txnAnalysis = signedAnalyses?.[0] || null;
    // Transaction monitoring summary for the review period (tm_core only). FIU details are never included.
    let tmMonitoring = null;
    if (isFeatureEnabled(tenant, 'tm_core')) {
      try {
        const ctx = (await base44.functions.invoke('getCaseTmContext', { kyc_case_id: kycCase.id }))?.data;
        tmMonitoring = ctx?.period || null;
      } catch { tmMonitoring = null; }
    }
    const nextVersion = (reports[0]?.version_number || 0) + 1;

    // Merge + dedupe case/client documents, excluding prior report PDFs
    const docMap = new Map();
    [...(caseDocs || []), ...(clientDocs || [])].forEach(d => {
      if (d.doc_type !== 'KYC_Report' && !d.is_deleted) docMap.set(d.id, d);
    });
    const sourceOrder = { didit: 0, portal: 1, manual: 2 };
    const documents = Array.from(docMap.values()).sort((a, b) => {
      const sa = sourceOrder[a.source] ?? 3, sb = sourceOrder[b.source] ?? 3;
      if (sa !== sb) return sa - sb;
      return new Date(a.created_date || 0) - new Date(b.created_date || 0);
    });

    // Unique Didit sessions from completed IDV items (their report goes first in the annex)
    const diditSessions = [];
    const seenSessions = new Set();
    (outreachRequests || []).forEach(req => {
      (req.items || []).forEach(item => {
        if (item.didit_session_id && item.idv_status && item.idv_status !== 'Pending' && !seenSessions.has(item.didit_session_id)) {
          seenSessions.add(item.didit_session_id);
          diditSessions.push({ session_id: item.didit_session_id, date: item.idv_completed_at || item.submitted_at || req.updated_date || null });
        }
      });
    });

    // Annex: every item fetched once; files are typed from their bytes, so portal uploads named "Additional Documents" are attached too.
    const [annexItems, logo, analyst] = await Promise.all([
      prepareAnnex({
        diditSessions, documents,
        fetchDidit: (sessionId) => fetchDiditPdfBytes(sessionId, kycCase.tenant_id),
        fetchBytes: fetchFileBytes,
      }),
      loadLogo(tenant?.branding_logo_url),
      kycCase.assigned_analyst_id
        ? fetchTenantUsers(kycCase.tenant_id).then((us) => us.find((u) => u.id === kycCase.assigned_analyst_id) || null).catch(() => null)
        : Promise.resolve(null),
    ]);

    const built = await buildKycReportPdf({
      kycCase, client,
      preparedBy: currentUser?.full_name,
      analystName: analyst?.full_name || currentUser?.full_name,
      screeningHits: screeningHits || [],
      assessments: assessments || [],
      controlMeasures: controlMeasures || [],
      auditEvents: auditEvents || [],
      relatedPartyLinks: relatedPartyLinks || [],
      relatedParties: relatedPartiesAll || [],
      tenant,
      nextVersion,
      annexItems,
      txnAnalysis,
      tmMonitoring,
      logo,
    });
    const pdfBlob = new Blob([built.bytes], { type: 'application/pdf' });

    const safeName = (client?.full_name || 'Client').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `KYC_Report_${safeName}_v${nextVersion}_${format(new Date(), 'yyyyMMdd')}.pdf`;
    const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

    const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });

    // Create KycReport record for versioning
    const reportSnapshot = {
      client: client,
      case: { status: kycCase.status, risk_classification: kycCase.risk_classification },
      summary: {
        total_pages: built.pageCount, generated_at: new Date().toISOString(), annex_documents: documents.length, didit_reports: diditSessions.length,
        annex_attached: built.attached, annex_listed_only: built.listedOnly,
      },
    };

    await base44.entities.KycReport.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      version_number: nextVersion,
      generated_at: new Date().toISOString(),
      generated_by_id: currentUser?.id,
      report_data_snapshot: reportSnapshot,
      pdf_url: file_url,
    });

    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'kyc_report_generated',
      notes: `KYC Report v${nextVersion} generated — ${fileName}`,
    });

    await loadReports();
  }

  const latestReport = reports[0];
  const isApproved = kycCase?.status === 'Approved';
  const isOutdated = !loading && reports.length > 0 && kycCase?.updated_date && latestReport?.generated_at
    && new Date(kycCase.updated_date) > new Date(latestReport.generated_at);

  const incompleteSteps = PREREQUISITE_STEPS.filter(s => !isStepComplete(kycCase, s.id));
  const allStepsComplete = incompleteSteps.length === 0;

  return (
    <div className="space-y-5">
      {viewerDoc && (
        <DocumentViewer
          fileUrl={viewerDoc.url}
          fileName={viewerDoc.name}
          onClose={() => setViewerDoc(null)}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            KYC Investigation Report
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Professional branded PDF · {reports.length} version{reports.length !== 1 ? 's' : ''} on file
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => onRefresh(true)} title="Refresh case data">
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            </Button>
          )}
          {reports.length > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={generateReport} disabled={generating || !allStepsComplete}>
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Regenerate
            </Button>
          )}
          <Button size="sm" className="gap-1.5 text-xs" onClick={generateReport} disabled={generating || !allStepsComplete}>
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {generating ? 'Building PDF…' : 'Generate Report'}
          </Button>
        </div>
      </div>

      {!isApproved && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          <FileText className="w-3.5 h-3.5 flex-shrink-0" />
          Case not yet approved. A draft report can be generated; regenerate after sign-off for the final version.
        </div>
      )}

      {/* Step readiness gate */}
      {allStepsComplete ? (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
          <span className="font-medium">All steps complete — ready to generate report</span>
        </div>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-red-800">
            The following steps must be completed before generating the report:
          </p>
          <ul className="space-y-1">
            {incompleteSteps.map(s => (
              <li key={s.stepKey} className="flex items-center gap-2 text-xs text-red-700">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-500" />
                Step {s.id}: {s.label}
                <span className="text-red-400 ml-1">
                  ({(() => { const st = getStepStatus(kycCase, s.id); return st === 'in_progress' ? 'in progress' : st === 'flagged' ? 'flagged' : 'not started'; })()})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What's included */}
      <div className="bg-muted/30 border border-border rounded-xl p-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {['Client Profile','Related Parties','Screening Hits','Risk Indicators','Control Measures','Sign-Off', 'Annex: Didit report & all documents', 'Audit Trail'].map(s => (
          <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />{s}
          </div>
        ))}
      </div>

      {genError && <InlineError message={`Report not generated: ${genError}`} onRetry={generateReport} />}

      {loadError ? (
        <InlineError message={loadError} onRetry={loadReports} />
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-card border-2 border-dashed border-border rounded-xl py-16 text-center space-y-2">
          <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No report generated yet</p>
          <p className="text-xs text-muted-foreground/60">Click "Generate Report" to create a full compliance PDF</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Outdated banner */}
          {isOutdated && (
            <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-amber-800">
                <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
                <span><strong>Report outdated</strong> — case changed since this report was generated.</span>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-100 flex-shrink-0"
                onClick={generateReport} disabled={generating || !allStepsComplete}>
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Regenerate
              </Button>
            </div>
          )}

          {/* Latest report */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold">Report v{latestReport.version_number}</span>
              <span className="text-xs text-muted-foreground">— {latestReport.generated_at && format(new Date(latestReport.generated_at), 'd MMM yyyy')}</span>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Latest</span>
              {isApproved && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Approved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1 text-xs h-7"
                onClick={() => setViewerDoc({ url: latestReport.pdf_url, name: `Report_v${latestReport.version_number}` })}>
                <Eye className="w-3 h-3" /> Preview
              </Button>
              <a href={latestReport.pdf_url} download target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="gap-1 text-xs h-7">
                  <Download className="w-3 h-3" /> Download
                </Button>
              </a>
              {isApproved && (
                <Button size="sm" variant="outline" className="gap-1 text-xs h-7 text-violet-600 border-violet-200 hover:bg-violet-50"
                  onClick={() => setShareLink(latestReport.pdf_url)}>
                  <Share2 className="w-3 h-3" /> Share
                </Button>
              )}
            </div>
          </div>

          </div>

          {/* Share link */}
          {shareLink && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-1.5">
              <div className="text-xs font-semibold text-violet-700">Shareable Report Link</div>
              <div className="flex items-center gap-2">
                <input readOnly value={shareLink}
                  className="flex-1 text-xs bg-white border border-violet-200 rounded px-2 py-1 text-violet-800 font-mono"
                  onClick={e => e.target.select()} />
                <Button size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => { navigator.clipboard.writeText(shareLink); }}>
                  Copy
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7"
                  onClick={() => setShareLink(null)}>
                  ✕
                </Button>
              </div>
            </div>
          )}

          {/* Version history */}
          {reports.length > 1 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground">Version History</span>
              </div>
              <div className="divide-y divide-border">
                {reports.slice(1).map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">Version {r.version_number}</span>
                      <span className="text-xs text-muted-foreground">—</span>
                      <span className="text-xs text-muted-foreground">{r.generated_at && format(new Date(r.generated_at), 'd MMM yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1"
                        onClick={() => setViewerDoc({ url: r.pdf_url, name: `Report_v${r.version_number}` })}>
                        <Eye className="w-3 h-3" /> View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}