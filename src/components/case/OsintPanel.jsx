import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Globe, Loader2, AlertTriangle, Plus, CheckCircle, ExternalLink, RefreshCw, Clock, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import InlineError from '@/components/shared/InlineError';
import { clientIdentityKey } from '@/lib/osintIdentity';

const TIMEOUT_MS = 150000;
const MATCH = {
  confirmed: { label: 'Confirmed match', cls: 'bg-emerald-600/30 text-emerald-300' },
  likely: { label: 'Likely match', cls: 'bg-sky-600/30 text-sky-300' },
  possible: { label: 'Possible — name only', cls: 'bg-amber-600/30 text-amber-300' },
};

function FindingCard({ f, added, onAdd, muted = false }) {
  const match = MATCH[f.subject_match];
  return (
    <div className={cn('rounded-lg border p-2.5 space-y-1.5',
      muted ? 'bg-navy-light/50 border-navy-border opacity-80' : f.is_adverse ? 'bg-red-900/20 border-red-500/30' : 'bg-navy-light border-navy-border')}>
      <div className="flex items-start gap-1.5">
        {f.is_adverse && !muted && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />}
        <span className="text-xs font-semibold text-white leading-tight">{f.title}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {match && !muted && <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', match.cls)}>{match.label}</span>}
        {f.credibility && (
          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
            f.credibility === 'high' ? 'bg-emerald-600/20 text-emerald-300' : f.credibility === 'medium' ? 'bg-amber-600/20 text-amber-300' : 'bg-slate-600/30 text-slate-300')}>
            {f.credibility} credibility
          </span>
        )}
        {f.source_type && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-300 font-medium">{f.source_type}</span>}
      </div>
      <p className="text-xs text-sidebar-foreground/70 leading-relaxed">{f.summary}</p>
      {!muted && f.matched_on?.length > 0 && (
        <p className="text-[11px] text-sidebar-foreground/50">Matched on: {f.matched_on.join(', ')}{f.name_variant ? ` · as "${f.name_variant}"` : ''}</p>
      )}
      {muted && f.mismatch && <p className="text-[11px] text-sidebar-foreground/50">Why not the subject: {f.mismatch}</p>}
      <div className="flex items-center justify-between pt-0.5">
        {f.source_url ? (
          <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            <ExternalLink className="w-2.5 h-2.5" /> Source
          </a>
        ) : <span />}
        {!muted && (
          <button onClick={() => onAdd(f)} disabled={added}
            className={cn('text-xs flex items-center gap-1 px-2 py-0.5 rounded border transition-colors',
              added ? 'border-emerald-500/30 text-emerald-400 bg-emerald-600/10 cursor-default' : 'border-blue-500/30 text-blue-300 hover:bg-blue-600/20 hover:border-blue-400/50')}>
            {added ? <><CheckCircle className="w-2.5 h-2.5" /> Added</> : <><Plus className="w-2.5 h-2.5" /> Add</>}
          </button>
        )}
      </div>
    </div>
  );
}

