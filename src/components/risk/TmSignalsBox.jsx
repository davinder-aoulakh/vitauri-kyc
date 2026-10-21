import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { Checkbox } from '@/components/ui/checkbox';
import { Activity } from 'lucide-react';

const DAY = 86400000;
const CLOSED = ['closed_false_positive', 'closed_no_action', 'reported'];
const SECTIONS = ['alerts', 'risk_history', 'profiles', 'coverage', 'counterparty_hits'];

function Row({ id, checked, onToggle, children }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} className="mt-0.5" aria-label="Use as evidence" />
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer">{children}</label>
      <span className="text-[11px] text-muted-foreground flex-shrink-0">Use as evidence</span>
    </li>
  );
}

function Group({ title, children }) {
  return (
    <div>
      <h4 className="eyebrow mb-1">{title}</h4>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

// Builds every selectable signal: { ref, line (title: value, for the AI prompt) } plus display sections.
function buildSignals(data, client) {
  const now = Date.now();
  const history = data.risk_history || [];
  const latest = history[0];
  const baseline = history.find((h) => h.at && now - new Date(h.at).getTime() >= 30 * DAY);
  const score = latest?.score ?? client?.customer_risk_score ?? null;
  const band = latest?.band ?? client?.customer_risk_band ?? null;
  const delta = latest && baseline && score != null && baseline.score != null ? Math.round(score - baseline.score) : null;

  const alerts = data.alerts || [];
  const isBreach = (a) => a.source === 'profile_deviation' && a.created_date && now - new Date(a.created_date).getTime() <= 30 * DAY;
  const breaches = alerts.filter(isBreach);
  const open = alerts.filter((a) => !CLOSED.includes(a.status) && !isBreach(a));
  const groups = Object.values(open.reduce((acc, a) => {
    const k = a.title || 'Alert';
    (acc[k] ||= { title: k, items: [] }).items.push(a);
    return acc;
  }, {}));

  const gaps = [];
  const cov = data.coverage;
  if (cov && cov.missing > 0) gaps.push({ ref: 'gap:coverage', text: `${cov.missing} of ${cov.expected} expected data days missing in the last ${cov.days} days` });
  if (!(data.profiles || []).some((p) => p.status === 'approved')) gaps.push({ ref: 'gap:profile', text: 'No approved expected profile' });

  const hits = data.counterparty_hits || [];
  const lines = {};
  if (score != null) lines[`score:${latest?.at || 'current'}`] = `Customer risk score: ${Math.round(score)}${band ? ` (${band})` : ''}${delta != null ? `, ${delta >= 0 ? '+' : ''}${delta} vs 30 days ago` : ''}`;
  open.forEach((a) => { lines[`alert:${a.id}`] = `Open alert "${a.title}": score ${a.score ?? 'n/a'}`; });
  breaches.forEach((a) => { lines[`alert:${a.id}`] = `Profile breach "${a.title}": score ${a.score ?? 'n/a'}`; });
  hits.forEach((c) => { lines[`counterparty:${c.id}`] = `Counterparty ${c.display_name}: ${String(c.screening_status).replace(/_/g, ' ')}`; });
  gaps.forEach((g) => { lines[g.ref] = `Data gap: ${g.text}`; });

  return { score, band, delta, scoreRef: score != null ? `score:${latest?.at || 'current'}` : null, groups, breaches, hits, gaps, lines };
}

export default function TmSignalsBox({ client, onChange, initialRefs = [] }) {
  const { tenant } = useTenant();
  const on = isFeatureEnabled(tenant, 'tm_core');
  const [selected, setSelected] = useState(() => new Set(initialRefs));
  const cb = useRef(onChange);
  cb.current = onChange;

  const { data } = useQuery({
    queryKey: ['risk-tm-signals', client?.id],
    enabled: on && !!client?.id,
    retry: false,
    queryFn: async () => (await base44.functions.invoke('getCustomerFile', { client_id: client.id, sections: SECTIONS })).data,
  });

  const s = useMemo(() => (data ? buildSignals(data, client) : null), [data, client]);

  useEffect(() => {
    if (!s) return;
    const refs = [...selected];
    cb.current?.(refs, refs.map((r) => s.lines[r]).filter(Boolean));
  }, [selected, s]);

  if (!on || !s) return null;
  const hasData = s.score != null || s.groups.length || s.breaches.length || s.hits.length || (data.profiles || []).length;
  if (!hasData) return null;

  const toggle = (ref) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(ref) ? next.delete(ref) : next.add(ref);
    return next;
  });
  const chk = (ref) => selected.has(ref);

  return (
    <section className="bg-card border border-border rounded-xl p-4 mb-4 space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Transaction monitoring signals</h3>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">For reference. These do not change indicator scores. Tick a signal to save it as evidence on your assessments.</p>

      {s.scoreRef && (
        <Group title="Dynamic customer risk">
          <Row id="tm-score" checked={chk(s.scoreRef)} onToggle={() => toggle(s.scoreRef)}>
            <span className="font-semibold tabular-nums">{Math.round(s.score)}</span>
            {s.band && <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted">{s.band}</span>}
            {s.delta != null && <span className="ml-2 text-xs text-muted-foreground">{s.delta >= 0 ? '+' : ''}{s.delta} in 30 days</span>}
          </Row>
        </Group>
      )}

      {s.groups.length > 0 && (
        <Group title="Open alerts by scenario">
          {s.groups.map((g) => (
            <li key={g.title} className="py-1.5">
              <div className="text-sm font-medium">{g.title} <span className="text-xs text-muted-foreground font-normal">· {g.items.length} open · max score {Math.max(...g.items.map((a) => a.score ?? 0))}</span></div>
              <ul className="pl-1">
                {g.items.map((a) => (
                  <Row key={a.id} id={`tm-a-${a.id}`} checked={chk(`alert:${a.id}`)} onToggle={() => toggle(`alert:${a.id}`)}>
                    <span className="text-xs">Alert score {a.score ?? '–'} · {String(a.status).replace(/_/g, ' ')}</span>
                  </Row>
                ))}
              </ul>
            </li>
          ))}
        </Group>
      )}

      {s.breaches.length > 0 && (
        <Group title="Profile breaches (last 30 days)">
          {s.breaches.map((a) => (
            <Row key={a.id} id={`tm-b-${a.id}`} checked={chk(`alert:${a.id}`)} onToggle={() => toggle(`alert:${a.id}`)}>{a.title}</Row>
          ))}
        </Group>
      )}

      {s.hits.length > 0 && (
        <Group title="Counterparty screening hits">
          {s.hits.map((c) => (
            <Row key={c.id} id={`tm-c-${c.id}`} checked={chk(`counterparty:${c.id}`)} onToggle={() => toggle(`counterparty:${c.id}`)}>
              {c.display_name} <span className="text-xs text-muted-foreground">· {String(c.screening_status).replace(/_/g, ' ')}</span>
            </Row>
          ))}
        </Group>
      )}

      {s.gaps.length > 0 && (
        <Group title="Data coverage gaps">
          {s.gaps.map((g) => <Row key={g.ref} id={`tm-g-${g.ref}`} checked={chk(g.ref)} onToggle={() => toggle(g.ref)}>{g.text}</Row>)}
        </Group>
      )}
    </section>
  );
}