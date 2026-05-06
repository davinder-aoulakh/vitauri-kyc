/**
 * useAiOrchestrator — frontend hook for calling the AI orchestrator.
 * Handles: invocation, analyst action logging (Accept/Edit/Override/Reject),
 * token cap error surfacing, and AiAgentRun update after analyst action.
 */
import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useAiOrchestrator({ caseId, tenantId, currentUser } = {}) {
  const [loading, setLoading]   = useState(false);
  const [output, setOutput]     = useState(null);
  const [runId, setRunId]       = useState(null);
  const [error, setError]       = useState(null);
  const [tokenInfo, setTokenInfo] = useState(null);

  const invoke = useCallback(async (agentType, payload = {}) => {
    setLoading(true);
    setOutput(null);
    setError(null);
    setRunId(null);

    const res = await base44.functions.invoke('aiOrchestrator', {
      agent_type: agentType,
      payload,
      case_id: caseId || null,
    });

    const data = res.data;

    if (data?.error) {
      setError(data.message || data.error);
      setLoading(false);
      return null;
    }

    setOutput(data.output);
    setRunId(data.run_id);
    setTokenInfo({ used: data.tokens_used, remaining: data.daily_tokens_remaining });
    setLoading(false);
    return data.output;
  }, [caseId]);

  const logAction = useCallback(async (action, justification = '') => {
    if (!runId) return;
    // Update the AiAgentRun record with analyst action
    await base44.entities.AiAgentRun.update(runId, {
      analyst_action: action,
      analyst_justification: justification || null,
    });
    // Also write to audit trail
    if (caseId && currentUser) {
      await base44.entities.AuditEvent.create({
        tenant_id: tenantId,
        case_id: caseId,
        actor_user_id: currentUser.id,
        actor_name: currentUser.full_name,
        actor_type: 'User',
        event_type: `ai_output_${action.toLowerCase()}`,
        notes: justification ? justification.substring(0, 300) : `AI output ${action}`,
        is_override: action === 'Overridden',
      });
    }
  }, [runId, caseId, tenantId, currentUser]);

  const reset = useCallback(() => {
    setOutput(null);
    setRunId(null);
    setError(null);
    setTokenInfo(null);
    setLoading(false);
  }, []);

  return { invoke, logAction, reset, loading, output, error, tokenInfo };
}