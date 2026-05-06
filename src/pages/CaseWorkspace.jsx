import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import RiskBadge from '@/components/shared/RiskBadge';
import StatusBadge from '@/components/shared/StatusBadge';
import ScreeningStep from '@/components/case/ScreeningStep';
import RiskAssessmentStep from '@/components/case/RiskAssessmentStep';
import SignOffStep from '@/components/case/SignOffStep';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  ChevronLeft, CheckCircle, Circle, AlertTriangle, Clock,
  ChevronRight, FileText, Shield, BarChart3, ClipboardCheck,
  MessageSquare, User, Building2, Loader2
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';

const STEPS = [
  { id: 1, label: 'Outreach & Documents', icon: MessageSquare, stepKey: 'step_1_status' },
  { id: 2, label: 'Identity Verification', icon: User, stepKey: 'step_2_status' },
  { id: 3, label: 'Screening', icon: Shield, stepKey: 'step_3_status' },
  { id: 4, label: 'Client Profile', icon: User, stepKey: 'step_4_status' },
  { id: 5, label: 'Source of Funds/Wealth', icon: FileText, stepKey: 'step_5_status' },
  { id: 6, label: 'Risk Assessment', icon: BarChart3, stepKey: 'step_6_status' },
  { id: 7, label: 'Control Measures', icon: ClipboardCheck, stepKey: 'step_7_status' },
  { id: 8, label: 'Sign-Off & Report', icon: CheckCircle, stepKey: 'step_8_status' },
];

function StepIcon({ status }) {
  if (status === 'complete') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (status === 'in_progress') return <Clock className="w-4 h-4 text-blue-500" />;
  if (status === 'flagged') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  return <Circle className="w-4 h-4 text-muted-foreground/40" />;
}

export default function CaseWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useTenant();
  const [kycCase, setKycCase] = useState(null);
  const [client, setClient] = useState(null);
  const [activeStep, setActiveStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState('');

  useEffect(() => { loadCase(); }, [id]);

  async function loadCase() {
    const [caseData] = await Promise.all([
      base44.entities.KycCase.filter({ id }),
    ]);
    const c = caseData?.[0];
    setKycCase(c);
    setNoteText(c?.case_notes || '');
    if (c?.client_id) {
      const [clientData] = await Promise.all([
        base44.entities.Client.filter({ id: c.client_id }),
      ]);
      setClient(clientData?.[0]);
    }
    setLoading(false);
  }

  async function saveNote() {
    setSaving(true);
    await base44.entities.KycCase.update(id, { case_notes: noteText });
    setSaving(false);
  }

  async function updateStepStatus(stepKey, status) {
    const updated = await base44.entities.KycCase.update(id, { [stepKey]: status });
    setKycCase(prev => ({ ...prev, [stepKey]: status }));
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
  const activeStepData = STEPS[activeStep - 1];

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {/* Case Header Bar */}
        <div className="bg-card border-b border-border px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
          <button
            onClick={() => navigate(client ? `/client/${kycCase.client_id}` : '/')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Client
          </button>
          <div className="flex-1 flex flex-wrap items-center gap-2 md:justify-center">
            <span className="font-semibold text-sm text-foreground">{client?.full_name || kycCase.client_id}</span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', kycCase.client_type==='ORG'?'bg-blue-100 text-blue-700':'bg-violet-100 text-violet-700')}>
              {kycCase.client_type}
            </span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{kycCase.case_type?.replace(/_/g,' ')}</span>
            <StatusBadge status={kycCase.status} />
            <RiskBadge risk={kycCase.risk_classification} />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Due: <strong className="text-foreground">{kycCase.due_date ? format(new Date(kycCase.due_date),'d MMM') : '—'}</strong></span>
            <span>{daysOpen}d open</span>
          </div>
        </div>

        {/* Main Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Rail */}
          <aside className="w-52 bg-card border-r border-border flex-shrink-0 flex flex-col overflow-y-auto">
            <div className="p-3 space-y-0.5">
              {STEPS.map(step => {
                const stepStatus = kycCase[step.stepKey] || 'not_started';
                return (
                  <button
                    key={step.id}
                    onClick={() => setActiveStep(step.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors group',
                      activeStep === step.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    <StepIcon status={stepStatus} />
                    <span className="text-xs leading-tight">{step.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Case Notes */}
            <div className="mt-auto border-t border-border p-3">
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Case Notes</div>
              <Textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add notes…"
                className="text-xs min-h-16 resize-none"
                onBlur={saveNote}
              />
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto bg-background">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Step {activeStep}</span>
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">{activeStepData?.label}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={() => updateStepStatus(activeStepData.stepKey, 'in_progress')}
                    disabled={kycCase[activeStepData?.stepKey] === 'in_progress'}
                  >
                    Mark In Progress
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => updateStepStatus(activeStepData.stepKey, 'complete')}
                    disabled={kycCase[activeStepData?.stepKey] === 'complete'}
                  >
                    <CheckCircle className="w-3 h-3" />
                    Mark Complete
                  </Button>
                </div>
              </div>

              {activeStep === 3 && (
                <ScreeningStep caseId={id} tenantId={currentUser?.tenant_id} currentUser={currentUser} />
              )}
              {activeStep === 6 && (
                <RiskAssessmentStep kycCase={kycCase} client={client} currentUser={currentUser} onCaseUpdate={setKycCase} />
              )}
              {activeStep === 8 && (
                <SignOffStep kycCase={kycCase} client={client} currentUser={currentUser} onCaseUpdate={setKycCase} />
              )}
              {![3, 6, 8].includes(activeStep) && (
                <StepPlaceholder step={activeStepData} caseId={id} />
              )}
            </div>
          </main>
        </div>
      </div>
    </AppShell>
  );
}

function StepPlaceholder({ step, caseId }) {
  return (
    <div className="bg-card border border-border rounded-xl p-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
        <step.icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-foreground mb-2">{step.label}</h3>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        This step workspace is ready. Use the controls above to track progress.
      </p>
    </div>
  );
}