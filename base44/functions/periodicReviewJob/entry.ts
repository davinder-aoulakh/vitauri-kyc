/**
 * Periodic Review Automation Job
 * Runs daily: finds clients whose next_review_date is today or overdue
 * and creates a Periodic_Review KYC case pre-filled from the last approved case.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { format, addDays } from 'npm:date-fns@3.6.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = format(today, 'yyyy-MM-dd');

  let created = 0, errors = 0;

  // Fetch all active clients with a review date due today or earlier
  const clients = await base44.asServiceRole.entities.Client.filter({ status: 'Active' }, 'next_review_date', 500);

  for (const client of (clients || [])) {
    if (!client.next_review_date) continue;
    if (client.next_review_date > todayStr) continue; // not yet due

    try {
      // Check if a Periodic_Review case is already open for this client (avoid duplicates)
      const existingCases = await base44.asServiceRole.entities.KycCase.filter({
        client_id: client.id,
        case_type: 'Periodic_Review',
        status: 'Draft',
      }, null, 1);
      if (existingCases?.length > 0) continue;

      // Find last approved case
      const prevCases = await base44.asServiceRole.entities.KycCase.filter(
        { client_id: client.id, status: 'Approved' },
        '-created_date',
        1
      );
      const prevCase = prevCases?.[0];

      const dueDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');

      const newCase = await base44.asServiceRole.entities.KycCase.create({
        tenant_id: client.tenant_id,
        client_id: client.id,
        case_type: 'Periodic_Review',
        status: 'Draft',
        assigned_analyst_id: prevCase?.assigned_analyst_id || client.assigned_analyst_id || null,
        trigger_reason: `Periodic review triggered automatically. Review date: ${client.next_review_date}. Previous review: ${client.last_review_date || 'N/A'}`,
        due_date: dueDate,
        previous_case_id: prevCase?.id || null,
        risk_classification: prevCase?.risk_classification || client.risk_classification || null,
        step_1_status: 'not_started', step_2_status: 'not_started', step_3_status: 'not_started',
        step_4_status: 'not_started', step_5_status: 'not_started', step_6_status: 'not_started',
        step_7_status: 'not_started', step_8_status: 'not_started',
      });

      await base44.asServiceRole.entities.AuditEvent.create({
        tenant_id: client.tenant_id,
        case_id: newCase.id,
        actor_type: 'System',
        event_type: 'periodic_review_created',
        notes: `Auto-created by daily review job. Review date was ${client.next_review_date}.`,
      });

      // In-app notification to assigned analyst
      const analystId = prevCase?.assigned_analyst_id || client.assigned_analyst_id;
      if (analystId) {
        await base44.asServiceRole.entities.Notification.create({
          tenant_id: client.tenant_id,
          user_id: analystId,
          type: 'periodic_review_created',
          title: 'Periodic Review Due',
          body: `A periodic review for ${client.full_name} (${client.risk_classification || 'Unknown'} risk) is now due. Please open and complete the review within 30 days.`,
          link_case_id: newCase.id,
          link_client_id: client.id,
        });
      }

      created++;
      console.log(`Created periodic review case for client ${client.id} (${client.full_name})`);
    } catch (err) {
      console.error(`Error creating periodic review for client ${client.id}:`, err.message);
      errors++;
    }
  }

  console.log(`Periodic review job complete: ${created} cases created, ${errors} errors`);

  return Response.json({ status: 'ok', cases_created: created, errors });
});