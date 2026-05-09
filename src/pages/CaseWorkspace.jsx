import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import RiskBadge from '@/components/shared/RiskBadge';
import StatusBadge from '@/components/shared/StatusBadge';

// Step components
import OutreachStep         from '@/components/case/OutreachStep';
import IdentityVerificationStep from '@/components/case/IdentityVerificationStep';
import ScreeningStep        from '@/components/case/ScreeningStep';
import SoFSoWStep           from '@/components/case/SoFSoWStep';
import RiskAssessmentStep   from '@/components/case/RiskAssessmentStep';
import ControlMeasuresStep  from '@/components/case/ControlMeasuresStep';
import SignOffStep          from '@/components/case/SignOffStep';
import KycReportStep        from '@/components/case/KycReportStep';
import AiAssistantPanel     from '@/components/case/AiAssistantPanel';
import ClientProfileStep    from '@/components/case/ClientProfileStep';
import CaseTypeBanner       from '@/components/case/views/CaseTypeBanner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ChevronLeft, CheckCircle, Circle, AlertTriangle, Clock,
  MessageSquare, User, Shield, BarChart3, ClipboardCheck,
  FileText, Loader2
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';

const STEPS = [
  { id: 1, label: 'Outreach & Documents', icon: MessageSquare, stepKey: 'step_1_status' },
  { id: 2, label: 'Identity Verification', icon: User,          stepKey: 'step_2_status' },
  { id: 3, label: 'Screening',             icon: Shield,        stepKey: 'step_3_status' },
  { id: 4, label: 'Client Profile',        icon: User,          stepKey: 'step_4_status' },
  { id: 5, label: 'Source of Funds/Wealth',icon: FileText,      stepKey: 'step_5_status' },
  { id: 6, label: 'Risk Assessment',       icon: BarChart3,     stepKey: 'step_6_status' },
  { id: 7, label: 'Control Measures',      icon: ClipboardCheck,stepKey: 'step_7_status' },
  { id: 8, label: 'Sign-Off & Report',     icon: CheckCircle,   stepKey: 'step_8_status' },
];

const STATUS_ORDER = ['Draft','In_Progress','Outreach_Pending','Screening','Assessment','QC','Compliance_Review','Sign_Off_Pending','Approved','Rejected','Closed'];

function StepIcon({ status }) {
  if (status === 'complete')     return <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  if (status === 'in_progress')  return <Clock className="w-4 h-4 text-blue-500 flex-shrink-0" />;
  if (status === 'flagged')      return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/30 flex-shrink-0" />;
}



