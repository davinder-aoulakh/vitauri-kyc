import React from 'react';
import { cn } from '@/lib/utils';

// One tone map for every KYC/TM status pill. Colour is always paired with text (never colour alone).
export const TONES = {
  neutral: 'bg-secondary text-muted-foreground border-border',
  info: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/30',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/30',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
  danger: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30',
  ai: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/30',
  teal: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-200 dark:border-teal-500/30',
};

// status value → [label, tone]. Keys are the raw enum values used across TmAlert, TmCase, FiuReport,
// TmRule, ExpectedProfile, EdrTrigger, coverage matrix and Didit transactions.
const STATUS = {
  // alerts
  new: ['New', 'info'], triaged: ['Triaged', 'info'], in_review: ['In review', 'warning'], escalated: ['Escalated', 'danger'],
  closed_false_positive: ['Closed · false positive', 'neutral'], closed_no_action: ['Closed · no action', 'neutral'], reported: ['Reported', 'success'],
  // TM cases
  open: ['Open', 'info'], investigating: ['Investigating', 'warning'], pending_co: ['Pending CO decision', 'warning'],
  decided_report: ['Decided: report', 'danger'], decided_no_report: ['Decided: no report', 'success'], closed: ['Closed', 'neutral'],
  // FIU reports
  draft: ['Draft', 'neutral'], approved: ['Approved', 'success'], generated: ['Generated', 'info'], submitted: ['Submitted', 'info'],
  received: ['Received', 'success'], accepted: ['Accepted', 'success'], rejected: ['Rejected', 'danger'],
  // rules / profiles / EDR
  test: ['Test', 'warning'], active: ['Active', 'success'], disabled: ['Disabled', 'neutral'], retired: ['Retired', 'neutral'],
  proposed: ['Proposed', 'warning'], superseded: ['Superseded', 'neutral'], dismissed: ['Dismissed', 'neutral'],
  synced: ['Synced', 'success'], not_synced: ['Not synced', 'neutral'], failed: ['Failed', 'danger'], drift: ['Drift', 'warning'],
  requested: ['Approval requested', 'warning'],
  // coverage matrix
  covered: ['Covered', 'success'], partial: ['Partial', 'warning'], gap: ['Gap', 'danger'], no_data: ['No data', 'neutral'],
  // Didit transaction status
  APPROVED: ['Approved', 'success'], IN_REVIEW: ['In review', 'warning'], DECLINED: ['Declined', 'danger'],
  AWAITING_USER: ['Awaiting customer', 'warning'], PENDING: ['Pending', 'neutral'],
};

export function statusMeta(status) {
  const key = String(status ?? '');
  const hit = STATUS[key] || STATUS[key.toLowerCase().replace(/[\s-]+/g, '_')];
  return hit ? { label: hit[0], tone: hit[1] } : { label: key.replace(/_/g, ' ') || '—', tone: 'neutral' };
}

/** <StatusPill status="pending_co" /> or <StatusPill tone="ai">Custom</StatusPill>. */
export default function StatusPill({ status, tone, children, className, title }) {
  const meta = statusMeta(status);
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', TONES[tone || meta.tone], className)}
    >
      {children ?? meta.label}
    </span>
  );
}
