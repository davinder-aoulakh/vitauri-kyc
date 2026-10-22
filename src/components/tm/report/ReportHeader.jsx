import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/shared/PageHeader';
import { STATUS_LABEL } from '@/lib/fiuReport';
import { deadlineState, formatCountdown } from '@/lib/tmAlerts';
import { cn } from '@/lib/utils';

const Pill = ({ children, className }) => <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border bg-secondary text-foreground', className)}>{children}</span>;

export default function ReportHeader({ report, fiu, preparedBy, now }) {
  const dl = deadlineState({ due_at: report.clock?.due_at }, now);
  const dlText = dl.kind === 'none' ? null : dl.kind === 'expired' ? `Deadline passed ${formatCountdown(dl.ms)} ago` : `Due in ${formatCountdown(dl.ms)}`;
  return (
    <div>
      <PageHeader
        title={`Unusual transaction report · ${fiu?.name || report.fiu_profile_code}`}
        subtitle={`${report.report_ref} · Draft v${report.version || 1} · Prepared by ${preparedBy || 'the system'}`}
        actions={(
          <div className="flex items-center gap-3">
            <Link to={`/tm/case/${report.tm_case_id}`} className="text-sm text-primary hover:underline">Back to case</Link>
            {report.kyc_case_id && <Link to={`/case/${report.kyc_case_id}`} className="text-sm text-primary hover:underline">KYC case</Link>}
          </div>
        )}
      />
      <div className="flex flex-wrap gap-2 -mt-3 mb-5">
        <Pill>{STATUS_LABEL[report.status]}</Pill>
        <Pill>Profile: {fiu?.name || report.fiu_profile_code} · Didit template {report.didit_template_code || 'UTR'}</Pill>
        {dlText && <Pill className={dl.kind === 'expired' ? 'bg-red-50 text-red-700 border-red-200' : dl.kind === 'soon' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}>{dlText}</Pill>}
      </div>
    </div>
  );
}