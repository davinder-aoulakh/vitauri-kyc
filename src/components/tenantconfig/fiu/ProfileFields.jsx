import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StringListEditor from '@/components/tenantconfig/fiu/StringListEditor';
import { METHOD_LABELS } from '@/lib/fiuProfile';

function Field({ label, children }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

export default function ProfileFields({ draft, set, disabled }) {
  const num = (key, label) => (
    <Field label={label}>
      <Input type="number" min="0" disabled={disabled} className="h-8 text-xs" value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </Field>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Law"><Input disabled={disabled} className="h-8 text-xs" value={draft.law} onChange={(e) => set({ law: e.target.value })} /></Field>
        <Field label="Language"><Input disabled={disabled} className="h-8 text-xs" value={draft.language} onChange={(e) => set({ language: e.target.value })} /></Field>
        {num('objective_deadline_hours', 'Objective deadline (hours)')}
        {num('subjective_escalation_hours', 'Subjective escalation (hours)')}
        {num('co_investigation_working_days', 'CO investigation (working days)')}
        {num('report_deadline_hours', 'Report deadline (hours)')}
        <Field label="Submission method">
          <Select disabled={disabled} value={draft.submission_method} onValueChange={(v) => set({ submission_method: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(METHOD_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex items-center gap-2 pt-5">
          <Switch disabled={disabled} checked={draft.report_without_delay} onCheckedChange={(v) => set({ report_without_delay: v })} />
          <Label className="text-xs">Report without delay</Label>
        </div>
        <Field label="Didit template ID: objective report"><Input disabled={disabled} className="h-8 text-xs font-mono" value={draft.didit_template_ids.unusual_objective} onChange={(e) => set({ didit_template_ids: { ...draft.didit_template_ids, unusual_objective: e.target.value } })} /></Field>
        <Field label="Didit template ID: subjective report"><Input disabled={disabled} className="h-8 text-xs font-mono" value={draft.didit_template_ids.unusual_subjective} onChange={(e) => set({ didit_template_ids: { ...draft.didit_template_ids, unusual_subjective: e.target.value } })} /></Field>
      </div>
      <Field label="Holiday calendar"><StringListEditor type="date" disabled={disabled} items={draft.holiday_calendar} onChange={(v) => set({ holiday_calendar: v })} /></Field>
      <Field label="Mandatory fields (goAML paths)"><StringListEditor disabled={disabled} placeholder="e.g. t_person.first_name" items={draft.mandatory_fields} onChange={(v) => set({ mandatory_fields: v })} /></Field>
      <Field label="Notes"><Textarea disabled={disabled} className="text-xs min-h-16" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </div>
  );
}