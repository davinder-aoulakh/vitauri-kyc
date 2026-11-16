import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { hasPermission, canAml } from '@/lib/permissions';
import { useTenant } from '@/lib/tenantContext';
import { LOCK_BANNER, HOLD_BANNER, HOLD_BANNER_NEUTRAL, isLocked, holdKind } from '@/lib/tippingOff';
import UnlockTippingOffDialog from '@/components/shared/UnlockTippingOffDialog';
import { Lock } from 'lucide-react';

/**
 * Red lock banner. Renders nothing when the client is not locked.
 * The text names the reason (FIU report in progress, or an open investigation) for users with AML access; others
 * see a neutral "AML hold". The release button is for an FIU lock only and shows for users with tmApproveFiuReport:
 * an investigation hold ends when the investigation is closed.
 */
export default function TippingOffBanner({ client, userRole, onChanged, className = '' }) {
  const [open, setOpen] = useState(false);
  const { currentUser, tenant } = useTenant();
  if (!isLocked(client)) return null;
  const kind = holdKind(client);
  const seesAml = canAml(currentUser, tenant);
  const text = !seesAml ? HOLD_BANNER_NEUTRAL : kind === 'investigation' ? HOLD_BANNER : LOCK_BANNER;
  const canRelease = !!onChanged && kind === 'fiu' && seesAml && hasPermission(userRole, 'tmApproveFiuReport');
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 text-red-800 px-4 py-3 text-sm font-medium ${className}`}>
      <Lock className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{text}</span>
      {canRelease && <Button size="sm" variant="outline" className="border-red-300 text-red-800 hover:bg-red-100" onClick={() => setOpen(true)}>Release lock</Button>}
      {canRelease && <UnlockTippingOffDialog open={open} onOpenChange={setOpen} clientId={client.id} onUnlocked={onChanged} />}
    </div>
  );
}
