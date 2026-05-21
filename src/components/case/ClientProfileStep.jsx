import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAutoSave } from '@/hooks/useAutoSave';
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sparkles, CheckCircle, Loader2, RefreshCw, Globe, ChevronDown,
  ChevronUp, ExternalLink, Plus, User, Building2, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ClientProfileStep({ kycCase, client, currentUser }) {
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptedBy, setAcceptedBy] = useState(null); // 'accept' | 'edit'
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideJustification, setOverrideJustification] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // OSINT
  const [osintResults, setOsintResults] = useState(null);
  const [osintLoading, setOsintLoading] = useState(false);
  const [osintOpen, setOsintOpen] = useState(false);
  const [selectedOsint, setSelectedOsint] = useState([]);

  // Track whether initial load has completed so auto-save doesn't fire on mount
  const loaded = useRef(false);

  // Load existing profile draft from audit/case notes
  useEffect(() => {
    if (kycCase?.case_notes?.includes('PROFILE_DRAFT:')) {
      const match = kycCase.case_notes.match(/PROFILE_DRAFT:([\s\S]*?)(?:END_PROFILE|$)/);
      if (match) setDraft(match[1].trim());
    }
    loaded.current = true;
  }, [kycCase?.id]);

  // Auto-save draft to KycCase after 1500ms of inactivity
  const { autoSaving, lastSaved } = useAutoSave(
    draft,
    async (currentDraft) => {
      if (!kycCase?.id || !currentDraft) return;
      const existingNotes = kycCase.case_notes || '';
      const cleaned = existingNotes.replace(/PROFILE_DRAFT:[\s\S]*?END_PROFILE/g, '').trim();
      await base44.entities.KycCase.update(kycCase.id, {
        case_notes: `${cleaned}\n\nPROFILE_DRAFT:${currentDraft}END_PROFILE`,
      });
    },
    1500,
    !loaded.current,
  );

  async function generateDraft() {
    setGenerating(true);
    setAccepted(false);

    // Gather available context
    const [outreachData, docsData] = await Promise.all([
      base44.entities.OutreachRequest.filter({ case_id: kycCase.id }),
      base44.entities.Document.filter({ client_id: kycCase.client_id }),
    ]);

    const outreachContext = outreachData?.map(o =>
      `Outreach (${o.status}): ${o.items?.map(i => `${i.label}: ${i.response_text || 'pending'}`).join('; ') || 'no items'}`
    ).join('\n') || 'No outreach data';

    const docContext = docsData?.map(d => `Document: ${d.doc_type} — ${d.file_name}`).join('\n') || 'No documents';

    const osintContext = osintResults?.findings?.map(f => `OSINT: ${f.title} — ${f.summary}`).join('\n') || '';

    const isOrg = client?.client_type === 'ORG';
    const clientContext = isOrg ? `
Company: ${client.full_name}
Legal Form: ${client.legal_form || 'N/A'}
Registration No: ${client.registration_number || 'N/A'}
Country: ${client.registered_country || 'N/A'}
Sector: ${client.sector || 'N/A'}
LEI: ${client.lei_code || 'N/A'}
Contact: ${client.primary_contact_email || 'N/A'}
` : `
Client: ${client.full_name}
Date of Birth: ${client.date_of_birth || 'N/A'}
Nationality: ${client.nationality || 'N/A'}
Residence: ${client.country_of_residence || 'N/A'}
ID: ${client.id_type || 'N/A'} ${client.id_number || ''}
`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a senior KYC analyst at a regulated financial institution. Draft a professional KYC client profile for the following client.

CLIENT DATA:
${clientContext}

DOCUMENTS ON FILE:
${docContext}

OUTREACH RESPONSES:
${outreachContext}

${osintContext ? `OSINT FINDINGS:\n${osintContext}` : ''}

Write a comprehensive, regulatory-grade KYC profile covering:
1. Business/personal description and background
2. Ownership structure (for ORG: UBOs and directors; for NP: key relationships)
3. Client relationship history and purpose of relationship
4. Products and services used
5. Geographic footprint and key jurisdictions
6. Any red flags, anomalies, or areas requiring further scrutiny

Tone: factual, neutral, professional. Use third person. 4–8 paragraphs. Do not invent facts — note where information is missing.`,
      model: 'claude_sonnet_4_6',
    });

    setDraft(typeof result === 'string' ? result : result?.narrative || result?.profile || JSON.stringify(result));
    setGenerating(false);
  }

  async function runOsint() {
    setOsintLoading(true);
    setOsintOpen(true);
    const name = client?.full_name || '';
    const country = client?.registered_country || client?.nationality || '';

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an OSINT researcher. Conduct open-source intelligence research on the following entity and return structured findings.

Entity: "${name}"
Country: "${country}"
Client Type: ${client?.client_type === 'ORG' ? 'Organisation' : 'Natural Person'}

Search for and summarise:
1. Company website / official presence
2. News articles (last 5 years)
3. Regulatory registers or enforcement actions
4. LinkedIn or professional profiles (NP only)
5. Any adverse or negative mentions

For each finding, provide: title, summary, source_type (news/regulatory/website/social), credibility (high/medium/low), and a plausible source_url.

Return 3–8 findings. If you find nothing notable, state that explicitly.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: 'object',
        properties: {
          entity_searched: { type: 'string' },
          search_date: { type: 'string' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
                source_type: { type: 'string' },
                credibility: { type: 'string' },
                source_url: { type: 'string' },
                is_adverse: { type: 'boolean' },
              }
            }
          },
          overall_summary: { type: 'string' },
        }
      }
    });

    setOsintResults(result);
    setOsintLoading(false);
  }

  function appendOsintToProfile(finding) {
    const text = `\n\n[OSINT — ${finding.source_type?.toUpperCase()}] ${finding.title}: ${finding.summary}`;
    setDraft(d => d + text);
    setSelectedOsint(s => [...s, finding.title]);
  }

  async function acceptDraft(mode) {
    setSaving(true);
    setAcceptedBy(mode);
    setAccepted(true);

    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: mode === 'accept' ? 'client_profile_accepted' : 'client_profile_edited_accepted',
      notes: `Client profile draft ${mode === 'accept' ? 'accepted as-is' : 'edited and accepted'}. Length: ${draft.length} chars.`,
    });

    // Store draft snippet in KycCase notes for retrieval
    const existingNotes = kycCase.case_notes || '';
    const cleaned = existingNotes.replace(/PROFILE_DRAFT:[\s\S]*?END_PROFILE/g, '').trim();
    await base44.entities.KycCase.update(kycCase.id, {
      case_notes: `${cleaned}\n\nPROFILE_DRAFT:${draft}END_PROFILE`,
    });

    setSaving(false);
    setTimeout(() => setSaved(false), 3000);
    setSaved(true);
  }

  async function handleOverride() {
    if (overrideJustification.length < 20) return;
    setSaving(true);
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'client_profile_overridden',
      notes: overrideJustification,
      is_override: true,
    });
    setAccepted(true);
    setAcceptedBy('override');
    setOverrideMode(false);
    setSaving(false);
    setSaved(true);
  }

  const isOrg = client?.client_type === 'ORG';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm text-foreground">Client Profile Builder</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build a structured regulatory profile for {client?.full_name || 'this client'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            className="gap-1.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
            onClick={runOsint}
            disabled={osintLoading}
          >
            {osintLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            {osintLoading ? 'Searching…' : 'OSINT Search'}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white"
            onClick={generateDraft}
            disabled={generating}
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'Generating…' : draft ? 'Regenerate' : 'Generate Profile Draft'}
          </Button>
        </div>
      </div>

      {/* Client Snapshot */}
      <div className="bg-muted/30 border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', isOrg ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>
            {isOrg ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
          </div>
          <div>
            <div className="font-semibold text-sm">{client?.full_name}</div>
            <div className="text-xs text-muted-foreground">
              {isOrg
                ? `${client?.legal_form || 'Organisation'} · ${client?.sector || '—'} · ${client?.registered_country || '—'}`
                : `${client?.nationality || '—'} · ${client?.country_of_residence || '—'}`
              }
            </div>
          </div>
        </div>
      </div>

      {/* OSINT Panel */}
      {(osintResults || osintLoading) && (
        <div className="border border-blue-200 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 bg-blue-50/60 text-left"
            onClick={() => setOsintOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600" />
              <span className="font-semibold text-sm text-blue-800">OSINT Results</span>
              {osintResults?.findings?.length > 0 && (
                <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">
                  {osintResults.findings.length} findings
                </span>
              )}
              {osintResults?.findings?.some(f => f.is_adverse) && (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Adverse
                </span>
              )}
            </div>
            {osintOpen ? <ChevronUp className="w-4 h-4 text-blue-500" /> : <ChevronDown className="w-4 h-4 text-blue-500" />}
          </button>

          {osintOpen && (
            <div className="p-4 space-y-3 border-t border-blue-200 bg-white">
              {osintLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching open sources…
                </div>
              ) : (
                <>
                  {osintResults?.overall_summary && (
                    <div className="text-xs text-muted-foreground italic border-b border-border pb-2">
                      {osintResults.overall_summary}
                    </div>
                  )}
                  <div className="space-y-2">
                    {osintResults?.findings?.map((f, i) => (
                      <div
                        key={i}
                        className={cn(
                          'border rounded-lg p-3 text-xs space-y-1',
                          f.is_adverse ? 'border-red-200 bg-red-50/40' : 'border-border bg-muted/20'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-foreground flex items-center gap-1.5">
                            {f.is_adverse && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                            {f.title}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium',
                              f.credibility === 'high' ? 'bg-emerald-100 text-emerald-700' :
                              f.credibility === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                            )}>
                              {f.credibility}
                            </span>
                            <span className="text-muted-foreground/60">{f.source_type}</span>
                          </div>
                        </div>
                        <div className="text-muted-foreground leading-relaxed">{f.summary}</div>
                        <div className="flex items-center justify-between pt-1">
                          {f.source_url && (
                            <a href={f.source_url} target="_blank" rel="noopener noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> Source
                            </a>
                          )}
                          <Button
                            size="sm" variant="outline"
                            className={cn('text-xs h-6 px-2 ml-auto gap-1',
                              selectedOsint.includes(f.title) ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : ''
                            )}
                            onClick={() => appendOsintToProfile(f)}
                            disabled={selectedOsint.includes(f.title)}
                          >
                            {selectedOsint.includes(f.title) ? <CheckCircle className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                            {selectedOsint.includes(f.title) ? 'Added' : 'Add to Profile'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Draft Editor */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h4 className="font-medium text-sm">Profile Draft</h4>
            <AutoSaveIndicator autoSaving={autoSaving} lastSaved={lastSaved} />
          </div>
          {accepted && (
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
              acceptedBy === 'override' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            )}>
              {acceptedBy === 'override' ? '⚠ Override Accepted' : '✓ Accepted'}
            </span>
          )}
        </div>
        <Textarea
          value={draft}
          onChange={e => { setDraft(e.target.value); setAccepted(false); }}
          placeholder="Click 'Generate Profile Draft' to create an AI-assisted profile, or type manually…"
          className="text-sm min-h-64 resize-y font-mono leading-relaxed"
        />
        <div className="text-xs text-muted-foreground">{draft.length} characters</div>

        {/* Actions */}
        {draft && !accepted && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => acceptDraft('accept')}
              disabled={saving}
            >
              <CheckCircle className="w-3.5 h-3.5" /> Accept Draft
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5"
              onClick={() => acceptDraft('edit')}
              disabled={saving}
            >
              <CheckCircle className="w-3.5 h-3.5" /> Edit & Accept
            </Button>
            <Button
              size="sm" variant="ghost"
              className="gap-1.5"
              onClick={generateDraft}
              disabled={generating}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </Button>
            <Button
              size="sm" variant="ghost"
              className="gap-1.5 text-amber-600 hover:bg-amber-50"
              onClick={() => setOverrideMode(true)}
            >
              Override
            </Button>
          </div>
        )}

        {accepted && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setAccepted(false)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={generateDraft} disabled={generating}>
              <RefreshCw className="w-3 h-3" /> Regenerate
            </Button>
          </div>
        )}

        {saved && <div className="text-xs text-emerald-600 font-medium">✓ Profile saved to case</div>}
      </div>

      {/* Override Modal */}
      {overrideMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-card border border-border rounded-xl p-5 w-96 shadow-xl space-y-4">
            <h3 className="font-semibold text-sm">Override AI Draft</h3>
            <p className="text-xs text-muted-foreground">Provide a justification for overriding the AI-generated profile (min 20 characters). This will be logged as an audit event.</p>
            <Textarea
              value={overrideJustification}
              onChange={e => setOverrideJustification(e.target.value)}
              placeholder="Reason for override…"
              className="text-sm min-h-16"
            />
            <div className="text-xs text-muted-foreground">{overrideJustification.length}/20</div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setOverrideMode(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={overrideJustification.length < 20 || saving}
                onClick={handleOverride}
              >
                Confirm Override
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}