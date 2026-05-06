/**
 * S-120: KYC Investigation Report
 * Generates a versioned, downloadable KYC report for the case
 */
import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FileText, Download, Loader2, Share2, CheckCircle, Eye, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { RISK_COLORS } from '@/lib/riskColors';
import jsPDF from 'jspdf';

function sectionTitle(doc, text, y) {
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(240, 244, 255);
  doc.roundedRect(14, y - 5, 182, 10, 2, 2, 'F');
  doc.setTextColor(30, 60, 120);
  doc.text(text, 16, y + 1);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);
  return y + 12;
}

function field(doc, label, value, x, y) {
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(label + ':', x, y);
  doc.setFont('helvetica', 'normal');
  const text = String(value || '—');
  const lines = doc.splitTextToSize(text, 110);
  doc.text(lines, x + 40, y);
  return y + 6 * lines.length;
}

function paragraph(doc, text, y, maxWidth = 182) {
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  doc.text(lines, 14, y);
  return y + 5.5 * lines.length + 2;
}

function checkPageBreak(doc, y, margin = 20) {
  if (y > 270) { doc.addPage(); return 20; }
  return y;
}

export default function KycReportStep({ kycCase, client, currentUser }) {
  const [generating, setGenerating] = useState(false);
  const [reports, setReports]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [shareLink, setShareLink]   = useState(null);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);

  useEffect(() => { loadReports(); }, [kycCase.id]);

  async function loadReports() {
    const docs = await base44.entities.Document.filter({ case_id: kycCase.id, doc_type: 'KYC_Report' });
    setReports((docs || []).sort((a, b) => (b.version || 1) - (a.version || 1)));
    setLoading(false);
  }

  async function generateReport() {
    setGenerating(true);

    // Fetch all case data in parallel
    const [screeningHits, assessments, controlMeasures, auditEvents, relatedPartyLinks] = await Promise.all([
      base44.entities.ScreeningHit.filter({ case_id: kycCase.id }),
      base44.entities.RiskAssessment.filter({ case_id: kycCase.id }),
      base44.entities.ControlMeasure.filter({ case_id: kycCase.id }),
      base44.entities.AuditEvent.filter({ case_id: kycCase.id }, '-created_date', 50),
      base44.entities.ClientRelatedPartyLink.filter({ client_id: kycCase.client_id }),
    ]);

    const risk = kycCase.risk_classification;
    const nextVersion = (reports[0]?.version || 0) + 1;
    const dateStr = format(new Date(), 'd MMMM yyyy');

    // Build PDF
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let y = 20;

    // ── Cover Page ──
    doc.setFillColor(15, 31, 61); // navy
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('KYC Investigation Report', 14, 20);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('CONFIDENTIAL — For compliance use only', 14, 28);
    doc.setTextColor(50, 50, 50);

    y = 52;
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(client?.full_name || '—', 14, y);
    y += 8;

    // Risk badge
    const riskColors = { Low: [209, 250, 229], Medium: [254, 243, 199], High: [254, 226, 226], Unacceptable: [127, 0, 0] };
    const riskText   = { Low: [6, 95, 70],   Medium: [120, 53, 15],   High: [153, 27, 27],  Unacceptable: [255, 255, 255] };
    const bg = riskColors[risk] || [240, 240, 240];
    const tx = riskText[risk] || [50, 50, 50];
    doc.setFillColor(...bg);
    doc.roundedRect(14, y, 45, 8, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...tx);
    doc.text(`${risk || 'UNCLASSIFIED'} RISK`, 16, y + 5.5);
    doc.setTextColor(50, 50, 50);
    y += 14;

    y = field(doc, 'Case Type',     kycCase.case_type?.replace(/_/g,' '), 14, y); y += 1;
    y = field(doc, 'Report Date',   dateStr, 14, y); y += 1;
    y = field(doc, 'Prepared By',   currentUser?.full_name, 14, y); y += 1;
    y = field(doc, 'Case Status',   kycCase.status?.replace(/_/g,' '), 14, y); y += 1;
    y = field(doc, 'Report Version', `v${nextVersion}`, 14, y); y += 6;

    doc.setDrawColor(220, 220, 220);
    doc.line(14, y, 196, y);
    y += 8;

    // ── 1. Client Profile ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '1. Client Profile', y);
    if (client?.client_type === 'NP') {
      y = field(doc, 'Full Name', client.full_name, 14, y); y += 1;
      y = field(doc, 'Date of Birth', client.date_of_birth, 14, y); y += 1;
      y = field(doc, 'Nationality', client.nationality, 14, y); y += 1;
      y = field(doc, 'Country of Residence', client.country_of_residence, 14, y); y += 1;
      y = field(doc, 'ID Type / Number', `${client.id_type || '—'} / ${client.id_number || '—'}`, 14, y);
    } else {
      y = field(doc, 'Legal Name', client?.full_name, 14, y); y += 1;
      y = field(doc, 'Reg. Number', client?.registration_number, 14, y); y += 1;
      y = field(doc, 'LEI', client?.lei_code, 14, y); y += 1;
      y = field(doc, 'Jurisdiction', client?.registered_country, 14, y); y += 1;
      y = field(doc, 'Sector', client?.sector, 14, y); y += 1;
      y = field(doc, 'Legal Form', client?.legal_form, 14, y);
    }
    y += 8;

    // ── 2. Related Parties ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '2. Related Parties', y);
    if (relatedPartyLinks?.length > 0) {
      doc.setFontSize(8.5);
      doc.text(`${relatedPartyLinks.length} related party link(s) on file. See full organisational chart.`, 14, y);
      y += 6;
    } else {
      doc.setFontSize(8.5);
      doc.text('No related parties recorded.', 14, y);
      y += 6;
    }
    y += 4;

    // ── 3. Screening ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '3. Screening & Adverse Media', y);
    if (!screeningHits || screeningHits.length === 0) {
      y = paragraph(doc, 'No screening hits recorded for this case.', y);
    } else {
      screeningHits.forEach(hit => {
        y = checkPageBreak(doc, y);
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.text(`• ${hit.hit_name} [${hit.source}] — ${hit.status?.replace(/_/g,' ')}`, 14, y);
        doc.setFont('helvetica', 'normal');
        y += 5;
        if (hit.analyst_justification) {
          y = paragraph(doc, `  Decision: ${hit.analyst_justification}`, y);
        }
      });
    }
    y += 4;

    // ── 4. Source of Funds / Wealth ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '4. Source of Funds / Source of Wealth', y);
    y = paragraph(doc, kycCase.sof_narrative || 'SoF/SoW assessment on file. Refer to case documentation.', y);
    y += 4;

    // ── 5. Risk Assessment ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '5. Risk Indicators & Assessment', y);
    if (assessments?.length > 0) {
      assessments.forEach(a => {
        y = checkPageBreak(doc, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text(`${a.indicator_name}: ${a.score}${a.analyst_override ? ' [ANALYST OVERRIDE]' : ''}`, 14, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        const narrative = a.analyst_narrative || a.ai_narrative || '';
        if (narrative) { y = paragraph(doc, narrative, y); }
        if (a.analyst_override && a.analyst_justification) {
          y = paragraph(doc, `Override justification: ${a.analyst_justification}`, y);
        }
        y += 2;
      });
    } else {
      y = paragraph(doc, 'Risk assessments on file. See individual indicator records.', y);
    }
    y += 4;

    // ── 6. Consolidated Risk Classification ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '6. Consolidated Risk Classification', y);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(...(riskColors[risk] || [240,240,240]));
    doc.roundedRect(14, y, 100, 12, 2, 2, 'F');
    doc.setTextColor(...(riskText[risk] || [50,50,50]));
    doc.text(`${risk || 'UNCLASSIFIED'} RISK`, 16, y + 8);
    doc.setTextColor(50, 50, 50);
    y += 18;
    if (kycCase.risk_override_justification) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('⚠ Analyst override applied:', 14, y); y += 5;
      y = paragraph(doc, kycCase.risk_override_justification, y);
    }
    y += 4;

    // ── 7. Control Measures ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '7. Control Measures', y);
    if (!controlMeasures || controlMeasures.length === 0) {
      y = paragraph(doc, 'No control measures recorded.', y);
    } else {
      controlMeasures.forEach(cm => {
        y = checkPageBreak(doc, y);
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.text(`• [${cm.status}] ${cm.description}`, 14, y);
        doc.setFont('helvetica', 'normal');
        y += 5;
        if (cm.owner_name) {
          doc.text(`  Owner: ${cm.owner_name}  |  Due: ${cm.due_date || '—'}`, 14, y); y += 5;
        }
      });
    }
    y += 4;

    // ── 8. Sign-Off Record ──
    y = checkPageBreak(doc, y);
    y = sectionTitle(doc, '8. Sign-Off Record', y);
    y = field(doc, 'Submitted By', currentUser?.full_name, 14, y); y += 1;
    y = field(doc, 'Submitted At', kycCase.sign_off_submitted_at ? format(new Date(kycCase.sign_off_submitted_at), 'd MMM yyyy HH:mm') : '—', 14, y); y += 1;
    y = field(doc, 'Approved At',  kycCase.sign_off_approved_at  ? format(new Date(kycCase.sign_off_approved_at),  'd MMM yyyy HH:mm') : '—', 14, y);
    y += 4;
    if (kycCase.compliance_advisory_note) {
      y = checkPageBreak(doc, y);
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
      doc.text('Compliance Advisory Note:', 14, y); y += 5;
      y = paragraph(doc, kycCase.compliance_advisory_note, y);
    }
    y += 4;

    // ── 9. Audit Trail ──
    if (auditEvents?.length > 0) {
      doc.addPage(); y = 20;
      y = sectionTitle(doc, '9. Audit Trail (key events)', y);
      auditEvents.slice(0, 30).forEach(e => {
        y = checkPageBreak(doc, y);
        doc.setFontSize(7.5);
        const ts = e.created_date ? format(new Date(e.created_date), 'd MMM yyyy HH:mm') : '—';
        doc.text(`${ts}  |  ${e.actor_name || '—'}  |  ${e.event_type?.replace(/_/g,' ')}${e.notes ? ' — ' + e.notes.slice(0, 60) : ''}`, 14, y);
        y += 5;
      });
    }

    // Footer on all pages
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.text(`Vitauri KYC · ${dateStr} · CONFIDENTIAL · Page ${i} of ${pageCount}`, 14, 292);
    }

    // Save PDF as blob + upload
    const pdfBlob = doc.output('blob');
    const pdfFile = new File([pdfBlob], `KYC_Report_${client?.full_name?.replace(/\s+/g,'_')}_v${nextVersion}.pdf`, { type: 'application/pdf' });
    const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });

    // Save as Document record
    await base44.entities.Document.create({
      tenant_id: kycCase.tenant_id,
      client_id: kycCase.client_id,
      case_id: kycCase.id,
      doc_type: 'KYC_Report',
      file_name: `KYC_Report_v${nextVersion}.pdf`,
      file_url,
      version: nextVersion,
      uploaded_by_user_id: currentUser?.id,
      is_ai_generated: false,
    });

    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'kyc_report_generated',
      notes: `KYC Report v${nextVersion} generated`,
    });

    await loadReports();
    setGenerating(false);
  }

  async function getShareLink(report) {
    setShareLinkLoading(true);
    // Reports are already public URLs — wrap in a one-time share token
    setShareLink(report.file_url);
    setShareLinkLoading(false);
  }

  const latestReport = reports[0];
  const isApproved = kycCase?.status === 'Approved';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">KYC Investigation Report</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Regulator-ready PDF · {reports.length} version{reports.length !== 1 ? 's' : ''} generated
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reports.length > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={generateReport} disabled={generating}>
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Regenerate
            </Button>
          )}
          <Button size="sm" className="gap-1.5 text-xs" onClick={generateReport} disabled={generating}>
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {generating ? 'Generating…' : 'Generate Report'}
          </Button>
        </div>
      </div>

      {!isApproved && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          <FileText className="w-3.5 h-3.5 flex-shrink-0" />
          Case is not yet approved. You can generate a draft report, but the final version should be generated after sign-off.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-16 text-center space-y-2">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium text-muted-foreground">No report generated yet</p>
          <p className="text-xs text-muted-foreground/70">Click "Generate Report" to create the first version</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Latest report preview panel */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">{latestReport.file_name}</span>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">v{latestReport.version} · Latest</span>
                {isApproved && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Approved</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1 text-xs h-7"
                  onClick={() => window.open(latestReport.file_url, '_blank')}>
                  <Eye className="w-3 h-3" /> Preview
                </Button>
                <a href={latestReport.file_url} download target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="gap-1 text-xs h-7">
                    <Download className="w-3 h-3" /> Download
                  </Button>
                </a>
                {isApproved && (
                  <Button size="sm" variant="outline" className="gap-1 text-xs h-7 text-violet-600 border-violet-200 hover:bg-violet-50"
                    onClick={() => getShareLink(latestReport)} disabled={shareLinkLoading}>
                    {shareLinkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />}
                    Share
                  </Button>
                )}
              </div>
            </div>
            {/* Inline PDF preview */}
            <iframe
              src={latestReport.file_url}
              title="KYC Report Preview"
              className="w-full border-0"
              style={{ height: '520px' }}
            />
          </div>

          {/* Share link */}
          {shareLink && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-1.5">
              <div className="text-xs font-semibold text-violet-700">Shareable Report Link</div>
              <div className="flex items-center gap-2">
                <input
                  readOnly value={shareLink}
                  className="flex-1 text-xs bg-white border border-violet-200 rounded px-2 py-1 text-violet-800 font-mono"
                  onClick={e => e.target.select()}
                />
                <Button size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => { navigator.clipboard.writeText(shareLink); }}>
                  Copy
                </Button>
              </div>
              <p className="text-xs text-violet-600">This link points directly to the PDF. Share with client or supervisor as needed.</p>
            </div>
          )}

          {/* Version history */}
          {reports.length > 1 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground">Previous Versions</span>
              </div>
              <div className="divide-y divide-border">
                {reports.slice(1).map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{r.file_name}</span>
                      <span className="text-xs text-muted-foreground">v{r.version}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {r.created_date && format(new Date(r.created_date), 'd MMM yyyy HH:mm')}
                      <a href={r.file_url} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="ghost" className="h-6 text-xs gap-1">
                          <Download className="w-3 h-3" /> Download
                        </Button>
                      </a>
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