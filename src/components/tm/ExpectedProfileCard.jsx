import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { hasPermission } from '@/lib/permissions';
import { canDecideProfile } from '@/lib/profileApproval';
import InlineError from '@/components/shared/InlineError';
import ProfileStatusPill from './profile/ProfileStatusPill';
import ProfileVersionsPopover from './profile/ProfileVersionsPopover';
import ProfileDecisionPanel from './profile/ProfileDecisionPanel';
import ProfileLimits from './profile/ProfileLimits';
import { Loader2, Target } from 'lucide-react';

/**
 * Expected transaction profile for a client: current approved version, version history,
 * and approve/reject controls for a proposed version (only for allowed approvers).
 * Props: client (Client record), onChanged (optional callback after a decision).
 */
export default function ExpectedProfileCard({ client, onChanged }) {
  const { currentUser, tenant } = useTenant();
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const enabled = isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'createRunCase');
  const tenantId = currentUser?.tenant_id;

  const load = useCallback(async () => {
    if (!tenantId || !client?.id) return;
    setLoading(true);
    setError(null);
    try {
      const page = await base44.entities.ExpectedProfile.filter({ tenant_id: tenantId, client_id: client.id }, '-version', 50);
      const list = Array.isArray(page) ? page : (page?.items || []);
      setProfiles(list);
      setSelectedId((prev) => prev && list.some((p) => p.id === prev) ? prev
        : (list.find((p) => p.status === 'approved') || list.find((p) => p.status === 'proposed') || list[0])?.id || null);
    } catch (e) {
      setError('Could not load expected profiles.');
    }
    setLoading(false);
  }, [tenantId, client?.id]);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return null;

  const selected = profiles.find((p) => p.id === selectedId);
  const canDecide = selected?.status === 'proposed' && canDecideProfile({
    role: currentUser?.app_role, userId: currentUser?.id, tenant,
    riskClass: client?.risk_classification, proposedBy: selected.proposed_by_user_id,
  });
  const decidedBy = selected?.approved_by_name || null;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Expected Profile</h3>
          {selected && <><span className="text-xs text-muted-foreground">v{selected.version}</span><ProfileStatusPill status={selected.status} /></>}
        </div>
        <ProfileVersionsPopover profiles={profiles} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {loading && <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
      {error && <InlineError message={error} onRetry={load} />}
      {!loading && !error && !selected && (
        <p className="py-4 text-center text-xs text-muted-foreground">No expected profile yet. One is proposed automatically when a case is signed off.</p>
      )}

      {!loading && selected && (
        <>
          <ProfileLimits profile={selected} />
          {selected.status === 'approved' && (
            <div className="space-y-1 border-t border-border/50 pt-3 text-xs">
              <div><span className="text-muted-foreground">Approved by: </span>{decidedBy || '—'}</div>
              {selected.rationale && <div className="italic text-muted-foreground">“{selected.rationale}”</div>}
              {selected.didit_sync_error && <div className="text-amber-700">Didit sync pending: {selected.didit_sync_error}</div>}
            </div>
          )}
          {selected.status === 'rejected' && selected.rejection_reason && (
            <div className="border-t border-border/50 pt-3 text-xs text-red-700">Rejected{decidedBy ? ` by ${decidedBy}` : ''}: {selected.rejection_reason}</div>
          )}
          {canDecide && <ProfileDecisionPanel profile={selected} onDecided={() => { load(); onChanged?.(); }} />}
          {selected.status === 'proposed' && !canDecide && (
            <p className="text-xs text-muted-foreground">Awaiting approval by an authorised approver.</p>
          )}
        </>
      )}
    </div>
  );
}