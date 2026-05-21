import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Globe, Loader2, AlertTriangle, Plus, CheckCircle, ExternalLink, RefreshCw, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function OsintPanel({ kycCase, client, onAddToProfile }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [runAt, setRunAt] = useState(null);
  const [added, setAdded] = useState([]);

  // Load cached results on mount
  useEffect(() => {
    if (kycCase?.osint_cache) {
      try {
        const cached = JSON.parse(kycCase.osint_cache);
        setResults(cached.results || null);
        setRunAt(cached.run_at || null);
      } catch {}
    }
  }, [kycCase?.id]);

  async function runSearch() {
    setLoading(true);
    const name = client?.full_name || '';
    const country = client?.registered_country || client?.nationality || '';

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an OSINT intelligence analyst at a regulated financial institution. Conduct thorough open-source intelligence research on the following entity.

Entity Name: "${name}"
Country: "${country}"
Entity Type: ${client?.client_type === 'ORG' ? 'Organisation / Company' : 'Natural Person'}
${client?.client_type === 'ORG' ? `Sector: ${client?.sector || 'Unknown'}\nRegistration: ${client?.registration_number || 'Unknown'}` : `Date of Birth: ${client?.date_of_birth || 'Unknown'}\nNationality: ${client?.nationality || 'Unknown'}`}

Using web search, research and report on:
1. Official website and corporate/personal presence
2. News articles and press coverage (last 5 years)
3. Regulatory actions, enforcement, or sanctions
4. Court proceedings or legal disputes
5. Adverse media or negative mentions
6. LinkedIn / professional profiles (for natural persons)
7. Industry reputation and notable business relationships

For each finding provide: title, a 2-3 sentence summary, source_type (news/regulatory/website/social/legal), credibility rating (high/medium/low), whether it is adverse, and a source URL where possible.

Return 4–8 findings. Be specific and factual. If no results found, state clearly.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: 'object',
        properties: {
          entity_searched: { type: 'string' },
          overall_summary: { type: 'string' },
          adverse_count: { type: 'number' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
                source_type: { type: 'string' },
                credibility: { type: 'string' },
                source_url: { type: 'string' },
                is_adverse: { type: 'boolean' },
              }
            }
          }
        }
      }
    });

    const now = new Date().toISOString();
    setResults(result);
    setRunAt(now);
    setAdded([]);

    // Cache in KycCase
    if (kycCase?.id) {
      await base44.entities.KycCase.update(kycCase.id, {
        osint_cache: JSON.stringify({ results: result, run_at: now }),
      });
    }

    setLoading(false);
  }

  function handleAdd(finding) {
    onAddToProfile?.(finding);
    setAdded(a => [...a, finding.title]);
  }

  const adverseFindings = results?.findings?.filter(f => f.is_adverse) || [];

  return (
    <div className="w-72 flex-shrink-0 bg-navy flex flex-col overflow-hidden border-l border-navy-border">
      {/* Header */}
      <div className="px-3 py-3 border-b border-navy-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-300 flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-white">OSINT Intelligence</div>
            <div className="text-xs text-sidebar-foreground/60 leading-tight">Open-source research · {client?.full_name}</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Idle — no results yet */}
        {!results && !loading && (
          <div className="flex flex-col items-center py-8 gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-navy-light border border-navy-border flex items-center justify-center">
              <Globe className="w-5 h-5 text-blue-300" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">No OSINT data yet</p>
              <p className="text-xs text-sidebar-foreground/60 mt-0.5">Run a search to find news, adverse media, and regulatory information</p>
            </div>
            <Button
              size="sm"
              onClick={runSearch}
              className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white w-full text-xs"
            >
              <Globe className="w-3.5 h-3.5" /> Run OSINT Search
            </Button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center py-10 gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-blue-600/20 animate-ping absolute inset-0" />
              <div className="w-10 h-10 rounded-full bg-navy-light border border-blue-500/40 flex items-center justify-center relative">
                <Globe className="w-4 h-4 text-blue-300 animate-pulse" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-white">Searching open sources…</p>
              <p className="text-xs text-sidebar-foreground/60 mt-0.5">News, registers, adverse media</p>
            </div>
          </div>
        )}

        {/* Results */}
        {results && !loading && (
          <div className="space-y-3">
            {/* Summary bar */}
            <div className="bg-navy-light border border-navy-border rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  {results.findings?.length || 0} findings
                </span>
                {adverseFindings.length > 0 && (
                  <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/30 rounded-full px-2 py-0.5 flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> {adverseFindings.length} adverse
                  </span>
                )}
              </div>
              {results.overall_summary && (
                <p className="text-xs text-sidebar-foreground/70 leading-relaxed">{results.overall_summary}</p>
              )}
              {runAt && (
                <div className="flex items-center gap-1 text-xs text-sidebar-foreground/40">
                  <Clock className="w-2.5 h-2.5" />
                  {format(new Date(runAt), 'd MMM yyyy HH:mm')}
                </div>
              )}
            </div>

            {/* Finding cards */}
            {results.findings?.map((f, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg border p-2.5 space-y-1.5',
                  f.is_adverse
                    ? 'bg-red-900/20 border-red-500/30'
                    : 'bg-navy-light border-navy-border'
                )}
              >
                {/* Title row */}
                <div className="flex items-start gap-1.5">
                  {f.is_adverse && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />}
                  <span className="text-xs font-semibold text-white leading-tight">{f.title}</span>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-medium',
                    f.credibility === 'high' ? 'bg-emerald-600/30 text-emerald-300' :
                    f.credibility === 'medium' ? 'bg-amber-600/30 text-amber-300' :
                    'bg-slate-600/30 text-slate-300'
                  )}>
                    {f.credibility}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-300 font-medium">
                    {f.source_type}
                  </span>
                </div>

                {/* Summary */}
                <p className="text-xs text-sidebar-foreground/70 leading-relaxed">{f.summary}</p>

                {/* Footer */}
                <div className="flex items-center justify-between pt-0.5">
                  {f.source_url ? (
                    <a href={f.source_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                      <ExternalLink className="w-2.5 h-2.5" /> Source
                    </a>
                  ) : <span />}
                  <button
                    onClick={() => handleAdd(f)}
                    disabled={added.includes(f.title)}
                    className={cn(
                      'text-xs flex items-center gap-1 px-2 py-0.5 rounded border transition-colors',
                      added.includes(f.title)
                        ? 'border-emerald-500/30 text-emerald-400 bg-emerald-600/10 cursor-default'
                        : 'border-blue-500/30 text-blue-300 hover:bg-blue-600/20 hover:border-blue-400/50'
                    )}
                  >
                    {added.includes(f.title)
                      ? <><CheckCircle className="w-2.5 h-2.5" /> Added</>
                      : <><Plus className="w-2.5 h-2.5" /> Add</>
                    }
                  </button>
                </div>
              </div>
            ))}

            {/* Re-run */}
            <Button
              size="sm" variant="ghost"
              onClick={runSearch}
              className="w-full text-xs text-sidebar-foreground/60 hover:text-white hover:bg-navy-light gap-1.5"
            >
              <RefreshCw className="w-3 h-3" /> Re-run Search
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}