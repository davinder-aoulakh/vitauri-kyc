import React from 'react';
import { Button } from '@/components/ui/button';

const LABEL = { pending: 'Pending', active: 'Active', expiring: 'Expiring', withdrawn: 'Withdrawn', expired: 'Expired' };
const canRecord = (c) => !c || ['pending', 'expired', 'withdrawn'].includes(c.consent_status);
const canWithdraw = (c) => !!c && ['pending', 'active', 'expiring'].includes(c.consent_status);

/** Consent status, days to re-auth and the Record consent / Withdraw actions for one account. */
export default function ConnectionCell({ connection, onRecord, onWithdraw }) {
  const days = connection?.reauth_due_at ? Math.ceil((new Date(connection.reauth_due_at).getTime() - Date.now()) / 86400000) : null;
  const live = connection && ['active', 'expiring'].includes(connection.consent_status);
  return (
    <div className="space-y-0.5">
      <div className="text-xs">
        {connection ? LABEL[connection.consent_status] || connection.consent_status : 'Not connected'}
        {live && days !== null && <span className="text-muted-foreground"> · {days < 0 ? `re-auth ${-days}d overdue` : `${days}d to re-auth`}</span>}
      </div>
      {connection?.last_error && <div className="text-[11px] text-muted-foreground">{connection.last_error}</div>}
      <div className="flex gap-1">
        {canRecord(connection) && <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onRecord}>Record consent</Button>}
        {canWithdraw(connection) && <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onWithdraw}>Withdraw</Button>}
      </div>
    </div>
  );
}