import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import { CheckCircle, Loader2, X } from 'lucide-react';

export default function ProfileDecisionPanel({ profile, onDecided }) {
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function decide(decision) {
    setBusy(decision);
    setError(null);
    try {
      await base44.functions.invoke('approveExpectedProfile', { profile_id: profile.id, decision, rationale });
      setRationale('');
      onDecided?.();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not save decision.');
    }
    setBusy(null);
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <div className="text-xs font-semibold">Decision on v{profile.version} *</div>
      <Textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Rationale (required)…"
        className="min-h-16 resize-none text-sm"
      />
      {error && <InlineError message={error} />}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" className="gap-1.5 border-red-300 text-xs text-red-600 hover:bg-red-50" disabled={!rationale.trim() || !!busy} onClick={() => decide('reject')}>
          {busy === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} Reject
        </Button>
        <Button size="sm" className="gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={!rationale.trim() || !!busy} onClick={() => decide('approve')}>
          {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Approve
        </Button>
      </div>
    </div>
  );
}