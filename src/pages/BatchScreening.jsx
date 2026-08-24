import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Upload, Download, CheckCircle, XCircle, AlertTriangle,
  Loader2, Shield, Sparkles, FileText, ChevronRight,
  AlertCircle, Info, Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addDays } from 'date-fns';

// ── CSV template ────────────────────────────────────────────────────────────
const TEMPLATE_COLS = ['entity_type', 'name', 'country', 'date_of_birth', 'registration_number', 'nationality'];

function downloadTemplate() {
  const header = TEMPLATE_COLS.join(',');
  const rows = [
    'NP,"Van der Berg, Jan","Netherlands (NL)","1985-03-15","","Dutch"',
    'ORG,"Acme Holdings Ltd","United Kingdom","","UK12345678","',
    'NP,"Ahmad Al-Rashid","Syria","1970-06-22","","Syrian"',
  ];
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'batch_screening_template.csv',
  });
  a.click();
}

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line, idx) => {
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const row = { _rowNum: idx + 2 };
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return row;
  });
}

function validateRow(row) {
  const errors = [];
  const t = (row.entity_type || '').trim().toUpperCase();
  if (!['NP', 'ORG'].includes(t)) errors.push('entity_type must be NP or ORG');
  if (!row.name?.trim()) errors.push('name is required');
  if (!row.country?.trim()) errors.push('country is required');
  return errors;
}

// ── Risk colours ─────────────────────────────────────────────────────────────
const RISK_STYLE = {
  Low:          'bg-emerald-100 text-emerald-700 border-emerald-200',
  Medium:       'bg-amber-100  text-amber-700  border-amber-200',
  High:         'bg-red-100    text-red-700    border-red-200',
  Unacceptable: 'bg-purple-100 text-purple-800 border-purple-200',
};

const SOURCE_LABEL = {
  Sanctions_EU: 'EU Sanctions',
  Sanctions_UN: 'UN Sanctions',
  PEP_List:     'PEP List',
  Adverse_Media:'Adverse Media',
  Internal_Flag:'Internal Flag',
};

