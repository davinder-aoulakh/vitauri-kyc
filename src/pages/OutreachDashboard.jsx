import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import AppShell from '@/components/layout/AppShell';
import { useTenant } from '@/lib/tenantContext';
import { differenceInDays, isToday, parseISO } from 'date-fns';
import { Mail, AlertTriangle, Clock, CheckCircle2, ChevronRight, ChevronLeft, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_STYLES = {
  Draft: 'bg-gray-100 text-gray-600',
  Sent: 'bg-blue-100 text-blue-700',
  Viewed: 'bg-purple-100 text-purple-700',
  Partial_Response: 'bg-amber-100 text-amber-700',
  Complete: 'bg-green-100 text-green-700',
};

function KpiTile({ icon: TileIcon, label, value, color }) {
  const Icon = TileIcon;
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function aiNextAction(request) {
  const daysSince = request.updated_date
    ? differenceInDays(new Date(), new Date(request.updated_date))
    : differenceInDays(new Date(), new Date(request.created_date));
  const { status } = request;

  if (status === 'Complete') return { label: 'Close file', color: 'text-green-600' };
  if (status === 'Partial_Response' && daysSince >= 7) return { label: 'Send Additional Info template', color: 'text-amber-600' };
  if (status === 'Partial_Response') return { label: 'Await remaining items', color: 'text-blue-600' };
  if (daysSince >= 14) return { label: 'Escalate / 2nd reminder', color: 'text-red-600' };
  if (daysSince >= 7) return { label: 'Send 2nd reminder', color: 'text-amber-600' };
  return { label: 'Monitor', color: 'text-muted-foreground' };
}

export default function OutreachDashboard() {
  const navigate = useNavigate();
  const { currentUser } = useTenant();
  const [requests, setRequests] = useState([]);
  const [clients, setClients] = useState({});
  const [cases, setCases] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [advisoryOpen, setAdvisoryOpen] = useState(true);
  const [aiAdvisory, setAiAdvisory] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!currentUser?.tenant_id) return;
    loadData();
  }, [currentUser?.tenant_id]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const reqs = await base44.entities.OutreachRequest.filter({ tenant_id: currentUser.tenant_id });
      setRequests(reqs);

      // Build client & case lookup maps
      const clientIds = [...new Set(reqs.map(r => r.client_id).filter(Boolean))];
      const caseIds = [...new Set(reqs.map(r => r.case_id).filter(Boolean))];

      const [clientList, caseList] = await Promise.all([
        clientIds.length ? base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }) : Promise.resolve([]),
        caseIds.length ? base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }) : Promise.resolve([]),
      ]);

      setClients(Object.fromEntries(clientList.map(c => [c.id, c])));
      setCases(Object.fromEntries(caseList.map(c => [c.id, c])));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateAdvisory() {
    if (!requests.length) return;
    setAiLoading(true);
    try {
      const noResponse14 = requests
        .filter(r => r.status !== 'Complete' && differenceInDays(new Date(), new Date(r.updated_date || r.created_date)) >= 14)
        .map(r => clients[r.client_id]?.full_name || r.client_id);

      const partial7 = requests.filter(
        r => r.status === 'Partial_Response' && differenceInDays(new Date(), new Date(r.updated_date || r.created_date)) >= 7
      ).length;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a KYC Compliance Officer reviewing outstanding client outreach.

Files with no meaningful response for 14+ days: ${noResponse14.length ? noResponse14.join(', ') : 'None'}
Files in Partial_Response for 7+ days: ${partial7}
Total active outreach: ${requests.filter(r => r.status !== 'Complete').length}

Provide a concise 2–3 bullet advisory using this format:
• [Observation]: [Recommended action]

Be specific and actionable. Reference template names like "Second Reminder" or "Additional Info Request" where appropriate.`,
      });
      setAiAdvisory(result);
    } catch (e) {
      setAiAdvisory('Unable to generate advisory at this time.');
    } finally {
      setAiLoading(false);
    }
  }

  // KPI calculations
  const today = new Date();
  const active = requests.filter(r => r.status !== 'Complete');
  const overdue = requests.filter(r => r.status !== 'Complete' && r.deadline && new Date(r.deadline) < today);
  const partial = requests.filter(r => r.status === 'Partial_Response');
  const completedToday = requests.filter(r => r.status === 'Complete' && isToday(parseISO(r.updated_date || r.created_date)));

  function itemProgress(request) {
    const items = request.items || [];
    if (!items.length) return '—';
    const received = items.filter(i => i.status === 'Received' || i.status === 'Verified').length;
    return `${received}/${items.length}`;
  }

  function daysSinceSent(request) {
    const base = request.updated_date || request.created_date;
    if (!base) return '—';
    const d = differenceInDays(today, new Date(base));
    return d === 0 ? 'Today' : `${d}d`;
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="p-6">
          <div className="bg-destructive/10 text-destructive rounded-lg p-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
            <button onClick={loadData} className="ml-auto text-xs underline">Retry</button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Outreach Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Track client document requests and follow-up actions</p>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile icon={Mail} label="Files in Outreach" value={active.length} color="bg-blue-100 text-blue-600" />
          <KpiTile icon={AlertTriangle} label="Overdue Responses" value={overdue.length} color="bg-red-100 text-red-600" />
          <KpiTile icon={Clock} label="Partial Responses" value={partial.length} color="bg-amber-100 text-amber-600" />
          <KpiTile icon={CheckCircle2} label="Completed Today" value={completedToday.length} color="bg-green-100 text-green-600" />
        </div>

        {/* Main content + Advisory panel */}
        <div className="flex gap-4 items-start">
          {/* Table */}
          <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden min-w-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Client</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Case Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Case ID</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Items</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Days Since</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Contact</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">AI Next Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">No outreach requests found</td>
                    </tr>
                  )}
                  {requests.map(req => {
                    const client = clients[req.client_id];
                    const kycCase = cases[req.case_id];
                    const action = aiNextAction(req);
                    const isOverdue = req.status !== 'Complete' && req.deadline && new Date(req.deadline) < today;
                    return (
                      <tr
                        key={req.id}
                        onClick={() => {
                          if (req.case_id) {
                            navigate(`/case/${req.case_id}`);
                          } else {
                            navigate(`/client/${req.client_id}`);
                          }
                        }}
                        className={cn(
                          'border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/40',
                          isOverdue && 'bg-red-50/50'
                        )}
                      >
                        <td className="px-4 py-3 font-medium text-foreground">
                          {client?.full_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {req.case_id
                            ? (kycCase?.case_type?.replace(/_/g, ' ') || '—')
                            : <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">Standalone</span>
                          }
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {req.case_id?.slice(-8) || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[req.status] || 'bg-gray-100 text-gray-600')}>
                            {req.status?.replace(/_/g, ' ') || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{itemProgress(req)}</td>
                        <td className={cn('px-4 py-3 text-sm', isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                          {daysSinceSent(req)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {client?.primary_contact_email || '—'}
                        </td>
                        <td className={cn('px-4 py-3 text-xs font-medium', action.color)}>
                          {action.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Advisory Panel */}
          <div className={cn('flex-shrink-0 transition-all duration-300', advisoryOpen ? 'w-72' : 'w-10')}>
            {advisoryOpen ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">AI Advisory</span>
                  </div>
                  <button onClick={() => setAdvisoryOpen(false)} className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  {!aiAdvisory && !aiLoading && (
                    <div className="text-xs text-muted-foreground">
                      Click below to generate AI-powered follow-up recommendations for your active outreach files.
                    </div>
                  )}
                  {aiLoading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Analysing outreach data…
                    </div>
                  )}
                  {aiAdvisory && !aiLoading && (
                    <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                      {aiAdvisory}
                    </div>
                  )}
                  <button
                    onClick={generateAdvisory}
                    disabled={aiLoading}
                    className="w-full mt-2 px-3 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3 h-3" />
                    {aiAdvisory ? 'Refresh Advisory' : 'Generate Advisory'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdvisoryOpen(true)}
                className="w-10 h-full min-h-32 bg-card border border-border rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}