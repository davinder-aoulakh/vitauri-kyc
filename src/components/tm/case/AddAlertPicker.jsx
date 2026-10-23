import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { alertShortId } from '@/lib/tmCase';

export default function AddAlertPicker({ tenantId, onAdd, busy }) {
  const [id, setId] = useState('');
  const { data: options = [] } = useQuery({
    queryKey: ['tmUnlinkedAlerts', tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await base44.entities.TmAlert.filter({ tenant_id: tenantId, status: { $in: ['new', 'triaged', 'in_review'] }, $or: [{ tm_case_id: { $exists: false } }, { tm_case_id: '' }] }, { sort: '-score', limit: 50 })).items || [],
  });
  return (
    <div className="flex gap-2 mt-3">
      <Select value={id} onValueChange={setId}>
        <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder={options.length ? 'Add an open alert' : 'No unlinked alerts'} /></SelectTrigger>
        <SelectContent>
          {options.map((a) => <SelectItem key={a.id} value={a.id}>{alertShortId(a)} · {a.title || 'Alert'}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" className="h-8 text-xs" disabled={!id || busy} onClick={async () => { if (await onAdd(id)) setId(''); }}>Add</Button>
    </div>
  );
}