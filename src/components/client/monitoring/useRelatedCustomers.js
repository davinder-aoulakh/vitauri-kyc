import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { OPEN_STATUSES } from '@/lib/tmAlerts';

const asList = (r) => (Array.isArray(r) ? r : r?.items || []);
const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * For related parties (UBOs, directors, related companies) that are themselves customers of the tenant, return
 * { [relatedPartyId]: { client_id, name, band, score, open_alerts } }.
 * A party is a customer when a counterparty was linked to both, its registration number matches, or its full name matches exactly.
 */
export function useRelatedCustomers({ tenantId, parties = [], excludeClientId, enabled = true }) {
  const ids = [...new Set(parties.map((p) => p.id).filter(Boolean))].sort();
  return useQuery({
    queryKey: ['related-customers', tenantId, ids],
    enabled: enabled && !!tenantId && ids.length > 0,
    staleTime: 60000,
    retry: false,
    queryFn: async () => {
      const names = [...new Set(parties.map((p) => p.full_name).filter(Boolean))];
      const regs = [...new Set(parties.map((p) => p.registration_number).filter(Boolean))];
      const [linkedCps, byName, byReg] = await Promise.all([
        base44.entities.Counterparty.filter({ tenant_id: tenantId, related_party_id: { $in: ids } }, undefined, 200).then(asList).catch(() => []),
        names.length ? base44.entities.Client.filter({ tenant_id: tenantId, full_name: { $in: names } }, undefined, 200).then(asList).catch(() => []) : [],
        regs.length ? base44.entities.Client.filter({ tenant_id: tenantId, registration_number: { $in: regs } }, undefined, 200).then(asList).catch(() => []) : [],
      ]);
      const clients = {};
      [...byName, ...byReg].forEach((c) => { clients[c.id] = c; });
      const match = {};
      for (const p of parties) {
        const cp = linkedCps.find((x) => x.related_party_id === p.id && x.client_id);
        const c = (cp && (clients[cp.client_id] || { id: cp.client_id }))
          || (p.registration_number && byReg.find((x) => x.registration_number === p.registration_number))
          || byName.find((x) => norm(x.full_name) === norm(p.full_name));
        if (c && c.id !== excludeClientId) match[p.id] = { client_id: c.id, name: c.full_name || p.full_name };
      }
      const clientIds = [...new Set(Object.values(match).map((m) => m.client_id))];
      if (!clientIds.length) return {};
      const [scores, alerts] = await Promise.all([
        base44.entities.CustomerRiskScore.filter({ tenant_id: tenantId, client_id: { $in: clientIds } }, '-computed_at', 200).then(asList).catch(() => []),
        base44.entities.TmAlert.filter({ tenant_id: tenantId, client_id: { $in: clientIds }, status: { $in: OPEN_STATUSES } }, undefined, 500).then(asList).catch(() => []),
      ]);
      for (const m of Object.values(match)) {
        const s = scores.find((x) => x.client_id === m.client_id);
        m.band = s?.band || null;
        m.score = s?.score ?? null;
        m.open_alerts = alerts.filter((a) => a.client_id === m.client_id).length;
      }
      return match;
    },
  });
}
