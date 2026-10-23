import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { toTmCase } from '@/lib/routes';

/** Open the active TmCase, or start an Event_Driven_Review KycCase (same fields as the alert escalation). */
export default function MonitoringActions({ client, currentUser, data, onChanged }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function startEdr() {
    setBusy(true);
    setError(null);
    try {
      const dueDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');
      const prev = (await base44.entities.KycCase.filter({ client_id: client.id, status: 'Approved' }, '-created_date', 1))?.[0];
      const risk = data.risk;
      const triggerReason = `Transaction monitoring: dynamic customer risk ${risk ? `${risk.band} (${risk.score})` : 'review requested'}. ${(risk?.reasons || []).slice(0, 3).join(' ')}`.trim();
      const newCase = await base44.entities.KycCase.create({
        tenant_id: currentUser.tenant_id, client_id: client.id, case_type: 'Event_Driven_Review', status: 'Draft',
        assigned_analyst_id: prev?.assigned_analyst_id || currentUser.id, trigger_reason: triggerReason, due_date: dueDate,
        created_by_user_id: currentUser.id, previous_case_id: prev?.id || null, is_re_onboarding: false,
        risk_classification: prev?.risk_classification || null,
        step_1_status: 'not_started', step_2_status: 'not_started', step_3_status: 'not_started', step_4_status: 'not_started',
        step_5_status: 'not_started', step_6_status: 'not_started', step_7_status: 'not_started', step_8_status: 'not_started',
      });
      await base44.entities.AuditEvent.create({
        tenant_id: currentUser.tenant_id, client_id: client.id, case_id: newCase.id,
        actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
        event_type: 'edr_case_created_from_monitoring', before_state: {},
        after_state: { case_id: newCase.id, customer_risk_score: risk?.score ?? null, customer_risk_band: risk?.band ?? null },
        notes: triggerReason,
      });
      onChanged?.();
      navigate(`/case/${newCase.id}`);
    } catch (e) {
      setError('Could not create the event-driven review.');
    }
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {data.open_tm_case && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(toTmCase(data.open_tm_case.id))}>
            <ExternalLink className="h-3.5 w-3.5" /> Open case{data.open_tm_case.case_ref ? ` ${data.open_tm_case.case_ref}` : ''}
          </Button>
        )}
        {data.open_edr_case_id ? (
          <Button size="sm" className="gap-1.5" onClick={() => navigate(`/case/${data.open_edr_case_id}`)}>
            <AlertTriangle className="h-3.5 w-3.5" /> Open event-driven review
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5" onClick={startEdr} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Start event-driven review
          </Button>
        )}
      </div>
      {error && <InlineError message={error} onRetry={startEdr} />}
    </div>
  );
}