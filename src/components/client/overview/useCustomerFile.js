import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

// Sections used by the customer-file Overview, the Cases tab and the header. One shared query per client.
const SECTIONS = ['related_parties', 'tm_cases', 'alerts', 'fiu_reports', 'fiu_artefacts', 'edr_triggers', 'timeline'];

export function useCustomerFile(clientId, enabled) {
  return useQuery({
    queryKey: ['customer-file-overview', clientId],
    enabled: !!enabled && !!clientId,
    retry: false,
    staleTime: 30000,
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerFile', { client_id: clientId, sections: SECTIONS });
      return res?.data ?? res;
    },
  });
}