const REC_STYLE = {
  Likely_False_Positive: 'text-muted-foreground',
  Possible_Match:        'text-amber-700',
  Confirmed_Match:       'text-red-700 font-medium',
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

function ScreeningResultRow({ result, row, onCreateCase, caseCreated }) {
  const [expanded, setExpanded] = useState(false);
  const hasHits = result?.hits?.length > 0;

  return (
    <React.Fragment>
      <tr
        className={cn(
          'border-b border-border transition-colors',
          hasHits ? 'bg-red-50/40' : 'hover:bg-muted/20'
        )}
      >
        <td className="px-3 py-2.5 text-center text-muted-foreground text-xs">{row._rowNum}</td>
        <td className="px-3 py-2.5">
          <span className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border',
            (row.entity_type || '').toUpperCase() === 'ORG'
              ? 'bg-blue-100 text-blue-700 border-blue-200'
              : 'bg-violet-100 text-violet-700 border-violet-200'
          )}>
            {(row.entity_type || '?').toUpperCase()}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm font-medium">{row.name}</td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.country}</td>
        <td className="px-3 py-2.5 text-center">
          {result ? (
            result.hit ? (
              <AlertCircle className="w-4 h-4 text-red-500 mx-auto" />
            ) : (
              <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
            )
          ) : (
            <div className="w-4 h-4 rounded-full bg-muted animate-pulse mx-auto" />
          )}
        </td>
        <td className="px-3 py-2.5">
          {result?.risk_level && (
            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', RISK_STYLE[result.risk_level])}>
              {result.risk_level}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-xs truncate">
          {result?.summary || '—'}
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1.5">
            {hasHits && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Eye className="w-3.5 h-3.5" />
                {result.hits.length} hit{result.hits.length !== 1 ? 's' : ''}
                <ChevronRight className={cn('w-3 h-3 transition-transform', expanded && 'rotate-90')} />
              </button>
            )}
            {hasHits && !caseCreated && (
              <Button size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => onCreateCase(result, row)}>
                <FileText className="w-3 h-3" /> Create Case
              </Button>
            )}
            {caseCreated && (
              <span className="text-[10px] text-emerald-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Case created
              </span>
            )}
          </div>
        </td>
      </tr>
      {expanded && hasHits && (
        <tr className="bg-red-50/20 border-b border-border">
          <td colSpan={8} className="px-6 py-3">
            <div className="space-y-2">
              {result.hits.map((hit, i) => (
                <div key={i} className="flex items-start gap-3 bg-white border border-red-100 rounded-lg px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-foreground">{hit.hit_name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                        {SOURCE_LABEL[hit.source] || hit.source}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {hit.confidence_score}% confidence
                      </span>
                    </div>
                    <div className={cn('text-xs', REC_STYLE[hit.ai_recommendation])}>
                      {hit.ai_recommendation?.replace(/_/g, ' ')} — {hit.ai_rationale}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BatchScreening() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const fileRef = useRef();

  const [rows, setRows]           = useState([]);       // parsed CSV rows
  const [screening, setScreening] = useState(false);
  const [progress, setProgress]   = useState(0);        // 0-100
  const [results, setResults]     = useState({});       // index → result
  const [createdCases, setCreatedCases] = useState({}); // index → true
  const [phase, setPhase]         = useState('idle');   // idle | preview | screening | done

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(text => {
      const parsed = parseCSV(text);
      const validated = parsed.map(row => ({ ...row, _errors: validateRow(row) }));
      setRows(validated);
      setResults({});
      setCreatedCases({});
      setPhase('preview');
    });
  }

  const validRows   = rows.filter(r => r._errors.length === 0);
  const invalidRows = rows.filter(r => r._errors.length > 0);
  const hitRows     = Object.values(results).filter(r => r.hit).length;

  async function runScreening() {
    if (validRows.length === 0) return;
    setScreening(true);
    setPhase('screening');
    setProgress(5);

    setProgress(10);

    const resultMap = {};
    const step = 80 / Math.max(validRows.length, 1);

    for (let idx = 0; idx < validRows.length; idx++) {
      const row = validRows[idx];
      try {
        const res = await base44.functions.invoke('screenEntityAml', {
          tenant_id:   currentUser.tenant_id,
          full_name:   row.name || row.full_name,
          legal_type:  (row.entity_type || 'NP').toUpperCase(),
          country:     row.country || row.registered_country || '',
          date_of_birth: row.date_of_birth || row.dob || undefined,
          nationality: row.nationality || undefined,
          registration_number: row.registration_number || undefined,
          include_adverse_media: false,
        });
        const d = res?.data ?? res;
        if (d?.error) {
          resultMap[idx] = { hit: false, risk_level: null, summary: d.error, hits: [], error: true };
        } else {
          const hits = (d?.hits || []).map(h => ({
            hit_name:         h.hitName,
            source:           h.source,
            confidence_score: h.confidenceScore,
            ai_recommendation: h.confidenceScore >= 90 ? 'Confirmed_Match' : h.confidenceScore >= 60 ? 'Possible_Match' : 'Likely_False_Positive',
            ai_rationale:     h.rawDetails?.match_type ? `${h.rawDetails.match_type} match via Didit AML` : 'Didit AML match',
          }));
          const maxConf = hits.reduce((m, h) => Math.max(m, h.confidence_score), 0);
          resultMap[idx] = {
            hit:       hits.length > 0,
            risk_level: hits.length === 0 ? 'Low' : maxConf >= 90 ? 'High' : maxConf >= 60 ? 'Medium' : 'Low',
            summary:   hits.length === 0 ? 'No hits found' : `${hits.length} hit${hits.length !== 1 ? 's' : ''} — ${hits[0].hit_name}`,
            hits,
            warnings:  d.warnings || [],
            adverse_media_incomplete: d.adverse_media_incomplete || false,
          };
        }
      } catch (err) {
        resultMap[idx] = { hit: false, risk_level: null, summary: `Error: ${err.message}`, hits: [], error: true };
      }
      setProgress(10 + Math.round((idx + 1) * step));
    }

    setResults(resultMap);
    setProgress(100);
    setScreening(false);
    setPhase('done');
  }

  async function handleCreateCase(result, row) {
    const rowIdx = validRows.findIndex(r => r._rowNum === row._rowNum);

    // Create a Prospect client record first if needed
    const clientData = {
      tenant_id:           currentUser.tenant_id,
      client_type:         (row.entity_type || 'NP').toUpperCase(),
      full_name:           row.name || row.full_name,
      status:              'Prospect',
      nationality:         row.nationality || undefined,
      country_of_residence:row.country || undefined,
      date_of_birth:       row.date_of_birth || undefined,
      registration_number: row.registration_number || undefined,
      registered_country:  row.country || undefined,
      source_channel:      'Batch',
    };

    const client = await base44.entities.Client.create(clientData);

    // Create an Event-Driven Review (EDR) case
    const kycCase = await base44.entities.KycCase.create({
      tenant_id:            currentUser.tenant_id,
      client_id:            client.id,
      case_type:            'Event_Driven_Review',
      status:               'Draft',
      risk_classification:  result.risk_level,
      assigned_analyst_id:  currentUser.id,
      trigger_reason:       `Batch screening hit — ${result.hits.map(h => `${SOURCE_LABEL[h.source] || h.source}: ${h.hit_name}`).join('; ')}`,
      due_date:             format(addDays(new Date(), 14), 'yyyy-MM-dd'),
      created_by_user_id:   currentUser.id,
    });

    // Create ScreeningHit records for each hit
    for (const hit of result.hits) {
      await base44.entities.ScreeningHit.create({
        tenant_id:             currentUser.tenant_id,
        client_id:             client.id,
        case_id:               kycCase.id,
        entity_name:           row.name || row.full_name,
        entity_type:           'Client',
        source:                hit.source,
        hit_name:              hit.hit_name,
        confidence_score:      hit.confidence_score,
        ai_recommendation:     hit.ai_recommendation,
        ai_rationale:          hit.ai_rationale,
        status:                'New',
        is_monitoring_alert:   false,
      });
    }

    // Audit log
    await base44.entities.AuditEvent.create({
      tenant_id:     currentUser.tenant_id,
      case_id:       kycCase.id,
      client_id:     client.id,
      actor_user_id: currentUser.id,
      actor_name:    currentUser.full_name,
      actor_type:    'User',
      event_type:    'batch_screening_case_created',
      notes:         `Case draft created from batch screening — ${result.hits.length} hit(s) identified.`,
    });

    setCreatedCases(prev => ({ ...prev, [rowIdx]: true }));
  }

  async function handleCreateAllCases() {
    const hitEntries = Object.entries(results).filter(([, r]) => r.hit);
    for (const [idxStr, result] of hitEntries) {
      const idx = parseInt(idxStr);
      if (createdCases[idx]) continue;
      await handleCreateCase(result, validRows[idx]);
    }
  }

  const allHitCasesCreated = Object.entries(results)
    .filter(([, r]) => r.hit)
    .every(([idxStr]) => createdCases[parseInt(idxStr)]);

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-5">
        <PageHeader
          title="Batch Screening"
          subtitle="Upload a CSV of individuals or entities to screen against global sanction lists using AI"
          actions={
            <Button variant="outline" onClick={downloadTemplate} className="gap-2">
              <Download className="w-4 h-4" /> Download Template
            </Button>
          }
        />

        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-800">
            <span className="font-semibold">Didit AML Screening</span> — Screens against PEP databases, sanctions lists (OFAC SDN, EU, UN, UK OFSI), adverse media, and global watchlists via the Didit AML API.
            Entities with hits will be flagged for review. You can create individual KYC case drafts for any confirmed hits.
            <span className="ml-1 text-blue-600">Results are sourced from Didit and must be reviewed by a qualified analyst.</span>
          </div>
        </div>

        {/* Upload Zone */}
        {(phase === 'idle' || phase === 'preview') && (
          <div
            className={cn(
              'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
              'border-border bg-card hover:border-primary/60 hover:bg-primary/5'
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const files = e.dataTransfer.files;
              if (files[0]) { fileRef.current.files = files; handleFile({ target: fileRef.current }); }
            }}
          >
            <Shield className="w-8 h-8 mx-auto text-primary/40 mb-3" />
            <div className="text-sm font-medium">
              {rows.length > 0 ? 'Drop a new CSV to replace' : 'Drop CSV here, or click to browse'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Required columns: <span className="font-mono">entity_type, name, country</span>
              &nbsp;· Optional: <span className="font-mono">date_of_birth, registration_number, nationality</span>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        )}

        {/* Preview Table */}
        {rows.length > 0 && phase === 'preview' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">{rows.length} entities loaded</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="text-emerald-600 font-medium">{validRows.length} valid</span>
                  {invalidRows.length > 0 && (
                    <span className="text-red-500 font-medium"> · {invalidRows.length} with errors (will be skipped)</span>
                  )}
                </p>
              </div>
              <Button onClick={runScreening} disabled={validRows.length === 0} className="gap-2">
              <Sparkles className="w-4 h-4" />
              Run Didit AML on {validRows.length} entities
              </Button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-muted-foreground uppercase tracking-wide">
                      <th className="px-3 py-2.5 text-center w-8">#</th>
                      <th className="px-3 py-2.5 text-left">Type</th>
                      <th className="px-3 py-2.5 text-left">Name</th>
                      <th className="px-3 py-2.5 text-left">Country</th>
                      <th className="px-3 py-2.5 text-left">DOB / Reg No.</th>
                      <th className="px-3 py-2.5 text-left">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map(row => {
                      const ok = row._errors.length === 0;
                      return (
                        <tr key={row._rowNum} className={cn(!ok && 'bg-red-50/60')}>
                          <td className="px-3 py-2 text-center text-muted-foreground">{row._rowNum}</td>
                          <td className="px-3 py-2">
                            <span className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] font-semibold border',
                              (row.entity_type || '').toUpperCase() === 'ORG'
                                ? 'bg-blue-100 text-blue-700 border-blue-200'
                                : 'bg-violet-100 text-violet-700 border-violet-200'
                            )}>
                              {(row.entity_type || '?').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium">{row.name || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.country || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.date_of_birth || row.registration_number || '—'}
                          </td>
                          <td className="px-3 py-2">
                            {ok ? (
                              <span className="text-emerald-600">Ready</span>
                            ) : (
                              <div className="space-y-0.5">
                                {row._errors.map((e, i) => (
                                  <div key={i} className="flex items-center gap-1 text-red-600">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />{e}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Screening Progress */}
        {phase === 'screening' && (
          <div className="bg-card border border-border rounded-xl p-8 text-center space-y-4">
            <div className="relative w-12 h-12 mx-auto">
              <Loader2 className="w-12 h-12 animate-spin text-primary/30" />
              <Sparkles className="w-5 h-5 text-primary absolute inset-0 m-auto" />
            </div>
            <div>
              <div className="font-semibold text-sm">Didit AML Screening in progress…</div>
              <div className="text-xs text-muted-foreground mt-1">
                Screening {validRows.length} entities via Didit AML API — this may take up to 30s
              </div>
            </div>
            <div className="max-w-xs mx-auto bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground">{progress}%</div>
          </div>
        )}

        {/* Screening Results */}
        {phase === 'done' && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Entities Screened', value: validRows.length, icon: Shield, color: 'text-primary' },
                { label: 'No Hits',   value: validRows.length - hitRows, icon: CheckCircle, color: 'text-emerald-600' },
                { label: 'Hits Found', value: hitRows,    icon: AlertCircle, color: 'text-red-500' },
                { label: 'Cases Created', value: Object.keys(createdCases).length, icon: FileText, color: 'text-amber-600' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-card border border-border rounded-xl p-4">
                  <div className={cn('mb-1', color)}><Icon className="w-4 h-4" /></div>
                  <div className="text-2xl font-bold">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            {/* Bulk create button */}
            {hitRows > 0 && !allHitCasesCreated && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="text-sm">
                  <span className="font-semibold text-amber-800">{hitRows} entit{hitRows !== 1 ? 'ies' : 'y'} with hits</span>
                  <span className="text-amber-700"> — create KYC case drafts for compliance review</span>
                </div>
                <Button variant="outline" className="gap-2 border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0" onClick={handleCreateAllCases}>
                  <FileText className="w-4 h-4" />
                  Create All {hitRows} Case Drafts
                </Button>
              </div>
            )}

            {hitRows > 0 && allHitCasesCreated && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-sm text-emerald-800">
                  All case drafts created successfully.&nbsp;
                  <button onClick={() => navigate('/my-cases')} className="underline font-medium hover:no-underline">
                    View in My Cases →
                  </button>
                </div>
              </div>
            )}

            {/* Results table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">Screening Results</h3>
                <button
                  onClick={() => { setRows([]); setResults({}); setCreatedCases({}); setPhase('idle'); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Start new screening
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-muted-foreground uppercase tracking-wide">
                      <th className="px-3 py-2.5 text-center w-8">#</th>
                      <th className="px-3 py-2.5 text-left">Type</th>
                      <th className="px-3 py-2.5 text-left">Name</th>
                      <th className="px-3 py-2.5 text-left">Country</th>
                      <th className="px-3 py-2.5 text-center">Hit?</th>
                      <th className="px-3 py-2.5 text-left">Risk</th>
                      <th className="px-3 py-2.5 text-left">Summary</th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.map((row, idx) => (
                      <ScreeningResultRow
                        key={idx}
                        result={results[idx]}
                        row={row}
                        onCreateCase={(result, row) => handleCreateCase(result, row)}
                        caseCreated={!!createdCases[idx]}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}