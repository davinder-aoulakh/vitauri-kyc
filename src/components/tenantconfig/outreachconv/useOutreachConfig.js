// Guided conversation outreach, Tenant Config: loads and changes blocks, templates and settings through manageOutreachConfig.
import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { versionsByKey } from '@/lib/outreachConfigView';

export const errText = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

export function useOutreachConfig() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await base44.functions.invoke('manageOutreachConfig', { action: 'list' });
      if (r?.data?.error) throw new Error(r.data.error);
      setData(r.data);
    } catch (e) {
      setData({ error: errText(e) });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = useCallback(async (action, payload = {}, okText) => {
    setBusy(action);
    try {
      const fn = action === 'seed' ? 'seedOutreachLibrary' : 'manageOutreachConfig';
      const r = await base44.functions.invoke(fn, action === 'seed' ? payload : { action, ...payload });
      if (r?.data?.error) throw new Error(r.data.error);
      if (okText) toast({ title: typeof okText === 'function' ? okText(r.data) : okText });
      await load();
      return r.data;
    } catch (e) {
      toast({ variant: 'destructive', title: 'Not saved', description: errText(e) });
      return null;
    } finally {
      setBusy('');
    }
  }, [load]);
  const blocks = versionsByKey(data?.blocks || []);
  const templates = versionsByKey(data?.templates || []);
  return { data, busy, act, reload: load, blocks, templates };
}
