import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { useFiuReportData, useFiuAct, useFiuEndpointMissing } from '@/hooks/useFiuReport';
import DiditConsoleFallback from '@/components/tm/report/DiditConsoleFallback';
import { useCaseUsers } from '@/hooks/useTmCase';
import AppShell from '@/components/layout/AppShell';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import ReportHeader from '@/components/tm/report/ReportHeader';
import ReportStepper from '@/components/tm/report/ReportStepper';
import FieldsTable from '@/components/tm/report/FieldsTable';
import AttachmentsList from '@/components/tm/report/AttachmentsList';
import DeadlineClockTable from '@/components/tm/report/DeadlineClockTable';
import NarrativePanel from '@/components/tm/report/NarrativePanel';
import ChecksPanel from '@/components/tm/report/ChecksPanel';
import ReportFooter from '@/components/tm/report/ReportFooter';
import { Loader2, Lock, FileSearch } from 'lucide-react';

export default function FiuReportWorkspace() {
  const { id } = useParams();
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const role = currentUser?.app_role;
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const isCO = hasPermission(role, 'tmApproveFiuReport');
  const canWork = hasPermission(role, 'tmWorkCase');
  const allowed = isFeatureEnabled(tenant, 'tm_core') && isFeatureEnabled(tenant, 'tm_fiu') && (canWork || isCO);
  const { report, fiu, checks } = useFiuReportData(tenantId, id, allowed);
  const { data: users = [] } = useCaseUsers(tenantId, allowed);
  const { act, busy } = useFiuAct(tenantId, id);
  const fiuMissing = useFiuEndpointMissing(tenantId, id, allowed && isCO && report.data?.status === 'approved');

  if (!allowed) return <AppShell><EmptyState icon={Lock} title="Not available" description="FIU reports need Transaction Monitoring and FIU reporting to be enabled, and the right permission." /></AppShell>;
  if (report.isLoading) return <AppShell><div className="flex justify-center py-20" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></AppShell>;
  if (report.error) return <AppShell><InlineError message="Couldn't load this report." onRetry={() => report.refetch()} /></AppShell>;
  const r = report.data;
  if (!r) return <AppShell><EmptyState icon={FileSearch} title="Report not found" description="It may have been removed, or it belongs to another organisation." /></AppShell>;

  const draft = r.status === 'draft';
  const preparedBy = users.find((u) => u.id === r.prepared_by_user_id);
  const pastDue = !!r.clock?.due_at && now > new Date(r.clock.due_at).getTime();
  const save = (path, value) => act('fiuReportAction', { action: 'update_field', path, value }, 'Saved');
  const toggle = (ref_id, selected) => act('fiuReportAction', { action: 'toggle_attachment', ref_id, selected });

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <ReportHeader report={r} fiu={fiu.data} preparedBy={preparedBy?.full_name || preparedBy?.name || preparedBy?.email} now={now} />
        <ReportStepper report={r} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-5">
            <FieldsTable report={r} editable={draft && canWork} editing={editing} busy={!!busy} onSave={save}
              canRefresh={canWork && ['draft', 'in_review'].includes(r.status)} onRefresh={() => act('fiuReportAction', { action: 'refresh_fields' }, 'Fields refreshed')} />
            <AttachmentsList report={r} editable={draft && canWork} onToggle={toggle} />
            <DeadlineClockTable report={r} />
          </div>
          <div className="space-y-5">
            <NarrativePanel report={r} editable={draft && canWork} editing={editing} busy={!!busy} onSave={save} />
            {['draft', 'in_review'].includes(r.status) && <ChecksPanel checks={checks} report={r} />}
          </div>
        </div>
        {r.status === 'approved' && isCO && (r.generation_path_missing || fiuMissing.data) && (
          <DiditConsoleFallback busy={busy} onUpload={(xml_text, filename) => act('fiuReportAction', { action: 'upload_generated', xml_text, filename }, 'goAML file uploaded')} />
        )}
        <ReportFooter report={r} isCO={isCO} isPreparer={!!currentUser?.id && currentUser.id === r.prepared_by_user_id} editing={editing} setEditing={setEditing} pastDue={pastDue} act={act} busy={busy} />
      </div>
    </AppShell>
  );
}