export default function CaseWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useTenant();

  const [kycCase, setKycCase] = useState(null);
  const [client, setClient]   = useState(null);
  const [users, setUsers]     = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStep, setActiveStep] = useState(1);
  const [mainTab, setMainTab] = useState('workspace'); // 'workspace' | 'audit'
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [statusOverrideOpen, setStatusOverrideOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideNote, setOverrideNote] = useState('');

  const userRole = currentUser?.app_role;
  const canOverrideStatus = hasPermission(userRole, 'viewAllTenantCases');

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    try {
      const caseData = await base44.entities.KycCase.filter({ id });
      const c = caseData?.[0];
      setKycCase(c);
      setNoteText(c?.case_notes || '');

      const [clientData, usersData, auditData] = await Promise.all([
        c?.client_id ? base44.entities.Client.filter({ id: c.client_id }) : Promise.resolve([]),
        base44.entities.User.list().catch(() => []),
        base44.entities.AuditEvent.filter({ case_id: id }, '-created_date', 100).catch(() => []),
      ]);
      setClient(clientData?.[0] || null);
      setUsers(usersData || []);
      setAuditEvents(auditData || []);
    } finally {
      setLoading(false);
    }
  }

  async function saveNote() {
    setNoteSaving(true);
    await base44.entities.KycCase.update(id, { case_notes: noteText });
    setNoteSaving(false);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  }

  async function updateStepStatus(stepKey, status) {
    const updated = await base44.entities.KycCase.update(id, { [stepKey]: status });
    setKycCase(prev => ({ ...prev, [stepKey]: status }));
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: `step_${stepKey.replace('_status','')}_${status}`,
      notes: `Step ${stepKey} marked as ${status}`,
    });
    // Refresh audit
    const auditData = await base44.entities.AuditEvent.filter({ case_id: id }, '-created_date', 100);
    setAuditEvents(auditData || []);
  }

  async function handleStatusOverride() {
    if (!overrideStatus || overrideNote.length < 10) return;
    await base44.entities.KycCase.update(id, { status: overrideStatus });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'case_status_override',
      notes: overrideNote,
      is_override: true,
    });
    setKycCase(prev => ({ ...prev, status: overrideStatus }));
    setStatusOverrideOpen(false);
    setOverrideStatus('');
    setOverrideNote('');
  }

  if (loading) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    </AppShell>
  );

  if (!kycCase) return (
    <AppShell>
      <div className="p-8 text-center text-muted-foreground">Case not found.</div>
    </AppShell>
  );

  const daysOpen = kycCase.created_date ? differenceInDays(new Date(), new Date(kycCase.created_date)) : 0;
  const assignedAnalyst = users.find(u => u.id === kycCase.assigned_analyst_id);
  const activeStepData = STEPS[activeStep - 1];
  const stepStatus = kycCase[activeStepData?.stepKey] || 'not_started';

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">

        {/* ── Case Header Bar ── */}
        <div className="bg-card border-b border-border px-4 py-2.5 flex-shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {/* Breadcrumb */}
            <button
              onClick={() => navigate(client ? `/client/${kycCase.client_id}` : '/')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back to Client
            </button>

            <div className="hidden sm:block w-px h-4 bg-border flex-shrink-0" />

            {/* Client + case info */}
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
              <span className="font-semibold text-sm text-foreground truncate">{client?.full_name || '—'}</span>
              <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0',
                client?.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
              )}>
                {client?.client_type || '—'}
              </span>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded flex-shrink-0">
                {kycCase.case_type?.replace(/_/g,' ')}
              </span>
              <StatusBadge status={kycCase.status} />
              <RiskBadge risk={kycCase.risk_classification} />
            </div>

            {/* Meta */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0 flex-wrap">
              <span>Analyst: <strong className="text-foreground">{assignedAnalyst?.full_name || '—'}</strong></span>
              <span>Due: <strong className={cn('', kycCase.due_date && new Date() > new Date(kycCase.due_date) ? 'text-red-600' : 'text-foreground')}>
                {kycCase.due_date ? format(new Date(kycCase.due_date), 'd MMM') : '—'}
              </strong></span>
              <span className="text-muted-foreground">{daysOpen}d open</span>
              {canOverrideStatus && (
                <button
                  className="text-xs text-primary font-medium hover:text-primary/80"
                  onClick={() => setStatusOverrideOpen(true)}
                >
                  Override Status
                </button>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-2 mt-2">
            <button
              className={cn('text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
                mainTab === 'workspace' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted/50'
              )}
              onClick={() => setMainTab('workspace')}
            >
              Workspace
            </button>
            <button
              className={cn('text-xs font-medium px-3 py-1.5 rounded-md transition-colors',
                mainTab === 'audit' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted/50'
              )}
              onClick={() => setMainTab('audit')}
            >
              Case Audit Trail ({auditEvents.length})
            </button>
          </div>
        </div>

        {/* ── Audit Trail view ── */}
        {mainTab === 'audit' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="bg-card border border-border rounded-xl overflow-hidden max-w-4xl mx-auto">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-sm">Case Audit Trail</h3>
                <span className="text-xs text-muted-foreground">Append-only · {auditEvents.length} events</span>
              </div>
              {auditEvents.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">No events yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left px-4 py-2.5 whitespace-nowrap">Timestamp</th>
                        <th className="text-left px-4 py-2.5">Actor</th>
                        <th className="text-left px-4 py-2.5">Type</th>
                        <th className="text-left px-4 py-2.5">Event</th>
                        <th className="text-left px-4 py-2.5">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {auditEvents.map(e => (
                        <tr key={e.id} className={cn('hover:bg-muted/20 transition-colors', e.is_override && 'bg-amber-50/40')}>
                          <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {e.created_date ? format(new Date(e.created_date), 'd MMM yyyy HH:mm') : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs font-medium">{e.actor_name || '—'}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                              e.actor_type === 'AI_Agent' ? 'bg-purple-100 text-purple-700' :
                              e.actor_type === 'System'   ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                            )}>
                              {e.actor_type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {e.is_override && <span className="text-amber-600 mr-1">⚠</span>}
                            {e.event_type?.replace(/_/g,' ')}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{e.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Workspace view ── */}
        {mainTab === 'workspace' && (
          <div className="flex flex-1 overflow-hidden">

            {/* Left Rail */}
            <aside className="w-52 bg-card border-r border-border flex-shrink-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-2 pt-3">
                <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest px-2 mb-2">Steps</div>
                {STEPS.map(step => {
                  const s = kycCase[step.stepKey] || 'not_started';
                  return (
                    <button
                      key={step.id}
                      onClick={() => setActiveStep(step.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors group text-xs',
                        activeStep === step.id
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      )}
                    >
                      <StepIcon status={s} />
                      <span className="leading-tight truncate">{step.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Case Notes */}
              <div className="border-t border-border p-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-semibold text-muted-foreground">Case Notes</div>
                  {noteSaved && <span className="text-xs text-emerald-600">✓</span>}
                </div>
                <Textarea
                  value={noteText}
                  onChange={e => { setNoteText(e.target.value); setNoteSaved(false); }}
                  placeholder="Add notes…"
                  className="text-xs min-h-14 resize-none"
                  onBlur={saveNote}
                />
                {noteSaving && <div className="text-xs text-muted-foreground mt-1">Saving…</div>}
              </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto bg-background">
              <div className="p-6 max-w-3xl">
                {/* Step header */}
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-0.5">
                      Step {activeStep} of 8
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">{activeStepData?.label}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {stepStatus !== 'in_progress' && stepStatus !== 'complete' && (
                      <Button
                        variant="outline" size="sm" className="text-xs gap-1"
                        onClick={() => updateStepStatus(activeStepData.stepKey, 'in_progress')}
                      >
                        <Clock className="w-3 h-3" /> Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className={cn('text-xs gap-1', stepStatus === 'complete' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : '')}
                      variant={stepStatus === 'complete' ? 'default' : 'outline'}
                      onClick={() => updateStepStatus(activeStepData.stepKey, stepStatus === 'complete' ? 'in_progress' : 'complete')}
                    >
                      <CheckCircle className="w-3 h-3" />
                      {stepStatus === 'complete' ? '✓ Complete' : 'Mark Complete'}
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="text-xs gap-1 text-amber-600"
                      onClick={() => updateStepStatus(activeStepData.stepKey, 'flagged')}
                      disabled={stepStatus === 'flagged'}
                    >
                      <AlertTriangle className="w-3 h-3" /> Flag
                    </Button>
                  </div>
                </div>

                {/* Case type context banner */}
                <CaseTypeBanner kycCase={kycCase} client={client} />

                {/* Step content */}
                {activeStep === 1 && <OutreachStep kycCase={kycCase} client={client} currentUser={currentUser} />}
                {activeStep === 2 && <IdentityVerificationStep kycCase={kycCase} client={client} currentUser={currentUser} />}
                {activeStep === 3 && <ScreeningStep caseId={id} tenantId={currentUser?.tenant_id} currentUser={currentUser} kycCase={kycCase} client={client} />}
                {activeStep === 4 && <ClientProfileStep kycCase={kycCase} client={client} currentUser={currentUser} />}
                {activeStep === 5 && <SoFSoWStep kycCase={kycCase} client={client} currentUser={currentUser} />}
                {activeStep === 6 && <RiskAssessmentStep kycCase={kycCase} client={client} currentUser={currentUser} onCaseUpdate={setKycCase} />}
                {activeStep === 7 && <ControlMeasuresStep kycCase={kycCase} currentUser={currentUser} />}
                {activeStep === 8 && (
                  <div className="space-y-8">
                    <SignOffStep kycCase={kycCase} client={client} currentUser={currentUser} onCaseUpdate={setKycCase} />
                    <div className="border-t border-border pt-6">
                      <KycReportStep kycCase={kycCase} client={client} currentUser={currentUser} />
                    </div>
                  </div>
                )}
              </div>
            </main>

            {/* AI Assistant Panel */}
            <AiAssistantPanel
              kycCase={kycCase}
              client={client}
              activeStep={activeStep}
              currentUser={currentUser}
              collapsed={aiCollapsed}
              onToggleCollapse={() => setAiCollapsed(c => !c)}
            />
          </div>
        )}
      </div>

      {/* Status Override Modal */}
      {statusOverrideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-5 w-96 shadow-xl space-y-4">
            <h3 className="font-semibold text-sm">Override Case Status</h3>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">New Status</label>
              <Select value={overrideStatus} onValueChange={setOverrideStatus}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Justification (min 10 chars) *</label>
              <Textarea
                value={overrideNote}
                onChange={e => setOverrideNote(e.target.value)}
                placeholder="Reason for manual override…"
                className="text-sm min-h-16"
              />
              <div className="text-xs text-muted-foreground mt-1">{overrideNote.length}/10</div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setStatusOverrideOpen(false)}>Cancel</Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={!overrideStatus || overrideNote.length < 10}
                onClick={handleStatusOverride}
              >
                Apply Override
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}