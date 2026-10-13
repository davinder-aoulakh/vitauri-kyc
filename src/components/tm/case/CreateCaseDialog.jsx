import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import { useCaseUsers } from '@/hooks/useTmCase';
import { errorMessage } from '@/lib/tmAlerts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import InlineError from '@/components/shared/InlineError';
import { Loader2 } from 'lucide-react';

export default function CreateCaseDialog({ open, onOpenChange, alertIds, defaultTitle, onCreated }) {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const { data: users = [] } = useCaseUsers(currentUser?.tenant_id, open);
  const [title, setTitle] = useState(defaultTitle || '');
  const [assignee, setAssignee] = useState(currentUser?.id || '');
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const workers = users.filter((u) => hasPermission(u.app_role, 'tmWorkCase'));
  const reviewers = users.filter((u) => hasPermission(u.app_role, 'tmFourEyes') && u.id !== assignee);

  const create = async () => {
    setBusy(true); setError('');
    try {
      const res = await base44.functions.invoke('manageTmCase', { action: 'create', alert_ids: alertIds, title, assigned_to_user_id: assignee, four_eyes_user_id: reviewer });
      onCreated?.();
      onOpenChange(false);
      navigate(`/tm/case/${res.data.tm_case_id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create investigation case</DialogTitle>
          <DialogDescription>{alertIds.length} alert{alertIds.length === 1 ? '' : 's'} will be bundled into one case.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short description of the concern" className="h-9" /></div>
          <div>
            <Label className="text-xs">Assigned investigator</Label>
            <Select value={assignee} onValueChange={(v) => { setAssignee(v); if (v === reviewer) setReviewer(''); }}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose investigator" /></SelectTrigger>
              <SelectContent>{workers.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name} · {u.app_role}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Four-eyes reviewer</Label>
            <Select value={reviewer} onValueChange={setReviewer}>
              <SelectTrigger className="h-9"><SelectValue placeholder={reviewers.length ? 'Choose reviewer' : 'No eligible reviewers'} /></SelectTrigger>
              <SelectContent>{reviewers.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name} · {u.app_role}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {error && <InlineError message={error} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={busy || !assignee || !reviewer}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Create case</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}