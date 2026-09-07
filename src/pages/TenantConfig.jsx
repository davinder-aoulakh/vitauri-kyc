import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Lock, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { hasPermission } from '@/lib/permissions';

// Tab components
import BrandingTab          from '@/components/tenantconfig/BrandingTab';
import RolesPermissionsTab  from '@/components/tenantconfig/RolesPermissionsTab';
import RiskIndicatorsTab    from '@/components/tenantconfig/RiskIndicatorsTab';
import ReviewCyclesTab      from '@/components/tenantconfig/ReviewCyclesTab';
import SignOffMatrixTab      from '@/components/tenantconfig/SignOffMatrixTab';
import OutreachTemplatesTab from '@/components/tenantconfig/OutreachTemplatesTab';
import FormTemplatesTab     from '@/components/tenantconfig/FormTemplatesTab';
import EmailTemplatesTab    from '@/components/tenantconfig/EmailTemplatesTab';
import IntegrationsTab      from '@/components/tenantconfig/IntegrationsTab';
const TABS = [
  { id: 'branding',    label: 'Branding' },
  { id: 'roles',       label: 'Roles & Permissions' },
  { id: 'indicators',  label: 'Risk Indicators' },
  { id: 'scoring',     label: 'Scoring Model' },
  { id: 'cycles',      label: 'Review Cycles' },
  { id: 'signoff',     label: 'Sign-Off Matrix' },
  { id: 'outreach',    label: 'Outreach Templates' },
  { id: 'form_tmpl',   label: 'Form Templates' },
  { id: 'email_tmpl',  label: 'Email Templates' },
  { id: 'retention',   label: 'Audit Retention' },
  { id: 'integrations',label: 'Integrations' },
];

