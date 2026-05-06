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
import { Search, Plus, AlertTriangle, UserCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ClientSearch() {
  const { currentUser } = useTenant();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setSearched(false); return; }
    debounceRef.current = setTimeout(() => search(query), 300);
  }, [query]);

  async function search(q) {
    setLoading(true);
    const all = await base44.entities.Client.filter({ tenant_id: currentUser.tenant_id });
    const lower = q.toLowerCase();
    const filtered = (all || []).filter(c => {
      return (
        c.full_name?.toLowerCase().includes(lower) ||
        c.registration_number?.toLowerCase().includes(lower) ||
        c.date_of_birth?.includes(q)
      );
    });
    setResults(filtered);
    setSearched(true);
    setLoading(false);
  }

  const restrictedStatuses = ['Rejected', 'Unacceptable'];
  const hasRestricted = results.some(c => restrictedStatuses.includes(c.status));

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <PageHeader
          title="Client Search"
          subtitle="Search existing clients before creating a new record"
          actions={
            <Button onClick={() => navigate('/new-client')} className="gap-2">
              <Plus className="w-4 h-4" /> New Client
            </Button>
          }
        />

        {/* Search */}
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
            Searching within {currentUser?.tenant_id ? 'your tenant' : ''} — includes all statuses
          </p>
        </div>

        {/* Restricted Warning */}
        {hasRestricted && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-800">Restricted client found</div>
              <div className="text-xs text-red-600 mt-0.5">
                One or more results are Rejected/Unacceptable. Re-onboarding requires Compliance Officer approval.
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {loading && (
          <div className="text-center py-6 text-muted-foreground text-sm">Searching…</div>
        )}
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
        {results.length > 0 && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
              {results.length} result{results.length !== 1 ? 's' : ''} found
            </div>
            <div className="divide-y divide-border">
              {results.map(client => {
                const isRestricted = restrictedStatuses.includes(client.status);
                return (
                  <div key={client.id} className="px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold',
                        client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                      )}>
                        {client.client_type}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-foreground truncate">{client.full_name}</span>
                          {isRestricted && (
                            <span className="flex items-center gap-1 text-xs text-red-600 font-medium bg-red-50 px-1.5 py-0.5 rounded-full border border-red-200">
                              <AlertTriangle className="w-3 h-3" />
                              Gatekept
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {client.registered_country || client.nationality || '—'}
                          {client.registration_number ? ` · ${client.registration_number}` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <RiskBadge risk={client.risk_classification} />
                      <span className="text-xs text-muted-foreground">{client.status}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => navigate(`/client/${client.id}`)}
                      >
                        View →
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}