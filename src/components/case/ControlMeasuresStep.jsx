import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, CheckCircle, Clock, AlertTriangle, Loader2, ClipboardCheck } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

const STATUS_STYLES = {
  Open:        'bg-slate-100 text-slate-600 border-slate-200',
  In_Progress: 'bg-blue-100 text-blue-700 border-blue-200',
  Completed:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  Overdue:     'bg-red-100 text-red-700 border-red-200',
};

const STATUS_ICON = {
  Open:        <Clock className="w-3.5 h-3.5" />,
  In_Progress: <Clock className="w-3.5 h-3.5 text-blue-500" />,
  Completed:   <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />,
  Overdue:     <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
};

export default function ControlMeasuresStep({ kycCase, currentUser }) {
  const [measures, setMeasures] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [newOpen, setNewOpen]   = useState(false);
  const [form, setForm]         = useState({ description: '', owner_name: '', due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'), reminder_date: '', status: 'Open' });
  const [saving, setSaving]     = useState(false);

  useEffect(() => { load(); }, [kycCase.id]);

  async function load() {
    const data = await base44.entities.ControlMeasure.filter({ case_id: kycCase.id });
    setMeasures(data || []);
    setLoading(false);
  }

  async function createMeasure() {
    if (!form.description) return;
    setSaving(true);
    await base44.entities.ControlMeasure.create({
      ...form,
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      owner_user_id: currentUser?.id,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'control_measure_added',
      notes: form.description,
    });
    setForm({ description: '', owner_name: '', due_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'), reminder_date: '', status: 'Open' });
    setNewOpen(false);
    setSaving(false);
    load();
  }

  async function updateStatus(measure, status) {
    await base44.entities.ControlMeasure.update(measure.id, { status });
    setMeasures(ms => ms.map(m => m.id === measure.id ? { ...m, status } : m));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Control Measures</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            SMART actions to mitigate identified risks · {measures.filter(m => m.status !== 'Completed').length} open
          </p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setNewOpen(true)}>
          <Plus className="w-3 h-3" /> Add Measure
        </Button>
      </div>

      {/* Summary bar */}
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
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : measures.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-12 text-center">
          <ClipboardCheck className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No control measures yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Add SMART actions to mitigate case risks</p>
        </div>
      ) : (
        <div className="space-y-2">
          {measures.map(m => (
            <div key={m.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{m.description}</div>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-full border flex items-center gap-1', STATUS_STYLES[m.status])}>
                      {STATUS_ICON[m.status]} {m.status?.replace('_', ' ')}
                    </span>
                    {m.owner_name && <span className="text-xs text-muted-foreground">Owner: {m.owner_name}</span>}
                    {m.due_date && (
                      <span className={cn('text-xs', new Date() > new Date(m.due_date) && m.status !== 'Completed' ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>
                        Due: {format(new Date(m.due_date), 'd MMM yyyy')}
                      </span>
                    )}
                  </div>
                </div>
                {m.status !== 'Completed' && (
                  <Select value={m.status} onValueChange={v => updateStatus(m, v)}>
                    <SelectTrigger className="h-7 text-xs w-32 flex-shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['Open','In_Progress','Completed','Overdue'].map(s => <SelectItem key={s} value={s}>{s.replace('_',' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Measure Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Control Measure</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Description (SMART action) *</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Obtain certified copy of passport within 14 days" className="text-sm min-h-16" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Owner</Label>
                <Input value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="Name or role" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Due Date</Label>
                <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Reminder Date</Label>
                <Input type="date" value={form.reminder_date} onChange={e => setForm(f => ({ ...f, reminder_date: e.target.value }))} className="h-9 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button onClick={createMeasure} disabled={!form.description || saving} className="gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Add Measure
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}