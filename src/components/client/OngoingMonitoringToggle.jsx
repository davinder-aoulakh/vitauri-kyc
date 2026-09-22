import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Radar, Loader2, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_STYLES = {
  NotEnrolled: 'text-muted-foreground border-border',
  Pending:     'text-amber-700 border-amber-300 bg-amber-50',
  Active:      'text-emerald-700 border-emerald-300 bg-emerald-50',
};

export default function OngoingMonitoringToggle({ client, canEdit, hasCompletedIdv, onClientUpdated }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const status = client.didit_ongoing_monitoring || 'NotEnrolled';
  const isActive = status === 'Active';
  const isPending = status === 'Pending';
  const disabled = !canEdit || !hasCompletedIdv || isPending;

  async function openDialog() {
    setError(null);
    setDialogOpen(true);
    if (!isActive) {
      setLoadingEstimate(true);
      try {
        const res = await base44.functions.invoke('toggleDiditMonitoring', {
          client_id: client.id, enable: true, estimate_only: true,
        });
        if (res.data?.error) setError(res.data.error);
        else setEstimate(res.data?.estimate || null);
      } catch (err) {
        setError(err?.message || 'Failed to fetch cost estimate');
      } finally {
        setLoadingEstimate(false);
      }
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('toggleDiditMonitoring', {
        client_id: client.id, enable: !isActive,
      });
      if (res.data?.error) {
        setError(res.data.error);
      } else {
        onClientUpdated?.({ ...client, didit_ongoing_monitoring: 'Pending' });
        setDialogOpen(false);
      }
    } catch (err) {
      setError(err?.message || 'Failed to update monitoring');
    } finally {
      setSubmitting(false);
    }
  }

  const button = (
    <Button
      variant="outline"
      size="sm"
      className={cn('gap-1.5', STATUS_STYLES[status])}
      disabled={disabled}
      onClick={openDialog}
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isActive ? <Radar className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
      {isPending ? 'Monitoring Pending' : isActive ? 'Monitoring Active' : 'Ongoing Monitoring'}
    </Button>
  );

  return (
    <>
      {!hasCompletedIdv ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild><span>{button}</span></TooltipTrigger>
            <TooltipContent>Complete identity verification before enabling ongoing monitoring</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : button}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isActive ? 'Disable Ongoing Monitoring' : 'Enable Ongoing Monitoring'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {isActive ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                This will stop Didit's ongoing AML monitoring for <strong>{client.full_name}</strong>. Sanctions, PEP, and adverse media re-screening will no longer run automatically.
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 space-y-2">
                <p>This enrolls <strong>{client.full_name}</strong> in Didit's ongoing AML monitoring — automatic re-screening for sanctions, PEP, and adverse media hits.</p>
                {loadingEstimate && <div className="flex items-center gap-2 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching cost estimate…</div>}
                {estimate && (
                  <div className="text-xs space-y-0.5 pt-1 border-t border-blue-200">
                    {estimate.estimated_screening_cost_usd != null && <div>Initial screening cost: <strong>${estimate.estimated_screening_cost_usd.toFixed(2)}</strong></div>}
                    {estimate.estimated_annual_monitoring_cost_usd != null && <div>Annual monitoring cost: <strong>${estimate.estimated_annual_monitoring_cost_usd.toFixed(2)}</strong></div>}
                    {estimate.balance_sufficient === false && <div className="text-destructive font-medium">Insufficient Didit balance for this operation.</div>}
                  </div>
                )}
              </div>
            )}
            {error && <div className="text-sm text-destructive">{error}</div>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                variant={isActive ? 'destructive' : 'default'}
                onClick={handleConfirm}
                disabled={submitting || loadingEstimate}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (isActive ? 'Disable Monitoring' : 'Enable Monitoring')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}