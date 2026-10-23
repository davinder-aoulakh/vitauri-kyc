import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toAlert, toClient, toClientView, toKycCase, toReport, toTmCase, toReviewPlanner } from '@/lib/routes';

/** The signed-in user's work queue (getMyWork). Shared by the My work page and the sidebar badge. */
export function useMyWork(tenantId, enabled = true) {
  return useQuery({
    queryKey: ['myWork', tenantId],
    enabled: !!tenantId && enabled,
    staleTime: 60000,
    refetchInterval: 120000,
    queryFn: async () => (await base44.functions.invoke('getMyWork', {}))?.data || { items: [], due_now: 0 },
  });
}

export const WORK_KINDS = [
  { key: 'alert', label: 'TM alerts' },
  { key: 'tm_case', label: 'TM cases' },
  { key: 'kyc_case', label: 'KYC cases' },
  { key: 'edr', label: 'Review proposals' },
  { key: 'profile', label: 'Profile approvals' },
  { key: 'fiu_report', label: 'FIU reports' },
  { key: 'outreach', label: 'Customer replies' },
];

/** Where a work item opens. */
export function workItemRoute(item) {
  switch (item.kind) {
    case 'alert': return toAlert(item.id);
    case 'tm_case': return toTmCase(item.id);
    case 'kyc_case': return toKycCase(item.id);
    case 'edr': return item.client_id ? toClient(item.client_id) : toReviewPlanner('edr');
    case 'profile': return item.client_id ? toClientView(item.client_id, 'profile') : null;
    case 'fiu_report': return toReport(item.id);
    case 'outreach': return item.kyc_case_id ? toKycCase(item.kyc_case_id, 1) : null;
    default: return null;
  }
}
