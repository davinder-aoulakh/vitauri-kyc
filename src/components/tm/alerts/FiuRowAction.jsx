import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

/** Row action for objective-indicator alerts: prepares the FIU report, then opens it. Hidden without tm_fiu + tmWorkCase. */
export default function FiuRowAction({ alert }) {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const allowed = alert.indicator_type === 'objective' && isFeatureEnabled(tenant, 'tm_core') && isFeatureEnabled(tenant, 'tm_fiu') && hasPermission(currentUser?.app_role, 'tmWorkCase');
  if (!allowed) return null;

  const open = async () => {
    setBusy(true);
    try {
      const res = (await base44.functions.invoke('prepareFiuReport', alert.tm_case_id ? { tm_case_id: alert.tm_case_id } : { alert_id: alert.id }))?.data || {};
      navigate(`/tm/report/${res.report_id}`);
    } catch (e) {
      toast({ title: 'Could not prepare the report', description: errorMessage(e), variant: 'destructive' });
      setBusy(false);
    }
  };
  return <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy} onClick={open}>{busy && <Loader2 className="w-3 h-3 animate-spin" />} FIU report</Button>;
}