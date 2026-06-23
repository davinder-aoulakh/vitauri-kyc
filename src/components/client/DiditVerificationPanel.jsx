import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

export default function DiditVerificationPanel({ sessionId, tenantId, clientName, onClose }) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [mainImage, setMainImage] = useState('front');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('getDiditSessionDetails', {
        session_id: sessionId,
        tenant_id:  tenantId,
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
            <a href={`https://business.didit.me/sessions/${sessionId}`}
               target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                <ExternalLink className="w-3.5 h-3.5" /> Didit Console
              </Button>
            </a>
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
                ID Document Images
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
                {data.portrait_image && (
                  <button onClick={() => setMainImage('portrait')}
                    className={cn('rounded-lg overflow-hidden border-2 w-12 h-12',
                      mainImage === 'portrait' ? 'border-primary' : 'border-transparent opacity-60')}>
                    <img src={data.portrait_image} alt="Selfie" className="w-full h-full object-cover" />
                  </button>
                )}
              </div>
            </div>

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
                  ['Nationality',     data.nationality],
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