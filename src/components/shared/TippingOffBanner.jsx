import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { hasPermission } from '@/lib/permissions';
import { LOCK_BANNER, isLocked } from '@/lib/tippingOff';
import UnlockTippingOffDialog from '@/components/shared/UnlockTippingOffDialog';
import { Lock } from 'lucide-react';

/** Red lock banner. Renders nothing when the client is not locked. The release button shows for users with tmApproveFiuReport. */
export default function TippingOffBanner({ client, userRole, onChanged, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!isLocked(client)) return null;
  const canRelease = !!onChanged && hasPermission(userRole, 'tmApproveFiuReport');
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 text-red-800 px-4 py-3 text-sm font-medium ${className}`}>
      <Lock className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{LOCK_BANNER}</span>
      {canRelease && <Button size="sm" variant="outline" className="border-red-300 text-red-800 hover:bg-red-100" onClick={() => setOpen(true)}>Release lock</Button>}
      {canRelease && <UnlockTippingOffDialog open={open} onOpenChange={setOpen} clientId={client.id} onUnlocked={onChanged} />}
    </div>
  );
}