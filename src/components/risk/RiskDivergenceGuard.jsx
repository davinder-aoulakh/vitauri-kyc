import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, CheckCircle } from 'lucide-react';

const RANK = { Low: 0, Medium: 1, High: 2, Unacceptable: 3 };

/**
 * When the KYC rating is lower than the dynamic monitoring band, the analyst records why (stored on
 * KycCase.tm_risk_divergence and audited). Reports readiness to the parent; renders nothing when TM is off or ratings agree.
 */
export default function RiskDivergenceGuard({ kycCase, client, currentUser, rating, onReadyChange }) {
  const { tenant } = useTenant();
  const on = isFeatureEnabled(tenant, 'tm_core');
  const band = client?.customer_risk_band;
  const diverges = on && rating && band && RANK[band] > RANK[rating];
  const saved = kycCase?.tm_risk_divergence;
  const savedFits = !!saved?.rationale && saved.kyc_rating === rating && saved.dynamic_band === band;
  const [text, setText] = useState(saved?.rationale || '');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(savedFits);

  useEffect(() => { setOk(savedFits); }, [savedFits]);
  useEffect(() => { onReadyChange?.(!diverges || ok); }, [diverges, ok, onReadyChange]);

  if (!diverges) return null;

  const save = async () => {
    setBusy(true);
    try {
      const value = {
        kyc_rating: rating, dynamic_band: band, dynamic_score: client?.customer_risk_score ?? null,
        rationale: text.trim(), by_user_id: currentUser?.id, by_name: currentUser?.full_name, at: new Date().toISOString(),
      };
      await base44.entities.KycCase.update(kycCase.id, { tm_risk_divergence: value });
      await base44.entities.AuditEvent.create({
        tenant_id: kycCase.tenant_id, case_id: kycCase.id, client_id: kycCase.client_id,
        actor_user_id: currentUser?.id, actor_name: currentUser?.full_name, actor_type: 'User',
        event_type: 'risk_rating_below_monitoring', before_state: saved || {}, after_state: value,
        notes: `KYC rating ${rating} is below the monitoring band ${band}. Rationale: ${value.rationale}`,
      });
      setOk(true);
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex items-start gap-2 text-amber-900 dark:text-amber-100">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold">Your rating ({rating}) is lower than transaction monitoring ({band}{client?.customer_risk_score != null ? `, score ${Math.round(client.customer_risk_score)}` : ''}).</div>
          <div className="text-xs">Explain why the lower rating is justified. This is recorded with the KYC decision.</div>
        </div>
      </div>
      <Textarea value={text} onChange={(e) => { setText(e.target.value); setOk(false); }} placeholder="e.g. Alerts were explained by documented seasonal income; source of funds verified…" className="text-sm min-h-16 bg-background" />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || text.trim().length < 15}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save rationale</Button>
        {ok && <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle className="w-3.5 h-3.5" /> Saved</span>}
        {!ok && text.trim().length < 15 && <span className="text-xs text-muted-foreground">At least 15 characters.</span>}
      </div>
    </div>
  );
}
