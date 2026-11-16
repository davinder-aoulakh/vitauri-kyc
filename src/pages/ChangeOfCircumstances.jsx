// Change of circumstances (KYC + AML layout, phase 5): events that may need a review, and the graduated response.
// Screening and transaction monitoring only raise events here; the response decides which review steps are re-run.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { amlLayoutOn } from '@/lib/amlNav';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Lock, RefreshCw, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { RESPONSES, RESPONSE_LABEL, RESPONSE_HELP, STATUS_LABEL, STEP_LABEL, stepsForResponse } from '@/lib/cocResponse';

const STATUS_STYLE = {
  proposed: 'bg-orange-100 text-orange-700',
  accepted: 'bg-blue-100 text-blue-700',
  dismissed: 'bg-slate-100 text-slate-500',
};
const FILTERS = [
  { key: 'proposed', label: STATUS_LABEL.proposed },
  { key: 'accepted', label: STATUS_LABEL.accepted },
  { key: 'dismissed', label: STATUS_LABEL.dismissed },
  { key: 'all', label: 'All' },
];
const day = (iso) => (iso ? format(new Date(iso), 'd MMM yyyy') : '—');

function RespondDialog({ event, onClose, onDone }) {
  const { toast } = useToast();
  const [response, setResponse] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = response ? stepsForResponse(event.trigger_type, response) : null;
  const minLen = response === 'no_action' ? 10 : 5;
  const ready = !!response && reason.trim().length >= minLen;

  async function submit() {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('decideEdrTrigger', { action: 'respond', edr_trigger_id: event.id, response, reason: reason.trim() });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      toast({ title: data?.kyc_case_id ? 'Review started' : 'Event closed', description: `${RESPONSE_LABEL[response]} · ${event.client_name}` });
      onDone(data);
    } catch (e) {
      toast({ title: 'Could not save the response', description: e?.response?.data?.error || e?.message || 'Try again', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Respond to change of circumstances</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
            <div className="font-semibold text-sm text-foreground">{event.client_name}</div>
            <div className="text-muted-foreground">{event.type_label} · {event.source_label} · {day(event.created_date)}</div>
            {event.summary && <div className="text-foreground">{event.summary}</div>}
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Response</div>
            {RESPONSES.map((r) => (
              <button key={r} type="button" onClick={() => setResponse(r)}
                className={cn('w-full text-left rounded-lg border px-3 py-2 transition-colors', response === r ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
                <div className="flex items-center gap-2">
                  <span className={cn('w-3.5 h-3.5 rounded-full border flex-shrink-0', response === r ? 'border-primary bg-primary' : 'border-muted-foreground/40')} />
                  <span className="text-sm font-medium">{RESPONSE_LABEL[r]}</span>
                </div>
                <div className="text-xs text-muted-foreground ml-5">{RESPONSE_HELP[r]}</div>
              </button>
            ))}
          </div>
          {plan && plan.createsReview && (
            <div className="text-xs rounded-lg border border-primary/20 bg-primary/5 p-3">
              <span className="font-semibold">Steps in the review: </span>
              {plan.required.map((n) => STEP_LABEL[n]).join(', ')}, then report and sign-off.
              {plan.required.length < 7 && <span className="text-muted-foreground"> The other steps are marked not required.</span>}
            </div>
          )}
          <div>
            <label className="text-xs font-medium block mb-1.5">Reason *</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="text-sm min-h-20"
              placeholder={response === 'no_action' ? 'Why no action is needed…' : 'Why this response fits the event…'} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={!ready || busy} className="gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {response === 'no_action' ? 'Close event' : 'Start review'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ChangeOfCircumstances() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const allowed = amlLayoutOn(tenant);
  const role = currentUser?.app_role;
  const canRespond = hasPermission(role, 'createRunCase');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('proposed');
  const [responding, setResponding] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await base44.functions.invoke('listChangeEvents', {});
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      setEvents(data?.events || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not load the events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed && currentUser?.tenant_id) load(); }, [allowed, currentUser?.tenant_id, load]);

  const counts = useMemo(() => {
    const c = { all: events.length, proposed: 0, accepted: 0, dismissed: 0 };
    for (const e of events) c[e.status] = (c[e.status] || 0) + 1;
    return c;
  }, [events]);
  const shown = filter === 'all' ? events : events.filter((e) => e.status === filter);

  if (!allowed) return <AppShell><EmptyState icon={Lock} title="Not available" description="This page is part of the KYC + AML layout, which is not switched on for this tenant." /></AppShell>;

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
        <PageHeader
          title="Change of circumstances"
          subtitle="Events that may need a review. Choose a response; only the steps the event touches are re-run."
          actions={<Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={load} disabled={loading}><RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh</Button>}
        />

        {error && (
          <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3">
            <span className="text-sm text-destructive flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                filter === f.key ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground hover:bg-muted')}>
              {f.label}
              <span className={cn('rounded-full px-1.5 font-semibold', filter === f.key ? 'bg-white/20' : 'bg-primary/10 text-primary')}>{counts[f.key] || 0}</span>
            </button>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : shown.length === 0 ? (
            <EmptyState icon={RefreshCw} title="No events" description={filter === 'proposed' ? 'Nothing is waiting for a response.' : 'No events with this status.'} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3">Event</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((e) => (
                  <tr key={e.id} className={cn('align-top', e.status === 'proposed' && 'bg-warning/5')}>
                    <td className="px-4 py-3">
                      <Link to={`/client/${e.client_id}`} className="font-medium text-xs text-foreground hover:underline">{e.client_name}</Link>
                      {e.client_risk && <div className="text-xs text-muted-foreground">{e.client_risk} risk</div>}
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                        {e.restricted && <ShieldAlert className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />}
                        {e.type_label}
                      </div>
                      {e.summary && <div className={cn('text-xs mt-0.5', e.masked ? 'text-amber-700' : 'text-muted-foreground')}>{e.summary}</div>}
                      {e.response_label && <div className="text-xs mt-1 text-foreground">Response: <span className="font-medium">{e.response_label}</span>{e.response_reason ? ` — ${e.response_reason}` : ''}</div>}
                      {!e.response_label && e.status === 'dismissed' && e.response_reason && <div className="text-xs mt-1 text-muted-foreground">Closed: {e.response_reason}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.source_label}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{day(e.created_date)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap', STATUS_STYLE[e.status])}>{e.status_label}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {e.status === 'proposed' && canRespond && (
                        <Button size="sm" className="h-7 text-xs" onClick={() => setResponding(e)}>Respond</Button>
                      )}
                      {e.kyc_case_id && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate(`/case/${e.kyc_case_id}`)}>
                          Open review <ArrowUpRight className="w-3 h-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {responding && (
        <RespondDialog
          event={responding}
          onClose={() => setResponding(null)}
          onDone={() => { setResponding(null); load(); }}
        />
      )}
    </AppShell>
  );
}