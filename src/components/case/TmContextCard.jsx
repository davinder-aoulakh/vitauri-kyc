import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Lock, Loader2, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import DeadlineCell from '@/components/tm/alerts/DeadlineCell';
import EvidenceItem from '@/components/tm/case/EvidenceItem';
import { CASE_STATUS_LABEL } from '@/lib/tmCase';
import { toClient, toTmCase, toReport } from '@/lib/routes';
import ReviewPeriodSection from '@/components/case/tm/ReviewPeriodSection';

const scoreCls = (s) => (s >= 70 ? 'bg-red-100 text-red-700' : s >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground');
const noop = () => {};

function RiskPair({ risk }) {
  const fmt = (v) => (v == null ? '–' : Math.round(v));
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">Risk</span>
      <span className="font-semibold tabular-nums">{fmt(risk.at_open)}</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-semibold tabular-nums">{fmt(risk.now)}</span>
      {risk.band && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted">{risk.band}</span>}
    </div>
  );
}

export default function TmContextCard({ kycCase, client }) {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = currentUser?.app_role;
  const tmOn = isFeatureEnabled(tenant, 'tm_core');
  const fiuOn = isFeatureEnabled(tenant, 'tm_fiu');
  const canPrepare = fiuOn && (hasPermission(role, 'tmWorkCase') || hasPermission(role, 'tmApproveFiuReport'));
  const isEdr = kycCase?.case_type === 'Event_Driven_Review';
  // Reviews start open: the monitoring picture is the point of a periodic or event-driven review.
  const [open, setOpen] = useState(isEdr || kycCase?.case_type === 'Periodic_Review');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const key = ['kyc-case-tm-context', kycCase?.id];
  const { data } = useQuery({
    queryKey: key,
    enabled: tmOn && !!kycCase?.id,
    queryFn: async () => (await base44.functions.invoke('getCaseTmContext', { kyc_case_id: kycCase.id })).data,
    retry: false,
  });

  if (!tmOn || !data?.has_context) return null;
  const tm = data.tm_case;
  const report = fiuOn ? (data.fiu_reports || [])[0] : null;
  const clientId = client?.id || kycCase.client_id;

  const prepare = async () => {
    setBusy(true);
    try {
      const res = (await base44.functions.invoke('prepareFiuReport', { kyc_case_id: kycCase.id })).data;
      qc.invalidateQueries({ queryKey: key });
      if (res?.report_id) navigate(toReport(res.report_id));
    } catch (e) {
      toast({ title: 'Could not prepare FIU report', description: e?.response?.data?.error || e.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-card border border-border rounded-xl mb-5">
      <button className="w-full flex items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <Activity className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold flex-1">
          {tm ? `Opened from TM case ${tm.case_ref || ''}` : data.period ? 'Monitoring since last review' : 'Transaction monitoring context'}
        </span>
        {tm && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted">{CASE_STATUS_LABEL[tm.status] || tm.status}</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-3">
          {data.tipping_off_locked && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700"><Lock className="w-3.5 h-3.5" /> Customer communications locked</p>
          )}
          {data.period && <ReviewPeriodSection period={data.period} />}
          {(tm || (data.alerts || []).length > 0 || data.profile) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <RiskPair risk={data.risk} />
            {data.profile && <span className="text-xs text-muted-foreground">Expected profile v{data.profile.version}</span>}
          </div>
          )}
          {data.profile?.breach_summary && <p className="text-xs text-foreground">{data.profile.breach_summary}</p>}
          {(data.alerts || []).length > 0 && (
            <ul className="divide-y divide-border">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">{a.title}</span>
                  <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums', scoreCls(a.score))}>{a.score ?? '–'}</span>
                  <span className="text-xs text-muted-foreground">{String(a.status || '').replace(/_/g, ' ')}</span>
                  <DeadlineCell alert={a} now={now} />
                </li>
              ))}
            </ul>
          )}
          {tm?.evidence?.length > 0 && (
            <ul>{tm.evidence.map((e) => <EvidenceItem key={e.id} item={e} canEdit={false} busy={false} onAccept={noop} onSave={noop} />)}</ul>
          )}
          <div className="flex flex-wrap gap-2">
            {tm && <Button asChild variant="outline" size="sm"><Link to={toTmCase(tm.id)}>Open TM case</Link></Button>}
            <Button asChild variant="outline" size="sm"><Link to={toClient(clientId)}>View customer file</Link></Button>
            {report && <Button asChild size="sm"><Link to={toReport(report.id)}>Open FIU report {report.report_ref} · {report.status}</Link></Button>}
            {!report && canPrepare && (
              <Button size="sm" disabled={busy} onClick={prepare}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Prepare FIU report
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}