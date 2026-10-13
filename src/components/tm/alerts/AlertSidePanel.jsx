import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { UserCheck, XCircle, Loader2 } from 'lucide-react';
import RiskBadge from '@/components/shared/RiskBadge';
import DeadlineCell from '@/components/tm/alerts/DeadlineCell';
import AlertEvidence from '@/components/tm/alerts/AlertEvidence';
import CaseActions from '@/components/tm/alerts/CaseActions';
import InlineError from '@/components/shared/InlineError';
import { shortId, errorMessage, CLOSABLE_STATUSES } from '@/lib/tmAlerts';

export default function AlertSidePanel({ alert, client, tenantId, userId, canWork, now, onClose, onChanged, onCloseAlert }) {
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');

  const txnIds = alert?.transaction_ids || [];
  const { data: txns = [] } = useQuery({
    queryKey: ['tmAlertTxns', tenantId, alert?.id],
    enabled: !!alert && txnIds.length > 0,
    queryFn: async () => (await base44.entities.Transaction.filter({ tenant_id: tenantId, id: { $in: txnIds.slice(0, 50) } }, { limit: 50 })).items || [],
  });

  const assign = async () => {
    setAssigning(true);
    setError('');
    try {
      await base44.functions.invoke('tmAlertActions', { alert_id: alert.id, action: 'assign_to_me' });
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAssigning(false);
    }
  };

  const open = !!alert;
  const closable = alert && CLOSABLE_STATUSES.includes(alert.status);
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {alert && (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle>{alert.title || shortId(alert.id)}</SheetTitle>
              <SheetDescription>{shortId(alert.id)} · {alert.status.replace(/_/g, ' ')}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link to={`/client/${alert.client_id}?tab=monitoring`} className="text-primary hover:underline font-medium">{client?.full_name || 'Customer'}</Link>
              {client?.risk_classification && <RiskBadge risk={client.risk_classification} />}
              <DeadlineCell alert={alert} now={now} />
            </div>
            {canWork && closable && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={assign} disabled={assigning || alert.assigned_to_user_id === userId}>
                  {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                  {alert.assigned_to_user_id === userId ? 'Assigned to you' : 'Assign to me'}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onCloseAlert([alert.id])}>
                  <XCircle className="w-3.5 h-3.5" /> Close
                </Button>
              </div>
            )}
            {canWork && closable && <CaseActions alert={alert} tenantId={tenantId} onChanged={onChanged} />}
            {error && <InlineError message={error} />}
            <AlertEvidence alert={alert} txns={txns} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}