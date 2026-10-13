import React from 'react';
import { Sparkles } from 'lucide-react';

const LIMITS = [
  ['inbound_max_month', 'Inbound / month'],
  ['inbound_max_count_month', 'Inbound count / month'],
  ['outbound_foreign_max_month', 'Outbound foreign / month'],
  ['cash_max_month', 'Cash / month'],
];

export default function AiConclusionBox({ analysis, profileVersion }) {
  const limits = analysis.proposed_profile_limits || {};
  const version = profileVersion ?? analysis.proposed_profile_version;
  return (
    <div className="space-y-3 rounded-xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900 dark:bg-purple-950/30">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
        <Sparkles className="w-3.5 h-3.5" /> AI conclusion on source of funds
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed">{analysis.ai_conclusion || '—'}</p>
      {analysis.insufficient_evidence && (
        <p className="text-xs text-amber-700">Insufficient evidence{analysis.missing?.length ? `: ${analysis.missing.join('; ')}` : ''}</p>
      )}
      <div className="border-t border-purple-200 pt-3 dark:border-purple-900">
        <div className="mb-1.5 text-xs font-semibold">Proposed expected profile{version ? ` v${version}` : ''}</div>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {LIMITS.map(([k, label]) => (
            <div key={k} className="flex justify-between border-b border-purple-200/60 py-1 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{limits[k] != null ? Number(limits[k]).toLocaleString() : '—'}</span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 text-xs"><span className="text-muted-foreground">Countries: </span>{limits.allowed_countries?.join(', ') || '—'}</div>
        <p className="mt-2 text-[11px] italic text-muted-foreground">Written as a separate section in the KYC report.</p>
      </div>
    </div>
  );
}