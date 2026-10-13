import React, { useState } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import KycTxnAnalysisPanel from './KycTxnAnalysisPanel';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Collapsible "Transaction analysis (statements)" block; hidden unless tm_kyc_analysis is enabled. */
export default function TxnAnalysisSection({ kycCase, client, onCaseUpdate }) {
  const { tenant } = useTenant();
  const [open, setOpen] = useState(false);
  if (!isFeatureEnabled(tenant, 'tm_kyc_analysis')) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-medium">Transaction analysis (statements)</span>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border p-4">
        <KycTxnAnalysisPanel kycCase={kycCase} client={client} onCaseUpdate={onCaseUpdate} />
      </CollapsibleContent>
    </Collapsible>
  );
}