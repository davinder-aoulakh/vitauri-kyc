// Guided conversation outreach, phase 10: the mirror (plan decision 10). Signed answers are copied into the carrier's
// OutreachRequest.items[] so the classic "Outreach & Documents" step, profile suggestions, QC, risk facts and every other
// reader of outreach answers keep working. Decision (20 Nov): every datapoint is mirrored; only datapoints with a
// profile_field carry the link (so only they create profile suggestions). One item per evidence file. The 'idv' item
// belongs to the Didit functions and is never touched; the mirror replaces only its own items (dp:*, ev:*).
// Pure except applyMirror (service-role entities passed in).

const FIELD_TYPE = { address: 'address', phone: 'phone', email: 'email', date: 'date', file: 'file_upload', multi: 'multi_select', choice: 'dropdown', number: 'number', area: 'textarea' };
export const MIRROR_PREFIXES = ['dp:', 'ev:'];
const own = (id) => MIRROR_PREFIXES.some((p) => String(id || '').startsWith(p));

/** The block datapoint definition for a datapoint key (for type and profile_field). */
function defOf(blocks, row) {
  const b = blocks?.[row.block_key];
  const list = b?.datapoints || [];
  return list.find((d) => d.key === row.key) || list.find((d) => String(d.key || '').includes('{') && new RegExp(`^${String(d.key).replace(/\{[^}]+\}/g, '.+')}$`).test(row.key)) || null;
}

const asText = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if (v.street || v.city || v.postcode) return [`${v.street || ''} ${v.number || ''}`.trim(), `${v.postcode || ''} ${v.city || ''}`.trim(), v.country || ''].filter(Boolean).join(', ');
    return Object.values(v).map(asText).filter(Boolean).join(', ');
  }
  return String(v);
};

/**
 * Items for the carrier. datapoints: OutreachDatapoint rows; evidence: OutreachEvidence rows; blocks: blocks_snapshot.
 * Deferred or empty datapoints are skipped; files without a file_uri are skipped.
 */
export function mirrorItems({ datapoints = [], evidence = [], blocks = {}, now = new Date().toISOString() }) {
  const items = [];
  for (const row of datapoints) {
    if (!row?.key || row.status === 'deferred') continue;
    const def = defOf(blocks, row) || {};
    if (def.type === 'file') continue; // files come from the evidence rows
    let value = row.value && typeof row.value === 'object' && 'v' in row.value ? row.value.v : row.value;
    // the conversation's address uses postcode; the KYC address uses zipcode (readers of response_value expect it)
    if (value && typeof value === 'object' && !Array.isArray(value) && 'postcode' in value && !('zipcode' in value)) value = { ...value, zipcode: value.postcode };
    const text = String(row.display_value ?? asText(value) ?? '').trim();
    if (!text && (value == null || value === '')) continue;
    items.push({
      item_id: `dp:${row.key}`, label: row.label || def.label || row.key, field_type: FIELD_TYPE[def.type] || 'text', item_type: 'data_point',
      ...(def.profile_field ? { profile_field: def.profile_field } : {}),
      response_text: text, response_value: value ?? null, status: 'Received', received_at: row.updated_date || now,
      source: row.source || 'client', block_key: row.block_key || null, origin: 'conversation',
    });
  }
  for (const ev of evidence) {
    if (!ev?.id || !ev.file_uri) continue;
    const label = blocks?.[String(ev.block_key || '').split(':')[0]]?.label || ev.datapoint_key || 'Document';
    items.push({
      item_id: `ev:${ev.id}`, label: `${label}: ${ev.name || 'file'}`, field_type: 'file_upload', item_type: 'document',
      file_url: ev.file_uri, file_name: ev.name || 'file', response_text: ev.name || '', status: 'Received',
      received_at: ev.uploaded_at || ev.created_date || now, source: 'doc', block_key: ev.block_key || null, origin: 'conversation',
      ...(ev.document_id ? { document_id: ev.document_id } : {}),
    });
  }
  return items;
}

/**
 * Replaces the mirror's own items by item_id and keeps every other item as it is (idv first, as created). An item the
 * staff already verified keeps its status when the mirrored value did not change.
 */
export function mergeItems(existing = [], mirrored = []) {
  const prev = new Map(existing.filter((i) => own(i.item_id)).map((i) => [i.item_id, i]));
  const keep = existing.filter((i) => !own(i.item_id));
  const next = mirrored.map((m) => {
    const p = prev.get(m.item_id);
    if (p && p.status === 'Verified' && p.response_text === m.response_text && (p.file_url || '') === (m.file_url || '')) return { ...m, status: 'Verified', ...(p.verified_at ? { verified_at: p.verified_at } : {}), ...(p.verified_by ? { verified_by: p.verified_by } : {}) };
    return m;
  });
  return [...keep, ...next];
}

/** Server: mirror one conversation into its carrier. complete=true at submission (carrier status Complete). */
export async function applyMirror(E, { conversation, request, complete = false }) {
  const tenantId = conversation.tenant_id;
  const asList = (r) => (Array.isArray(r) ? r : r?.items || r?.data || []);
  const [dps, evs] = await Promise.all([
    E.OutreachDatapoint.filter({ tenant_id: tenantId, conversation_id: conversation.id }, undefined, 500).then(asList),
    E.OutreachEvidence.filter({ tenant_id: tenantId, conversation_id: conversation.id }, undefined, 200).then(asList),
  ]);
  const fresh = asList(await E.OutreachRequest.filter({ tenant_id: tenantId, id: request.id }, undefined, 1))[0] || request;
  const items = mergeItems(fresh.items || [], mirrorItems({ datapoints: dps, evidence: evs, blocks: conversation.blocks_snapshot || {} }));
  await E.OutreachRequest.update(request.id, { items, ...(complete ? { status: 'Complete' } : {}) });
  return { items: items.length, mirrored: items.filter((i) => own(i.item_id)).length };
}
