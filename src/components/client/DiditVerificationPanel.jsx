import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, ExternalLink, RefreshCw, AlertTriangle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ISO3_TO_NAME = {
  AUS:'Australia', NLD:'Netherlands', BEL:'Belgium', DEU:'Germany',
  FRA:'France', GBR:'United Kingdom', USA:'United States',
  LUX:'Luxembourg', CHE:'Switzerland', CAN:'Canada', NZL:'New Zealand',
  SGP:'Singapore', ZAF:'South Africa', IND:'India', CHN:'China',
  JPN:'Japan', ARE:'United Arab Emirates', BRA:'Brazil', ARG:'Argentina',
  MYS:'Malaysia', PHL:'Philippines', IDN:'Indonesia', THA:'Thailand',
  KOR:'South Korea', PAK:'Pakistan', BGD:'Bangladesh', NGA:'Nigeria',
  KEN:'Kenya', GHA:'Ghana', EGY:'Egypt', TUR:'Turkey', ISR:'Israel',
  SAU:'Saudi Arabia', QAT:'Qatar', KWT:'Kuwait', PRT:'Portugal',
  ESP:'Spain', ITA:'Italy', SWE:'Sweden', NOR:'Norway', DNK:'Denmark',
  FIN:'Finland', IRL:'Ireland', POL:'Poland', CZE:'Czech Republic',
  HUN:'Hungary', ROU:'Romania', GRC:'Greece',
};

function formatNationality(iso3) {
  if (!iso3) return null;
  return ISO3_TO_NAME[iso3] ? `${ISO3_TO_NAME[iso3]} (${iso3})` : iso3;
}

