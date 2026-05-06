import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import RiskBadge from '@/components/shared/RiskBadge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ProfileTab       from '@/components/client/ProfileTab';
import RelatedPartiesTab from '@/components/client/RelatedPartiesTab';
import CasesTab         from '@/components/client/CasesTab';
import DocumentsTab     from '@/components/client/DocumentsTab';
import AuditTrailTab    from '@/components/client/AuditTrailTab';
import { Network, ChevronRight, User, Building2, UserCog, GitFork } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CLIENT_STATUS_COLORS } from '@/lib/riskColors';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useTenant();

  const [client, setClient]           = useState(null);
  const [cases, setCases]             = useState([]);
  const [relatedParties, setRelatedParties] = useState([]);
  const [rpLinks, setRpLinks]         = useState([]);
  const [documents, setDocuments]     = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [users, setUsers]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTo, setReassignTo]   = useState('');

  const userRole = currentUser?.app_role;
  const canReassign = hasPermission(userRole, 'viewAllTenantCases');

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    const [clientData, casesData, linksData, docsData, auditData, usersData] = await Promise.all([
      base44.entities.Client.filter({ id }),
      base44.entities.KycCase.filter({ client_id: id }, '-created_date'),
      base44.entities.ClientRelatedPartyLink.filter({ client_id: id }),
      base44.entities.Document.filter({ client_id: id }, '-created_date'),
      base44.entities.AuditEvent.filter({ client_id: id }, '-created_date', 200),
      base44.entities.User.list(),
    ]);
    const c = clientData?.[0];
    setClient(c);
    setCases(casesData || []);
    setRpLinks(linksData || []);
    setDocuments(docsData || []);
    setAuditEvents(auditData || []);
    setUsers(usersData || []);

    if (linksData?.length > 0) {
      const rps = await Promise.all(
        linksData.map(link => base44.entities.RelatedParty.filter({ id: link.related_party_id }))
      );
      setRelatedParties(rps.flat().filter(Boolean));
    }
    setLoading(false);
  }

  async function handleReassign() {
    if (!reassignTo) return;
    await base44.entities.Client.update(id, { assigned_analyst_id: reassignTo });
    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id,
      client_id: id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'analyst_reassigned',
      notes: `Analyst reassigned to ${users.find(u => u.id === reassignTo)?.full_name || reassignTo}`,
    });
    setClient(c => ({ ...c, assigned_analyst_id: reassignTo }));
    setReassignOpen(false);
  }

  if (loading) return <AppShell><div className="p-8 text-center text-muted-foreground">Loading client…</div></AppShell>;
  if (!client)  return <AppShell><div className="p-8 text-center text-muted-foreground">Client not found.</div></AppShell>;

  const activeCase = cases.find(c => !['Approved','Closed','Rejected'].includes(c.status));
  const lastReview = cases.filter(c => c.status === 'Approved' || c.completed_at).sort((a,b) => (b.completed_at||b.updated_date||'') > (a.completed_at||a.updated_date||'') ? 1 : -1)[0];
  const assignedAnalyst = users.find(u => u.id === client.assigned_analyst_id);

  return (
    <AppShell>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">

        {/* ── Header Card ── */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
              )}>
                {client.client_type === 'ORG' ? <Building2 className="w-5 h-5" /> : <User className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center flex-wrap gap-2">
                  <h1 className="text-xl font-semibold text-foreground">{client.full_name}</h1>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                    client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                  )}>
                    {client.client_type}
                  </span>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium border',
                    CLIENT_STATUS_COLORS?.[client.status] || 'bg-slate-100 text-slate-600 border-slate-200'
                  )}>
                    {client.status}
                  </span>
                  <RiskBadge risk={client.risk_classification} />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {client.registered_country || client.nationality || '—'}
                  {client.registration_number ? ` · KvK ${client.registration_number}` : ''}
                </p>
                {/* Assigned Analyst */}
                <div className="flex items-center gap-2 mt-2">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Analyst: <span className="font-medium text-foreground">{assignedAnalyst?.full_name || 'Unassigned'}</span>
                  </span>
                  {canReassign && (
                    <button
                      className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1"
                      onClick={() => setReassignOpen(true)}
                    >
                      <UserCog className="w-3 h-3" /> Reassign
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/org-chart/${id}`)}>
                <Network className="w-3.5 h-3.5" /> Org Chart
              </Button>
              {client.client_type === 'ORG' && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/entity-map/${id}`)}>
                  <GitFork className="w-3.5 h-3.5" /> Entity Map
                </Button>
              )}
              {activeCase && (
                <Button size="sm" className="gap-1.5" onClick={() => navigate(`/case/${activeCase.id}`)}>
                  Active Case <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-4 border-t border-border">
            {[
              { label: 'Total Cases',      value: cases.length },
              { label: 'Active Case',      value: activeCase ? activeCase.case_type?.replace(/_/g,' ') : 'None' },
              { label: 'Last Review',      value: lastReview?.completed_at ? format(new Date(lastReview.completed_at), 'd MMM yyyy') : '—' },
              { label: 'Next Review Due',  value: client.next_review_date ? format(new Date(client.next_review_date), 'd MMM yyyy') : 'Not set' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-base font-bold text-foreground truncate">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs defaultValue="profile">
          <TabsList className="bg-card border border-border h-auto p-1 gap-1 flex-wrap">
            {[
              { value: 'profile',          label: 'Profile' },
              { value: 'related-parties',  label: `Related Parties (${relatedParties.length})` },
              { value: 'cases',            label: `Cases (${cases.length})` },
              { value: 'documents',        label: `Documents (${documents.length})` },
              { value: 'audit-trail',      label: 'Audit Trail' },
            ].map(t => (
              <TabsTrigger key={t.value} value={t.value}
                className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-white">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab client={client} onClientUpdated={updated => setClient(updated)} />
          </TabsContent>

          <TabsContent value="related-parties">
            <RelatedPartiesTab
              client={client}
              relatedParties={relatedParties}
              links={rpLinks}
              onRefresh={loadAll}
            />
          </TabsContent>

          <TabsContent value="cases">
            <CasesTab
              client={client}
              cases={cases}
              users={users}
              onRefresh={loadAll}
            />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab
              client={client}
              documents={documents}
              onRefresh={loadAll}
            />
          </TabsContent>

          <TabsContent value="audit-trail">
            <AuditTrailTab auditEvents={auditEvents} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Reassign Dialog */}
      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Reassign Analyst</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select analyst" /></SelectTrigger>
              <SelectContent>
                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setReassignOpen(false)}>Cancel</Button>
              <Button onClick={handleReassign} disabled={!reassignTo}>Reassign</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}