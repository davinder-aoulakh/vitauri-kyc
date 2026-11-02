import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/shared/PageHeader';
import { STATUS_LABEL } from '@/lib/fiuReport';
import { typeLabel, typeCode, ORIGIN_LABEL } from '@/lib/fiuTypes';
import { AlertTriangle } from 'lucide-react';
import { toClient, toKycCase, toTmCase } from '@/lib/routes';
import { deadlineState, formatCountdown } from '@/lib/tmAlerts';
import { cn } from '@/lib/utils';

const Pill = ({ children, className }) => <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border bg-secondary text-foreground', className)}>{children}</span>;

export default function ReportHeader({ report, fiu, preparedBy, now }) {
  const dl = deadlineState({ due_at: report.clock?.due_at }, now);
  const dlText = dl.kind === 'none' ? null : dl.kind === 'expired' ? `Deadline passed ${formatCountdown(dl.ms)} ago` : `Due in ${formatCountdown(dl.ms)}`;
  return (
    <div>
      <PageHeader
        title={`${typeLabel(report.type)} · ${fiu?.name || report.fiu_profile_code}`}
        subtitle={`${report.report_ref} · ${STATUS_LABEL[report.status] || 'Draft'} · v${report.version || 1} · Prepared by ${preparedBy || 'the system'}`}
        actions={(
          <div className="flex items-center gap-3">
            {report.tm_case_id && <Link to={toTmCase(report.tm_case_id)} className="text-sm text-primary hover:underline">Back to case</Link>}
            {report.client_id && <Link to={toClient(report.client_id)} className="text-sm text-primary hover:underline">Customer</Link>}
            {report.kyc_case_id && <Link to={toKycCase(report.kyc_case_id)} className="text-sm text-primary hover:underline">KYC case</Link>}
          </div>
        )}
      />
      <div className="flex flex-wrap gap-2 -mt-3 mb-5">
        <Pill>{STATUS_LABEL[report.status]}</Pill>
        <Pill className="font-mono">{typeCode(report.type)} · goAML code {report.goaml_report_code || typeCode(report.type).split(' ')[0]}</Pill>
        {report.origin && <Pill>Origin: {ORIGIN_LABEL[report.origin] || report.origin}</Pill>}
        {report.priority === 'without_delay' && <Pill className="bg-red-50 text-red-700 border-red-200">Report without delay</Pill>}
        <Pill>Profile: {fiu?.name || report.fiu_profile_code} · Didit template {report.didit_template_code || 'UTR'}</Pill>
        {dlText && <Pill className={dl.kind === 'expired' ? 'bg-red-50 text-red-700 border-red-200' : dl.kind === 'soon' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}>{dlText}</Pill>}
      </div>
      {report.freeze_advised && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Terrorist-financing indicators: file this report without delay and assess an asset freeze under the applicable sanctions regulation. Vitauri does not freeze assets automatically. Do not inform the customer.</span>
        </div>
      )}
      {report.proposal?.rule && report.proposal?.threshold != null && (
        <p className="mb-4 text-xs text-muted-foreground">
          Proposed automatically: {report.proposal.rule} on {report.proposal.date} totalled {Number(report.proposal.total).toLocaleString()} {report.proposal.currency}, threshold {Number(report.proposal.threshold).toLocaleString()} {report.proposal.currency}.
        </p>
      )}
    </div>
  );
}