import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Switch } from '@/components/ui/switch';
import { FileSearch, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

// AI Document Checker — per-tenant switch: approve documents that have no red flag (off by default).
// Needs-attention and high-risk documents always stay with the analyst. Every change is audited (docCheckSettings).
export default function DocCheckSettingsCard({ tenant }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tenant?.id) return;
    base44.functions.invoke('docCheckSettings', { action: 'status', tenant_id: tenant.id })
      .then((r) => setState(r?.data || null)).catch(() => setState(null));
  }, [tenant?.id]);

  async function toggle(on) {
    setBusy(true);
    try {
      const r = await base44.functions.invoke('docCheckSettings', { action: 'set', auto_approve: on, tenant_id: tenant.id });
      if (r?.data?.error) throw new Error(r.data.error);
      setState((s) => ({ ...(s || {}), auto_approve: on }));
      toast({ title: on ? 'Auto-approval switched on' : 'Auto-approval switched off' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not saved', description: e?.response?.data?.error || e?.message });
    } finally { setBusy(false); }
  }

  if (!state) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FileSearch className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">AI Document Checker — approve documents without red flags</div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              When on, a client document that passes every check (file checks and AI review) is set to Approved by the checker and its
              outreach item to Verified; the audit trail shows &ldquo;AI Document Checker&rdquo; as the reviewer. Documents rated
              &ldquo;needs attention&rdquo; or &ldquo;high risk&rdquo; are never approved automatically. When off, the checker only advises
              and an analyst approves every document.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Switch checked={!!state.auto_approve} disabled={busy || !state.can_edit} onCheckedChange={toggle} aria-label="Approve documents without red flags" />
        </div>
      </div>
    </div>
  );
}
