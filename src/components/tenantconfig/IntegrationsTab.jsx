import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ExternalLink, CheckCircle, Circle, Loader2, ListOrdered } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const INTEGRATIONS = [
  {
    key: 'screening',
    label: 'Screening Vendor',
    description: 'PEP, Sanctions, and Adverse Media screening API. Connected to the abstraction layer (S-060).',
    fields: [{ key: 'api_key', label: 'API Key', placeholder: 'Vendor TBD — configure once selected', type: 'password' }],
    status: 'stub',
  },
  {
    key: 'idv',
    label: 'NP ID&V Vendor',
    description: 'Identity document verification with deep-fake detection. Vendor TBD.',
    fields: [{ key: 'api_key', label: 'API Key', placeholder: 'Deep-fake detection — vendor TBD', type: 'password' }],
    status: 'stub',
    warning: 'Deep-fake detection required. Vendor selection pending.',
  },
  {
    key: 'crm',
    label: 'CRM Integration',
    description: 'Bidirectional sync with your CRM for client data.',
    fields: [
      { key: 'endpoint', label: 'API Endpoint', placeholder: 'https://api.crm.example.com/v1', type: 'text' },
      { key: 'api_key', label: 'API Key', placeholder: 'CRM API key', type: 'password' },
    ],
    status: 'stub',
  },
  {
    key: 'kvk',
    label: 'NL Trade Register (KvK)',
    description: 'Netherlands Chamber of Commerce trade register for company verification and change monitoring.',
    fields: [{ key: 'api_key', label: 'KvK API Key', placeholder: 'KvK API key', type: 'password' }],
    status: 'enabled',
    enabledByDefault: true,
  },
  {
    key: 'companies_house',
    label: 'UK Companies House',
    description: 'UK Companies House API for company data. Configure for UK-registered entities.',
    fields: [{ key: 'api_key', label: 'Companies House API Key', placeholder: 'Companies House API key', type: 'password' }],
    status: 'stub',
  },
];

export default function IntegrationsTab({ tenant }) {
  const [values, setValues]   = useState({});
  const [enabled, setEnabled] = useState({ kvk: true });
  const [fixing, setFixing]   = useState(false);
  const { toast } = useToast();

  function setField(intKey, fieldKey, val) {
    setValues(v => ({ ...v, [intKey]: { ...(v[intKey] || {}), [fieldKey]: val } }));
  }

  async function fixItemOrdering() {
    if (!tenant?.id) return;
    setFixing(true);
    const requests = await base44.entities.OutreachRequest.filter({ tenant_id: tenant.id });
    const patches = [];
    for (const req of (requests || [])) {
      const items = req.items || [];
      const needsPatch = items.some(i => i.sort_order === undefined || i.sort_order === null);
      if (!needsPatch) continue;
      const patchedItems = items.map((item, idx) => ({
        ...item,
        sort_order: item.sort_order ?? idx,
      }));
      patches.push({ id: req.id, items: patchedItems });
    }
    if (patches.length > 0) {
      await base44.entities.OutreachRequest.bulkUpdate(patches);
    }
    setFixing(false);
    toast({ description: `Fixed item ordering on ${patches.length} outreach request(s).` });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Integration Configuration</h3>
        <p className="text-xs text-muted-foreground mt-0.5">API stubs for MVP. Configure once vendors are selected.</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <span className="text-xs text-amber-700">Integration credentials are stored securely. Never share API keys. Changes are effective immediately for new operations.</span>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <span className="font-semibold text-sm">Fix Outreach Item Ordering</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              One-time backfill that assigns a display order to existing outreach requests so item ordering in the client portal matches how items were configured.
            </p>
          </div>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 flex-shrink-0" onClick={fixItemOrdering} disabled={fixing}>
            {fixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListOrdered className="w-3.5 h-3.5" />}
            {fixing ? 'Fixing…' : 'Fix Item Ordering'}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {INTEGRATIONS.map(intg => (
          <div key={intg.key} className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{intg.label}</span>
                  {enabled[intg.key]
                    ? <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><CheckCircle className="w-3 h-3" /> Enabled</span>
                    : <span className="flex items-center gap-1 text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full"><Circle className="w-3 h-3" /> Disabled</span>
                  }
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{intg.description}</p>
                {intg.warning && (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {intg.warning}
                  </p>
                )}
              </div>
              <Switch
                checked={!!enabled[intg.key]}
                onCheckedChange={v => setEnabled(e => ({ ...e, [intg.key]: v }))}
              />
            </div>
            {enabled[intg.key] && (
              <div className="grid gap-3 pt-1 border-t border-border">
                {intg.fields.map(field => (
                  <div key={field.key}>
                    <Label className="text-xs font-medium mb-1.5 block">{field.label}</Label>
                    <Input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={values[intg.key]?.[field.key] || ''}
                      onChange={e => setField(intg.key, field.key, e.target.value)}
                      className="h-9 text-sm font-mono"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}