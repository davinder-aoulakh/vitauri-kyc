/**
 * Enables or disables Didit ongoing AML monitoring for a client.
 *
 * Supports estimate_only mode (cost preview, no state change) and the real
 * toggle (calls Didit's async monitoring endpoint, stores the job_id, sets
 * didit_ongoing_monitoring to 'Pending', then polls the job in the background
 * until it completes and resolves the final state).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { waitUntil } from 'base44:runtime';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { client_id, enable, estimate_only = false } = await req.json();
    if (!client_id || typeof enable !== 'boolean') {
      return Response.json({ error: 'client_id and enable (boolean) are required' }, { status: 400 });
    }

    const clients = await base44.entities.Client.filter({ id: client_id });
    const client = clients?.[0];
    if (!client) return Response.json({ error: 'Client not found' }, { status: 404 });

    const tenants = await base44.asServiceRole.entities.Tenant.filter({ id: client.tenant_id });
    const tenant = tenants?.[0];
    if (!tenant?.didit_api_key) {
      return Response.json({ error: 'Identity verification is not configured for this institution.' }, { status: 400 });
    }

    const endpoint = client.client_type === 'ORG'
      ? 'https://verification.didit.me/v3/businesses/aml-monitoring/'
      : 'https://verification.didit.me/v3/users/aml-monitoring/';

    const body = {
      is_enabled: enable,
      vendor_data_list: [client_id],
      ...(estimate_only ? { estimate_only: true } : {}),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-api-key': tenant.didit_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.error || errBody?.detail || `Didit API error ${response.status}`;
      return Response.json({ error: msg }, { status: 400 });
    }

    const data = await response.json();

    // Estimate-only: return cost preview, don't touch client state.
    if (estimate_only) {
      return Response.json({ estimate: data });
    }

    // Real toggle: store job_id, flip to Pending, and audit.
    await base44.entities.Client.update(client_id, {
      didit_ongoing_monitoring: 'Pending',
      didit_monitoring_job_id: data.job_id || null,
    });

    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id,
      client_id: client_id,
      actor_user_id: user.id,
      actor_name: user.full_name,
      actor_type: 'User',
      event_type: 'didit_ongoing_monitoring_toggled',
      notes: `Ongoing AML monitoring ${enable ? 'enable' : 'disable'} requested. Didit job ${data.job_id || 'n/a'} (status: ${data.status || 'n/a'}).`,
    });

    // Background confirmation: poll the job until it settles, then resolve
    // the final Client state. Small single-item jobs usually complete fast,
    // but may still start out PENDING/PROCESSING.
    if (data.job_id) {
      waitUntil(resolveMonitoringJob(base44, tenant.didit_api_key, client_id, data.job_id, enable));
    }

    return Response.json({ ok: true, job_id: data.job_id, status: data.status });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function resolveMonitoringJob(base44, apiKey, clientId, jobId, enable) {
  const maxAttempts = 8;
  const delayMs = 2500;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    try {
      const resp = await fetch(`https://verification.didit.me/v3/aml-monitoring/jobs/${jobId}/`, {
        headers: { 'x-api-key': apiKey },
      });
      if (!resp.ok) continue;
      const job = await resp.json();

      if (job.status === 'COMPLETED') {
        const result = (job.results || []).find(r => r.vendor_data === clientId);
        const failed = result?.outcome?.startsWith('failed') || result?.outcome === 'skipped_no_identity_data' || result?.outcome === 'skipped_blocked';
        const finalStatus = failed ? 'NotEnrolled' : (enable ? 'Active' : 'NotEnrolled');

        await base44.asServiceRole.entities.Client.update(clientId, {
          didit_ongoing_monitoring: finalStatus,
        });
        await base44.asServiceRole.entities.AuditEvent.create({
          tenant_id: (await base44.asServiceRole.entities.Client.filter({ id: clientId }))?.[0]?.tenant_id,
          client_id: clientId,
          actor_type: 'System',
          actor_name: 'Didit Monitoring Job Poll',
          event_type: 'didit_ongoing_monitoring_resolved',
          notes: `Monitoring job ${jobId} completed. Outcome: ${result?.outcome || 'unknown'}. Resolved to ${finalStatus}.`,
        }).catch(() => {});
        return;
      }

      if (job.status === 'FAILED') {
        await base44.asServiceRole.entities.Client.update(clientId, { didit_ongoing_monitoring: 'NotEnrolled' });
        await base44.asServiceRole.entities.AuditEvent.create({
          tenant_id: (await base44.asServiceRole.entities.Client.filter({ id: clientId }))?.[0]?.tenant_id,
          client_id: clientId,
          actor_type: 'System',
          actor_name: 'Didit Monitoring Job Poll',
          event_type: 'didit_ongoing_monitoring_resolved',
          notes: `Monitoring job ${jobId} failed: ${job.error || 'unknown error'}.`,
        }).catch(() => {});
        return;
      }
      // PENDING / PROCESSING — keep polling.
    } catch (err) {
      console.error('resolveMonitoringJob poll error:', err?.message);
    }
  }
  console.warn('resolveMonitoringJob: gave up after max attempts', { clientId, jobId });
}