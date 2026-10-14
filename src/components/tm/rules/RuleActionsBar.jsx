import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import ReasonDialog from '@/components/tm/report/ReasonDialog';
import { approvalGaps, isRetired } from '@/lib/tmRules';
import { Loader2 } from 'lucide-react';

export default function RuleActionsBar({ rule, backtest, canManage, canApprove, isMaker, busy, onAct, onResync }) {
  const [dlg, setDlg] = useState('');
  const gaps = approvalGaps(rule, backtest);
  const approved = rule.approval_status === 'approved';
  const draft = rule.mode === 'draft';
  const retired = isRetired(rule);
  const b = (action) => busy === action && <Loader2 className="w-3.5 h-3.5 animate-spin" />;
  const mode = (m) => onAct('set_mode', { mode: m });
  const bad = rule.sync_status === 'failed' || rule.sync_status === 'drift';

  return (
    <div className="space-y-2 mt-4">
      {bad && (
        <InlineError
          message={rule.sync_status === 'drift' ? `This rule was changed in Didit and has not been overwritten. ${rule.sync_error || ''}` : `Sync with Didit failed: ${rule.sync_error || 'unknown error'}`}
          onRetry={canManage ? () => onResync(rule.sync_status === 'drift') : undefined}
          retryLabel={rule.sync_status === 'drift' ? 'Push Vitauri version' : 'Retry'}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && !retired && (
          <Button size="sm" variant="outline" disabled={!!busy || !approved || !['draft', 'disabled'].includes(rule.mode) || bad}
            title={approved ? '' : 'The rule needs approval first'} onClick={() => mode('test')}>{b('set_mode')} Start in test mode</Button>
        )}
        {canManage && approved && ['draft', 'test', 'disabled'].includes(rule.mode) && (
          <Button size="sm" disabled={!!busy || bad} onClick={() => mode('active')}>Activate</Button>
        )}
        {canManage && approved && ['test', 'active'].includes(rule.mode) && (
          <Button size="sm" variant="outline" disabled={!!busy || bad} onClick={() => mode('disabled')}>Disable</Button>
        )}
        {canManage && draft && !approved && rule.approval_status !== 'requested' && (
          <Button size="sm" disabled={!!busy || gaps.length > 0} title={gaps.length ? `Add ${gaps.join(', ')}` : ''} onClick={() => onAct('request_approval')}>
            {b('request_approval')} Send for approval (4-eyes)
          </Button>
        )}
        {canApprove && rule.approval_status === 'requested' && (
          <>
            <Button size="sm" disabled={!!busy || isMaker} title={isMaker ? 'A different person must approve' : ''} onClick={() => setDlg('approve')}>Approve</Button>
            <Button size="sm" variant="outline" disabled={!!busy || isMaker} onClick={() => setDlg('reject')}>Send back</Button>
          </>
        )}
        {canManage && !retired && <Button size="sm" variant="ghost" className="text-red-600" disabled={!!busy} onClick={() => setDlg('retire')}>Retire</Button>}
      </div>
      {canManage && draft && !approved && rule.approval_status !== 'requested' && gaps.length > 0 && (
        <p className="text-xs text-muted-foreground">Before approval, add {gaps.join(', ')}.</p>
      )}
      {rule.approval_status === 'rejected' && rule.rejection_reason && <p className="text-xs text-red-700">Sent back: {rule.rejection_reason}</p>}
      <ReasonDialog open={dlg === 'approve'} onOpenChange={(v) => !v && setDlg('')} title="Approve this rule" description="The rule is registered in Didit switched off. Starting it is a separate step." label="Note (optional)" confirmLabel="Approve" required={false} busy={!!busy}
        onSubmit={(rationale) => onAct('approve', { rationale })} />
      <ReasonDialog open={dlg === 'reject'} onOpenChange={(v) => !v && setDlg('')} title="Send back to the author" label="Reason" confirmLabel="Send back" busy={!!busy}
        onSubmit={(reason) => onAct('reject', { reason })} />
      <ReasonDialog open={dlg === 'retire'} onOpenChange={(v) => !v && setDlg('')} title="Retire this rule" description="It is switched off in Didit and cannot be edited or started again." label="Reason" confirmLabel="Retire" busy={!!busy}
        onSubmit={(reason) => onAct('retire', { reason })} />
    </div>
  );
}