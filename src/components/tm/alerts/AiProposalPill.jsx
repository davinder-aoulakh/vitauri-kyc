import React from 'react';
import { PROPOSAL_LABEL, shortId } from '@/lib/tmAlerts';

/** Purple pill: "Escalate · first reason". Reasons, never percentages. */
export default function AiProposalPill({ alert }) {
  if (!alert.ai_proposal) return <span className="text-xs text-muted-foreground">Not triaged</span>;
  const reason = alert.ai_reasons?.[0];
  const text = reason ? `${PROPOSAL_LABEL[alert.ai_proposal]} · ${reason}` : PROPOSAL_LABEL[alert.ai_proposal];
  return (
    <span
      title={alert.ai_reasons?.join(' • ') || shortId(alert)}
      className="inline-block max-w-[320px] line-clamp-2 align-middle text-[11px] font-medium px-2.5 py-1 rounded-xl bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200"
    >
      {text}
    </span>
  );
}