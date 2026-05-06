/**
 * RestrictedClientGate — hard-stop banner shown in NewClient when a fuzzy-dedup
 * match is against a Rejected or Unacceptable client.
 * Sends a Notification to all Compliance Officers and blocks progression.
 */
import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RestrictedClientGate({ matches, currentUser, tenantId, onDismiss }) {
  const [notified, setNotified] = useState(false);
  const [notifying, setNotifying] = useState(false);

  async function notifyComplianceOfficers() {
    setNotifying(true);
    // Find all CO / Compliance Admin users
    const allUsers = await base44.entities.User.list();
    const officers = (allUsers || []).filter(u =>
      u.tenant_id === tenantId &&
      ['Compliance Officer', 'Compliance Admin', 'Tenant Admin'].includes(u.app_role)
    );

    for (const officer of officers) {
      await base44.entities.Notification.create({
        tenant_id: tenantId,
        user_id: officer.id,
        type: 'monitoring_alert',
        title: '⛔ Re-onboarding request: restricted client',
        body: `${currentUser.full_name} attempted to create a client matching a restricted record: "${matches[0]?.client?.full_name}". CO approval required.`,
        link_client_id: matches[0]?.client?.id,
      });
    }

    await base44.entities.AuditEvent.create({
      tenant_id: tenantId,
      client_id: matches[0]?.client?.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'restricted_reonboarding_requested',
      notes: `Analyst attempted to create client matching restricted record "${matches[0]?.client?.full_name}" (${matches[0]?.score}% match). CO notified.`,
    });

    setNotified(true);
    setNotifying(false);
  }

  return (
    <div className="bg-red-50 border-2 border-red-400 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-base font-bold text-red-800">
            ⛔ This client matches a restricted record
          </div>
          <div className="text-sm text-red-700 mt-1">
            Re-onboarding requires Compliance Officer approval. You cannot proceed until a Compliance Officer
            reviews and approves this request in the Archive module.
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {matches.map(({ client, score }) => (
          <div key={client.id} className="flex items-center justify-between bg-white border border-red-300 rounded-lg px-3 py-2.5">
            <div>
              <div className="text-sm font-semibold text-red-900">{client.full_name}</div>
              <div className="text-xs text-red-600 mt-0.5">
                Status: <strong>{client.status}</strong> · Match score: <strong className="font-mono">{score}%</strong>
                {client.registration_number && ` · Reg: ${client.registration_number}`}
              </div>
            </div>
            <span className="text-xs font-bold text-red-700 px-2 py-1 bg-red-100 rounded-full border border-red-300">
              RESTRICTED
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        {!notified ? (
          <Button
            onClick={notifyComplianceOfficers}
            disabled={notifying}
            className="gap-2 bg-red-700 hover:bg-red-800 text-white text-sm">
            {notifying && <Loader2 className="w-4 h-4 animate-spin" />}
            Notify Compliance Officer
          </Button>
        ) : (
          <div className="text-sm text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            ✓ Compliance Officer(s) have been notified. You will be informed of their decision.
          </div>
        )}
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={onDismiss}>
          Cancel
        </Button>
      </div>
    </div>
  );
}