import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { hasPermission } from '@/lib/permissions';
import { isFeatureEnabled } from '@/lib/featureFlags';
import Psd2PartnerSelect from '@/components/tenantconfig/tm/Psd2PartnerSelect';
import FxRatesCard from '@/components/tenantconfig/tm/FxRatesCard';
import { errorMessage } from '@/lib/tmAlerts';
import TmExportButton from '@/components/tenantconfig/tm/TmExportButton';
import ThresholdsEditor from '@/components/tenantconfig/tm/ThresholdsEditor';
import { Loader2, Save } from 'lucide-react';

const WEIGHTS = [['kyc', 'KYC profile'], ['behaviour', 'Behaviour'], ['screening', 'Screening'], ['alerts', 'Alerts']];
const DEFAULT_WEIGHTS = { kyc: 0.35, behaviour: 0.25, screening: 0.2, alerts: 0.2 };
const asObj = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v) || {}; } catch { return {}; } };
const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

export default function TmSettingsTab({ tenant, currentUser, setTenant }) {
  const s = asObj(tenant?.tm_settings);
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState(tenant?.tm_reporting_currency || 'USD');
  const [tz, setTz] = useState(tenant?.tm_timezone || 'America/Curacao');
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS, ...(s.risk_weights || {}) });
  const [thresholds, setThresholds] = useState(s.objective_thresholds || (s.objective_threshold ? { [currency]: s.objective_threshold } : {}));
  const [autoDraft, setAutoDraft] = useState(s.auto_draft_objective_reports === true);
  const [maxPct, setMaxPct] = useState(String(s.max_wrongly_closed_pct ?? 2));
  const [psd2Partner, setPsd2Partner] = useState(s.psd2_partner || 'manual');

  const sum = WEIGHTS.reduce((t, [k]) => t + (Number(weights[k]) || 0), 0);
  const pct = Number(maxPct);
  const valid = /^[A-Za-z]{3}$/.test(currency) && tz.trim() && Math.abs(sum - 1) < 0.011 && Number.isFinite(pct) && pct >= 0 && pct <= 100;

  async function save() {
    setSaving(true);
    try {
      const cur = currency.toUpperCase();
      const clean = Object.fromEntries(Object.entries(thresholds).filter(([c, v]) => /^[A-Za-z]{3}$/.test(c) && Number(v) > 0).map(([c, v]) => [c.toUpperCase(), Number(v)]));
      const tm_settings = {
        ...s,
        risk_weights: Object.fromEntries(WEIGHTS.map(([k]) => [k, Number(weights[k])])),
        objective_thresholds: clean,
        auto_draft_objective_reports: autoDraft,
        max_wrongly_closed_pct: pct,
        psd2_partner: psd2Partner,
        ...(clean[cur] ? { objective_threshold: clean[cur] } : {}), // read by the rule starters
      };
      const before = { tm_reporting_currency: tenant.tm_reporting_currency, tm_timezone: tenant.tm_timezone, tm_settings: s };
      const updated = await base44.entities.Tenant.update(tenant.id, { tm_reporting_currency: cur, tm_timezone: tz.trim(), tm_settings });
      await base44.entities.AuditEvent.create({
        tenant_id: tenant.id, actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
        event_type: 'tm_settings_updated', before_state: before, after_state: { tm_reporting_currency: cur, tm_timezone: tz.trim(), tm_settings },
        notes: 'Transaction monitoring settings were updated.',
      });
      setTenant(updated);
      toast({ title: 'TM settings saved' });
    } catch (e) {
      toast({ title: 'Save failed', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <h3 className="font-semibold text-sm">Transaction monitoring settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <div><Label className="text-xs mb-1.5 block">Reporting currency</Label><Input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="h-9 text-sm" /></div>
          <div>
            <Label className="text-xs mb-1.5 block">Timezone</Label>
            <Input list="tm-zones" value={tz} onChange={(e) => setTz(e.target.value)} className="h-9 text-sm" />
            <datalist id="tm-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Risk weights (must add up to 1)</Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
            {WEIGHTS.map(([k, name]) => (
              <div key={k}><div className="text-[11px] text-muted-foreground mb-1">{name}</div>
                <Input type="number" step="0.05" min="0" max="1" value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: e.target.value })} className="h-9 text-sm" /></div>
            ))}
          </div>
          {Math.abs(sum - 1) >= 0.011 && <p className="text-xs text-red-600 mt-1">Weights add up to {sum.toFixed(2)}.</p>}
        </div>
        <ThresholdsEditor value={thresholds} onChange={setThresholds} reportingCurrency={currency} />
        <div className="flex items-center gap-3">
          <Switch checked={autoDraft} onCheckedChange={setAutoDraft} aria-label="Auto-draft objective reports" />
          <div><div className="text-sm font-medium">Auto-draft objective reports</div><div className="text-xs text-muted-foreground">Create a draft FIU report when an objective-indicator alert is raised.</div></div>
        </div>
        <div className="max-w-xs">
          <Label className="text-xs mb-1.5 block">Max wrongly closed (%) for release</Label>
          <Input type="number" min="0" max="100" step="0.5" value={maxPct} onChange={(e) => setMaxPct(e.target.value)} className="h-9 text-sm" />
        </div>
        {isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tenantConfig') && (
          <Psd2PartnerSelect value={psd2Partner} onChange={setPsd2Partner} />
        )}
        <Button onClick={save} disabled={saving || !valid} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </Button>
      </div>
      {isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tenantConfig') && (
        <FxRatesCard tenantId={tenant?.id} canManage={hasPermission(currentUser?.app_role, 'tmManageFx')} />
      )}
      {hasPermission(currentUser?.app_role, 'exportData') && <TmExportButton />}
    </div>
  );
}