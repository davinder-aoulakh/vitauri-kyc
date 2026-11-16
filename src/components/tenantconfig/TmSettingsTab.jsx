import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { hasPermission, isVitauriOps, roleModel as roleModelOf } from '@/lib/permissions';
import RegressionRefFields from '@/components/tenantconfig/tm/RegressionRefFields';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { normaliseJurisdictions } from '@/lib/amlNav';
import { detectionSettings, caseGroupingSettings } from '@/lib/tmTenantSettings';
import AiModelCard from '@/components/tenantconfig/tm/AiModelCard';
import { BehaviourThresholdField, SegmentDefaultsEditor, CsvTemplatesEditor } from '@/components/tenantconfig/tm/ProfileAndImportSettings';
import { segmentDefaults, SEGMENT_KEYS, LIMIT_FIELDS } from '@/lib/tmProfileSources';
import { templatesOf } from '@/lib/tmCsvTemplates';
import { MODEL_CHANGE_ROLES, MIN_NOTE } from '@/lib/tmAiModels';
import Psd2PartnerSelect from '@/components/tenantconfig/tm/Psd2PartnerSelect';
import FxRatesCard from '@/components/tenantconfig/tm/FxRatesCard';
import { errorMessage } from '@/lib/tmAlerts';
import TmExportButton from '@/components/tenantconfig/tm/TmExportButton';
import ThresholdsEditor from '@/components/tenantconfig/tm/ThresholdsEditor';
import IdvWorkflowPicker from '@/components/outreach/IdvWorkflowPicker';
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
  const [autoTriage, setAutoTriage] = useState(s.auto_triage_new_alerts === true);
  const amlV2 = isFeatureEnabled(tenant, 'aml_nav_v2');
  const [histDays, setHistDays] = useState(String(s.historical_window_days ?? 30));
  const [jurisdictions, setJurisdictions] = useState((tenant?.jurisdictions || []).join(', '));
  // Role model (phase 6): 'combined' = every analyst does KYC and AML; 'separate' = each user's work domain decides.
  const [roleModel, setRoleModel] = useState(roleModelOf(tenant));
  // Detection in Vitauri + profile → change of circumstances (phase 3). Shown values are the effective ones (defaults filled in).
  const det0 = detectionSettings(tenant);
  const [detOn, setDetOn] = useState(det0.enabled);
  const [det, setDet] = useState({
    amount_min: String(det0.structuring.amount_min), amount_below: String(det0.structuring.amount_below), window_days: String(det0.structuring.window_days),
    Low: String(det0.structuring.senders_by_class.Low), Medium: String(det0.structuring.senders_by_class.Medium), High: String(det0.structuring.senders_by_class.High), PEP: String(det0.structuring.senders_by_class.PEP),
    window_hours: String(det0.rapid.window_hours), min_ratio_pct: String(Math.round(det0.rapid.min_ratio * 100)),
  });
  const [cocMode, setCocMode] = useState(det0.profile_coc_mode);
  const [cocMonths, setCocMonths] = useState(String(det0.profile_coc_months));
  const grp0 = caseGroupingSettings(tenant);
  const [caseGrouping, setCaseGrouping] = useState(grp0.case_grouping);
  const [autoObjective, setAutoObjective] = useState(grp0.auto_case_objective);
  const [autoSanctions, setAutoSanctions] = useState(grp0.auto_case_sanctions);
  // Phase 10: behaviour-score threshold, segment defaults for the expected profile, CSV mapping templates.
  const [behaviourThr, setBehaviourThr] = useState(s.behaviour_proposal_threshold != null ? String(s.behaviour_proposal_threshold) : '');
  const [segDefaults, setSegDefaults] = useState(() => segmentDefaults(tenant));
  const [csvTemplates, setCsvTemplates] = useState(() => templatesOf(tenant));
  const thrOk = behaviourThr === '' || (Number(behaviourThr) >= 1 && Number(behaviourThr) <= 100);
  const posInt = (v, min = 1) => Number.isInteger(Number(v)) && Number(v) >= min;
  const detOk = !amlV2 || (Number(det.amount_min) > 0 && Number(det.amount_below) > Number(det.amount_min) && posInt(det.window_days) && ['Low', 'Medium', 'High', 'PEP'].every((c) => posInt(det[c], 2))
    && posInt(det.window_hours) && Number(det.min_ratio_pct) >= 1 && Number(det.min_ratio_pct) <= 1000 && posInt(cocMonths));
  const histOk = !amlV2 || (Number.isInteger(Number(histDays)) && Number(histDays) >= 1 && Number(histDays) <= 3650);
  const [reverifyWf, setReverifyWf] = useState(s.reverify_workflow_id || '');
  const isOps = isVitauriOps(currentUser?.app_role);
  const [reg, setReg] = useState({ sessionId: s.regression_session_id || '', outreachId: s.regression_outreach_ref?.outreach_id || '', itemId: s.regression_outreach_ref?.item_id || '' });
  const savedModel = { model: s.ai_model || '', note: s.ai_model_change_note || '' };
  const [aiModel, setAiModel] = useState(savedModel.model);
  const [modelNote, setModelNote] = useState('');
  const canChangeModel = MODEL_CHANGE_ROLES.includes(currentUser?.app_role);
  const modelChanged = canChangeModel && aiModel !== savedModel.model;

  const sum = WEIGHTS.reduce((t, [k]) => t + (Number(weights[k]) || 0), 0);
  const pct = Number(maxPct);
  const valid = /^[A-Za-z]{3}$/.test(currency) && tz.trim() && Math.abs(sum - 1) < 0.011 && Number.isFinite(pct) && pct >= 0 && pct <= 100 && histOk && detOk && (!amlV2 || thrOk) && (!modelChanged || modelNote.trim().length >= MIN_NOTE);

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
        auto_triage_new_alerts: autoTriage,
        ...(amlV2 ? { historical_window_days: Number(histDays), role_model: roleModel } : {}),
        ...(amlV2 ? {
          behaviour_proposal_threshold: behaviourThr === '' ? undefined : Number(behaviourThr),
          segment_defaults: Object.fromEntries(SEGMENT_KEYS.map((k) => [k, Object.fromEntries(LIMIT_FIELDS.map((f) => [f, Number(segDefaults[k]?.[f]) || 0]))])),
          csv_templates: csvTemplates,
        } : {}),
        ...(amlV2 ? {
          case_grouping: caseGrouping, auto_case_objective: autoObjective, auto_case_sanctions: autoSanctions,
          detection_in_vitauri: detOn, profile_coc_mode: cocMode, profile_coc_months: Number(cocMonths),
          detection: {
            ...(s.detection || {}),
            structuring: { ...(s.detection?.structuring || {}), amount_min: Number(det.amount_min), amount_below: Number(det.amount_below), window_days: Number(det.window_days), senders_by_class: { Low: Number(det.Low), Medium: Number(det.Medium), High: Number(det.High), PEP: Number(det.PEP) } },
            rapid: { ...(s.detection?.rapid || {}), window_hours: Number(det.window_hours), min_ratio: Number(det.min_ratio_pct) / 100 },
          },
        } : {}),
        reverify_workflow_id: reverifyWf || undefined,
        ...(isOps ? {
          regression_session_id: reg.sessionId.trim() || undefined,
          regression_outreach_ref: reg.outreachId.trim() && reg.itemId.trim() ? { outreach_id: reg.outreachId.trim(), item_id: reg.itemId.trim() } : undefined,
        } : {}),
        ...(modelChanged ? { ai_model: aiModel, ai_model_changed_at: new Date().toISOString(), ai_model_change_note: modelNote.trim() } : {}),
        ...(clean[cur] ? { objective_threshold: clean[cur] } : {}), // read by the rule starters
      };
      const before = { tm_reporting_currency: tenant.tm_reporting_currency, tm_timezone: tenant.tm_timezone, tm_settings: s, ...(amlV2 ? { jurisdictions: tenant.jurisdictions || [] } : {}) };
      const juris = amlV2 ? { jurisdictions: normaliseJurisdictions(jurisdictions) } : {};
      const updated = await base44.entities.Tenant.update(tenant.id, { tm_reporting_currency: cur, tm_timezone: tz.trim(), tm_settings, ...juris });
      await base44.entities.AuditEvent.create({
        tenant_id: tenant.id, actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
        event_type: 'tm_settings_updated', before_state: before, after_state: { tm_reporting_currency: cur, tm_timezone: tz.trim(), tm_settings, ...juris },
        notes: 'Transaction monitoring settings were updated.',
      });
      if (modelChanged) {
        await base44.entities.AuditEvent.create({
          tenant_id: tenant.id, actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User', event_type: 'tm_ai_model_changed',
          before_state: { ai_model: savedModel.model || 'automatic' }, after_state: { ai_model: aiModel || 'automatic', change_note: modelNote.trim() },
          notes: `TM AI model changed from ${savedModel.model || 'automatic'} to ${aiModel || 'automatic'}. ${modelNote.trim()}`,
        });
        setModelNote('');
      }
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
        <div className="flex items-center gap-3">
          <Switch checked={autoTriage} onCheckedChange={setAutoTriage} aria-label="Auto-triage new alerts" />
          <div><div className="text-sm font-medium">Auto-triage new alerts</div><div className="text-xs text-muted-foreground">AI adds a proposal to each newly created alert. It never closes or escalates; a person decides.</div></div>
        </div>
        <div>
          <div className="text-sm font-medium">Identity re-verification workflow</div>
          <div className="text-xs text-muted-foreground mb-1.5">Didit workflow used when a TM case asks the customer to verify their identity again.</div>
          <IdvWorkflowPicker tenant={tenant} item={{ field_type: 'id_verification' }} value={reverifyWf} onChange={(v) => setReverifyWf(v.idv_workflow_id)} />
        </div>
        <AiModelCard saved={savedModel} value={aiModel} onChange={setAiModel} note={modelNote} onNote={setModelNote} canChange={canChangeModel} changedAt={s.ai_model_changed_at} />
        {amlV2 && (
          <div className="max-w-xs">
            <Label className="text-xs mb-1.5 block">Jurisdictions</Label>
            <Input value={jurisdictions} onChange={(e) => setJurisdictions(e.target.value.toUpperCase())} placeholder="e.g. NL, CW" className="h-9 text-sm" />
            <p className="mt-1 text-xs text-muted-foreground">Country codes this tenant operates under. The rule libraries on the Rules page follow this list; leave empty to show all.</p>
          </div>
        )}
        {amlV2 && <BehaviourThresholdField value={behaviourThr} onChange={setBehaviourThr} />}
        {amlV2 && <SegmentDefaultsEditor value={segDefaults} onChange={setSegDefaults} currency={currency.toUpperCase()} />}
        {amlV2 && <CsvTemplatesEditor value={csvTemplates} onChange={setCsvTemplates} />}
        {amlV2 && (
          <div className="max-w-md">
            <Label className="text-xs mb-1.5 block">Role model</Label>
            <select value={roleModel} onChange={(e) => setRoleModel(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="combined">Combined — every analyst does KYC and AML</option>
              <option value="separate">Separate — KYC and AML analysts (need-to-know)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">With "Separate", each user gets a work domain in User Management. KYC-only users do not see alerts, investigations or FIU reports; they see an "AML hold" badge. Compliance Officer, Compliance Admin and Tenant Admin always see both.</p>
          </div>
        )}
        {amlV2 && (
          <div className="max-w-xs">
            <Label className="text-xs mb-1.5 block">Historical window (days)</Label>
            <Input type="number" min="1" max="3650" step="1" value={histDays} onChange={(e) => setHistDays(e.target.value)} className="h-9 text-sm" aria-invalid={!histOk} />
            <p className="mt-1 text-xs text-muted-foreground">Transactions executed longer ago than this are stored for analysis only: not screened by Didit, no alerts. Applies to uploads, the API and PSD2.</p>
          </div>
        )}
        {amlV2 && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="text-sm font-medium">Alerts and investigations</div>
            <div className="max-w-md">
              <Label className="text-xs mb-1.5 block">Escalating an alert</Label>
              <select value={caseGrouping} onChange={(e) => setCaseGrouping(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" aria-label="Case grouping">
                <option value="one_open_per_customer">One open investigation per customer</option>
                <option value="per_rule_customer">One open investigation per rule and customer</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">The alert joins that investigation, or a new one is started. An investigation already waiting for the Compliance Officer is not extended.</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-sm">Start an investigation automatically for objective indicators</div><div className="text-xs text-muted-foreground">A new alert with an objective indicator goes straight into an investigation, without waiting for triage.</div></div>
              <Switch checked={autoObjective} onCheckedChange={setAutoObjective} aria-label="Auto-create for objective indicators" />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-sm">Start an investigation automatically for confirmed sanctions hits</div><div className="text-xs text-muted-foreground">Takes effect with the screening changes of the next phase (a hit is confirmed there). The choice is saved now.</div></div>
              <Switch checked={autoSanctions} onCheckedChange={setAutoSanctions} aria-label="Auto-create for confirmed sanctions hits" />
            </div>
          </div>
        )}
        {amlV2 && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-sm font-medium">Detection in Vitauri</div><div className="text-xs text-muted-foreground">After each upload Vitauri checks its own ledger for structuring and rapid in/out and raises the alert itself. Use this while these rules are not running in Didit, or you would get two alerts for the same pattern. The values below are demo values; set them with Compliance.</div></div>
              <Switch checked={detOn} onCheckedChange={setDetOn} aria-label="Detection in Vitauri" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[['amount_min', 'Structuring: amount from'], ['amount_below', 'Structuring: amount below'], ['window_days', 'Structuring: window (days)'],
                ['Low', 'Senders needed: Low'], ['Medium', 'Senders needed: Medium'], ['High', 'Senders needed: High'], ['PEP', 'Senders needed: PEP'],
                ['window_hours', 'Rapid in/out: window (hours)'], ['min_ratio_pct', 'Rapid in/out: sent on (% of received)']].map(([k, l]) => (
                <div key={k}><Label className="text-xs mb-1.5 block">{l}</Label><Input type="number" min="0" value={det[k]} onChange={(e) => setDet({ ...det, [k]: e.target.value })} className="h-9 text-sm" /></div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs mb-1.5 block">Profile overrun becomes a change of circumstances</Label>
                <select value={cocMode} onChange={(e) => setCocMode(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" aria-label="Profile overrun to change of circumstances">
                  <option value="structural">After several months above the ceiling</option>
                  <option value="first_overrun">On the first overrun</option>
                </select>
              </div>
              {cocMode === 'structural' && (
                <div><Label className="text-xs mb-1.5 block">Months above the ceiling</Label><Input type="number" min="1" step="1" value={cocMonths} onChange={(e) => setCocMonths(e.target.value)} className="h-9 text-sm" /></div>
              )}
            </div>
            {!detOk && <p className="text-xs text-destructive">Check the values: amounts and windows above zero, at least 2 senders per class.</p>}
          </div>
        )}
        <div className="max-w-xs">
          <Label className="text-xs mb-1.5 block">Max wrongly closed (%) for release</Label>
          <Input type="number" min="0" max="100" step="0.5" value={maxPct} onChange={(e) => setMaxPct(e.target.value)} className="h-9 text-sm" />
        </div>
        {isFeatureEnabled(tenant, 'tm_core') && hasPermission(currentUser?.app_role, 'tenantConfig') && (
          <Psd2PartnerSelect value={psd2Partner} onChange={setPsd2Partner} />
        )}
        {isOps && <RegressionRefFields sessionId={reg.sessionId} outreachId={reg.outreachId} itemId={reg.itemId} onChange={(p) => setReg({ ...reg, ...p })} />}
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