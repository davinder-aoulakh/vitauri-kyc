import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { Pencil, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Roles that can assign to any analyst (not just themselves)
const CAN_ASSIGN_ANY = ['Manager', 'Director', 'Compliance Admin', 'Tenant Admin'];

export default function CaseAssignmentPicker({ kycCase, currentUser, analysts, onAssigned }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  const canAssignAny = CAN_ASSIGN_ANY.includes(currentUser?.app_role);

  // Analysts available for selection based on role
  const options = canAssignAny
    ? analysts
    : analysts.filter(u => u.id === currentUser?.id);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleSelect(analyst) {
    if (analyst.id === kycCase.assigned_analyst_id) { setOpen(false); return; }
    setSaving(true);
    setOpen(false);

    const oldName = analysts.find(u => u.id === kycCase.assigned_analyst_id)?.full_name || 'Unassigned';
    const newName = analyst.full_name;

    await base44.entities.KycCase.update(kycCase.id, { assigned_analyst_id: analyst.id });
    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'case_reassigned',
      notes:         `Case reassigned from ${oldName} to ${newName}`,
    });

    onAssigned?.(analyst.id, newName);
    toast({ title: `Case assigned to ${newName}` });
    setSaving(false);
  }

  const assignedName = analysts.find(u => u.id === kycCase.assigned_analyst_id)?.full_name || '—';

  return (
    <span className="relative flex items-center gap-1" ref={ref}>
      <span className="text-xs text-muted-foreground">
        Analyst:{' '}
        <button
          className="font-semibold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
          onClick={() => options.length > 0 && setOpen(o => !o)}
          title={options.length === 0 ? 'No analysts available' : 'Click to reassign'}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : assignedName}
          {!saving && options.length > 0 && <Pencil className="w-2.5 h-2.5 text-muted-foreground/60" />}
        </button>
      </span>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg min-w-40 py-1 text-sm">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No analysts found</div>
          ) : (
            options.map(u => (
              <button
                key={u.id}
                onClick={() => handleSelect(u)}
                className={cn(
                  'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors',
                  u.id === kycCase.assigned_analyst_id && 'font-medium text-primary'
                )}
              >
                <span className="flex-1 truncate">{u.full_name}</span>
                {u.id === kycCase.assigned_analyst_id && <Check className="w-3 h-3 flex-shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </span>
  );
}