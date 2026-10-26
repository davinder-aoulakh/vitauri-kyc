import React, { useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RuleSentence from '@/components/tm/rules/RuleSentence';
import StatusPill from '@/components/tm/kit/StatusPill';
import { userName } from '@/lib/tmRules';
import { AlertTriangle } from 'lucide-react';

const SOURCE = { didit_library: 'Installed from the Didit library', didit_console: 'Created in the Didit console' };

function AdoptForm({ rule, scenarios, users, currentUserId, busy, onSubmit, onCancel }) {
  const [scenarioId, setScenarioId] = useState(rule.scenario_id || '');
  const [ownerId, setOwnerId] = useState(currentUserId || '');
  const [reviewDate, setReviewDate] = useState('');
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <Select value={scenarioId || 'none'} onValueChange={(v) => setScenarioId(v === 'none' ? '' : v)}>
        <SelectTrigger className="h-9 text-sm" aria-label="Scenario"><SelectValue placeholder="Scenario" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No scenario yet</SelectItem>
          {scenarios.map((s) => <SelectItem key={s.id} value={s.id}>{s.code} · {s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={ownerId || 'none'} onValueChange={(v) => setOwnerId(v === 'none' ? '' : v)}>
        <SelectTrigger className="h-9 text-sm" aria-label="Owner"><SelectValue placeholder="Owner" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Me</SelectItem>
          {users.map((u) => <SelectItem key={u.id} value={u.id}>{userName(u)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="h-9 text-sm" aria-label="Review date" />
      <div className="sm:col-span-3 flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="text-xs" disabled={busy === 'adopt'}
          onClick={() => onSubmit({ scenario_id: scenarioId || undefined, owner_user_id: ownerId || undefined, review_date: reviewDate || undefined })}>
          Adopt as draft
        </Button>
      </div>
    </div>
  );
}

function KnownForm({ busy, onSubmit, onCancel }) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-3 space-y-2">
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-sm" placeholder="Why this rule may keep running in Didit without Vitauri governance" aria-label="Reason" />
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="outline" className="text-xs" disabled={reason.trim().length < 5 || busy === 'acknowledge'} onClick={() => onSubmit(reason.trim())}>Mark as known</Button>
      </div>
    </div>
  );
}

/** Didit rules that run without a Vitauri rule behind them. Adopt = bring under governance (draft → approval → sync); Mark as known = accept with a reason. */
export default function UnmanagedRules({ rules, scenarios, users, usersById, currentUserId, canManage, call, busy, onAdopted }) {
  const [open, setOpen] = useState({ id: null, kind: null });
  if (!rules.length) return null;
  const pending = rules.filter((r) => !r.unmanaged_ack_at).length;

  const adopt = async (rule, fields) => {
    const res = await call('diditRuleLibrary', { action: 'adopt', rule_id: rule.id, ...fields }, 'Rule adopted as a draft');
    if (res?.rule_id) { setOpen({ id: null, kind: null }); onAdopted(res.rule_id); }
  };
  const known = async (rule, reason) => {
    const res = await call('diditRuleLibrary', { action: 'acknowledge', rule_id: rule.id, reason }, 'Marked as known');
    if (res?.rule_id) setOpen({ id: null, kind: null });
  };

  return (
    <section className="bg-card border border-orange-200 rounded-xl mb-5" aria-labelledby="unmanaged-title">
      <header className="px-4 py-3 border-b border-border flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
        <div>
          <h2 id="unmanaged-title" className="text-sm font-semibold">Unmanaged in Didit · {rules.length}{pending ? ` (${pending} to review)` : ''}</h2>
          <p className="text-xs text-muted-foreground">These rules run in Didit but were not created in Vitauri, so they have no owner, scenario or approval here. Alerts from them still reach you.</p>
        </div>
      </header>
      <ul className="divide-y divide-border">
        {rules.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{r.name}</span>
                  <StatusPill tone="neutral">{SOURCE[r.source] || 'Created in Didit'}</StatusPill>
                  {r.unmanaged_ack_at && <StatusPill tone="success" title={r.unmanaged_ack_reason}>Known</StatusPill>}
                </div>
                <RuleSentence definition={r.definition} className="text-xs text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground">
                  Found {r.unmanaged_since ? format(new Date(r.unmanaged_since), 'dd MMM yyyy') : '—'}
                  {r.unmanaged_ack_at && <> · Marked as known by {userName(usersById.get(r.unmanaged_ack_by_user_id)) || 'a user'} on {format(new Date(r.unmanaged_ack_at), 'dd MMM yyyy')}: {r.unmanaged_ack_reason}</>}
                </p>
              </div>
              {canManage && open.id !== r.id && (
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" className="text-xs" onClick={() => setOpen({ id: r.id, kind: 'adopt' })}>Adopt</Button>
                  {!r.unmanaged_ack_at && <Button size="sm" variant="outline" className="text-xs" onClick={() => setOpen({ id: r.id, kind: 'known' })}>Mark as known</Button>}
                </div>
              )}
            </div>
            {open.id === r.id && open.kind === 'adopt' && (
              <AdoptForm rule={r} scenarios={scenarios} users={users} currentUserId={currentUserId} busy={busy} onSubmit={(f) => adopt(r, f)} onCancel={() => setOpen({ id: null, kind: null })} />
            )}
            {open.id === r.id && open.kind === 'known' && <KnownForm busy={busy} onSubmit={(reason) => known(r, reason)} onCancel={() => setOpen({ id: null, kind: null })} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
