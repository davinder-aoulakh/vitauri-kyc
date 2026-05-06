import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MessageSquare, Plus, CheckCircle, Clock, AlertTriangle, Send, Loader2, FileText } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

const DOC_ITEMS = [
  { id: 'passport', label: 'Passport / ID Document', type: 'document' },
  { id: 'proof_address', label: 'Proof of Address', type: 'document' },
  { id: 'ubo_register', label: 'UBO Register Extract', type: 'document' },
  { id: 'articles', label: 'Articles of Association', type: 'document' },
  { id: 'financial_statement', label: 'Financial Statements (2 years)', type: 'document' },
  { id: 'tax_return', label: 'Tax Return', type: 'document' },
  { id: 'source_of_wealth', label: 'Source of Wealth Declaration', type: 'document' },
  { id: 'beneficial_owner', label: 'Beneficial Owner Declaration', type: 'document' },
];

const STATUS_STYLES = {
  Draft:            'bg-slate-100 text-slate-600',
  Sent:             'bg-blue-100 text-blue-700',
  Viewed:           'bg-purple-100 text-purple-700',
  Partial_Response: 'bg-amber-100 text-amber-700',
  Complete:         'bg-emerald-100 text-emerald-700',
};

export default function OutreachStep({ kycCase, client, currentUser }) {
  const [requests, setRequests]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newOpen, setNewOpen]     = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [message, setMessage]     = useState('');
  const [channel, setChannel]     = useState('Email');
  const [deadline, setDeadline]   = useState(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  const [creating, setCreating]   = useState(false);

  useEffect(() => { load(); }, [kycCase.id]);

  async function load() {
    const data = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });
    setRequests(data || []);
    setLoading(false);
  }

  function toggleItem(id) {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  async function createRequest() {
    if (selectedItems.length === 0) return;
    setCreating(true);
    const items = selectedItems.map(id => {
      const item = DOC_ITEMS.find(d => d.id === id);
      return { item_id: id, item_type: item.type, label: item.label, status: 'Requested' };
    });
    await base44.entities.OutreachRequest.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      message,
      deadline,
      delivery_channel: channel,
      status: 'Draft',
      items,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'outreach_created',
      notes: `Outreach request created: ${items.map(i => i.label).join(', ')}`,
    });
    setNewOpen(false);
    setSelectedItems([]);
    setMessage('');
    setCreating(false);
    load();
  }

  async function markSent(req) {
    await base44.entities.OutreachRequest.update(req.id, { status: 'Sent' });
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'outreach_sent',
      notes: `Outreach marked as sent via ${req.delivery_channel}`,
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Outreach & Document Collection</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Manage document requests sent to the client</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setNewOpen(true)}>
          <Plus className="w-3 h-3" /> New Request
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : requests.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-12 text-center">
          <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No outreach requests yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Create a request to collect documents from the client</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <div key={req.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_STYLES[req.status] || STATUS_STYLES.Draft)}>
                    {req.status?.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground">via {req.delivery_channel}</span>
                  {req.deadline && <span className="text-xs text-muted-foreground">· Due {format(new Date(req.deadline), 'd MMM')}</span>}
                </div>
                {req.status === 'Draft' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => markSent(req)}>
                    <Send className="w-3 h-3" /> Mark Sent
                  </Button>
                )}
              </div>
              {req.items?.length > 0 && (
                <div className="divide-y divide-border/50">
                  {req.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs text-foreground">{item.label}</span>
                      </div>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                        item.status === 'Received' ? 'bg-emerald-100 text-emerald-700' :
                        item.status === 'Verified' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      )}>
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Request Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Document Request — {client?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium mb-2 block">Select Required Documents</Label>
              <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                {DOC_ITEMS.map(item => (
                  <label key={item.id} className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm',
                    selectedItems.includes(item.id) ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                  )}>
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="rounded border-border"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Delivery Channel</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Email">Email</SelectItem>
                    <SelectItem value="SMS">SMS</SelectItem>
                    <SelectItem value="Portal">Client Portal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Deadline</Label>
                <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="h-9 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Covering Message (optional)</Label>
              <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Dear [Client], as part of our KYC review…" className="text-sm min-h-16" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button onClick={createRequest} disabled={selectedItems.length === 0 || creating} className="gap-2">
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}