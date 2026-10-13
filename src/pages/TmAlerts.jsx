import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { useTenantClients } from '@/hooks/useTenantData';
import { useTmAlerts } from '@/hooks/useTmAlerts';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { errorMessage } from '@/lib/tmAlerts';
import { useToast } from '@/components/ui/use-toast';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import InlineError from '@/components/shared/InlineError';
import AlertFilters from '@/components/tm/alerts/AlertFilters';
import AlertsTable from '@/components/tm/alerts/AlertsTable';
import AlertSidePanel from '@/components/tm/alerts/AlertSidePanel';
import CloseAlertDialog from '@/components/tm/alerts/CloseAlertDialog';
import CreateCaseDialog from '@/components/tm/case/CreateCaseDialog';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, Inbox, Sparkles, XCircle, FolderPlus } from 'lucide-react';

const EMPTY_COPY = {
  all: 'No open alerts. New alerts appear here as soon as monitoring rules or profile checks raise them.',
  mine: 'Nothing is assigned to you. Open an alert and choose “Assign to me”, or switch to All.',
  soon: 'No alert is due within 24 hours. Check “All” to see every open alert.',
  expired: 'No alert has passed its deadline. Nothing to catch up on.',
  ai_close: 'AI has not suggested closing any alert. Run AI triage on new alerts to get proposals.',
};

export default function TmAlerts() {
  const { currentUser, tenant } = useTenant();
  const tenantId = currentUser?.tenant_id;
  const userId = currentUser?.id;
  const role = currentUser?.app_role;
  const qc = useQueryClient();
  const { toast } = useToast();

  const allowed = isFeatureEnabled(tenant, 'tm_core') && hasPermission(role, 'tmViewAlerts');
  const canWork = hasPermission(role, 'tmWorkCase');

  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [closeIds, setCloseIds] = useState(null);
  const [caseIds, setCaseIds] = useState(null);
  const [triaging, setTriaging] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const { list, count } = useTmAlerts(tenantId, userId, filter, allowed);
  const { data: clients } = useTenantClients(tenantId, { enabled: allowed });
  const clientsById = useMemo(() => new Map((clients || []).map((c) => [c.id, c])), [clients]);
  const alerts = list.data || [];
  const openAlert = alerts.find((a) => a.id === openId) || null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tmAlerts', tenantId] });
    qc.invalidateQueries({ queryKey: ['tmAlertsOpenCount', tenantId] });
    setSelected(new Set());
  };

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const runTriage = async () => {
    setTriaging(true);
    try {
      const page = await base44.entities.TmAlert.filter({ tenant_id: tenantId, status: 'new' }, { sort: '-score', limit: 25 });
      const ids = (page.items || []).map((a) => a.id);
      if (!ids.length) { toast({ title: 'No new alerts to triage' }); return; }
      const res = await base44.functions.invoke('triageAlerts', { alert_ids: ids });
      toast({ title: `AI triage proposed for ${res?.data?.triaged ?? 0} of ${ids.length} alerts` });
      refresh();
    } catch (e) {
      toast({ title: 'AI triage failed', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setTriaging(false);
    }
  };

  if (!allowed) {
    return (
      <AppShell>
        <EmptyState icon={Lock} title="Not available" description="Alerts need Transaction Monitoring to be enabled and the right permission." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Alerts"
        subtitle={`${count.data ?? '…'} open · sorted by risk and deadline`}
        actions={
          <>
            {canWork && selected.size > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setCaseIds([...selected])}>
                <FolderPlus className="w-3.5 h-3.5" /> Create case from {selected.size}
              </Button>
            )}
            {canWork && selected.size > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setCloseIds([...selected])}>
                <XCircle className="w-3.5 h-3.5" /> Close {selected.size} selected
              </Button>
            )}
            <Button size="sm" className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white" onClick={runTriage} disabled={triaging}>
              {triaging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Run AI triage on new alerts
            </Button>
          </>
        }
      />
      <AlertFilters value={filter} onChange={(f) => { setFilter(f); setSelected(new Set()); }} />

      {list.error && <InlineError message="Couldn't load alerts." onRetry={() => list.refetch()} />}
      {list.isLoading && <div className="flex justify-center py-16" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
      {!list.isLoading && !list.error && alerts.length === 0 && (
        <EmptyState icon={Inbox} title={filter === 'all' ? 'No open alerts' : 'No alerts match this filter'} description={EMPTY_COPY[filter]} />
      )}
      {alerts.length > 0 && (
        <AlertsTable alerts={alerts} clientsById={clientsById} now={now} selected={selected} onToggle={toggle} onOpen={(a) => setOpenId(a.id)} canSelect={canWork} />
      )}
      <p className="text-xs text-muted-foreground mt-4">
        AI proposals show reasons, not percentages. Bulk closing is only possible for alert types released after measurement.
      </p>

      <AlertSidePanel
        alert={openAlert} client={openAlert ? clientsById.get(openAlert.client_id) : null} tenantId={tenantId} userId={userId}
        canWork={canWork} now={now} onClose={() => setOpenId(null)} onChanged={refresh} onCloseAlert={setCloseIds}
      />
      {caseIds && (
        <CreateCaseDialog
          open alertIds={caseIds} defaultTitle={alerts.find((a) => a.id === caseIds[0])?.title}
          onOpenChange={(v) => !v && setCaseIds(null)} onCreated={() => { setOpenId(null); refresh(); }}
        />
      )}
      <CloseAlertDialog
        alertIds={closeIds || []} open={!!closeIds} onOpenChange={(v) => !v && setCloseIds(null)}
        onClosed={() => { setOpenId(null); refresh(); }}
      />
    </AppShell>
  );
}