export default function OsintPanel({ kycCase, client, onAddToProfile }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [runAt, setRunAt] = useState(null);
  const [added, setAdded] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [hints, setHints] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const [showSearched, setShowSearched] = useState(false);

  // Load cached results on mount
  useEffect(() => {
    if (kycCase?.osint_cache) {
      try {
        const cached = JSON.parse(kycCase.osint_cache);
        setResults(cached.results || null);
        setRunAt(cached.run_at || null);
        setHints(cached.results?.hints || '');
      } catch { /* unreadable cache: start empty */ }
    }
  }, [kycCase?.id]);

  async function runSearch() {
    setLoading(true);
    setSearchError(null);
    try {
      const res = await Promise.race([
        base44.functions.invoke('runOsintSearch', { case_id: kycCase.id, hints }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OSINT search timed out — please try again.')), TIMEOUT_MS)),
      ]);
      const data = res?.data ?? res;
      setResults(data.results);
      setRunAt(data.run_at);
      setAdded([]);
      setShowOthers(false);
    } catch (err) {
      console.error('OSINT runSearch error:', err);
      setSearchError(err?.response?.data?.error || err?.message || 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleAdd(finding) {
    onAddToProfile?.(finding);
    setAdded((a) => [...a, finding.title]);
  }

  const findings = results?.findings || [];
  const others = results?.other_people || [];
  const adverseFindings = findings.filter((f) => f.is_adverse);
  const names = results?.subject?.names || [];
  const ids = results?.subject?.identifiers || {};
  const context = [...(ids.employers || []), ids.email_domain, ...(ids.linked_companies || []), ids.city, ids.country].filter(Boolean);
  // Old caches have no identity key; a different key means names/identifiers changed after this search.
  const stale = !!results && !loading && (results.identity_key == null || results.identity_key !== clientIdentityKey(client));

  const hintBox = (
    <div className="space-y-1">
      <label htmlFor="osint-hints" className="text-[11px] text-sidebar-foreground/60">Search hints (optional)</label>
      <textarea id="osint-hints" value={hints} onChange={(e) => setHints(e.target.value)} rows={2} maxLength={500}
        placeholder="Other names, website, LinkedIn URL, employer…"
        className="w-full rounded-md bg-navy-light border border-navy-border px-2 py-1.5 text-xs text-white placeholder:text-sidebar-foreground/40 focus:outline-none focus:border-blue-500/50 resize-none" />
    </div>
  );

  return (
    <div className="w-72 flex-shrink-0 bg-navy flex flex-col overflow-hidden border-l border-navy-border">
      {/* Header */}
      <div className="px-3 py-3 border-b border-navy-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-300 flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-white">OSINT Intelligence</div>
            <div className="text-xs text-sidebar-foreground/60 leading-tight">Open-source research · {client?.preferred_name || client?.full_name}</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {searchError && !loading && <InlineError message={searchError} onRetry={runSearch} retryLabel="Retry Search" />}

        {/* Idle — no results yet */}
        {!results && !loading && !searchError && (
          <div className="flex flex-col items-center py-6 gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-navy-light border border-navy-border flex items-center justify-center">
              <Globe className="w-5 h-5 text-blue-300" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">No OSINT data yet</p>
              <p className="text-xs text-sidebar-foreground/60 mt-0.5">Searches every name the client is known by, using employer, companies and location to tell them apart from namesakes</p>
            </div>
            <div className="w-full text-left">{hintBox}</div>
            <Button size="sm" onClick={runSearch} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white w-full text-xs">
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
              <p className="text-xs text-sidebar-foreground/60 mt-0.5">All name variants, profiles, registers, adverse media. This can take up to two minutes.</p>
            </div>
          </div>
        )}

        {/* Results */}
        {results && !loading && (
          <div className="space-y-3">
            {stale && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200 space-y-1.5">
                <p>{results.identity_key == null
                  ? 'These results come from the previous search, which only used the full legal name.'
                  : 'The client\'s names or details changed since this search.'}</p>
                <button onClick={runSearch} className="font-medium text-amber-100 underline hover:no-underline">Re-run with current details</button>
              </div>
            )}

            {/* Summary */}
            <div className="bg-navy-light border border-navy-border rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">{findings.length} finding{findings.length === 1 ? '' : 's'} about the client</span>
                {adverseFindings.length > 0 && (
                  <span className="text-xs bg-red-500/20 text-red-300 border border-red-500/30 rounded-full px-2 py-0.5 flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> {adverseFindings.length} adverse
                  </span>
                )}
              </div>
              {results.overall_summary && <p className="text-xs text-sidebar-foreground/70 leading-relaxed">{results.overall_summary}</p>}
              {names.length > 0 && (
                <div className="text-[11px] text-sidebar-foreground/60">
                  <button className="flex items-center gap-1 hover:text-white" onClick={() => setShowSearched((v) => !v)}>
                    <Search className="w-2.5 h-2.5" /> Searched as: {names.slice(0, 2).join(' · ')}{names.length > 2 ? ` +${names.length - 2}` : ''}
                  </button>
                  {showSearched && (
                    <div className="mt-1 space-y-0.5 pl-3.5">
                      <div>Names: {names.join(', ')}</div>
                      {context.length > 0 && <div>Context: {context.join(', ')}</div>}
                      {results.hints && <div>Hints: {results.hints}</div>}
                      {results.queries?.length > 0 && <div>{results.queries.length} search queries</div>}
                    </div>
                  )}
                </div>
              )}
              {results.partial && <p className="text-[11px] text-amber-300">Part of the search failed; re-run for complete results.</p>}
              {runAt && (
                <div className="flex items-center gap-1 text-xs text-sidebar-foreground/40">
                  <Clock className="w-2.5 h-2.5" /> {format(new Date(runAt), 'd MMM yyyy HH:mm')}
                </div>
              )}
            </div>

            {findings.length === 0 && (
              <p className="text-xs text-sidebar-foreground/60 text-center py-2">Nothing found that could be tied to this client. Add a hint (e.g. LinkedIn URL or employer) and re-run.</p>
            )}
            {findings.map((f, i) => <FindingCard key={`f${i}`} f={f} added={added.includes(f.title)} onAdd={handleAdd} />)}

            {others.length > 0 && (
              <div className="space-y-2">
                <button onClick={() => setShowOthers((v) => !v)} className="w-full flex items-center gap-1 text-xs text-sidebar-foreground/60 hover:text-white">
                  {showOthers ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Other people with a similar name ({others.length})
                </button>
                {showOthers && others.map((f, i) => <FindingCard key={`o${i}`} f={f} muted />)}
              </div>
            )}

            <div className="pt-1 space-y-2">
              {hintBox}
              <Button size="sm" variant="ghost" onClick={runSearch}
                className="w-full text-xs text-sidebar-foreground/60 hover:text-white hover:bg-navy-light gap-1.5">
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Re-run Search
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
