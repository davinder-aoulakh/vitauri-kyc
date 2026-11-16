import React from 'react';
import { Lock } from 'lucide-react';
import { isLocked } from '@/lib/tippingOff';

/** "AML hold" badge (spec section 4): shown to every role while customer communications are blocked. No detail. */
export default function AmlHoldBadge({ client, className = '' }) {
  if (!isLocked(client)) return null;
  return (
    <span title="Customer communications are blocked for this customer"
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border border-red-300 bg-red-50 text-red-700 whitespace-nowrap ${className}`}>
      <Lock className="w-3 h-3" /> AML hold
    </span>
  );
}
