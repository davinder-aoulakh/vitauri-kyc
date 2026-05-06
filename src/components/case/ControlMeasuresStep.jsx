import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, CheckCircle, Clock, AlertTriangle, Loader2, ClipboardCheck, Pencil, Info } from 'lucide-react';
import { format, addDays, isPast, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const STATUS_STYLES = {
  Open:        'bg-slate-100 text-slate-600 border-slate-200',
  In_Progress: 'bg-blue-100 text-blue-700 border-blue-200',
  Completed:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  Overdue:     'bg-red-100 text-red-700 border-red-200',
};

const EMPTY_FORM = {
  description: '', owner_user_id: '', owner_name: '',
  due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
  reminder_date: '', status: 'Open',
};

function isOverdue(measure) {
  return measure.status !== 'Completed' && measure.due_date && isPast(parseISO(measure.due_date));
}

export default function ControlMeasuresStep({ kycCase, currentUser }) {
  const [measures, setMeasures] = useState([]);
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState(null); // null = new
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);

  const risk = kycCase?.risk_classification;
  const isLowRisk = risk === 'Low';

  useEffect(() => { load(); }, [kycCase.id]);

  async function load() {
    const [data, usersData] = await Promise.all([
      base44.entities.ControlMeasure.filter({ case_id: kycCase.id }),
      base44.entities.User.list(),
    ]);
    // Auto-flag overdue
    const withStatus = (data || []).map(m => ({
      ...m,
      status: isOverdue(m) ? 'Overdue' : m.status,
    }));
    setMeasures(withStatus);
    setUsers(usersData || []);
    setLoading(false);
  }

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(m) {
    setEditing(m);
    setForm({
      description: m.description || '',
      owner_user_id: m.owner_user_id || '',
      owner_name: m.owner_name || '',
      due_date: m.due_date || format(addDays(new Date(), 30), 'yyyy-MM-dd'),
      reminder_date: m.reminder_date || '',
      status: m.status || 'Open',
    });
    setDialogOpen(true);
  }

  async function saveMeasure() {
    if (!form.description) return;
    setSaving(true);
    const owner = users.find(u => u.id === form.owner_user_id);
    const payload = {
      ...form,
      owner_name: owner?.full_name || form.owner_name,
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
    };
    if (editing) {
      await base44.entities.ControlMeasure.update(editing.id, payload);
      await base44.entities.AuditEvent.create({
        tenant_id: kycCase.tenant_id, case_id: kycCase.id,
        actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
        actor_type: 'User', event_type: 'control_measure_updated',
        notes: form.description,
      });
    } else {
      await base44.entities.ControlMeasure.create({ ...payload, owner_user_id: currentUser?.id });
      await base44.entities.AuditEvent.create({
        tenant_id: kycCase.tenant_id, case_id: kycCase.id,
        actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
        actor_type: 'User', event_type: 'control_measure_added',
        notes: form.description,
      });
      // In-app notification to owner if different from current user
      if (form.owner_user_id && form.owner_user_id !== currentUser?.id) {
        await base44.entities.Notification.create({
          tenant_id: kycCase.tenant_id,
          user_id: form.owner_user_id,
          type: 'control_measure_due',
          title: 'Control Measure Assigned',
          body: `You have been assigned a control measure due ${form.due_date}: "${form.description}"`,
          link_case_id: kycCase.id,
        });
      }
    }
    setDialogOpen(false);
    setSaving(false);
    load();
  }

  async function markComplete(m) {
    await base44.entities.ControlMeasure.update(m.id, { status: 'Completed' });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id, case_id: kycCase.id,
      actor_user_id: currentUser?.id, actor_name: currentUser?.full_name,
      actor_type: 'User', event_type: 'control_measure_completed',
      notes: m.description,
    });
    setMeasures(ms => ms.map(x => x.id === m.id ? { ...x, status: 'Completed' } : x));
  }

  const open = measures.filter(m => m.status !== 'Completed').length;
  const overdue = measures.filter(m => m.status === 'Overdue').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Control Measures</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            SMART mitigation actions · {open} open{overdue > 0 ? ` · ${overdue} overdue` : ''}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={openNew}>
          <Plus className="w-3 h-3" /> Add Measure
        </Button>
      </div>

      {/* Low-risk advisory */}
      {isLowRisk && measures.length === 0 && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            This is a <strong>Low Risk</strong> case — control measures are optional. You may proceed to Sign-Off without adding any.
          </p>
        </div>
      )}

      {/* Summary counters */}
      {measures.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {['Open','In_Progress','Completed','Overdue'].map(s => (
            <div key={s} className={cn('rounded-lg border text-center py-2 px-3', STATUS_STYLES[s])}>
              <div className="text-lg font-bold">{measures.filter(m => m.status === s).length}</div>
              <div className="text-xs">{s.replace('_',' ')}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : measures.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-12 text-center">
          <ClipboardCheck className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No control measures yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Add SMART actions to mitigate case risks</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-left px-4 py-2.5">Owner</th>
                <th className="text-left px-4 py-2.5">Due</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {measures.map(m => {
                const od = isOverdue(m);
                return (
                  <tr key={m.id} className={cn('hover:bg-muted/20 transition-colors', od && 'bg-red-50/40')}>
                    <td className="px-4 py-3 text-xs max-w-xs">
                      <div className={cn('font-medium', od && 'text-red-700')}>{m.description}</div>
                      {m.reminder_date && (
                        <div className="text-muted-foreground mt-0.5">Reminder: {format(parseISO(m.reminder_date), 'd MMM yyyy')}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{m.owner_name || '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={cn(od && m.status !== 'Completed' ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                        {m.due_date ? format(parseISO(m.due_date), 'd MMM yyyy') : '—'}
                      </span>
                      {od && m.status !== 'Completed' && (
                        <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full border border-red-200">Overdue</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', STATUS_STYLES[m.status] || STATUS_STYLES.Open)}>
                        {m.status?.replace('_',' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => openEdit(m)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {m.status !== 'Completed' && (
                          <button onClick={() => markComplete(m)} className="p-1 rounded hover:bg-emerald-50 text-muted-foreground hover:text-emerald-600">
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Control Measure' : 'Add Control Measure'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Description (SMART format) *</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Obtain certified copy of passport from client within 14 days via secure upload"
                className="text-sm min-h-20 resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">Specific · Measurable · Achievable · Relevant · Time-bound</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Owner</Label>
                <Select value={form.owner_user_id} onValueChange={v => setForm(f => ({ ...f, owner_user_id: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.app_role})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Open','In_Progress','Completed'].map(s => <SelectItem key={s} value={s}>{s.replace('_',' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Due Date *</Label>
                <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Reminder Date (optional)</Label>
                <Input type="date" value={form.reminder_date} onChange={e => setForm(f => ({ ...f, reminder_date: e.target.value }))} className="h-9 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveMeasure} disabled={!form.description || saving} className="gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? 'Save Changes' : 'Add Measure'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}