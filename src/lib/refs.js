// Source references used by AI and evidence ("txn:<id>", "alert:<id>", ...) → readable labels and routes.
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toAlert, toClient, toCoverage, toKycCase, toRule } from '@/lib/routes';

export function parseRef(ref) {
  const s = String(ref || '');
  const i = s.indexOf(':');
  if (i < 0) return { kind: s, id: '' };
  const kind = s.slice(0, i);
  return { kind: kind === 'cp' ? 'counterparty' : kind, id: s.slice(i + 1).split(':')[0] };
}

// kind → entity + how to label and route a loaded record.
const KINDS = {
  alert: {
    entity: 'TmAlert',
    label: (r) => `${r.ref || alertRef(r.id)} · ${r.title || 'Alert'}`,
    route: (r) => toAlert(r.id),
  },
  txn: {
    entity: 'Transaction',
    label: (r) => [
      'Transaction',
      r.executed_at ? new Date(r.executed_at).toLocaleDateString() : null,
      r.amount != null ? `${Number(r.amount).toLocaleString()} ${r.currency || ''}`.trim() : null,
      r.counterparty_name || null,
    ].filter(Boolean).join(' · '),
    route: (r) => (r.client_id ? toClient(r.client_id, 'transactions') : null),
  },
  client: { entity: 'Client', label: (r) => r.full_name || 'Customer', route: (r) => toClient(r.id) },
  kyc: {
    entity: 'KycCase',
    label: (r) => `KYC file · ${String(r.case_type || 'case').replace(/_/g, ' ')}`,
    route: (r) => toKycCase(r.id),
  },
  profile: {
    entity: 'ExpectedProfile',
    label: (r) => `Expected profile v${r.version ?? '?'}${r.status && r.status !== 'approved' ? ` (${r.status})` : ''}`,
    route: (r) => (r.client_id ? toClient(r.client_id, 'profile') : null),
  },
  screening: {
    entity: 'ScreeningHit',
    label: (r) => `Screening · ${r.hit_name || r.source || 'hit'}`,
    route: (r) => (r.case_id ? toKycCase(r.case_id, 3) : null),
  },
  counterparty: { entity: 'Counterparty', label: (r) => `Counterparty · ${r.display_name || '—'}`, route: () => null },
  coverage: {
    entity: 'BankAccount',
    label: (r) => `Data coverage · ${[r.institution, r.iban_or_number].filter(Boolean).join(' ') || 'account'}`,
    route: (r) => toCoverage(r.id),
  },
  rule: { entity: 'TmRule', label: (r) => `Rule · ${r.name || '—'}${r.version ? ` v${r.version}` : ''}`, route: (r) => toRule(r.id) },
};

const STATIC_LABEL = { monthly_totals: 'Monthly totals', evidence: 'Case evidence' };

/** Short readable alert reference when the stored ref is missing. */
export const alertRef = (id) => `AL-${String(id || '').slice(-4).toUpperCase()}`;

/** Fallback label when the record is not loaded (or not resolvable). */
export function fallbackLabel(ref) {
  const { kind } = parseRef(ref);
  if (STATIC_LABEL[kind]) return STATIC_LABEL[kind];
  return { alert: 'Alert', txn: 'Transaction', client: 'Customer', kyc: 'KYC file', profile: 'Expected profile', screening: 'Screening hit', counterparty: 'Counterparty', coverage: 'Data coverage', rule: 'Rule' }[kind] || 'Source';
}

/**
 * Batch-resolve refs to { [ref]: { label, to } }. One query per kind (ids $in), cached by react-query.
 * Unknown kinds and records the user cannot read fall back to a generic label without a link.
 */
export function useRefLabels(refs) {
  const list = [...new Set((refs || []).filter(Boolean).map(String))].sort();
  return useQuery({
    queryKey: ['ref-labels', list],
    enabled: list.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const byKind = {};
      for (const ref of list) {
        const { kind, id } = parseRef(ref);
        if (KINDS[kind] && id) (byKind[kind] ||= new Set()).add(id);
      }
      const loaded = {};
      await Promise.all(Object.entries(byKind).map(async ([kind, ids]) => {
        try {
          const res = await base44.entities[KINDS[kind].entity].filter({ id: { $in: [...ids] } }, undefined, ids.size);
          const rows = Array.isArray(res) ? res : (res?.items || []);
          for (const r of rows) loaded[`${kind}:${r.id}`] = r;
        } catch { /* not readable for this user: generic label */ }
      }));
      const out = {};
      for (const ref of list) {
        const { kind, id } = parseRef(ref);
        const rec = loaded[`${kind}:${id}`];
        out[ref] = rec ? { label: KINDS[kind].label(rec), to: KINDS[kind].route(rec) } : { label: fallbackLabel(ref), to: null };
      }
      return out;
    },
  });
}
