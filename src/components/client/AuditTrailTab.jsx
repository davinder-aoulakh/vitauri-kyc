import React, { useState, useMemo } from 'react';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Search, X, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const ACTOR_TYPE_STYLES = {
  AI_Agent: 'bg-purple-100 text-purple-700',
  System:   'bg-blue-100 text-blue-700',
  User:     'bg-slate-100 text-slate-600',
};

export default function AuditTrailTab({ auditEvents }) {
  const { currentUser } = useTenant();
  const [searchActor, setSearchActor]   = useState('');
  const [filterType, setFilterType]     = useState('all');
  const [filterActor, setFilterActor]   = useState('all');

  const canExport = hasPermission(currentUser?.app_role, 'exportData');

  const uniqueEventTypes = useMemo(() => [...new Set(auditEvents.map(e => e.event_type).filter(Boolean))], [auditEvents]);
  const uniqueActors     = useMemo(() => [...new Set(auditEvents.map(e => e.actor_name).filter(Boolean))], [auditEvents]);

  const filtered = useMemo(() => {
    return auditEvents.filter(e => {
      if (filterType !== 'all' && e.event_type !== filterType) return false;
      if (filterActor !== 'all' && e.actor_name !== filterActor) return false;
      if (searchActor && !e.actor_name?.toLowerCase().includes(searchActor.toLowerCase())) return false;
      return true;
    });
  }, [auditEvents, filterType, filterActor, searchActor]);

  const hasFilters = filterType !== 'all' || filterActor !== 'all' || searchActor;

  function clearFilters() { setFilterType('all'); setFilterActor('all'); setSearchActor(''); }

  function exportCSV() {
    const headers = ['Timestamp','Actor','Actor Type','Event','Notes'];
    const rows = filtered.map(e => [
      e.created_date ? format(new Date(e.created_date), 'yyyy-MM-dd HH:mm:ss') : '',
      e.actor_name || '',
      e.actor_type || '',
      e.event_type || '',
      (e.notes || '').replace(/"/g, '""'),
    ].map(v => `"${v}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `audit-trail-${format(new Date(),'yyyyMMdd')}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Audit Trail</h3>
          <span className="text-xs text-muted-foreground">({filtered.length} events)</span>
          <span className="text-xs text-muted-foreground/60 hidden sm:inline">— append-only, cannot be edited</span>
        </div>
        {canExport && (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={exportCSV}>
            <Download className="w-3 h-3" /> Export CSV
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="px-4 py-2.5 border-b border-border flex flex-wrap gap-2 items-center bg-muted/20">
        <div className="relative flex-1 min-w-36 max-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder="Filter by actor…" value={searchActor} onChange={e => setSearchActor(e.target.value)} className="pl-7 h-7 text-xs" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-7 text-xs w-44"><SelectValue placeholder="Event type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            {uniqueEventTypes.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g,' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterActor} onValueChange={setFilterActor}>
          <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Actor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actors</SelectItem>
            {uniqueActors.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={clearFilters}>
            <X className="w-3 h-3" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">No audit events match your filters</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 whitespace-nowrap">Timestamp</th>
                <th className="text-left px-4 py-2.5">Actor</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Event</th>
                <th className="text-left px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(e => (
                <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap font-mono">
                    {e.created_date ? format(new Date(e.created_date), 'd MMM yyyy HH:mm') : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium">{e.actor_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-full', ACTOR_TYPE_STYLES[e.actor_type] || ACTOR_TYPE_STYLES.User)}>
                      {e.actor_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-foreground">{e.event_type?.replace(/_/g,' ')}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[280px] truncate" title={e.notes}>
                    {e.notes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}