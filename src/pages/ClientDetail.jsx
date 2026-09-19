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
import { Network, ChevronRight, User, Building2, UserCog, GitFork, AlertTriangle, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CLIENT_STATUS_COLORS } from '@/lib/riskColors';
import { deleteCase } from '@/lib/caseDelete';

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
  const [error, setError]             = useState(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTo, setReassignTo]   = useState('');
  const [deleteOpen, setDeleteOpen]   = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting]       = useState(false);
  const [pendingOcr, setPendingOcr]   = useState(null);
  const [activeTab, setActiveTab]     = useState('profile');

  const userRole = currentUser?.app_role;
  const canReassign = hasPermission(userRole, 'viewAllTenantCases');
  const canDelete = hasPermission(userRole, 'deleteClient');

  useEffect(() => { loadAll(); }, [id]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [clientData, casesData, linksData, docsData, auditData, usersData] = await Promise.all([
        base44.entities.Client.filter({ id }),
        base44.entities.KycCase.filter({ client_id: id }, '-created_date'),
        base44.entities.ClientRelatedPartyLink.filter({ client_id: id }),
        base44.entities.Document.filter({ client_id: id }, '-created_date'),
        base44.entities.AuditEvent.filter({ client_id: id }, '-created_date', 200),
        base44.entities.User.list().catch(() => []),
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
    } catch (err) {
      console.error('ClientDetail loadAll error:', err);
      setError(err?.message || 'Failed to load client data');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirm !== 'DELETE') return;
    setDeleting(true);
    await base44.entities.Client.update(id, {
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: currentUser.id,
      deletion_reason: deleteReason,
      status: 'Inactive',
    });
    const clientCases = await base44.entities.KycCase.filter({ client_id: id });
    for (const kycCase of (clientCases || [])) {
      await deleteCase(kycCase, currentUser);
    }
    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id,
      client_id: id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'client_deleted',
      notes: `Client soft-deleted. Reason: ${deleteReason || 'No reason provided.'}`,
    });
    setDeleting(false);
    navigate('/client-search');
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
  if (error) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <span className="text-destructive text-lg">!</span>
          </div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={loadAll}>Retry</Button>
        </div>
      </div>
    </AppShell>
  );
  if (!client || client.is_deleted) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto">
            <AlertTriangle className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Client not found</p>
          <p className="text-xs text-muted-foreground">This client has been deleted or does not exist.</p>
          <Button size="sm" variant="outline" onClick={() => navigate('/client-search')}>Back to Search</Button>
        </div>
      </div>
    </AppShell>
  );

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
              {canDelete && (
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete Client
                </Button>
              )}
              {client.client_type === 'ORG' && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/entity-map/${id}`)}>
                  <GitFork className="w-3.5 h-3.5" /> Org Chart Viewer
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
        <Tabs value={activeTab} onValueChange={setActiveTab}>
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
            <ProfileTab
              client={client}
              onClientUpdated={updated => setClient(updated)}
              pendingOcr={pendingOcr}
              onOcrApplied={() => setPendingOcr(null)}
            />
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
              onOcrExtracted={fields => {
                setPendingOcr(fields);
                setActiveTab('profile');
              }}
            />
          </TabsContent>

          <TabsContent value="audit-trail">
            <AuditTrailTab auditEvents={auditEvents} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Client Dialog */}
      <Dialog open={deleteOpen} onOpenChange={open => { setDeleteOpen(open); setDeleteConfirm(''); setDeleteReason(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-4 h-4" /> Delete Client
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
              This will soft-delete <strong>{client?.full_name}</strong> and all associated data will be hidden from active workflows. This action is logged and can be reviewed by admins.
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Reason for deletion</label>
              <Textarea
                placeholder="Enter a reason (e.g. duplicate record, data entry error)…"
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                className="text-sm"
                rows={3}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">
                Type <strong>DELETE</strong> to confirm
              </label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="DELETE"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteConfirm !== 'DELETE' || deleting}
              >
                {deleting ? 'Deleting…' : 'Delete Client'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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