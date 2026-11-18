import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Settings2 } from 'lucide-react';

const listText = (v) => (v || []).join(', ');
const fromList = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean);
const N = ({ label, value, onChange, disabled }) => (
  <label className="space-y-1 text-xs font-medium">{label}<Input type="number" className="h-8" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} /></label>
);

/** Non-secret settings of the guided conversation (Tenant.outreach_settings). Registry and keys are shown read-only (set by Vitauri Ops). */
export default function OutreachSettingsCard({ settings, registry, canEdit, busy, onSave }) {
  const [s, setS] = useState(/** @type {any} */ (settings || {}));
  useEffect(() => { setS(settings || {}); }, [settings]);
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const ro = !canEdit;
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><Settings2 className="h-4 w-4 text-primary" /> Guided conversation settings</div>
      <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
        Company registry: <span className="font-medium">{registry?.label || 'Didit (default)'}</span> · Didit key {registry?.didit_key_set ? 'set' : 'not set'}.
        <span className="text-muted-foreground"> Integration keys are managed by Vitauri Ops.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <N label="UBO threshold (%)" value={s.uboThreshold} disabled={ro} onChange={(v) => set('uboThreshold', v)} />
        <N label="List owners from (%)" value={s.ownerListThreshold} disabled={ro} onChange={(v) => set('ownerListThreshold', v)} />
        <N label="Default deadline (days)" value={s.defaultDeadlineDays} disabled={ro} onChange={(v) => set('defaultDeadlineDays', v)} />
        <N label="Link grace period (days)" value={s.tokenGraceDays} disabled={ro} onChange={(v) => set('tokenGraceDays', v)} />
        <N label="Document max age (months)" value={s.documentMaxAgeMonths} disabled={ro} onChange={(v) => set('documentMaxAgeMonths', v)} />
        <N label="AI follow-ups per request" value={s.aiFollowUpMaxPerRequest} disabled={ro} onChange={(v) => set('aiFollowUpMaxPerRequest', v)} />
        <N label="Wait for AI approval (minutes)" value={s.aiApprovalWaitMinutes} disabled={ro} onChange={(v) => set('aiApprovalWaitMinutes', v)} />
        <N label="ID check attempts" value={s.idvMaxAttempts} disabled={ro} onChange={(v) => set('idvMaxAttempts', v)} />
        <label className="space-y-1 text-xs font-medium">Reference prefix<Input className="h-8" value={s.referencePrefix || ''} disabled={ro} onChange={(e) => set('referencePrefix', e.target.value.toUpperCase())} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">Reminder days before the deadline<Input className="h-8" value={listText(s.reminderDays)} disabled={ro} onChange={(e) => set('reminderDays', fromList(e.target.value).map(Number))} /></label>
        <label className="space-y-1 text-xs font-medium">Phone country codes<Input className="h-8" value={listText(s.phoneCountryCodes)} disabled={ro} onChange={(e) => set('phoneCountryCodes', fromList(e.target.value))} /></label>
        <label className="space-y-1 text-xs font-medium">Address countries<Input className="h-8" value={listText(s.addressCountries)} disabled={ro} onChange={(e) => set('addressCountries', fromList(e.target.value))} /></label>
        <label className="space-y-1 text-xs font-medium">Blocked jurisdictions<Input className="h-8" value={listText(s.blockedJurisdictions)} disabled={ro} onChange={(e) => set('blockedJurisdictions', fromList(e.target.value))} /></label>
        <label className="space-y-1 text-xs font-medium">Response time text (person)<Input className="h-8" value={s.responseTimeTexts?.NP || ''} disabled={ro} onChange={(e) => set('responseTimeTexts', { ...s.responseTimeTexts, NP: e.target.value })} /></label>
        <label className="space-y-1 text-xs font-medium">Response time text (organisation)<Input className="h-8" value={s.responseTimeTexts?.ORG || ''} disabled={ro} onChange={(e) => set('responseTimeTexts', { ...s.responseTimeTexts, ORG: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2"><Switch checked={s.releaseInvitesAfterIdv !== false} disabled={ro} onCheckedChange={(v) => set('releaseInvitesAfterIdv', v)} /> Send related-party invitations only after the representative passed ID&amp;V</label>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium">AI follow-up questions</div>
        <div className="flex flex-wrap gap-4 text-xs">
          {['low', 'medium', 'high'].map((r) => (
            <label key={r} className="flex items-center gap-1.5 capitalize">{r} risk:
              <select className="h-7 rounded-md border border-border bg-background px-1.5" disabled={ro} value={s.aiFollowUp?.[r] || 'approval'} onChange={(e) => set('aiFollowUp', { ...s.aiFollowUp, [r]: e.target.value })}>
                <option value="auto">sent at once</option><option value="approval">analyst approves first</option>
              </select>
            </label>
          ))}
        </div>
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => onSave(s)}>{busy === 'save_settings' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save settings</Button>
        </div>
      )}
    </div>
  );
}
