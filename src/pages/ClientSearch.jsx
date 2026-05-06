import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import RiskBadge from '@/components/shared/RiskBadge';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Plus, AlertTriangle, Upload, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dedupScore, DEDUP_THRESHOLD } from '@/lib/dedup';

const RESTRICTED = ['Rejected', 'Unacceptable'];

export default function ClientSearch() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();

  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [casesCounts, setCasesCounts] = useState({}); // clientId → count
  const [allClients, setAllClients] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [searched, setSearched]     = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const debounceRef = useRef(null);

  // Load all clients once on mount so dedup runs client-side
  useEffect(() => {
    if (currentUser?.tenant_id) {
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }).then(d => setAllClients(d || []));
      base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }).then(cases => {
        const counts = {};
        (cases || []).forEach(c => { counts[c.client_id] = (counts[c.client_id] || 0) + 1; });
        setCasesCounts(counts);
      });
    }
  }, [currentUser]);

  useEffect(() => {
    setAcknowledged(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setSearched(false); return; }
    debounceRef.current = setTimeout(() => runSearch(query), 300);
  }, [query, allClients]);

  function runSearch(q) {
    setLoading(true);
    const lower = q.toLowerCase();
    const filtered = allClients.filter(c =>
      c.full_name?.toLowerCase().includes(lower) ||
      c.registration_number?.toLowerCase().includes(lower) ||
      c.date_of_birth?.includes(q)
    );
    setResults(filtered);
    setSearched(true);
    setLoading(false);
  }

  // Dedup scores against query name
  const dedupHits = results.map(c => ({ client: c, score: dedupScore(query, '', c) }))
    .filter(r => r.score >= DEDUP_THRESHOLD);
  const hasDuplicates = dedupHits.length > 0;
  const hasRestricted = results.some(c => RESTRICTED.includes(c.status));
  const canCreateNew  = !hasDuplicates || acknowledged;

  async function handleAcknowledge() {
    setAcknowledged(true);
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'dedup_warning_acknowledged',
      notes: `Analyst acknowledged duplicate warning for query: "${query}"`,
      after_state: { query, matched_clients: dedupHits.map(h => ({ id: h.client.id, name: h.client.full_name, score: h.score })) },
    });
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <PageHeader
          title="Client Search"
          subtitle="Search existing clients before creating a new record — all statuses included"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/batch-upload')} className="gap-2 text-sm">
                <Upload className="w-4 h-4" /> Batch Upload
              </Button>
              <Button
                onClick={() => navigate('/new-client')}
                className="gap-2"
                disabled={searched && hasDuplicates && !acknowledged}
                title={searched && hasDuplicates && !acknowledged ? 'Acknowledge duplicate warning first' : undefined}
              >
                <Plus className="w-4 h-4" /> New Client
              </Button>
            </div>
          }
        />

        {/* Search box */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, registration number or date of birth…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="pl-10 h-11 text-sm"
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Searching within your tenant — includes all statuses (Active, Former, Rejected, Unacceptable)
          </p>
        </div>

        {/* Duplicate warning banner */}
        {searched && hasDuplicates && (
          <div className={cn(
            'border rounded-xl p-4',
            acknowledged ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-300'
          )}>
            <div className="flex gap-3 items-start">
              <AlertTriangle className={cn('w-5 h-5 flex-shrink-0 mt-0.5', acknowledged ? 'text-amber-500' : 'text-red-500')} />
              <div className="flex-1">
                <div className={cn('font-semibold text-sm', acknowledged ? 'text-amber-800' : 'text-red-800')}>
                  {acknowledged ? 'Duplicate acknowledged — proceed with caution' : '⚠ Potential duplicate detected'}
                </div>
                <div className={cn('text-xs mt-1', acknowledged ? 'text-amber-700' : 'text-red-700')}>
                  {dedupHits.length} existing client{dedupHits.length > 1 ? 's' : ''} matched at ≥{DEDUP_THRESHOLD}% similarity.
                  Creating a new client without reviewing these may create a duplicate record.
                </div>
                {!acknowledged && (
                  <div className="mt-3 flex items-start gap-2">
                    <Checkbox id="ack" onCheckedChange={checked => checked && handleAcknowledge()} className="mt-0.5" />
                    <label htmlFor="ack" className="text-xs text-red-700 cursor-pointer leading-relaxed">
                      I have reviewed the existing records below and confirm this is a new client that is not a duplicate.
                      This acknowledgement will be logged as an audit event.
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Restricted warning */}
        {hasRestricted && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-800">Gatekept client in results</div>
              <div className="text-xs text-red-600 mt-0.5">
                One or more results are Rejected / Unacceptable. Re-onboarding requires Compliance Officer approval.
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && <div className="text-center py-6 text-muted-foreground text-sm">Searching…</div>}

        {/* Empty state */}
        {!loading && searched && results.length === 0 && (
          <EmptyState
            icon={Search}
            title="No clients found"
            description="No records match your search. You can create a new client below."
            action={
              <Button onClick={() => navigate('/new-client')} className="gap-2">
                <Plus className="w-4 h-4" /> Create New Client
              </Button>
            }
          />
        )}

        {/* Results table */}
        {results.length > 0 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {results.length} result{results.length !== 1 ? 's' : ''} found
              </span>
              {canCreateNew && (
                <Button size="sm" className="gap-1.5 text-xs h-7" onClick={() => navigate('/new-client')}>
                  <Plus className="w-3 h-3" /> Create New Client
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Name</th>
                    <th className="text-left px-4 py-2.5">Type</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Risk Class</th>
                    <th className="text-left px-4 py-2.5">Cases</th>
                    <th className="text-left px-4 py-2.5">Country</th>
                    <th className="text-left px-4 py-2.5">Match</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map(client => {
                    const isRestricted = RESTRICTED.includes(client.status);
                    const score = dedupScore(query, '', client);
                    const isDupHit = score >= DEDUP_THRESHOLD;
                    return (
                      <tr key={client.id} className={cn('hover:bg-muted/30 transition-colors', isDupHit && 'bg-amber-50/40')}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{client.full_name}</span>
                            {isRestricted && (
                              <span className="flex items-center gap-1 text-xs text-red-600 font-medium bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200 whitespace-nowrap">
                                <AlertTriangle className="w-3 h-3" />
                                Gatekept — Compliance approval required to re-onboard
                              </span>
                            )}
                          </div>
                          {client.registration_number && (
                            <div className="text-xs text-muted-foreground mt-0.5">Reg: {client.registration_number}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded',
                            client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                          )}>
                            {client.client_type || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'text-xs font-medium px-2 py-0.5 rounded-full border',
                            isRestricted ? 'bg-red-100 text-red-700 border-red-200'
                              : client.status === 'Active' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                              : 'bg-muted text-muted-foreground border-border'
                          )}>
                            {client.status}
                          </span>
                        </td>
                        <td className="px-4 py-3"><RiskBadge risk={client.risk_classification} /></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                          {casesCounts[client.id] || 0}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {client.registered_country || client.nationality || client.country_of_residence || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {query.length >= 2 && (
                            <span className={cn('text-xs font-mono px-1.5 py-0.5 rounded',
                              score >= DEDUP_THRESHOLD ? 'bg-amber-100 text-amber-700' : 'text-muted-foreground'
                            )}>
                              {score}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline" size="sm" className="text-xs h-7 gap-1"
                            onClick={() => navigate(`/client/${client.id}`)}
                          >
                            View <ExternalLink className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Initial prompt */}
        {!searched && (
          <div className="text-center py-10 text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Type at least 2 characters to search</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}