import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import RiskBadge from '@/components/shared/RiskBadge';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Plus, Loader2 } from 'lucide-react';
import { getDefaultStepConfig } from '@/lib/caseUtils';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

const NEW_CASE_TYPES = [
  { value: 'Periodic_Review',     label: 'Periodic Review',     disabled: false },
  { value: 'Event_Driven_Review', label: 'Event-Driven Review', disabled: false },
  { value: 'Offboarding',         label: 'Offboarding',         disabled: false },
];

export default function CasesTab({ client, cases, users, onRefresh }) {
  const navigate = useNavigate();
  const { currentUser } = useTenant();
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [caseType, setCaseType]       = useState('Periodic_Review');
  const [triggerReason, setTriggerReason] = useState('');
  const [dueDate, setDueDate]         = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [creating, setCreating]       = useState(false);

  const canCreateCase = hasPermission(currentUser?.app_role, 'createRunCase') &&
    !['Rejected','Unacceptable'].includes(client.status);

  async function handleCreateCase() {
    setCreating(true);
    const kycCase = await base44.entities.KycCase.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      case_type: caseType,
      status: 'Draft',
      assigned_analyst_id: currentUser.id,
      due_date: dueDate,
      trigger_reason: triggerReason || undefined,
      created_by_user_id: currentUser.id,
      ...getDefaultStepConfig(client.client_type, caseType),
    });
    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      case_id: kycCase.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'case_opened',
      notes: `New ${caseType.replace(/_/g,' ')} case created`,
    });
    setCreating(false);
    setNewCaseOpen(false);
    onRefresh?.();
    navigate(`/case/${kycCase.id}`);
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">KYC Cases ({cases.length})</h3>
        {canCreateCase && (
          <Button size="sm" className="gap-1 text-xs" onClick={() => setNewCaseOpen(true)}>
            <Plus className="w-3 h-3" /> Open New Case
          </Button>
        )}
      </div>

      {cases.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">No cases found for this client</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Case Type</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Risk</th>
                <th className="text-left px-4 py-2.5">Analyst</th>
                <th className="text-left px-4 py-2.5">Created</th>
                <th className="text-left px-4 py-2.5">Due Date</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cases.map(c => {
                const analyst = users?.find(u => u.id === c.assigned_analyst_id);
                const isOverdue = c.due_date && new Date() > new Date(c.due_date) && !['Approved','Closed','Rejected'].includes(c.status);
                return (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/case/${c.id}`)}>
                    <td className="px-4 py-3 font-medium text-foreground">{c.case_type?.replace(/_/g,' ')}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3"><RiskBadge risk={c.risk_classification} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{analyst?.full_name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.created_date ? format(new Date(c.created_date), 'd MMM yyyy') : '—'}</td>
                    <td className={cn('px-4 py-3 text-xs whitespace-nowrap', isOverdue ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                      {c.due_date ? format(new Date(c.due_date), 'd MMM yyyy') : '—'}
                      {isOverdue && ' ⚠'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-primary font-medium">Open →</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New case dialog */}
      <Dialog open={newCaseOpen} onOpenChange={setNewCaseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Open New Case — {client.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Case Type</Label>
              <Select value={caseType} onValueChange={setCaseType}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NEW_CASE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {caseType === 'Event_Driven_Review' && (
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Trigger Reason</Label>
                <Input value={triggerReason} onChange={e => setTriggerReason(e.target.value)} placeholder="Describe the event that triggered this review…" className="h-9 text-sm" />
              </div>
            )}
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Due Date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground">
              Case will be assigned to you and set to Draft status.
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNewCaseOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateCase} disabled={creating} className="gap-2">
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Case
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}