import { base44 } from '@/api/base44Client';

export const LOW_CONFIDENCE = 0.95;
export const isLowConfidence = (c) => c != null && c < LOW_CONFIDENCE;

const unwrap = (res) => res?.data ?? res;

export async function fetchCounterparties(filters) {
  return unwrap(await base44.functions.invoke('listCounterparties', { filters }));
}

export async function mergeCounterparty({ targetId, sourceId, reason }) {
  return unwrap(await base44.functions.invoke('mergeCounterparties', { action: 'merge', target_id: targetId, source_ids: [sourceId], reason }));
}

export async function unmergeCounterparty({ counterpartyId, reason }) {
  return unwrap(await base44.functions.invoke('mergeCounterparties', { action: 'unmerge', counterparty_id: counterpartyId, reason }));
}

export const errText = (e, fallback) => e?.response?.data?.error || e?.message || fallback;