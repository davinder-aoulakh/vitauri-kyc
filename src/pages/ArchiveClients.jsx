import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import RiskBadge from '@/components/shared/RiskBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Archive, Search, AlertTriangle, RefreshCw, ShieldAlert,
  Loader2, ChevronRight, RotateCcw, Trash2, Info, Lock
} from 'lucide-react';
import { format, addYears, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';

const ARCHIVE_STATUSES = ['Inactive', 'Former', 'Rejected', 'Unacceptable'];

const STATUS_STYLE = {
  Inactive:     'bg-slate-100 text-slate-600 border-slate-200',
  Former:       'bg-blue-100 text-blue-700 border-blue-200',
  Rejected:     'bg-red-100 text-red-700 border-red-200',
  Unacceptable: 'bg-rose-200 text-rose-900 border-rose-300',
};

export default function ArchiveClients() {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const userRole = currentUser?.app_role;

  const canView   = hasPermission(userRole, 'viewArchive');
  const canManage = hasPermission(userRole, 'manageArchive');

  const [clients, setClients]   = useState([]);
  const [cases, setCases]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Reactivate dialog
  const [reactivateClient, setReactivateClient] = useState(null);
  const [reactivateNote, setReactivateNote]     = useState('');
  const [reactivating, setReactivating]         = useState(false);

  // Delete dialog
  const [deleteClient, setDeleteClient]   = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting]           = useState(false);

  // Re-onboarding approval dialog (for Rejected/Unacceptable)
  const [pendingReOnboard, setPendingReOnboard] = useState(null);

  const retentionYears = tenant?.audit_retention_years || 5;

  useEffect(() => {
    if (currentUser?.tenant_id) load();
  }, [currentUser]);

  async function load() {
    setLoading(true);
    const [clientData, caseData] = await Promise.all([
      base44.entities.Client.filter({ tenant_id: currentUser.tenant_id }),
      base44.entities.KycCase.filter({ tenant_id: currentUser.tenant_id }),
    ]);
    setClients((clientData || []).filter(c => ARCHIVE_STATUSES.includes(c.status)));
    setCases(caseData || []);
    setLoading(false);
  }

  // Get most recent closed case for a client
  function getLastClosedCase(clientId) {
    return cases
      .filter(c => c.client_id === clientId && ['Approved', 'Closed', 'Rejected'].includes(c.status))
      .sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0))[0];
  }

  // Retention expiry calculation
  function getRetentionExpiry(client) {
    const lastCase = getLastClosedCase(client.id);
    const baseDate = lastCase?.completed_at || lastCase?.updated_date || client.updated_date;
    if (!baseDate) return null;
    return addYears(new Date(baseDate), retentionYears);
  }

  function getDaysUntilExpiry(client) {
    const expiry = getRetentionExpiry(client);
    if (!expiry) return null;
    return differenceInDays(expiry, new Date());
  }

  // Reactivate client
  async function handleReactivate() {
    if (!reactivateClient) return;
    setReactivating(true);
    const isFormer    = reactivateClient.status === 'Former';
    const lastCase    = getLastClosedCase(reactivateClient.id);
    const caseType    = isFormer ? 'Onboarding' : 'Periodic_Review';

    // Update client status to Active
    await base44.entities.Client.update(reactivateClient.id, { status: 'Active' });

    // Create new KYC case, pre-fill if former
    const newCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: reactivateClient.id,
      case_type: caseType,
      status: 'Draft',
      assigned_analyst_id: currentUser.id,
      previous_case_id: lastCase?.id || null,
      is_re_onboarding: isFormer,
      trigger_reason: `Re-activation from ${reactivateClient.status} status. ${reactivateNote}`,
    });

    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      client_id: reactivateClient.id,
      case_id: newCase.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'client_reactivated',
      before_state: { status: reactivateClient.status },
      after_state: { status: 'Active' },
      notes: reactivateNote || `Re-activated from ${reactivateClient.status}`,
      is_override: reactivateClient.status === 'Former',
    });

    setReactivating(false);
    setReactivateClient(null);
    setReactivateNote('');
    navigate(`/case/${newCase.id}`);
  }

  // Approve re-onboarding for Rejected/Unacceptable (CO only)
  async function handleApproveReOnboard() {
    if (!pendingReOnboard || pendingReOnboard.justification?.length < 20) return;
    setReactivating(true);

    await base44.entities.Client.update(pendingReOnboard.client.id, { status: 'Active' });

    const newCase = await base44.entities.KycCase.create({
      tenant_id: currentUser.tenant_id,
      client_id: pendingReOnboard.client.id,
      case_type: 'Onboarding',
      status: 'Draft',
      assigned_analyst_id: currentUser.id,
      is_re_onboarding: true,
      trigger_reason: `Re-onboarding — Previously Restricted (${pendingReOnboard.client.status}). CO Approval: ${pendingReOnboard.justification}`,
    });

    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      client_id: pendingReOnboard.client.id,
      case_id: newCase.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'restricted_client_reonboarding_approved',
      before_state: { status: pendingReOnboard.client.status },
      after_state: { status: 'Active', case_type: 'Onboarding' },
      notes: pendingReOnboard.justification,
      is_override: true,
    });

    // Notify requestor if available
    if (pendingReOnboard.requestorUserId) {
      await base44.entities.Notification.create({
        tenant_id: currentUser.tenant_id,
        user_id: pendingReOnboard.requestorUserId,
        type: 'sign_off_decision',
        title: 'Re-onboarding approved',
        body: `Re-onboarding of ${pendingReOnboard.client.full_name} has been approved by ${currentUser.full_name}.`,
        link_client_id: pendingReOnboard.client.id,
      });
    }

    setReactivating(false);
    setPendingReOnboard(null);
    navigate(`/case/${newCase.id}`);
  }

  // Permanent delete with confirmation
  async function handleDelete() {
    if (!deleteClient || deleteConfirm !== 'DELETE') return;
    setDeleting(true);

    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      client_id: deleteClient.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'client_record_deleted',
      notes: `Permanent deletion of archived client record. Retention expiry: ${getRetentionExpiry(deleteClient) ? format(getRetentionExpiry(deleteClient), 'd MMM yyyy') : 'unknown'}`,
      is_override: true,
    });

    await base44.entities.Client.delete(deleteClient.id);
    setDeleting(false);
    setDeleteClient(null);
    setDeleteConfirm('');
    load();
  }

  // Filtered lists
  const filtered = clients.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    const q = search.toLowerCase();
    if (q && !c.full_name?.toLowerCase().includes(q) && !c.registration_number?.toLowerCase().includes(q)) return false;
    return true;
  });

  const restricted = filtered.filter(c => ['Rejected', 'Unacceptable'].includes(c.status));
  const archived   = filtered.filter(c => ['Inactive', 'Former'].includes(c.status));

  const counts = ARCHIVE_STATUSES.reduce((acc, s) => {
    acc[s] = clients.filter(c => c.status === s).length;
    return acc;
  }, {});

  if (!canView) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-2">
            <Lock className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Access restricted. Compliance Officer or Admin role required.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
        <PageHeader
          title="Archive & Former Clients"
          subtitle={`Inactive, Former, Rejected, and Unacceptable clients · Retention policy: ${retentionYears} years`}
          actions={
            <Button variant="outline" size="sm" onClick={load} className="gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          }
        />

        {/* GDPR scope notice */}
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          This list is scoped to this institution only. No cross-tenant data sharing (GDPR compliant).
        </div>

        {/* Status tabs + filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-muted/40 rounded-lg p-1 border border-border">
            {[{ key: 'all', label: `All (${clients.length})` },
              { key: 'Inactive',     label: `Inactive (${counts.Inactive || 0})` },
              { key: 'Former',       label: `Former (${counts.Former || 0})` },
              { key: 'Rejected',     label: `Rejected (${counts.Rejected || 0})` },
              { key: 'Unacceptable', label: `Unacceptable (${counts.Unacceptable || 0})` },
            ].map(t => (
              <button key={t.key}
                onClick={() => setStatusFilter(t.key)}
                className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  statusFilter === t.key ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-48 max-w-72">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
            <Input placeholder="Search name or reg. no…" value={search} onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs pl-8" />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">

            {/* ── RESTRICTED LIST ── */}
            {(statusFilter === 'all' || statusFilter === 'Rejected' || statusFilter === 'Unacceptable') && restricted.length > 0 && (
              <div>
                <div className="flex items-center gap-2 bg-red-600 text-white rounded-t-xl px-4 py-2.5">
                  <ShieldAlert className="w-4 h-4" />
                  <span className="text-sm font-semibold">Restricted Client List ({restricted.length})</span>
                  <span className="text-xs text-red-200 ml-2">Re-onboarding requires Compliance Officer approval</span>
                </div>
                <div className="border border-red-200 border-t-0 rounded-b-xl overflow-hidden">
                  <ClientTable
                    clients={restricted}
                    cases={cases}
                    canManage={canManage}
                    userRole={userRole}
                    retentionYears={retentionYears}
                    onReactivate={c => {
                      // For restricted, require CO approval dialog
                      setPendingReOnboard({ client: c, justification: '' });
                    }}
                    onDelete={c => setDeleteClient(c)}
                    onNavigate={id => navigate(`/client/${id}`)}
                    getRetentionExpiry={getRetentionExpiry}
                    getDaysUntilExpiry={getDaysUntilExpiry}
                    isRestricted
                  />
                </div>
              </div>
            )}

            {/* ── INACTIVE / FORMER ── */}
            {(statusFilter === 'all' || statusFilter === 'Inactive' || statusFilter === 'Former') && archived.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Archived Clients ({archived.length})
                </h3>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <ClientTable
                    clients={archived}
                    cases={cases}
                    canManage={canManage}
                    userRole={userRole}
                    retentionYears={retentionYears}
                    onReactivate={c => { setReactivateClient(c); setReactivateNote(''); }}
                    onDelete={c => setDeleteClient(c)}
                    onNavigate={id => navigate(`/client/${id}`)}
                    getRetentionExpiry={getRetentionExpiry}
                    getDaysUntilExpiry={getDaysUntilExpiry}
                  />
                </div>
              </div>
            )}

            {filtered.length === 0 && (
              <EmptyState icon={Archive} title="No archived clients" description="Inactive, Former, Rejected and Unacceptable clients will appear here." />
            )}
          </div>
        )}
      </div>

      {/* ── Reactivate Dialog (Inactive/Former) ── */}
      <Dialog open={!!reactivateClient} onOpenChange={() => setReactivateClient(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Re-activate Client</DialogTitle>
          </DialogHeader>
          {reactivateClient && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1 border border-border">
                <div className="font-semibold">{reactivateClient.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  Current status: <span className="font-medium">{reactivateClient.status}</span>
                </div>
                {reactivateClient.status === 'Former' && (
                  <div className="text-xs text-blue-600">
                    A new <strong>Onboarding</strong> case will be pre-filled from the most recent closed case.
                  </div>
                )}
                {reactivateClient.status === 'Inactive' && (
                  <div className="text-xs text-blue-600">
                    A new <strong>Periodic Review</strong> case will be created and monitoring re-enabled.
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Reason for re-activation *</label>
                <Textarea value={reactivateNote} onChange={e => setReactivateNote(e.target.value)}
                  placeholder="Briefly explain why this client is being re-activated…"
                  className="text-sm min-h-16 resize-none" />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setReactivateClient(null)}>Cancel</Button>
                <Button onClick={handleReactivate}
                  disabled={!reactivateNote.trim() || reactivating}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                  {reactivating && <Loader2 className="w-4 h-4 animate-spin" />}
                  <RotateCcw className="w-4 h-4" /> Re-activate & Open Case
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── CO Approval Dialog (Rejected/Unacceptable) ── */}
      <Dialog open={!!pendingReOnboard} onOpenChange={() => setPendingReOnboard(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <ShieldAlert className="w-5 h-5" /> Restricted Client — Re-onboarding Approval
            </DialogTitle>
          </DialogHeader>
          {pendingReOnboard && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm space-y-1">
                <div className="font-semibold text-red-800">{pendingReOnboard.client.full_name}</div>
                <div className="text-xs text-red-600">
                  Status: <strong>{pendingReOnboard.client.status}</strong> · Risk: {pendingReOnboard.client.risk_classification || '—'}
                </div>
                <div className="text-xs text-red-700 mt-1">
                  This client is on the Restricted List. Re-onboarding requires Compliance Officer written justification.
                  This action will be prominently logged in the audit trail.
                </div>
              </div>

              {!canManage && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                  You do not have permission to approve re-onboarding. A Compliance Admin has been notified.
                </div>
              )}

              {canManage && (
                <>
                  <div>
                    <label className="text-xs font-medium block mb-1.5">Mandatory written justification * (min 20 chars)</label>
                    <Textarea
                      value={pendingReOnboard.justification}
                      onChange={e => setPendingReOnboard(p => ({ ...p, justification: e.target.value }))}
                      placeholder="Provide a detailed compliance justification for re-onboarding this previously restricted client…"
                      className="text-sm min-h-20 resize-none" />
                    <div className="text-xs text-muted-foreground mt-1">
                      {pendingReOnboard.justification?.length || 0}/20 characters minimum
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setPendingReOnboard(null)}>Cancel / Deny</Button>
                    <Button
                      className="bg-red-700 hover:bg-red-800 text-white gap-2"
                      disabled={(pendingReOnboard.justification?.length || 0) < 20 || reactivating}
                      onClick={handleApproveReOnboard}>
                      {reactivating && <Loader2 className="w-4 h-4 animate-spin" />}
                      Approve Re-onboarding
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deleteClient} onOpenChange={() => { setDeleteClient(null); setDeleteConfirm(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" /> Permanently Delete Record
            </DialogTitle>
          </DialogHeader>
          {deleteClient && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                <p className="font-semibold text-red-800">{deleteClient.full_name}</p>
                <p className="text-xs text-red-600 mt-1">
                  Retention expiry: {getRetentionExpiry(deleteClient)
                    ? format(getRetentionExpiry(deleteClient), 'd MMM yyyy')
                    : 'Unknown'}
                </p>
                <p className="text-xs text-red-700 mt-2">
                  This will permanently delete the client record. All documents and case history should be exported first.
                  This action cannot be undone.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Type <strong>DELETE</strong> to confirm</label>
                <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE" className="font-mono text-sm" />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => { setDeleteClient(null); setDeleteConfirm(''); }}>Cancel</Button>
                <Button variant="destructive" disabled={deleteConfirm !== 'DELETE' || deleting} onClick={handleDelete}>
                  {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Permanently Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// ── Client table sub-component ──────────────────────────────────────────────
function ClientTable({ clients, cases, canManage, userRole, retentionYears,
  onReactivate, onDelete, onNavigate, getRetentionExpiry, getDaysUntilExpiry, isRestricted }) {

  const isComplianceOfficer = ['Compliance Officer', 'Compliance Admin', 'Tenant Admin'].includes(userRole);

  function getArchiveReason(client) {
    const lastCase = cases
      .filter(c => c.client_id === client.id)
      .sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0))[0];
    return lastCase?.trigger_reason || lastCase?.sign_off_rejection_reason || client.status;
  }

  function getArchiveDate(client) {
    const lastCase = cases
      .filter(c => c.client_id === client.id && ['Approved', 'Closed', 'Rejected'].includes(c.status))
      .sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0))[0];
    return lastCase?.updated_date || client.updated_date;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={cn('border-b text-xs text-muted-foreground uppercase tracking-wide',
          isRestricted ? 'bg-red-50' : 'bg-muted/40 border-border')}>
          <th className="text-left px-4 py-3">Client</th>
          <th className="text-left px-4 py-3">Type</th>
          <th className="text-left px-4 py-3">Status</th>
          <th className="text-left px-4 py-3">Risk Class</th>
          <th className="text-left px-4 py-3">Archived Date</th>
          <th className="text-left px-4 py-3">Retention Expiry</th>
          <th className="text-left px-4 py-3 max-w-[180px]">Reason</th>
          <th className="px-4 py-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {clients.map(client => {
          const daysLeft = getDaysUntilExpiry(client);
          const expiry   = getRetentionExpiry(client);
          const nearExpiry = daysLeft !== null && daysLeft <= 90;
          const archiveDate = getArchiveDate(client);
          const reason = getArchiveReason(client);

          return (
            <tr key={client.id}
              className={cn('hover:bg-muted/20 transition-colors',
                isRestricted && 'bg-red-50/30 hover:bg-red-50/60')}>
              <td className="px-4 py-3">
                <div className="font-medium text-xs text-foreground">{client.full_name}</div>
                {client.registration_number && (
                  <div className="text-xs text-muted-foreground font-mono">{client.registration_number}</div>
                )}
              </td>
              <td className="px-4 py-3">
                <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                  client.client_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>
                  {client.client_type}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', STATUS_STYLE[client.status])}>
                  {client.status}
                </span>
              </td>
              <td className="px-4 py-3">
                <RiskBadge risk={client.risk_classification} />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                {archiveDate ? format(new Date(archiveDate), 'd MMM yyyy') : '—'}
              </td>
              <td className="px-4 py-3">
                {expiry ? (
                  <div className={cn('text-xs whitespace-nowrap', nearExpiry ? 'text-amber-600 font-semibold' : 'text-muted-foreground')}>
                    {format(expiry, 'd MMM yyyy')}
                    {nearExpiry && <div className="text-xs text-amber-500">{daysLeft}d remaining</div>}
                  </div>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px]">
                <span className="line-clamp-2">{reason || '—'}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1 justify-end">
                  <button onClick={() => onNavigate(client.id)}
                    className="text-xs text-primary hover:text-primary/70 px-2 py-1 rounded hover:bg-primary/5 transition-colors whitespace-nowrap flex items-center gap-1">
                    View <ChevronRight className="w-3 h-3" />
                  </button>
                  {canManage && isComplianceOfficer && (
                    <button onClick={() => onReactivate(client)}
                      className="text-xs text-emerald-600 hover:text-emerald-800 px-2 py-1 rounded hover:bg-emerald-50 transition-colors whitespace-nowrap flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Re-activate
                    </button>
                  )}
                  {canManage && (
                    <button onClick={() => onDelete(client)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}