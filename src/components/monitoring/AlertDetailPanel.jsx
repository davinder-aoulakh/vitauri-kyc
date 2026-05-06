/**
 * Slide-over panel for a full monitoring alert detail view
 * with AI impact summary, Dismiss / Acknowledge / Escalate to EDR actions
 */
import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  X, AlertTriangle, CheckCircle, Loader2, Sparkles,
  Eye, MessageSquare, Shield, ArrowUpRight
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

const ALERT_TYPE_STYLE = {
  Screening_Hit:   'bg-red-100 text-red-700 border-red-200',
  Register_Change: 'bg-blue-100 text-blue-700 border-blue-200',
  Manual_Flag:     'bg-amber-100 text-amber-700 border-amber-200',
};

const STATUS_STYLE = {
  New:              'bg-orange-100 text-orange-700',
  Under_Review:     'bg-blue-100 text-blue-700',
  Dismissed:        'bg-slate-100 text-slate-500',
  Escalated_to_EDR: 'bg-red-100 text-red-700',
};

export default function AlertDetailPanel({ alert, currentUser, onClose, onUpdated, onNavigateCase }) {
  const [aiSummary, setAiSummary]         = useState(alert?.ai_impact_summary || '');
  const [generatingAi, setGeneratingAi]   = useState(false);
  const [justification, setJustification] = useState('');
  const [acknowledgeNote, setAckNote]     = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [action, setAction]               = useState(null); // 'dismiss' | 'acknowledge' | 'escalate'

  async function generateAiSummary() {
    setGeneratingAi(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a KYC compliance analyst. A monitoring alert has been triggered for a client.

Alert Type: ${alert.alert_type?.replace(/_/g,' ')}
Entity: ${alert.entity_name} (${alert.entity_type?.replace(/_/g,' ')})
Source: ${alert.source || 'Unknown'}
Details: ${JSON.stringify(alert.details || {})}

Write a concise (3–4 sentence) AI impact summary:
1. State the nature of the alert and what triggered it
2. Describe the potential risk impact to the institution
3. Recommend whether this warrants dismissal, monitoring, or EDR escalation

Tone: professional, regulatory-grade.`,
    });
    const summary = typeof result === 'string' ? result : result?.narrative || result?.summary || JSON.stringify(result);
    setAiSummary(summary);
    await base44.entities.MonitoringAlert.update(alert.id, { ai_impact_summary: summary });
    setGeneratingAi(false);
  }

  async function dismiss() {
    if (!justification.trim()) return;
    setSubmitting(true);
    await base44.entities.MonitoringAlert.update(alert.id, {
      status: 'Dismissed',
      dismissed_justification: justification,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'monitoring_alert_dismissed',
      notes: `Alert for ${alert.entity_name} dismissed: ${justification}`,
    });
    setSubmitting(false);
    onUpdated();
    onClose();
  }

  async function acknowledge() {
    setSubmitting(true);
    await base44.entities.MonitoringAlert.update(alert.id, {
      status: 'Under_Review',
      ...(acknowledgeNote && { dismissed_justification: acknowledgeNote }),
    });
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'monitoring_alert_acknowledged',
      notes: acknowledgeNote || `Alert for ${alert.entity_name} acknowledged for monitoring`,
    });
    setSubmitting(false);
    onUpdated();
    onClose();
  }

  async function escalateToEDR() {
    setSubmitting(true);
    const dueDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');

    // Fetch last approved case for this client to pre-fill
    const prevCases = await base44.entities.KycCase.filter(
      { client_id: alert.client_id, status: 'Approved' },
      '-created_date',
      1
    );
    const prevCase = prevCases?.[0];

    const triggerReason = `Monitoring alert: ${alert.alert_type?.replace(/_/g,' ')} — Source: ${alert.source || 'Unknown'}. ${aiSummary ? 'AI Summary: ' + aiSummary : ''}`;

    const newCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: alert.client_id,
      case_type: 'Event_Driven_Review',
      status: 'Draft',
      assigned_analyst_id: prevCase?.assigned_analyst_id || currentUser.id,
      trigger_reason: triggerReason,
      due_date: dueDate,
      created_by_user_id: currentUser.id,
      previous_case_id: prevCase?.id || null,
      is_re_onboarding: false,
      risk_classification: prevCase?.risk_classification || null,
      // Pre-fill step statuses as not_started for the new EDR case
      step_1_status: 'not_started', step_2_status: 'not_started', step_3_status: 'not_started',
      step_4_status: 'not_started', step_5_status: 'not_started', step_6_status: 'not_started',
      step_7_status: 'not_started', step_8_status: 'not_started',
    });

    await base44.entities.MonitoringAlert.update(alert.id, {
      status: 'Escalated_to_EDR',
      edr_case_id: newCase.id,
    });

    // Audit events on both the alert and the new case
    await Promise.all([
      base44.entities.AuditEvent.create({
        tenant_id: currentUser.tenant_id,
        actor_user_id: currentUser.id,
        actor_name: currentUser.full_name,
        actor_type: 'User',
        event_type: 'monitoring_alert_escalated_to_edr',
        notes: `EDR case created: ${newCase.id} for alert on ${alert.entity_name}`,
      }),
      base44.entities.AuditEvent.create({
        tenant_id: currentUser.tenant_id,
        case_id: newCase.id,
        actor_user_id: currentUser.id,
        actor_name: currentUser.full_name,
        actor_type: 'System',
        event_type: 'edr_case_created_from_alert',
        notes: triggerReason,
      }),
      // Notify assigned analyst if different
      prevCase?.assigned_analyst_id && prevCase.assigned_analyst_id !== currentUser.id
        ? base44.entities.Notification.create({
            tenant_id: currentUser.tenant_id,
            user_id: prevCase.assigned_analyst_id,
            type: 'case_assigned',
            title: 'New EDR Case Assigned',
            body: `An Event-Driven Review has been triggered for client based on a monitoring alert. Due: ${dueDate}`,
            link_case_id: newCase.id,
          })
        : Promise.resolve(),
    ]);

    setSubmitting(false);
    onUpdated();
    onNavigateCase(newCase.id);
  }

  if (!alert) return null;
  const isResolved = ['Dismissed', 'Escalated_to_EDR'].includes(alert.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-[520px] bg-card shadow-2xl flex flex-col h-full animate-slide-in-right border-l border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Alert Detail</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Alert metadata */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', ALERT_TYPE_STYLE[alert.alert_type])}>
                {alert.alert_type?.replace(/_/g,' ')}
              </span>
              <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full', STATUS_STYLE[alert.status])}>
                {alert.status?.replace(/_/g,' ')}
              </span>
            </div>

            <div>
              <div className="text-base font-semibold text-foreground">{alert.entity_name || '—'}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {alert.entity_type?.replace(/_/g,' ')} · Source: {alert.source || '—'} · Detected: {alert.created_date ? format(new Date(alert.created_date), 'd MMM yyyy HH:mm') : '—'}
              </div>
            </div>

            {alert.details && Object.keys(alert.details).length > 0 && (
              <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                {Object.entries(alert.details).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-muted-foreground capitalize">{k.replace(/_/g,' ')}</span>
                    <span className="font-medium text-foreground max-w-[60%] truncate text-right">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}

            {alert.dismissed_justification && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700">
                <strong>Analyst Note:</strong> {alert.dismissed_justification}
              </div>
            )}
          </div>

          {/* AI Impact Summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Impact Summary</div>
              {!isResolved && (
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-purple-600 hover:bg-purple-50"
                  onClick={generateAiSummary} disabled={generatingAi}>
                  {generatingAi ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {aiSummary ? 'Regenerate' : 'Generate'}
                </Button>
              )}
            </div>
            {aiSummary ? (
              <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3 text-xs text-purple-900 leading-relaxed">
                {aiSummary}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic bg-muted/30 rounded-lg p-3">
                Click "Generate" to get an AI-drafted impact assessment for this alert.
              </div>
            )}
          </div>

          {/* EDR link if already escalated */}
          {alert.status === 'Escalated_to_EDR' && alert.edr_case_id && (
            <button
              className="w-full flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 hover:bg-red-100 transition-colors"
              onClick={() => onNavigateCase(alert.edr_case_id)}
            >
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <span className="text-xs font-semibold text-red-700">View EDR Case</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-red-500 ml-auto" />
            </button>
          )}
        </div>

        {/* Action footer — only for active alerts */}
        {!isResolved && (
          <div className="border-t border-border p-5 space-y-3 flex-shrink-0">
            {!action && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Analyst Decision</div>
                <Button size="sm" variant="outline" className="w-full gap-2 text-xs justify-start border-slate-300 hover:bg-slate-50"
                  onClick={() => setAction('dismiss')}>
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Dismiss — No material impact
                </Button>
                <Button size="sm" variant="outline" className="w-full gap-2 text-xs justify-start border-blue-300 hover:bg-blue-50 text-blue-700"
                  onClick={() => setAction('acknowledge')}>
                  <Eye className="w-3.5 h-3.5" /> Acknowledge — Continue monitoring
                </Button>
                <Button size="sm" className="w-full gap-2 text-xs justify-start bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => setAction('escalate')}>
                  <AlertTriangle className="w-3.5 h-3.5" /> Escalate to Event-Driven Review
                </Button>
              </div>
            )}

            {action === 'dismiss' && (
              <div className="space-y-3">
                <div className="text-xs font-semibold">Dismissal Justification *</div>
                <Textarea value={justification} onChange={e => setJustification(e.target.value)}
                  placeholder="Document why this alert has no material impact…"
                  className="text-xs min-h-16 resize-none" />
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAction(null)}>Back</Button>
                  <Button size="sm" className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    onClick={dismiss} disabled={!justification.trim() || submitting}>
                    {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Confirm Dismissal
                  </Button>
                </div>
              </div>
            )}

            {action === 'acknowledge' && (
              <div className="space-y-3">
                <div className="text-xs font-semibold">Note (optional)</div>
                <Textarea value={acknowledgeNote} onChange={e => setAckNote(e.target.value)}
                  placeholder="Add a monitoring note…"
                  className="text-xs min-h-12 resize-none" />
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAction(null)}>Back</Button>
                  <Button size="sm" className="flex-1 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1"
                    onClick={acknowledge} disabled={submitting}>
                    {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                    Acknowledge &amp; Monitor
                  </Button>
                </div>
              </div>
            )}

            {action === 'escalate' && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 space-y-1">
                  <div className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Create Event-Driven Review</div>
                  <div>A new EDR case will be created for this client, pre-filled with the last approved case data and this alert as the trigger reason.</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAction(null)}>Back</Button>
                  <Button size="sm" className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white gap-1"
                    onClick={escalateToEDR} disabled={submitting}>
                    {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                    Confirm Escalation → EDR
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}