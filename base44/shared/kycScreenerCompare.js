// Didit vs Claude comparison per party and list (sanctions / PEP / adverse media). Pure; reads stored Vitauri data only.
// Didit sources: ScreeningHit rows (client + related_party_id), the ID&V AML result on outreach items (NP client) and
// KybVerification.aml (ORG client). A discounted hit counts as cleared.
export const LISTS = ['sanctions', 'pep', 'adverse_media'];
const LIST_OF = { PEP_List: 'pep', Sanctions_EU: 'sanctions', Sanctions_UN: 'sanctions', Adverse_Media: 'adverse_media', Internal_Flag: 'sanctions' };
const OPEN = ['New', 'Under_Review', 'Escalated', 'Confirmed_Match'];
const approved = (st) => /approved|clear|pass/i.test(String(st || ''));

/** Didit view per party key: { [list]: { status: 'hit'|'clear'|'not_screened', detail } }. */
export function diditView({ client, parties, hits = [], idvAml = [], kyb = null }) {
  const out = {};
  for (const p of parties) {
    const rpId = p.key === 'client' ? null : p.key.slice(3);
    const mine = hits.filter((h) => (rpId ? h.related_party_id === rpId : h.client_id === client.id && !h.related_party_id));
    const view = {};
    for (const list of LISTS) {
      const rows = mine.filter((h) => LIST_OF[h.source] === list);
      const open = rows.filter((h) => OPEN.includes(h.status) && h.analyst_decision !== 'Discounted');
      if (open.length) view[list] = { status: 'hit', detail: open.slice(0, 3).map((h) => `${h.hit_name || h.entity_name} (${h.status === 'Confirmed_Match' ? 'confirmed' : 'open'}${h.confidence_score != null ? `, ${Math.round(h.confidence_score)}%` : ''})`).join('; ') };
      else if (rows.length) view[list] = { status: 'clear', detail: `${rows.length} hit(s) discounted` };
    }
    // Aggregate AML results (no per-list split): fill lists that have no hit rows.
    let agg = null;
    if (p.key === 'client' && client.client_type === 'ORG' && kyb?.aml) agg = { ok: approved(kyb.aml.status) && !Number(kyb.aml.total_hits), label: `Didit KYB AML ${kyb.aml.status || '—'} · ${Number(kyb.aml.total_hits) || 0} hit(s)` };
    else if (p.key === 'client' && idvAml.length) { const a = idvAml[0]; agg = { ok: approved(a.status) && !a.hits, label: `Didit ID&V AML ${a.status} · ${a.hits} hit(s)` }; }
    else if (rpId && p.didit_aml) agg = { ok: approved(p.didit_aml.status) && !p.didit_aml.hits, label: `Didit ID&V AML ${p.didit_aml.status} · ${p.didit_aml.hits} hit(s)` };
    for (const list of LISTS) {
      if (view[list]) continue;
      view[list] = agg ? { status: agg.ok ? 'clear' : 'hit', detail: agg.ok ? agg.label : `${agg.label} (list not specified)` } : { status: 'not_screened', detail: 'No Didit screening stored' };
    }
    out[p.key] = view;
  }
  return out;
}

/** agree_clear | agree_hit | claude_only | didit_only | review | claude_only_clear */
export function agreement(didit, claude) {
  const c = claude?.result || 'inconclusive';
  if (didit === 'hit' && c === 'hit') return 'agree_hit';
  if (didit === 'clear' && c === 'no_match') return 'agree_clear';
  if (c === 'hit') return 'claude_only';
  if (didit === 'hit') return 'didit_only';
  if (didit === 'not_screened' && c === 'no_match') return 'claude_only_clear';
  return 'review';
}

export function compareScreening({ client, parties, screening, hits, idvAml, kyb }) {
  const d = diditView({ client, parties, hits, idvAml, kyb });
  const rows = [];
  for (const p of screening.parties) {
    for (const list of LISTS) {
      const claude = p.checks[list];
      const dv = d[p.party_key]?.[list] || { status: 'not_screened', detail: '' };
      rows.push({
        party_key: p.party_key, party: p.name, role: p.role, list,
        didit: dv.status, didit_detail: dv.detail,
        claude: claude.result, claude_detail: claude.matches.map((m) => `${m.name_matched} — ${m.list_or_source} (${m.confidence}%)`).join('; '),
        sources: [...new Set(claude.matches.flatMap((m) => m.sources))].slice(0, 6),
        agreement: agreement(dv.status, claude),
      });
    }
  }
  const count = (a) => rows.filter((r) => r.agreement === a).length;
  return {
    rows,
    totals: { agree_clear: count('agree_clear'), agree_hit: count('agree_hit'), claude_only: count('claude_only'), didit_only: count('didit_only'), review: count('review'), claude_only_clear: count('claude_only_clear') },
  };
}

const RANK = { low: 0, medium: 1, high: 2, unacceptable: 3 };
export function compareRisk(claudeRating, vitauriClassification) {
  const v = String(vitauriClassification || '').toLowerCase();
  if (!v) return { claude: claudeRating, vitauri: null, relation: 'no_vitauri_rating' };
  const cr = RANK[claudeRating]; const vr = RANK[v];
  return { claude: claudeRating, vitauri: vitauriClassification, relation: cr === vr ? 'same' : cr > vr ? 'claude_higher' : 'claude_lower' };
}
