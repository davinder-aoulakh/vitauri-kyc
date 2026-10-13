import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import InlineError from '@/components/shared/InlineError';
import { Loader2, Sparkles } from 'lucide-react';

/** 90-day evidence summary from the TmEvidence agent, with sources and explicit data gaps. */
export default function AiSummaryBox({ clientId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('runTmAgent', { agent: 'TmEvidence', client_id: clientId });
      setResult(res?.data ?? res);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not generate the summary.');
    }
    setLoading(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> AI summary (last 90 days)</h3>
        <Button size="sm" variant="outline" onClick={run} disabled={loading} className="gap-1.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {result ? 'Regenerate' : 'Summarise'}
        </Button>
      </div>
      {error && <InlineError message={error} onRetry={run} />}
      {!result && !loading && !error && <p className="text-xs text-muted-foreground">Summarises transactions, alerts and the expected profile for the last 90 days, citing its sources.</p>}
      {result && (
        <div className="space-y-3 text-sm">
          <p className="leading-relaxed">{result.summary}</p>
          {result.findings?.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {result.findings.map((f, i) => <li key={i}>{f.text}</li>)}
            </ul>
          )}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="mb-1 font-semibold">Data gaps</div>
            {result.missing?.length ? <ul className="list-disc pl-4">{result.missing.map((m, i) => <li key={i}>{m}</li>)}</ul> : 'None identified.'}
          </div>
          <p className="break-words text-[11px] text-muted-foreground">
            Sources: {result.sources?.length ? result.sources.join(', ') : 'none cited'}
          </p>
        </div>
      )}
    </div>
  );
}