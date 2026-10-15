import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import { errorMessage } from '@/lib/tmAlerts';
import { Download, Loader2 } from 'lucide-react';

/** Builds the tenant's TM ZIP on the server and offers the download link. */
export default function TmExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function run() {
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await base44.functions.invoke('exportTenantTm', {});
      setResult(res.data);
      window.open(res.data.download_url, '_blank', 'noopener');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <h3 className="font-semibold text-sm">Export TM data</h3>
      <p className="text-xs text-muted-foreground">A ZIP with one JSON file per transaction monitoring table, plus a list of generated goAML file URLs. The link is valid for one hour.</p>
      {error && <InlineError message={error} onRetry={run} />}
      <Button variant="outline" className="gap-2" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export TM data (ZIP)
      </Button>
      {result && (
        <p className="text-xs text-muted-foreground">
          Ready: {Object.values(result.counts).reduce((a, b) => a + b, 0)} records, {result.goaml_files} goAML file(s).{' '}
          <a className="text-primary hover:underline" href={result.download_url} target="_blank" rel="noopener noreferrer">Download again</a>
          {result.truncated_entities?.length > 0 && <span className="text-amber-700"> Capped: {result.truncated_entities.join(', ')}.</span>}
        </p>
      )}
    </div>
  );
}