export default function TenantConfig() {
  const { currentUser, tenant, setTenant } = useTenant();
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState({
    name: '',
    branding_primary_color: '#1A6BFF',
    branding_secondary_color: '#E8F0FF',
    branding_bg_color: '#F4F6FA',
    branding_text_color: '#1A2332',
    branding_logo_url: '',
    branding_font_family: 'Inter',
    branding_button_radius: 'rounded',
    branding_header_style: 'dark',
    branding_favicon_url: '',
    white_label_enabled: false,
    portal_subdomain: '',
    email_from_name: '',
    email_from_address: '',
    email_reply_to: '',
    portal_welcome_title: '',
    portal_welcome_body: '',
    portal_footer_text: '',
    portal_contact_info: '',
    default_language: 'en',
    audit_retention_years: 5,
    risk_scoring_model: 'highest_risk',
  });

  const userRole = currentUser?.app_role;
  const canConfig = hasPermission(userRole, 'tenantConfig');
  const hydrated = useRef(false);

  useEffect(() => {
    if (tenant && !hydrated.current) {
      hydrated.current = true;
      setForm({
        name:                     tenant.name || '',
        branding_primary_color:   tenant.branding_primary_color || '#1A6BFF',
        branding_secondary_color: tenant.branding_secondary_color || '#E8F0FF',
        branding_bg_color:        tenant.branding_bg_color || '#F4F6FA',
        branding_text_color:      tenant.branding_text_color || '#1A2332',
        branding_logo_url:        tenant.branding_logo_url || '',
        branding_font_family:     tenant.branding_font_family || 'Inter',
        branding_button_radius:   tenant.branding_button_radius || 'rounded',
        branding_header_style:    tenant.branding_header_style || 'dark',
        branding_favicon_url:     tenant.branding_favicon_url || '',
        white_label_enabled:      !!tenant.white_label_enabled,
        portal_subdomain:         tenant.portal_subdomain || '',
        email_from_name:          tenant.email_from_name || '',
        email_from_address:       tenant.email_from_address || '',
        email_reply_to:           tenant.email_reply_to || '',
        portal_welcome_title:     tenant.portal_welcome_title || '',
        portal_welcome_body:      tenant.portal_welcome_body || '',
        portal_footer_text:       tenant.portal_footer_text || '',
        portal_contact_info:      tenant.portal_contact_info || '',
        default_language:         tenant.default_language || 'en',
        audit_retention_years:    tenant.audit_retention_years || 5,
        risk_scoring_model:       tenant.risk_scoring_model || 'highest_risk',
      });
    }
  }, [tenant]);

  async function saveTenant(overrides = {}) {
    if (!tenant?.id) return;
    setSaving(true);
    const payload = { ...form, ...overrides };
    const updated = await base44.entities.Tenant.update(tenant.id, payload);
    setTenant(updated);
    setSaving(false);
  }

  if (!canConfig) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <Lock className="w-8 h-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">Access restricted to Compliance Admin and Tenant Admin.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto space-y-5">
        <PageHeader
          title="Tenant Configuration"
          subtitle="Configure branding, roles, risk model, and integrations for your institution"
          actions={
            <Link to="/ai-prompts">
              <Button size="sm" variant="outline" className="text-xs gap-1.5">
                AI Prompt Library
              </Button>
            </Link>
          }
        />

        <Tabs defaultValue="branding">
          <TabsList className="bg-card border border-border p-1 flex flex-wrap gap-1 h-auto">
            {TABS.map(t => (
              <TabsTrigger
                key={t.id} value={t.id}
                className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-white whitespace-nowrap"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="branding" className="mt-5">
            <BrandingTab tenant={tenant} form={form} setForm={setForm} onSave={() => saveTenant()} saving={saving} />
          </TabsContent>

          <TabsContent value="roles" className="mt-5">
            <RolesPermissionsTab tenant={tenant} currentUser={currentUser} />
          </TabsContent>

          <TabsContent value="indicators" className="mt-5">
            <RiskIndicatorsTab tenant={tenant} />
          </TabsContent>

          <TabsContent value="scoring" className="mt-5">
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-sm">Risk Scoring Model</h3>
              <div className="space-y-3">
                {[
                  { value: 'highest_risk', label: 'Highest-Risk-Wins', desc: 'Final classification = highest individual indicator score. MVP default.', available: true },
                  { value: 'points_based', label: 'Points-Based Scoring', desc: 'Weighted sum of indicator scores with configurable thresholds.', available: false },
                ].map(model => (
                  <div key={model.value}
                    onClick={() => model.available && setForm(f => ({ ...f, risk_scoring_model: model.value }))}
                    className={`border rounded-xl p-4 transition-all ${!model.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${form.risk_scoring_model === model.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{model.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{model.desc}</div>
                      </div>
                      {!model.available && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Post-MVP</span>}
                      {model.available && form.risk_scoring_model === model.value && <div className="w-4 h-4 rounded-full bg-primary" />}
                    </div>
                  </div>
                ))}
              </div>
              <Button onClick={() => saveTenant()} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Model
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="cycles" className="mt-5">
            <ReviewCyclesTab tenant={tenant} />
          </TabsContent>

          <TabsContent value="signoff" className="mt-5">
            <SignOffMatrixTab tenant={tenant} currentUser={currentUser} setTenant={setTenant} />
          </TabsContent>

          <TabsContent value="outreach" className="mt-5">
            <OutreachTemplatesTab tenant={tenant} />
          </TabsContent>

          <TabsContent value="form_tmpl" className="mt-5">
            <FormTemplatesTab tenant={tenant} />
          </TabsContent>

          <TabsContent value="email_tmpl" className="mt-5">
            <EmailTemplatesTab tenant={tenant} currentUser={currentUser} />
          </TabsContent>

          <TabsContent value="retention" className="mt-5">
            <div className="bg-card border border-border rounded-xl p-5 space-y-5">
              <h3 className="font-semibold text-sm">Audit Log Retention</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <span className="text-xs text-blue-700">EU regulatory minimum is 5 years post-offboarding. This cannot be set below 5 years.</span>
              </div>
              <div className="max-w-xs">
                <Label className="text-xs font-medium mb-1.5 block">Retention Period (years)</Label>
                <Input
                  type="number" min={5}
                  value={form.audit_retention_years}
                  onChange={e => setForm(f => ({ ...f, audit_retention_years: Math.max(5, Number(e.target.value)) }))}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Current: {form.audit_retention_years} years ({form.audit_retention_years * 12} months)</p>
              </div>
              <Button onClick={() => saveTenant()} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="integrations" className="mt-5">
            <IntegrationsTab />
          </TabsContent>

        </Tabs>
      </div>
    </AppShell>
  );
}