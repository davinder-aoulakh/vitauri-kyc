// Outreach questions that fill a KYC field are checked in the Profile Verification panel, not in the outreach list.
// These helpers say which KYC field(s) such an item belongs to, how far that check is, and which items can be set to
// Verified because their field is settled. Pure (no I/O).
import { isFieldMappedLabel } from '@/lib/outreachFieldMatch';
import { sameProfileValue } from '@/lib/profileValueMatch';
import { getNestedValue } from '@/lib/clientNameUtils';

const OPEN = ['suggested', 'low_confidence', 'conflict', 'info_requested'];
const has = (v) => v != null && String(v).trim() !== '' && v !== 'null';

/** KYC field keys an outreach item fills: by its profile_field link, else by its label. [] when it is a free question. */
export function linkedFieldKeys(item, fieldLabels) {
  if (!item || item.field_type === 'id_verification' || item.field_type === 'kyb_verification') return [];
  const keys = Object.keys(fieldLabels || {});
  if (item.profile_field) return keys.filter((k) => k === item.profile_field || k.startsWith(`${item.profile_field}.`));
  return keys.filter((k) => isFieldMappedLabel(item.label, { [k]: fieldLabels[k] }));
}

/**
 * State of the KYC check for one linked item: 'settled' | 'open' | 'waiting'.
 *  settled: no linked field is waiting for a decision, and at least one is confirmed / decided, or the client's answer
 *           equals what the client file already holds;
 *  open:    a suggestion waits for the analyst (suggested, low confidence, conflict, info requested);
 *  waiting: nothing to decide yet (the pipeline has not offered the answer and the file is empty).
 */
export function linkedItemState(item, fieldLabels, suggestions, client) {
  const keys = linkedFieldKeys(item, fieldLabels);
  if (!keys.length) return { state: 'none', keys };
  const fields = suggestions?.client_fields || {};
  const statuses = keys.map((k) => fields[k]?.status || null);
  if (statuses.some((s) => OPEN.includes(s))) return { state: 'open', keys, conflict: statuses.includes('conflict') };
  const decided = statuses.some((s) => s === 'confirmed' || s === 'rejected');
  const answer = item.response_value != null && typeof item.response_value !== 'object' ? item.response_value : item.response_text;
  const equalsFile = keys.length === 1 && has(answer) && sameProfileValue(keys[0], getNestedValue(client, keys[0]), answer);
  // Structured address: every part the client gave equals the file
  const addr = item.response_value && typeof item.response_value === 'object' ? item.response_value : null;
  const addrEquals = !!addr && keys.length > 1 && keys.some((k) => has(addr[k.split('.')[1]]))
    && keys.every((k) => { const part = addr[k.split('.')[1]]; return !has(part) || sameProfileValue(k, getNestedValue(client, k), part); });
  return { state: decided || equalsFile || addrEquals ? 'settled' : 'waiting', keys };
}

/** [{ requestId, index, label }] — answered linked items whose KYC field is settled and that are not Verified yet. */
export function linkedItemsToVerify(requests, fieldLabels, suggestions, client) {
  const out = [];
  for (const req of requests || []) {
    (req.items || []).forEach((item, index) => {
      if (item.status !== 'Received') return;
      if (linkedItemState(item, fieldLabels, suggestions, client).state === 'settled') out.push({ requestId: req.id, index, itemId: item.item_id, label: item.label });
    });
  }
  return out;
}
