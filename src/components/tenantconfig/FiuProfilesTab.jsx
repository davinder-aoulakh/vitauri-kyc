import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import { hasPermission } from '@/lib/permissions';
import { errorMessage } from '@/lib/tmAlerts';
import { WARNING } from '@/lib/fiuProfile';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import InlineError from '@/components/shared/InlineError';
import EmptyState from '@/components/shared/EmptyState';
import FiuProfileCard from '@/components/tenantconfig/fiu/FiuProfileCard';
import { AlertTriangle, Landmark, Loader2 } from 'lucide-react';

export default function FiuProfilesTab({ tenant, currentUser }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tenantId = tenant?.id;
  const canEdit = hasPermission(currentUser?.app_role, 'tenantConfig');
  const [confirm, setConfirm] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fiuProfilesTab', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [profiles, scenarios] = await Promise.all([
        base44.entities.FiuProfile.filter({ tenant_id: tenantId }, { limit: 10 }),
        base44.entities.TmScenario.filter({ tenant_id: tenantId }, { sort: 'code', limit: 500 }),
      ]);
      return { profiles: profiles.items || [], scenarios: scenarios.items || [] };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['fiuProfilesTab', tenantId] });

  const seed = async () => {
    setConfirm(false); setSeeding(true); setSeedError('');
    try {
      await base44.functions.invoke('seedTmLibrary', {});
      toast({ title: 'Defaults loaded' });
      await refresh();
    } catch (e) {
      setSeedError(errorMessage(e));
    } finally {
      setSeeding(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-16" role="status"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (error) return <InlineError message="Couldn't load FIU profiles." onRetry={refetch} />;

  const profiles = ['CW', 'NL'].map((code) => data.profiles.find((p) => p.code === code)).filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{WARNING}</span>
      </div>
      {seedError && <InlineError message={seedError} onRetry={seed} />}
      {profiles.length === 0 ? (
        <EmptyState
          icon={Landmark} title="No FIU profiles yet"
          description={canEdit ? 'Load the default Curaçao and Netherlands profiles to start configuring them.' : 'Ask a Tenant Admin to load the default FIU profiles.'}
          action={canEdit ? <Button disabled={seeding} onClick={() => setConfirm(true)}>{seeding && <Loader2 className="w-4 h-4 animate-spin" />} Load defaults</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5 items-start">
          {profiles.map((p) => (
            <FiuProfileCard key={`${p.id}-${p.updated_date}`} profile={p} scenarios={data.scenarios} canEdit={canEdit} onSaved={refresh} />
          ))}
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load default FIU profiles?</AlertDialogTitle>
            <AlertDialogDescription>This creates the default FIU Curaçao and FIU-Nederland profiles plus the scenario library. {WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={seed}>Load defaults</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}