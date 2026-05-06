import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Pencil, RotateCcw, Save, Loader2, Sparkles, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const AGENTS = [
  {
    key: 'OrgChart',
    label: 'Org Chart Agent',
    description: 'Analyses client ownership structures and suggests UBOs and related parties.',
    default_prompt: `You are a KYC compliance expert specialising in corporate ownership analysis. Given the client's legal name, sector, and jurisdiction, identify probable beneficial owners, analyse ownership layers, and flag any complexity or opacity. Output a structured list of recommended related parties with their likely roles. Be specific, concise, and regulatory-grade.`,
  },
  {
    key: 'OutreachCopilot',
    label: 'Outreach Co-pilot',
    description: 'Drafts professional client outreach messages requesting documents and data.',
    default_prompt: `You are a KYC analyst writing professional outreach messages to clients. Based on the client's profile (name, type, sector, jurisdiction) and the list of requested items, draft a clear, polite, and compliant outreach message. The tone should be professional but approachable. Include a deadline and reference the regulatory obligation without being threatening.`,
  },
  {
    key: 'ScreeningTriage',
    label: 'Screening Triage Agent',
    description: 'Triages screening hits and recommends Likely FP / Possible Match / Confirmed Match.',
    default_prompt: `You are a financial crime screening analyst. Given an entity name and a screening hit (source, confidence score, raw details), assess whether this is a true match or a false positive. Consider name similarity, date of birth, country, and list type. Output a recommendation: Likely_False_Positive, Possible_Match, or Confirmed_Match. Provide a concise rationale of 2-3 sentences.`,
  },
  {
    key: 'ClientProfile',
    label: 'Client Profile Agent',
    description: 'Drafts structured KYC client profile narratives from client data and OSINT.',
    default_prompt: `You are a KYC analyst drafting a regulatory-grade client profile. Using the provided client data (name, type, sector, jurisdiction, ownership, related parties), write a professional client profile narrative. Include: business description, ownership overview, product/service nature, geographic footprint, and any notable risk factors. Be factual, precise, and use regulatory language.`,
  },
  {
    key: 'SoFSoW',
    label: 'SoF/SoW Agent',
    description: 'Generates Source of Funds and Source of Wealth assessment narratives.',
    default_prompt: `You are a KYC compliance analyst writing a Source of Funds (SoF) and Source of Wealth (SoW) assessment. Based on the client's stated sources, supporting evidence, and any outreach responses, write a structured assessment that: (1) summarises stated sources, (2) assesses plausibility, (3) identifies any documentation gaps, and (4) provides a final assessment of adequacy. Use FATF-aligned language.`,
  },
  {
    key: 'IndicatorApplicability',
    label: 'Indicator Applicability Agent',
    description: 'Suggests which risk indicators apply to a given entity based on profile data.',
    default_prompt: `You are a KYC risk analyst. Given a client or related party profile (type, sector, jurisdiction, ownership structure, screening results), identify which of the provided risk indicators are applicable. For each applicable indicator, briefly explain why it applies. Return a JSON array of applicable indicator IDs with justifications.`,
  },
  {
    key: 'RiskNarrative',
    label: 'Risk Narrative Agent',
    description: 'Generates pyramidal risk narratives for each indicator and consolidated assessment.',
    default_prompt: `You are a KYC risk analyst writing a risk assessment narrative. For the given entity (name, type, sector) and risk indicator (name, description, analyst score), write a concise 2-3 sentence risk narrative that: (1) states the indicator and its relevance to this entity, (2) justifies the assigned risk score (Low/Medium/High/Unacceptable) with specific reasoning, and (3) references any mitigating or aggravating factors.`,
  },
  {
    key: 'WorkflowOptimisation',
    label: 'Workflow Optimisation Agent',
    description: 'Analyses case workflow and suggests optimisations for analyst efficiency.',
    default_prompt: `You are a KYC compliance operations advisor. Analyse the provided case workflow data (steps completed, time per step, flags raised, outreach delays) and identify bottlenecks, inefficiencies, or risk gaps. Suggest specific, actionable improvements that maintain regulatory compliance while improving analyst throughput. Be practical and evidence-based.`,
  },
];