function ScoreRing({ score, status, label }) {
  if (score == null) return null;
  const passed = status === 'Approved';
  const color  = passed ? '#10B981' : '#EF4444';
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${(score / 100) * circumference} ${circumference}`;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none"
          stroke="#E5E7EB" strokeWidth="6" />
        <circle cx="36" cy="36" r={radius} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          transform="rotate(-90 36 36)" />
        <text x="36" y="40" textAnchor="middle"
          fontSize="14" fontWeight="700" fill={color}>
          {Math.round(score)}%
        </text>
      </svg>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <span className={cn('text-xs font-semibold',
        passed ? 'text-emerald-600' : 'text-red-600')}>
        {status || '—'}
      </span>
    </div>
  );
}

export default function DiditVerificationPanel({ sessionId, tenantId, diditApiKey, clientName, onClose }) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [mainImage, setMainImage] = useState('front');
  const [pdfLoading, setPdfLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('getDiditSessionDetails', {
        session_id:    sessionId,
        tenant_id:     tenantId,
        didit_api_key: diditApiKey,
      });
      const d = res?.data || res;
      if (d?.error) { setError(d.error); }
      else { setData(d); }
    } catch (e) {
      setError(e.message || 'Failed to load verification details');
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    if (!sessionId) return;
    setPdfLoading(true);
    try {
      const res = await base44.functions.invoke('getDiditSessionDetails', {
        session_id:    sessionId,
        tenant_id:     tenantId,
        didit_api_key: diditApiKey,
        action:        'generate_pdf',
      });
      const d = res?.data || res;
      console.log('PDF response from backend:', d);
      if (d?.pdf_data_url) {
        const a = document.createElement('a');
        a.href     = d.pdf_data_url;
        a.download = d.filename || `Didit_Report_${sessionId.substring(0, 8)}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        console.error('Didit PDF failed:', d?.error, 'session:', sessionId);
        alert(`PDF generation failed: ${d?.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('PDF invoke error:', e);
      alert(`PDF request error: ${e.message}`);
    } finally {
      setPdfLoading(false);
    }
  }

  async function generateClientSidePdf() {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const M = 15; // margin
    let y = 20;

    const addText = (text, size = 10, bold = false, color = [30, 30, 30]) => {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(String(text ?? ''), 180);
      doc.text(lines, M, y);
      y += lines.length * (size * 0.45) + 2;
    };

    const addSection = (title) => {
      if (y > 260) { doc.addPage(); y = 20; }
      y += 3;
      doc.setFillColor(230, 237, 255);
      doc.rect(M, y - 4, 180, 8, 'F');
      addText(title, 9, true, [30, 60, 130]);
      y += 1;
    };

    const addRow = (label, value) => {
      if (!value) return;
      if (y > 275) { doc.addPage(); y = 20; }
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 90, 90);
      doc.text(label + ':', M, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
      const lines = doc.splitTextToSize(String(value), 120);
      doc.text(lines, M + 55, y);
      y += lines.length * 5 + 1;
    };

    // Header
    addText('Didit Identity Verification Report', 16, true, [15, 40, 110]);
    addText(`Generated: ${new Date().toLocaleString('en-AU')}`, 8, false, [110, 110, 110]);
    addText(`Session ID: ${sessionId}`, 8, false, [110, 110, 110]);
    addText(`Client: ${clientName}`, 8, false, [110, 110, 110]);
    y += 4;

    // Overall result banner
    const passed = data.status === 'Approved';
    doc.setFillColor(passed ? 220 : 255, passed ? 250 : 230, passed ? 230 : 220);
    doc.rect(M, y - 2, 180, 10, 'F');
    addText(`Overall Result: ${data.status || '—'}   |   Face Match: ${data.face_score != null ? Math.round(data.face_score) + '%' : '—'}   |   Liveness: ${data.liveness_score != null ? Math.round(data.liveness_score) + '%' : '—'}   |   AML Hits: ${data.aml_total_hits ?? 0}`,
      10, true, passed ? [20, 120, 60] : [180, 30, 30]);
    y += 4;

    // Personal Data
    addSection('Personal Data');
    addRow('Full Name',       data.full_name || [data.first_name, data.last_name].filter(Boolean).join(' '));
    addRow('Date of Birth',   data.date_of_birth);
    addRow('Nationality',     formatNationality(data.nationality));
    addRow('Gender',          data.gender);
    addRow('Document Type',   data.document_type);
    addRow('Document Number', data.document_number);
    addRow('Personal Number', data.personal_number);
    addRow('Expiry Date',     data.expiration_date);
    addRow('Issue Date',      data.date_of_issue);
    addRow('Issuing State',   data.issuing_state_name || data.issuing_state);
    addRow('Address',         data.address);

    // Biometric
    addSection('Biometric Verification');
    addRow('Face Match Score',  data.face_score != null ? Math.round(data.face_score) + '%' : '—');
    addRow('Face Match Status', data.face_status);
    addRow('Liveness Score',    data.liveness_score != null ? Math.round(data.liveness_score) + '%' : '—');
    addRow('Liveness Status',   data.liveness_status);
    if (data.front_quality != null) addRow('Front Image Quality', Math.round(data.front_quality) + '%');
    if (data.back_quality  != null) addRow('Back Image Quality',  Math.round(data.back_quality)  + '%');

    // AML
    addSection('AML Screening');
    addRow('AML Status',   data.aml_status || '—');
    addRow('Total Hits',   String(data.aml_total_hits ?? 0));
    if (data.aml_hits?.length > 0) {
      for (const hit of data.aml_hits) {
        y += 2;
        addText(`• ${hit.entity_name || hit.name || 'Unknown Entity'}`, 9, true, [160, 80, 0]);
        if (hit.match_type) addText(`  Match Type: ${hit.match_type}`, 8, false, [100, 100, 100]);
        if (hit.categories?.length) addText(`  Categories: ${Array.isArray(hit.categories) ? hit.categories.join(', ') : hit.categories}`, 8, false, [100, 100, 100]);
        if (hit.datasets?.length) addText(`  Lists: ${Array.isArray(hit.datasets) ? hit.datasets.join(', ') : hit.datasets}`, 8, false, [100, 100, 100]);
      }
    }

    // Warnings
    if (data.warnings?.length > 0) {
      addSection('Warnings / Issues');
      for (const w of data.warnings) {
        addText(`• ${w.risk || '—'}${w.short_description ? ': ' + w.short_description : ''}`, 9, false, [160, 80, 0]);
      }
    }

    // Footer
    y += 6;
    doc.setFontSize(7); doc.setTextColor(150, 150, 150);
    doc.text('Verified by Didit (didit.me) · Generated from Vitauri KYC Platform', M, y);

    doc.save(`Didit_Report_${clientName?.replace(/\s+/g, '_') || sessionId.substring(0, 8)}.pdf`);
  }

  useEffect(() => { if (sessionId && tenantId) load(); }, [sessionId, tenantId]);

  const passed = data?.status === 'Approved';

  const currentImg =
    mainImage === 'front'    ? data?.front_image    :
    mainImage === 'back'     ? data?.back_image     :
    mainImage === 'portrait' ? data?.portrait_image : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-card border-l border-border shadow-2xl w-full md:w-[720px] overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-border bg-card/95 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg">🪪</span>
            <div>
              <div className="text-sm font-semibold">Didit Verification — {clientName}</div>
              <div className="text-xs text-muted-foreground">Session: {sessionId?.substring(0, 20)}…</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className={cn('text-xs px-2.5 py-1 rounded-full font-semibold border',
                passed
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200')}>
                {passed ? '✓' : '✗'} {data.status}
              </span>
            )}
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
              onClick={load} disabled={loading}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
              onClick={downloadPdf} disabled={pdfLoading}>
              {pdfLoading
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : <Download className="w-3.5 h-3.5" />}
              PDF Report
            </Button>

            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex-1 flex items-center justify-center gap-3 text-sm text-muted-foreground py-20">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading verification details…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="m-5 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
            <Button size="sm" variant="outline" className="ml-3 h-7 text-xs" onClick={load}>Retry</Button>
          </div>
        )}

        {/* Content */}
        {data && !loading && (
          <div className="p-5 space-y-5">

            {/* Document images */}
            <div className="bg-muted/30 rounded-xl p-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Identity Document
              </div>
              {currentImg && (
                <div className="bg-black rounded-xl overflow-hidden mb-3 flex items-center justify-center" style={{ minHeight: 220 }}>
                  <img src={currentImg} alt="Document" className="max-w-full max-h-80 object-contain" />
                </div>
              )}
              <div className="flex gap-2">
                {data.front_image && (
                  <button onClick={() => setMainImage('front')}
                    className={cn('rounded-lg overflow-hidden border-2 w-16 h-12',
                      mainImage === 'front' ? 'border-primary' : 'border-transparent opacity-60')}>
                    <img src={data.front_image} alt="Front" className="w-full h-full object-cover" />
                  </button>
                )}
                {data.back_image && (
                  <button onClick={() => setMainImage('back')}
                    className={cn('rounded-lg overflow-hidden border-2 w-16 h-12',
                      mainImage === 'back' ? 'border-primary' : 'border-transparent opacity-60')}>
                    <img src={data.back_image} alt="Back" className="w-full h-full object-cover" />
                  </button>
                )}
                {/* Portrait removed from here — shown in Face Comparison section below */}
              </div>
            </div>

            {/* ── Face Comparison ── */}
            {(() => {
              const docFace = data.portrait_image;

              const findSelfie = (raw) => {
                if (!raw || typeof raw !== 'object') return null;
                const knownFields = ['face_image','selfie_image','selfie','image',
                                     'target_image','source_image','portrait',
                                     'live_image','capture_image','user_image'];
                for (const f of knownFields) {
                  if (raw[f] && typeof raw[f] === 'string' &&
                      (raw[f].startsWith('http') || raw[f].startsWith('data:'))) {
                    return raw[f];
                  }
                }
                for (const [, v] of Object.entries(raw)) {
                  if (typeof v === 'string' && v.length > 20 &&
                      (v.startsWith('http') || v.startsWith('data:image'))) {
                    return v;
                  }
                }
                return null;
              };

              const liveSelfie =
                data.liveness_image      ||
                data.face_selfie_image   ||
                findSelfie(data.liveness_raw) ||
                findSelfie(data.face_raw);

              if (!docFace && !liveSelfie) return null;

              return (
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                    Face Comparison
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-none text-center" style={{ width: 130 }}>
                      {docFace ? (
                        <div className="bg-muted rounded-xl overflow-hidden mb-2" style={{ height: 160 }}>
                          <img src={docFace} alt="Document portrait" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="bg-muted rounded-xl flex items-center justify-center mb-2 text-muted-foreground text-xs" style={{ height: 160 }}>
                          Not available
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">Document Photo</div>
                    </div>

                    <div className="flex-1 flex flex-col items-center justify-center gap-2">
                      <div className={cn(
                        'text-3xl font-bold px-4 py-2 rounded-xl',
                        (data.face_score ?? 0) >= 80
                          ? 'text-emerald-600 bg-emerald-50 border border-emerald-200'
                          : 'text-red-600 bg-red-50 border border-red-200'
                      )}>
                        {data.face_score != null ? Math.round(data.face_score) + '%' : '—'}
                      </div>
                      <div className="text-xs text-muted-foreground">Match</div>
                      {data.face_status && (
                        <div className={cn(
                          'text-xs font-semibold px-2 py-0.5 rounded-full',
                          data.face_status === 'Approved' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
                        )}>
                          {data.face_status}
                        </div>
                      )}
                    </div>

                    <div className="flex-none text-center" style={{ width: 130 }}>
                      {liveSelfie ? (
                        <div className="bg-muted rounded-xl overflow-hidden mb-2" style={{ height: 160 }}>
                          <img src={liveSelfie} alt="Live selfie" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="bg-muted rounded-xl flex items-center justify-center mb-2 text-center text-xs text-muted-foreground p-3" style={{ height: 160 }}>
                          <div>
                            <div className="text-2xl mb-2">📸</div>
                            Selfie image not<br/>returned by Didit API
                          </div>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">Live Selfie</div>
                    </div>
                  </div>

                  {!liveSelfie && data.liveness_raw && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer">
                        Debug: available liveness fields
                      </summary>
                      <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-auto max-h-32">
                        {JSON.stringify(Object.keys(data.liveness_raw || {}), null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })()}

            {/* Biometric scores */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                Biometric Scores
              </div>
              <div className="flex gap-8 justify-center">
                <ScoreRing score={data.face_score} status={data.face_status} label="Face Match" />
                <ScoreRing score={data.liveness_score} status={data.liveness_status} label="Liveness" />
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center justify-center w-[72px] h-[72px]">
                    <div className={cn('text-3xl font-bold',
                      data.aml_total_hits > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                      {data.aml_total_hits}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">AML Hits</span>
                  <span className={cn('text-xs font-semibold',
                    data.aml_total_hits > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                    {data.aml_status || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Personal data */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Personal Data
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  ['Document Type',   data.document_type],
                  ['Document Number', data.document_number],
                  ['Personal Number', data.personal_number],
                  ['Issuing State',   data.issuing_state_name || data.issuing_state],
                  ['Issue Date',      data.date_of_issue],
                  ['Expiry Date',     data.expiration_date],
                  ['Full Name',       data.full_name || [data.first_name, data.last_name].filter(Boolean).join(' ')],
                  ['Date of Birth',   data.date_of_birth],
                  ['Nationality',     formatNationality(data.nationality)],
                  ['Gender',          data.gender],
                  ['Address',         data.address],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                    <div className="font-medium text-foreground">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Image quality */}
            {(data.front_quality != null || data.back_quality != null) && (
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Document Quality Scores
                </div>
                <div className="flex gap-6">
                  {data.front_quality != null && (
                    <div>
                      <div className="text-xs text-muted-foreground">Front</div>
                      <div className="text-lg font-bold text-foreground">{Math.round(data.front_quality)}%</div>
                    </div>
                  )}
                  {data.back_quality != null && (
                    <div>
                      <div className="text-xs text-muted-foreground">Back</div>
                      <div className="text-lg font-bold text-foreground">{Math.round(data.back_quality)}%</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AML Details */}
            {data.aml_total_hits > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
                      AML Screening — {data.aml_total_hits} Hit{data.aml_total_hits !== 1 ? 's' : ''} Found
                    </div>
                  </div>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-semibold border',
                    data.aml_status === 'Approved'
                      ? 'bg-amber-100 text-amber-700 border-amber-300'
                      : 'bg-red-100 text-red-700 border-red-300'
                  )}>
                    {data.aml_status || '—'}
                  </span>
                </div>
                {data.aml_hits?.length > 0 ? (
                  <div className="space-y-3">
                    {data.aml_hits.map((hit, idx) => (
                      <div key={idx} className="bg-white border border-amber-200 rounded-lg p-3 text-xs">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="font-semibold text-amber-900 text-sm">
                            {hit.entity_name || hit.name || hit.full_name || `Hit ${idx + 1}`}
                          </div>
                          {(hit.score || hit.similarity_score) != null && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                              {Math.round((hit.score || hit.similarity_score) * 100)}% match
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-muted-foreground">
                          {hit.match_type && <><span>Match Type</span><span className="text-foreground font-medium">{hit.match_type}</span></>}
                          {hit.categories?.length > 0 && <><span>Categories</span><span className="text-foreground">{Array.isArray(hit.categories) ? hit.categories.join(', ') : hit.categories}</span></>}
                          {hit.datasets?.length > 0 && <><span>Lists / Sources</span><span className="text-foreground">{Array.isArray(hit.datasets) ? hit.datasets.join(', ') : hit.datasets}</span></>}
                          {hit.country && <><span>Country</span><span className="text-foreground">{hit.country}</span></>}
                          {hit.date_of_birth && <><span>Date of Birth</span><span className="text-foreground">{hit.date_of_birth}</span></>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white border border-amber-200 rounded-lg p-3 text-xs">
                    <div className="text-amber-800 font-medium mb-1">{data.aml_total_hits} screening hit(s) detected</div>
                    <div className="text-amber-700">View full AML details in Didit Console → Sessions → this session → AML tab.</div>
                    {data.aml_raw && (
                      <pre className="mt-2 text-xs text-muted-foreground overflow-auto max-h-32 bg-muted rounded p-2">
                        {JSON.stringify(data.aml_raw, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Warnings */}
            {data.warnings?.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 uppercase tracking-wide mb-3">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Warnings / Issues
                </div>
                <div className="space-y-2">
                  {data.warnings.map((w, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-medium text-amber-900">{w.risk || '—'}</span>
                      {w.short_description && (
                        <span className="text-amber-700"> — {w.short_description}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="text-xs text-muted-foreground text-center pb-2">
              Images expire 60 min after each refresh · Click "Refresh" to reload fresh signed URLs · Verified by Didit (didit.me)
            </div>
          </div>
        )}
      </div>
    </>
  );
}