import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity } from 'lucide-react';

const AML_OPTIONS = [
  { value: 'no_concerns', label: 'No concerns' },
  { value: 'concerns_handled_in_tm', label: 'Concerns — handled in TM case' },
  { value: 'report_to_fiu', label: 'Report to FIU', fiu: true },
];
const NONE = '__none__';

// TM outcome line + optional AML assessment for event-driven reviews opened from a TM case.
// Renders nothing unless tm_core is on and the case is an EDR with tm_case_id.
// value: { outcome, rationale } | null — passed to recordKycDecision as aml_assessment.
export default function SignOffTmOutcome({ kycCase, value, onChange }) {
  const { tenant } = useTenant();
  const show = isFeatureEnabled(tenant, 'tm_core') && kycCase?.case_type === 'Event_Driven_Review' && !!kycCase?.tm_case_id;
  const fiuOn = isFeatureEnabled(tenant, 'tm_fiu');

  const { data: tmCase } = useQuery({
    queryKey: ['signoff-tm-case', kycCase?.tm_case_id],
    enabled: show,
    staleTime: 60000,
    queryFn: async () => (await base44.entities.TmCase.filter({ id: kycCase.tm_case_id }))?.[0] || null,
  });

  if (!show) return null;
  const options = AML_OPTIONS.filter((o) => !o.fiu || fiuOn);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="w-3.5 h-3.5 flex-shrink-0" />
        The outcome will be recorded on TM case {tmCase?.case_ref || '…'}.
      </div>
      <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-2">
        <div className="text-xs font-semibold">AML assessment <span className="font-normal text-muted-foreground">(optional)</span></div>
        <Select
          value={value?.outcome || NONE}
          onValueChange={(v) => onChange?.(v === NONE ? null : { outcome: v, rationale: value?.rationale || '' })}
        >
          <SelectTrigger className="h-8 text-xs bg-background"><SelectValue placeholder="Not assessed" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs">Not assessed</SelectItem>
            {options.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {value?.outcome && (
          <Textarea
            value={value.rationale || ''}
            onChange={(e) => onChange?.({ ...value, rationale: e.target.value })}
            placeholder="Short note on the AML assessment…"
            className="text-xs min-h-12 resize-none bg-background"
          />
        )}
      </div>
    </div>
  );
}
