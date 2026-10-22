import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import RiskBadge from '@/components/shared/RiskBadge';
import { AlertTriangle, GitFork } from 'lucide-react';

const isUbo = (role) => /ubo|beneficial/i.test(role || '');
const isDirector = (role) => /director|board/i.test(role || '');
const label = (s) => (s ? String(s).replace(/_/g, ' ') : '—');
const SCREENING = { none: 'Not screened', clear: 'Clear', potential: 'Potential match', confirmed: 'Confirmed match' };
const SCREENING_CLS = { potential: 'text-amber-700', confirmed: 'font-semibold text-destructive' };

function Field({ name, value, clientId }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1.5 text-xs">
      <span className="text-muted-foreground">{name}</span>
      {value ? <span className="text-right font-medium">{value}</span> : (
        <span className="text-muted-foreground">Not recorded · <Link to={`/client/${clientId}?tab=profile`} className="text-primary hover:underline">Edit</Link></span>
      )}
    </div>
  );
}

function Chip({ children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
      <AlertTriangle className="h-3 w-3" /> {children}
    </span>
  );
}

/** KYB view for ORG customers: registry data, UBOs and directors, ownership warnings and related companies seen in transactions. */
export default function OwnershipControlCard({ client, relatedParties = [] }) {
  const { tenant } = useTenant();
  const show = isFeatureEnabled(tenant, 'tm_core') && client?.client_type === 'ORG';

  const { data: related } = useQuery({
    queryKey: ['related-companies', client?.id],
    enabled: show,
    retry: false,
    staleTime: 60000,
    queryFn: async () => (await base44.functions.invoke('getRelatedCompanies', { client_id: client.id })).data?.related_companies || [],
  });

  if (!show) return null;

  const ubos = relatedParties.filter((p) => isUbo(p.role)).sort((a, b) => (b.ownership_percentage ?? -1) - (a.ownership_percentage ?? -1));
  const directors = relatedParties.filter((p) => !isUbo(p.role) && isDirector(p.role));
  const rows = [...ubos, ...directors];
  const total = ubos.reduce((s, p) => s + (Number(p.ownership_percentage) || 0), 0);
  const chips = [];
  if (!ubos.length) chips.push('No UBO recorded');
  else if (total < 75 || total > 100) chips.push(`Ownership totals ${Math.round(total * 100) / 100}%`);
  ubos.filter((p) => p.verification_status !== 'Verified').forEach((p) => chips.push(`UBO not verified: ${p.full_name}`));

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Ownership &amp; control</h3>
        <Link to={`/entity-map/${client.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <GitFork className="h-3.5 w-3.5" /> Open entity map
        </Link>
      </div>

      <div className="grid gap-x-6 md:grid-cols-2">
        <Field name="Legal name" value={client.full_name} clientId={client.id} />
        <Field name="Registration number" value={client.registration_number} clientId={client.id} />
        <Field name="Legal form" value={client.legal_form} clientId={client.id} />
        <Field name="Registered country" value={client.registered_country} clientId={client.id} />
        <Field name="Registered address" value={client.registered_address} clientId={client.id} />
        <Field name="Sector" value={client.sector} clientId={client.id} />
        <Field name="Business activity" value={client.business_activity} clientId={client.id} />
        <Field name="Nature of business code" value={client.nature_of_business_code} clientId={client.id} />
      </div>

      {chips.length > 0 && <div className="flex flex-wrap gap-2">{chips.map((c) => <Chip key={c}>{c}</Chip>)}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Ownership</th>
              <th className="px-3 py-2">Nationality</th><th className="px-3 py-2">Country</th><th className="px-3 py-2">Verification</th>
              <th className="px-3 py-2">Risk</th><th className="px-3 py-2">Screening</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No UBOs or directors recorded</td></tr>
            ) : rows.map((p) => (
              <tr key={`${p.id}-${p.role}`}>
                <td className="px-3 py-2 font-medium">{p.full_name || '—'}</td>
                <td className="px-3 py-2">{p.role || '—'}</td>
                <td className="px-3 py-2 tabular-nums">{p.ownership_percentage != null ? `${p.ownership_percentage}%` : '—'}</td>
                <td className="px-3 py-2">{p.nationality || '—'}</td>
                <td className="px-3 py-2">{p.country_of_residence || '—'}</td>
                <td className="px-3 py-2">{label(p.verification_status)}</td>
                <td className="px-3 py-2"><RiskBadge risk={p.risk_classification} /></td>
                <td className={`px-3 py-2 ${SCREENING_CLS[p.screening_status] || ''}`}>{SCREENING[p.screening_status] || label(p.screening_status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold">Related companies seen in transactions</div>
        {!related ? <p className="text-xs text-muted-foreground">Loading…</p> : related.length === 0 ? (
          <p className="text-xs text-muted-foreground">None found.</p>
        ) : (
          <ul className="space-y-1.5">
            {related.map((cp) => (
              <li key={cp.id} className="text-xs">
                <span className="font-medium">{cp.display_name}</span>
                <span className="text-muted-foreground"> · {cp.reasons.map((r) => (r.type === 'related_party'
                  ? `matches related company ${r.name}`
                  : `shares ${label(r.identifier_type)} with ${r.client_name || 'another client'}`)).join('; ')}</span>
                {otherClientLink(cp)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Link to the other client when the match came from a shared identifier.
function otherClientLink(cp) {
  const other = cp.reasons.find((r) => r.type === 'identifier' && r.client_id);
  if (!other) return null;
  return <Link to={`/client/${other.client_id}`} className="ml-1 text-primary hover:underline">Open client</Link>;
}
