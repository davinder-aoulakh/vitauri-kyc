import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import InlineError from '@/components/shared/InlineError';
import KeysTable from './apikeys/KeysTable';
import CreateKeyDialog from './apikeys/CreateKeyDialog';
import KeyRevealDialog from './apikeys/KeyRevealDialog';
import IngestDocsCard from './apikeys/IngestDocsCard';

export default function ApiKeysTab({ tenant }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [plaintext, setPlaintext] = useState(null);
  const queryKey = ['tenant-api-keys', tenant?.id];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    enabled: !!tenant?.id,
    queryFn: async () => (await base44.functions.invoke('manageTenantApiKey', { action: 'list' })).data.keys,
  });

  async function create(label) {
    const res = await base44.functions.invoke('manageTenantApiKey', { action: 'create', label });
    setPlaintext(res.data.plaintext_key);
    setCreateOpen(false);
    qc.invalidateQueries({ queryKey });
  }

  async function revoke(id) {
    try {
      await base44.functions.invoke('manageTenantApiKey', { action: 'revoke', id });
      toast({ title: 'API key revoked' });
    } catch (err) {
      toast({ title: 'Could not revoke key', description: err?.response?.data?.error || err.message, variant: 'destructive' });
    }
    qc.invalidateQueries({ queryKey });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">API keys</h3>
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />Create key</Button>
        </div>
        {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {error && <InlineError message="Could not load API keys." onRetry={() => refetch()} />}
        {data && <KeysTable keys={data} onRevoke={revoke} />}
      </div>
      <IngestDocsCard />
      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={create} />
      <KeyRevealDialog plaintextKey={plaintext} onClose={() => setPlaintext(null)} />
    </div>
  );
}