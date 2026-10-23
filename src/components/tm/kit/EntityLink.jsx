import React from 'react';
import { Link } from 'react-router-dom';
import { toAlert, toClient, toKycCase, toReport, toTmCase } from '@/lib/routes';
import { cn } from '@/lib/utils';

const ROUTE = { client: toClient, alert: toAlert, tmCase: toTmCase, report: toReport, kycCase: toKycCase };

/** Consistent link to a KYC/TM object. kind: client | alert | tmCase | report | kycCase. Falls back to text without an id. */
export default function EntityLink({ kind, id, children, tab, className, title }) {
  const build = ROUTE[kind];
  if (!id || !build) return <span className={className}>{children}</span>;
  const to = kind === 'client' || kind === 'kycCase' ? build(id, tab) : build(id);
  return (
    <Link to={to} title={title} onClick={(e) => e.stopPropagation()} className={cn('text-primary hover:underline', className)}>
      {children}
    </Link>
  );
}
