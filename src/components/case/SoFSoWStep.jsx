import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const SOF_SOURCES = ['Salary / Employment Income','Business Income / Dividends','Sale of Property','Inheritance','Investment Returns','Pension','Loan / Credit Facility','Other'];
const SOW_SOURCES = ['Lifetime Savings','Business Ownership','Inheritance / Gift','Property Portfolio','Investment Portfolio','Pension / Retirement Funds','Other'];
const ADEQUACY_LEVELS = ['Fully Adequate','Mostly Adequate','Partially Adequate','Inadequate','Unable to Assess'];

export default function SoFSoWStep({ kycCase, client, currentUser }) {
  const [sof, setSof] = useState({ source: '', explanation: '', adequacy: '', evidence_received: false });
  const [sow, setSow] = useState({ source: '', explanation: '', adequacy: '', evidence_received: false });
  const [generatingNarrative, setGeneratingNarrative] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  async function generateNarrative() {
    setGeneratingNarrative(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC analyst. Write a professional SoF/SoW narrative for: 
Client: ${client?.full_name} (${client?.client_type})
Source of Funds: ${sof.source || 'Not specified'} — ${sof.explanation || 'No details'}
Source of Wealth: ${sow.source || 'Not specified'} — ${sow.explanation || 'No details'}
SoF Adequacy: ${sof.adequacy || 'Not assessed'}
SoW Adequacy: ${sow.adequacy || 'Not assessed'}

Write a 3-5 sentence professional KYC narrative. Be factual and regulatory-grade.`,
      response_json_schema: { type: 'object', properties: { narrative: { type: 'string' } } },
    });
    setNarrative(result?.narrative || '');
    setGeneratingNarrative(false);
  }

  async function save() {
    setSaving(true);
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'sof_sow_updated',
      notes: `SoF: ${sof.source} (${sof.adequacy}) | SoW: ${sow.source} (${sow.adequacy})`,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function SectionCard({ title, state, setState }) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h4 className="font-medium text-sm">{title}</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs mb-1 block">Primary Source</Label>
            <Select value={state.source} onValueChange={v => setState(s => ({ ...s, source: v }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                {(title.includes('Funds') ? SOF_SOURCES : SOW_SOURCES).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs mb-1 block">Explanation / Evidence</Label>
            <Textarea value={state.explanation} onChange={e => setState(s => ({ ...s, explanation: e.target.value }))} className="text-sm min-h-16" placeholder="Describe the source in detail…" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Adequacy Assessment</Label>
            <Select value={state.adequacy} onValueChange={v => setState(s => ({ ...s, adequacy: v }))}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{ADEQUACY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              id={`evidence-${title}`}
              checked={state.evidence_received}
              onChange={e => setState(s => ({ ...s, evidence_received: e.target.checked }))}
              className="rounded border-border"
            />
            <Label htmlFor={`evidence-${title}`} className="text-xs cursor-pointer">Documentary evidence received</Label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-sm">Source of Funds / Source of Wealth</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Document and assess the client's sources of funds and wealth</p>
      </div>

      <SectionCard title="Source of Funds (SoF)" state={sof} setState={setSof} />
      <SectionCard title="Source of Wealth (SoW)" state={sow} setState={setSow} />

      {/* AI Narrative */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">SoF / SoW Narrative</h4>
          <Button
            size="sm" variant="outline" className="text-xs gap-1.5 text-purple-600 border-purple-200 hover:bg-purple-50"
            onClick={generateNarrative}
            disabled={generatingNarrative || (!sof.source && !sow.source)}
          >
            {generatingNarrative ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {generatingNarrative ? 'Generating…' : 'AI Draft Narrative'}
          </Button>
        </div>
        <Textarea
          value={narrative}
          onChange={e => setNarrative(e.target.value)}
          placeholder="Enter or generate a narrative summarising the SoF/SoW assessment…"
          className="text-sm min-h-24"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Save SoF/SoW Assessment
        </Button>
        {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
      </div>
    </div>
  );
}