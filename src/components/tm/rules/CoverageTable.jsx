import React from 'react';
import { format } from 'date-fns';
import { userName } from '@/lib/tmRules';

const Row = ({ k, v }) => (
  <tr className="border-b border-border last:border-0 align-top">
    <td className="py-1.5 pr-3 text-muted-foreground w-32">{k}</td>
    <td className="py-1.5">{v}</td>
  </tr>
);

export default function CoverageTable({ rule, scenario, risk, owner }) {
  const codes = scenario?.fiu_indicator_codes || {};
  const fiu = [['CW', codes.CW], ['NL', codes.NL]].filter(([, l]) => l?.length).map(([c, l]) => `${c}: ${l.join(', ')}`).join(' · ');
  return (
    <table className="w-full text-sm mb-3">
      <tbody>
        <Row k="Risk" v={risk ? `${risk.code} · ${risk.name}` : '—'} />
        <Row k="Scenario" v={scenario ? `${scenario.code} · ${scenario.name}` : 'Not linked'} />
        <Row k="Required data" v={scenario?.required_data?.length ? scenario.required_data.join(', ') : '—'} />
        <Row k="FIU mapping" v={fiu || 'Not mapped'} />
        <Row k="Owner · review" v={`${userName(owner) || 'No owner'} · ${rule.review_date ? format(new Date(rule.review_date), 'dd MMM yyyy') : 'no review date'}`} />
      </tbody>
    </table>
  );
}