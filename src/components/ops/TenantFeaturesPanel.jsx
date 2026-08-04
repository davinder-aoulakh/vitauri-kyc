import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { FEATURE_DEFINITIONS } from '@/lib/featureFlags';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { X, ToggleLeft, Loader2, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TenantFeaturesPanel({ tenant, onClose, onSaved }) {
  const [flags, setFlags] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    try {
      const parsed = tenant.features_enabled
        ? (typeof tenant.features_enabled === 'string'
            ? JSON.parse(tenant.features_enabled)
            : tenant.features_enabled)
        : {};
      setFlags(parsed);
    } catch {
      setFlags({});
    }
  }, [tenant]);

  function toggle(key) {
    setFlags(prev => {
      const current = key in prev ? prev[key] : true;
      return { ...prev, [key]: !current };
    });
    setSaved(false);
  }

  function isOn(key) {
    return key in flags ? flags[key] !== false : true;
  }

  async function handleSave() {
    setSaving(true);
    await base44.entities.Tenant.update(tenant.id, {
      features_enabled: JSON.stringify(flags),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => { onSaved?.(); }, 800);
  }

  const enabledCount = FEATURE_DEFINITIONS.flatMap(g => g.features).filter(f => isOn(f.key)).length;
  const totalCount = FEATURE_DEFINITIONS.flatMap(g => g.features).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <ToggleLeft className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold text-sm">Feature Flags</div>
              <div className="text-xs text-muted-foreground truncate max-w-[220px]">{tenant?.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary badge */}
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{enabledCount}</span> of {totalCount} features enabled for this tenant
          </div>
        </div>

        {/* Feature list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {FEATURE_DEFINITIONS.map(group => (
            <div key={group.group}>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {group.group}
              </div>
              <div className="space-y-3">
                {group.features.map(feature => {
                  const on = isOn(feature.key);
                  return (
                    <div
                      key={feature.key}
                      className={cn(
                        'flex items-start justify-between gap-3 p-3 rounded-lg border transition-colors',
                        on ? 'bg-card border-border' : 'bg-muted/30 border-border/50'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={cn('text-sm font-medium', !on && 'text-muted-foreground line-through')}>
                          {feature.label}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{feature.description}</div>
                      </div>
                      <Switch
                        checked={on}
                        onCheckedChange={() => toggle(feature.key)}
                        className="flex-shrink-0 mt-0.5"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex-shrink-0 flex items-center gap-3">
          <Button variant="outline" size="sm" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="flex-1 gap-1.5" onClick={handleSave} disabled={saving || saved}>
            {saving ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
            ) : saved ? (
              <><CheckCircle className="w-3.5 h-3.5" /> Saved</>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}