export default function AiPromptLibrary() {
  const { currentUser } = useTenant();
  const [configs, setConfigs]     = useState({});
  const [loading, setLoading]     = useState(true);
  const [editAgent, setEditAgent] = useState(null);  // agent key
  const [editPrompt, setEditPrompt] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testing, setTesting]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  useEffect(() => { if (currentUser?.tenant_id) load(); }, [currentUser]);

  async function load() {
    const data = await base44.entities.AiPromptConfig.filter({ tenant_id: currentUser.tenant_id });
    const map = {};
    (data || []).forEach(c => { map[c.agent_key] = c; });
    setConfigs(map);
    setLoading(false);
  }

  function openEdit(agentKey) {
    const existing = configs[agentKey];
    const agent = AGENTS.find(a => a.key === agentKey);
    setEditPrompt(existing?.system_prompt || agent?.default_prompt || '');
    setEditAgent(agentKey);
    setTestInput('');
    setTestOutput('');
  }

  async function savePrompt() {
    setSaving(true);
    const agent = AGENTS.find(a => a.key === editAgent);
    const existing = configs[editAgent];
    if (existing?.id) {
      await base44.entities.AiPromptConfig.update(existing.id, {
        system_prompt: editPrompt,
        modified_by_name: currentUser.full_name,
      });
    } else {
      await base44.entities.AiPromptConfig.create({
        tenant_id: currentUser.tenant_id,
        agent_key: editAgent,
        agent_label: agent?.label,
        system_prompt: editPrompt,
        default_prompt: agent?.default_prompt,
        modified_by_name: currentUser.full_name,
        is_active: true,
      });
    }
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'ai_prompt_edited',
      notes: `System prompt for agent "${editAgent}" updated by ${currentUser.full_name}`,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await load();
  }

  async function resetToDefault() {
    const agent = AGENTS.find(a => a.key === editAgent);
    setEditPrompt(agent?.default_prompt || '');
  }

  async function runTest() {
    if (!testInput.trim()) return;
    setTesting(true);
    setTestOutput('');
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `[SYSTEM PROMPT]\n${editPrompt}\n\n[USER INPUT]\n${testInput}`,
    });
    setTestOutput(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    setTesting(false);
  }

  const activeAgent = editAgent ? AGENTS.find(a => a.key === editAgent) : null;

  return (
    <AppShell>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-semibold">AI Prompt &amp; Rule Library</h1>
          <p className="text-sm text-muted-foreground mt-0.5">View and customise system prompts for all AI agents. Compliance Admin only.</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold text-amber-800">Editing AI prompts affects all cases in this tenant</div>
            <div className="text-xs text-amber-700 mt-0.5">Changes take effect on the next AI invocation. All edits are audit-logged. Only edit with care and test before saving.</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {AGENTS.map(agent => {
            const config = configs[agent.key];
            const isCustomised = !!config;
            return (
              <div key={agent.key} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-500 flex-shrink-0" />
                    <span className="font-semibold text-sm">{agent.label}</span>
                    {isCustomised
                      ? <span className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">Custom</span>
                      : <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Default</span>
                    }
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{agent.description}</p>
                  {config?.updated_date && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Last modified: {format(new Date(config.updated_date), 'd MMM yyyy HH:mm')}
                      {config.modified_by_name && ` · by ${config.modified_by_name}`}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs flex-shrink-0" onClick={() => openEdit(agent.key)}>
                  <Pencil className="w-3.5 h-3.5" /> Edit Prompt
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editAgent} onOpenChange={v => !v && setEditAgent(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              {activeAgent?.label} — System Prompt
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <p className="text-xs text-muted-foreground">{activeAgent?.description}</p>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">System Prompt</label>
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={resetToDefault}>
                  <RotateCcw className="w-3 h-3" /> Reset to Default
                </Button>
              </div>
              <Textarea
                value={editPrompt}
                onChange={e => setEditPrompt(e.target.value)}
                className="text-xs font-mono min-h-[200px] resize-y bg-muted/20"
                spellCheck={false}
              />
              <div className="text-xs text-muted-foreground mt-1">{editPrompt.length} characters</div>
            </div>

            {/* Test Panel */}
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="bg-muted/40 px-4 py-2.5 border-b border-border flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-xs font-semibold">Test Panel</span>
                <span className="text-xs text-muted-foreground">— enter sample input and run to preview output</span>
              </div>
              <div className="p-4 space-y-3">
                <Textarea
                  value={testInput}
                  onChange={e => setTestInput(e.target.value)}
                  placeholder="Enter a sample input to test this prompt…"
                  className="text-xs min-h-16 resize-none"
                />
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={runTest} disabled={!testInput.trim() || testing}>
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-purple-500" />}
                  Run Test
                </Button>
                {testOutput && (
                  <div className="bg-purple-50/60 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {testOutput}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end flex-shrink-0 pt-4 border-t border-border mt-2">
            <Button variant="outline" onClick={() => setEditAgent(null)}>Cancel</Button>
            <Button onClick={savePrompt} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saved ? '✓ Saved' : 'Save Prompt'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}