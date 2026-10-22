import { base44 } from '@/api/base44Client';
import { isFeatureEnabled } from '@/lib/featureFlags';

export const EDR_CLIENT_FIELDS = ['business_activity', 'sector', 'country_of_residence', 'registered_country'];
export const pickEdrClientFields = (c) => Object.fromEntries(EDR_CLIENT_FIELDS.map((k) => [k, c?.[k] ?? null]));
export const edrParty = (p, link) => (p ? {
  related_party_id: p.id, full_name: p.full_name,
  role: link?.role || p.role_in_relationship || null,
  ownership_percentage: link?.ownership_percentage ?? p.ownership_percentage ?? null,
} : null);

/**
 * Ask the backend to check a saved change for event-driven review triggers. Only with tm_core.
 * Call after the existing save succeeded; it never throws and never blocks the save.
 * change: { type: 'client_profile'|'related_party', source_ref, before, after }
 */
export function reportEdrChange(tenant, clientId, change) {
  if (!clientId || !isFeatureEnabled(tenant, 'tm_core')) return Promise.resolve();
  return base44.functions.invoke('evaluateEdrTriggers', { mode: 'change', client_id: clientId, change })
    .catch((e) => console.warn('evaluateEdrTriggers failed (save unaffected):', e?.message));
}
