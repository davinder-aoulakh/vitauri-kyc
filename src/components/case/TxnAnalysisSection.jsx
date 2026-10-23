import React, { useState } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import KycTxnAnalysisPanel from './KycTxnAnalysisPanel';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Collapsible "Transaction analysis (statements)" block; hidden unless tm_kyc_analysis is enabled. */
// Statement analysis is recommended for higher-risk onboarding, periodic reviews and behaviour-driven EDRs.
function recommendation(kycCase, client) {
  const risk = kycCase?.risk_classification || client?.risk_classification;
  const trig = kycCase?.tm_context?.trigger?.type;
  if (kycCase?.case_type === 'Onboarding' && ['High', 'Unacceptable'].includes(risk)) return `Recommended: ${risk} risk onboarding`;
  if (kycCase?.case_type === 'Periodic_Review') return 'Recommended for periodic reviews';
  if (kycCase?.case_type === 'Event_Driven_Review' && ['profile_breach', 'risk_band_rise', 'tm_case'].includes(trig)) return 'Recommended: review opened from monitoring';
  return null;
}

export default function TxnAnalysisSection({ kycCase, client, onCaseUpdate }) {
  const { tenant } = useTenant();
  const why = recommendation(kycCase, client);
  const [open, setOpen] = useState(!!why);
  if (!isFeatureEnabled(tenant, 'tm_kyc_analysis')) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-medium">Transaction analysis (statements){why && <span className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-200">{why}</span>}</span>
        <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border p-4">
        <KycTxnAnalysisPanel kycCase={kycCase} client={client} onCaseUpdate={onCaseUpdate} />
      </CollapsibleContent>
    </Collapsible>
  );
}