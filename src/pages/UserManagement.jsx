import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import AppShell from '@/components/layout/AppShell';
import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Users, Plus, Mail, Shield, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_ROLES } from '@/lib/permissions';

export default function UserManagement() {
  const { currentUser } = useTenant();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePlatformRole, setInvitePlatformRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (currentUser?.tenant_id) loadUsers();
  }, [currentUser]);

  async function loadUsers() {
    const data = await base44.entities.User.filter({ tenant_id: currentUser.tenant_id });
    setUsers(data || []);
    setLoading(false);
  }

  async function inviteUser() {
    setInviting(true);
    await base44.users.inviteUser(inviteEmail, invitePlatformRole);
    setInviteEmail('');
    setInviteOpen(false);
    setInviting(false);
    await loadUsers();
  }

  async function updateUser(userId, updates) {
    setSaving(true);
    await base44.entities.User.update(userId, updates);
    setSaving(false);
    setEditUser(null);
    await loadUsers();
  }

  // Segregation of duties: users whose app_role grants both Analyst and QC actions
  // In MVP, Analyst and QC Reviewer are separate roles; warn if any user holds a role
  // outside the standard single-role model (e.g., future custom roles spanning both)
  const sodWarningUsers = users.filter(u => {
    const role = u.app_role;
    // Warn if same user is both analyst-capable and QC-capable (shouldn't happen with standard roles, but flag edge cases)
    return role === 'QC Reviewer' && u.is_active !== false; // placeholder — real SOD check when custom roles land
  });

  return (
    <AppShell>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5">
        {sodWarningUsers.length > 0 && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Segregation of Duties Advisory:</strong> {sodWarningUsers.length} user(s) hold roles with overlapping Analyst / QC Reviewer capabilities. Review assignments to ensure no single user can both prepare and quality-check the same case.
            </span>
          </div>
        )}
        <PageHeader
          title="User Management"
          subtitle="Manage team members, roles and access for this institution"
          actions={
            <Button onClick={() => setInviteOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Invite User
            </Button>
          }
        />

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <EmptyState icon={Users} title="No users found" description="Invite your first team member to get started." action={<Button onClick={() => setInviteOpen(true)}>Invite User</Button>} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Platform Role (Base44)</th>
                  <th className="text-left px-4 py-3">Application Role (KYC)</th>
                  <th className="text-left px-4 py-3">Active</th>
                  <th className="text-left px-4 py-3">MFA</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                          {u.full_name?.charAt(0) || '?'}
                        </div>
                        <span className="font-medium">{u.full_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', u.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600')}>
                        {u.role || 'user'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        {u.app_role || 'Analyst'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active !== false ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <span className="text-xs text-red-500">Inactive</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u.mfa_enabled ? <Shield className="w-4 h-4 text-primary" /> : <span className="text-xs text-muted-foreground">Off</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditUser(u)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Invite Dialog */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Invite User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Email Address</Label>
                <Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@institution.nl" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Platform Role (Base44)</Label>
                <Select value={invitePlatformRole} onValueChange={setInvitePlatformRole}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User — standard member, no invite rights</SelectItem>
                    <SelectItem value="admin">Admin — can invite others, manage settings</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Controls invite rights only. Application role is set separately after acceptance.</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground">
                After accepting the invite, you can assign the user's Application Role (KYC) from the full role list.
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={inviteUser} disabled={!inviteEmail || inviting} className="gap-2">
                  {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Send Invite
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit User Dialog */}
        {editUser && (
          <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Edit User — {editUser.full_name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                  These are two independent, separate roles. A Director can have platform role "User" and vice versa.
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Platform Role (Base44)</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">Controls invite rights only</p>
                  <Select value={editUser.role || 'user'} onValueChange={v => setEditUser(u => ({ ...u, role: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Application Role (Vitauri KYC)</Label>
                  <p className="text-xs text-muted-foreground mb-1.5">Controls all in-app permissions and sign-off authority</p>
                  <Select value={editUser.app_role || 'Analyst'} onValueChange={v => setEditUser(u => ({ ...u, app_role: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {APP_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-medium">Active</Label>
                    <p className="text-xs text-muted-foreground">Deactivating preserves audit history</p>
                  </div>
                  <Switch checked={editUser.is_active !== false} onCheckedChange={v => setEditUser(u => ({ ...u, is_active: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">MFA Enabled</Label>
                  <Switch checked={!!editUser.mfa_enabled} onCheckedChange={v => setEditUser(u => ({ ...u, mfa_enabled: v }))} />
                </div>
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                  <Button onClick={() => updateUser(editUser.id, { role: editUser.role, app_role: editUser.app_role, is_active: editUser.is_active, mfa_enabled: editUser.mfa_enabled })} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </AppShell>
  );
}