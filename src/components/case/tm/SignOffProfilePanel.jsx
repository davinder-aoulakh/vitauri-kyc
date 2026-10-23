import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { canDecideProfile } from '@/lib/profileApproval';
import { PROFILE_FIELDS, showValue } from '@/components/case/tm/ExpectedProfileEditor';
import { LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);

/** Sign-off view of the case's expected profile: proposed vs current, and whether this approver also approves it. */
export default function SignOffProfilePanel({ kycCase, client, currentUser }) {
  const { tenant } = useTenant();
  const tmOn = isFeatureEnabled(tenant, 'tm_core');
  const { data } = useQuery({
    queryKey: ['signoff-profile', kycCase?.id],
    enabled: tmOn && !!kycCase?.id,
    queryFn: async () => {
      const [mine, approved] = await Promise.all([
        base44.entities.ExpectedProfile.filter({ client_id: kycCase.client_id, case_id: kycCase.id }, '-version', 5).then(list),
        base44.entities.ExpectedProfile.filter({ client_id: kycCase.client_id, status: 'approved' }, '-version', 1).then(list),
      ]);
      return { draft: mine.find((p) => ['draft', 'proposed'].includes(p.status)) || null, approved: approved[0] || null };
    },
  });
  if (!tmOn || !data) return null;
  const { draft, approved } = data;
  if (!draft) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LineChart className="w-3.5 h-3.5" /> No expected profile was recorded in step 4; one is proposed automatically from the case data at sign-off.
      </p>
    );
  }
  const cur = draft.currency || approved?.currency || 'USD';
  const canApprove = canDecideProfile({ role: currentUser?.app_role, userId: currentUser?.id, tenant, riskClass: client?.risk_classification || kycCase?.risk_classification, proposedBy: draft.proposed_by_user_id });
  const rows = PROFILE_FIELDS.filter((f) => draft[f.key] != null || approved?.[f.key] != null);
  return (
    <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold"><LineChart className="w-3.5 h-3.5 text-teal-600" /> Expected profile v{draft.version}{approved ? ` (replaces v${approved.version})` : ''}</div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((f) => {
            const changed = JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(approved?.[f.key] ?? null);
            return (
              <tr key={f.key}>
                <td className="py-0.5 pr-2 text-muted-foreground">{f.label}</td>
                {approved && <td className="py-0.5 pr-2 text-muted-foreground line-through">{changed ? showValue(f, approved[f.key], cur) : ''}</td>}
                <td className={cn('py-0.5 font-medium', changed && 'text-amber-800 dark:text-amber-200')}>{showValue(f, draft[f.key], cur)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {draft.rationale && <p className="text-xs"><span className="text-muted-foreground">Rationale: </span>{draft.rationale}</p>}
      <p className="text-xs text-muted-foreground">
        {canApprove
          ? 'Approving this case also approves this expected profile (recorded as a separate profile decision).'
          : 'Approving this case proposes the profile; it then waits in My work for an approver with the right authority.'}
      </p>
    </div>
  );
}
