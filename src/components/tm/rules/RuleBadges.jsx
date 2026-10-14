import React from 'react';
import { cn } from '@/lib/utils';
import { MODE_LABEL, MODE_TONE, SYNC_LABEL, SYNC_TONE, APPROVAL_LABEL, APPROVAL_TONE } from '@/lib/tmRules';

const Pill = ({ tone, children, title }) => (
  <span title={title} className={cn('inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap', tone)}>{children}</span>
);

export const ModeBadge = ({ mode }) => <Pill tone={MODE_TONE[mode] || MODE_TONE.draft}>{MODE_LABEL[mode] || mode}</Pill>;
export const SyncBadge = ({ rule }) => {
  const s = rule.sync_status || 'not_synced';
  return <Pill tone={SYNC_TONE[s]} title={rule.sync_error || undefined}>{SYNC_LABEL[s]}</Pill>;
};
export const ApprovalBadge = ({ status }) => <Pill tone={APPROVAL_TONE[status || 'not_requested']}>{APPROVAL_LABEL[status || 'not_requested']}</Pill>;