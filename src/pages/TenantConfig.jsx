import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Save, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_REVIEW_CYCLES = [
  { risk_class: 'Low', cycle_years: 5 },
  { risk_class: 'Medium', cycle_years: 3 },
  { risk_class: 'High', cycle_years: 1 },
  { risk_class: 'Unacceptable', cycle_years: 0.25 },
];

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Unacceptable'];

export default function TenantConfig() {
  const { currentUser, tenant, setTenant } = useTenant();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: tenant?.name || '',
    branding_primary_color: tenant?.branding_primary_color || '#1A6BFF',
    default_language: tenant?.default_language || 'en',
    audit_retention_years: tenant?.audit_retention_years || 5,
    risk_scoring_model: tenant?.risk_scoring_model || 'highest_risk',
  });

  const [reviewCycles, setReviewCycles] = useState(DEFAULT_REVIEW_CYCLES);
  const [signOffMatrix, setSignOffMatrix] = useState({
    Low: { approver: 'Analyst', compliance_mandatory: false },
    Medium: { approver: 'Manager', compliance_mandatory: false },
    High: { approver: 'Director', compliance_mandatory: false },
    Unacceptable: { approver: 'Director', compliance_mandatory: false },
  });

  useEffect(() => {
    if (tenant) {
      setForm({
        name: tenant.name || '',
        branding_primary_color: tenant.branding_primary_color || '#1A6BFF',
        default_language: tenant.default_language || 'en',
        audit_retention_years: tenant.audit_retention_years || 5,
        risk_scoring_model: tenant.risk_scoring_model || 'highest_risk',
      });
    }
  }, [tenant]);

  async function saveBranding() {
    if (!tenant?.id) return;
    setSaving(true);
    const updated = await base44.entities.Tenant.update(tenant.id, form);
    setTenant(updated);
    setSaving(false);
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <PageHeader
          title="Tenant Configuration"
          subtitle="Configure your institution's settings, risk model and permissions"
        />

        <Tabs defaultValue="branding">
          <TabsList className="bg-card border border-border h-auto p-1 flex-wrap gap-1 h-auto">
            {['branding', 'scoring', 'review-cycles', 'sign-off', 'integrations'].map(t => (
              <TabsTrigger key={t} value={t} className="capitalize text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-white">
                {t.replace('-', ' ')}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Branding */}
          <TabsContent value="branding">
            <div className="bg-card border border-border rounded-xl p-5 space-y-5">
              <h3 className="font-semibold text-sm">Institution Branding</h3>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Institution Name</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Primary Color</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      value={form.branding_primary_color}
                      onChange={e => setForm(f => ({ ...f, branding_primary_color: e.target.value }))}
                      className="h-9 w-16 p-1 cursor-pointer"
                    />
                    <Input
                      value={form.branding_primary_color}
                      onChange={e => setForm(f => ({ ...f, branding_primary_color: e.target.value }))}
                      className="h-9 text-sm flex-1 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Default Language</Label>
                  <Select value={form.default_language} onValueChange={v => setForm(f => ({ ...f, default_language: v }))}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English (EN)</SelectItem>
                      <SelectItem value="nl">Dutch (NL)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Audit Retention (years)</Label>
                  <Input
                    type="number"
                    min={5}
                    value={form.audit_retention_years}
                    onChange={e => setForm(f => ({ ...f, audit_retention_years: Number(e.target.value) }))}
                    className="h-9 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">EU minimum is 5 years post-offboarding</p>
                </div>
              </div>

              {/* Preview */}
              <div className="border border-border rounded-lg p-4 bg-muted/20">
                <div className="text-xs text-muted-foreground mb-2">Color Preview</div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg" style={{ backgroundColor: form.branding_primary_color }} />
                  <div>
                    <div className="text-sm font-semibold" style={{ color: form.branding_primary_color }}>{form.name}</div>
                    <div className="text-xs text-muted-foreground">Brand accent color</div>
                  </div>
                  <Button size="sm" className="ml-auto text-xs text-white" style={{ backgroundColor: form.branding_primary_color }}>
                    Sample Button
                  </Button>
                </div>
              </div>

              <Button onClick={saveBranding} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Branding
              </Button>
            </div>
          </TabsContent>

          {/* Scoring Model */}
          <TabsContent value="scoring">
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-sm">Risk Scoring Model</h3>
              <div className="space-y-3">
                {[
                  { value: 'highest_risk', label: 'Highest-Risk-Wins', desc: 'Final classification = highest individual indicator score. MVP default.', available: true },
                  { value: 'points_based', label: 'Points-Based Scoring', desc: 'Weighted sum of indicator scores with configurable thresholds.', available: false },
                ].map(model => (
                  <div
                    key={model.value}
                    onClick={() => model.available && setForm(f => ({ ...f, risk_scoring_model: model.value }))}
                    className={cn(
                      'border rounded-xl p-4 transition-all',
                      !model.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                      form.risk_scoring_model === model.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{model.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{model.desc}</div>
                      </div>
                      {!model.available && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Post-MVP</span>
                      )}
                      {model.available && form.risk_scoring_model === model.value && (
                        <div className="w-4 h-4 rounded-full bg-primary" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button onClick={saveBranding} disabled={saving} className="gap-2">
                <Save className="w-4 h-4" /> Save Model
              </Button>
            </div>
          </TabsContent>

          {/* Review Cycles */}
          <TabsContent value="review-cycles">
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-sm">Periodic Review Cycles</h3>
              <p className="text-xs text-muted-foreground">Changes apply to new cases only — not retroactive.</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                    <th className="text-left py-2">Risk Class</th>
                    <th className="text-left py-2">Cycle Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reviewCycles.map((rc, i) => (
                    <tr key={rc.risk_class}>
                      <td className="py-3 font-medium">{rc.risk_class}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            step="0.25"
                            min="0.25"
                            value={rc.cycle_years}
                            onChange={e => {
                              const updated = [...reviewCycles];
                              updated[i] = { ...updated[i], cycle_years: Number(e.target.value) };
                              setReviewCycles(updated);
                            }}
                            className="h-8 w-24 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">years</span>
                          <span className="text-xs text-muted-foreground">
                            ({rc.cycle_years === 0.25 ? '3 months' : rc.cycle_years === 1 ? '12 months' : `${rc.cycle_years * 12} months`})
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button className="gap-2"><Save className="w-4 h-4" /> Save Cycles</Button>
            </div>
          </TabsContent>

          {/* Sign-Off Matrix */}
          <TabsContent value="sign-off">
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-sm">Sign-Off Matrix</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                    <th className="text-left py-2">Risk Class</th>
                    <th className="text-left py-2">Required Approver</th>
                    <th className="text-left py-2">Compliance Advisory</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {RISK_LEVELS.map(level => (
                    <tr key={level}>
                      <td className="py-3 font-medium">{level}</td>
                      <td className="py-3 text-xs text-muted-foreground">{signOffMatrix[level]?.approver}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={signOffMatrix[level]?.compliance_mandatory}
                            onCheckedChange={v => setSignOffMatrix(m => ({ ...m, [level]: { ...m[level], compliance_mandatory: v } }))}
                          />
                          <span className="text-xs text-muted-foreground">
                            {signOffMatrix[level]?.compliance_mandatory ? 'Mandatory' : 'Optional'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button className="gap-2"><Save className="w-4 h-4" /> Save Matrix</Button>
            </div>
          </TabsContent>

          {/* Integrations */}
          <TabsContent value="integrations">
            <div className="bg-card border border-border rounded-xl p-5 space-y-5">
              <h3 className="font-semibold text-sm">Integration Configuration</h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <span className="text-xs text-amber-700">Integration stubs — vendor TBD. Configure API keys once vendor is selected.</span>
              </div>
              {[
                { label: 'Screening Vendor API Key', placeholder: 'Vendor TBD — API key' },
                { label: 'NP ID&V Vendor API Key', placeholder: 'Deep-fake detection — vendor TBD' },
                { label: 'CRM Integration Endpoint', placeholder: 'https://api.crm.example.com/v1' },
                { label: 'Trade Register (NL KvK) API Key', placeholder: 'KvK API key' },
              ].map(f => (
                <div key={f.label}>
                  <Label className="text-xs font-medium mb-1.5 block">{f.label}</Label>
                  <Input placeholder={f.placeholder} className="h-9 text-sm font-mono" />
                </div>
              ))}
              <Button className="gap-2" disabled><Save className="w-4 h-4" /> Save (Vendor TBD)</Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}