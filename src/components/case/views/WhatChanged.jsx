import React from 'react';
import SourceChips from '@/components/tm/kit/SourceChips';

// Internal keys the reviewer does not need to see as "changes".
const HIDDEN = new Set(['summary', 'tm_alert_ids', 'didit_transaction_id', 'didit_session_id', 'related_party_id']);
const LABEL = {
  full_name: 'Name', role: 'Role', ownership_percentage: 'Ownership %', business_activity: 'Business activity',
  country_of_residence: 'Country of residence', registered_country: 'Registered country', nationality: 'Nationality',
  band: 'Risk band', score: 'Risk score', tm_alert_id: 'Alert', tm_case_id: 'TM case', tm_case_ref: 'TM case',
  co_decision: 'CO decision', transaction_id: 'Transaction', session_status: 'Verification status',
};
const show = (v) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Before → after of the trigger that opened this review (from KycCase.tm_context.trigger), plus its sources. */
export default function WhatChanged({ trigger }) {
  if (!trigger) return null;
  const before = trigger.before || {};
  const after = trigger.after || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN.has(k));
  const refs = [
    after.tm_alert_id && `alert:${after.tm_alert_id}`,
    ...(Array.isArray(after.tm_alert_ids) ? after.tm_alert_ids.map((id) => `alert:${id}`) : []),
    after.transaction_id && `txn:${after.transaction_id}`,
  ].filter(Boolean);
  return (
    <div className="mt-2 rounded-md bg-white/60 dark:bg-black/10 px-3 py-2 text-xs">
      <div className="font-semibold mb-1">What changed · {trigger.label || trigger.type}</div>
      {trigger.summary && <p className="mb-1.5">{trigger.summary}</p>}
      {keys.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="text-left opacity-70"><th className="pr-3 font-medium">Field</th><th className="pr-3 font-medium">Before</th><th className="font-medium">After</th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td className="pr-3 py-0.5 opacity-80">{LABEL[k] || k.replace(/_/g, ' ')}</td>
                <td className="pr-3 py-0.5 line-through opacity-70">{show(before[k])}</td>
                <td className="py-0.5 font-medium">{show(after[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {refs.length > 0 && <div className="mt-1.5"><SourceChips refs={refs} /></div>}
    </div>
  );
}
