import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { errorMessage } from '@/lib/tmAlerts';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import ProfileFields from '@/components/tenantconfig/fiu/ProfileFields';
import IndicatorCodesTable from '@/components/tenantconfig/fiu/IndicatorCodesTable';
import ScenarioMapping from '@/components/tenantconfig/fiu/ScenarioMapping';
import { PROFILE_LABELS, toDraft, toMappings } from '@/lib/fiuProfile';
import { Loader2, Save } from 'lucide-react';

export default function FiuProfileCard({ profile, scenarios, canEdit, onSaved }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(() => toDraft(profile));
  const [mappings, setMappings] = useState(() => toMappings(scenarios, profile.code));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const valid = new Set(draft.indicator_codes.map((c) => c.code.trim()));
      await base44.functions.invoke('saveFiuProfile', {
        profile_id: profile.id,
        profile: draft,
        mappings: scenarios.map((s) => ({ scenario_id: s.id, codes: (mappings[s.id] || []).filter((c) => valid.has(c)) })),
      });
      toast({ title: `${PROFILE_LABELS[profile.code]} profile saved` });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{PROFILE_LABELS[profile.code] || profile.code} <span className="text-muted-foreground font-mono text-xs">({profile.code})</span></h3>
        {canEdit && (
          <Button size="sm" className="gap-1.5" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save profile
          </Button>
        )}
      </div>
      {error && <InlineError message={error} onRetry={save} />}
      <ProfileFields draft={draft} set={set} disabled={!canEdit} />
      <IndicatorCodesTable codes={draft.indicator_codes} onChange={(v) => set({ indicator_codes: v })} disabled={!canEdit} />
      <ScenarioMapping scenarios={scenarios} codes={draft.indicator_codes} mappings={mappings} disabled={!canEdit} onChange={(id, v) => setMappings((m) => ({ ...m, [id]: v }))} />
    </section>
  );
}