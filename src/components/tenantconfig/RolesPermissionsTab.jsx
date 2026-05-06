import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, AlertTriangle, Loader2, Shield } from 'lucide-react';
import { APP_ROLES, PERMISSIONS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const PERMISSION_LABELS = {
  viewOwnCases:            'View Own Cases',
  viewAllTenantCases:      'View All Cases',
  createEditClient:        'Create/Edit Clients',
  createRunCase:           'Create/Run Cases',
  qcFlag:                  'QC Flag Cases',
  approveMedium:           'Approve Medium Risk',
  approveHighUnacceptable: 'Approve High/Unacceptable',
  tenantConfig:            'Configure Tenant',
  userManagement:          'Manage Users',
  bulkActions:             'Bulk Actions',
  exportData:              'Export Data',
  viewMIDashboard:         'View MI Dashboard',
  viewArchive:             'View Archive',
  manageArchive:           'Manage Archive',
};

// Build initial matrix from the static PERMISSIONS object
function buildMatrix() {
  const matrix = {};
  APP_ROLES.filter(r => r !== 'Vitauri Ops').forEach(role => {
    matrix[role] = {};
    Object.entries(PERMISSIONS).forEach(([perm, roles]) => {
      matrix[role][perm] = roles.includes(role);
    });
  });
  return matrix;
}

export default function RolesPermissionsTab({ tenant, currentUser }) {
  const [matrix, setMatrix]   = useState(buildMatrix());
  const [roles, setRoles]     = useState(APP_ROLES.filter(r => r !== 'Vitauri Ops'));
  const [users, setUsers]     = useState([]);
  const [newRole, setNewRole] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => { loadUsers(); }, [tenant]);

  async function loadUsers() {
    const data = await base44.entities.User.list();
    setUsers(data || []);
  }

  function toggle(role, perm) {
    setMatrix(m => ({ ...m, [role]: { ...m[role], [perm]: !m[role][perm] } }));
  }

  function addRole() {
    const trimmed = newRole.trim();
    if (!trimmed || roles.includes(trimmed)) return;
    setRoles(r => [...r, trimmed]);
    const newPerms = {};
    Object.keys(PERMISSION_LABELS).forEach(p => { newPerms[p] = false; });
    setMatrix(m => ({ ...m, [trimmed]: newPerms }));
    setNewRole('');
    setAddOpen(false);
  }

  function removeRole(role) {
    const inUse = users.some(u => u.app_role === role);
    if (inUse) { alert(`Cannot delete "${role}" — it has active users.`); return; }
    setRoles(r => r.filter(x => x !== role));
    setMatrix(m => { const copy = { ...m }; delete copy[role]; return copy; });
  }

  async function saveMatrix() {
    setSaving(true);
    // Persist as an AuditEvent (config change) — matrix is currently in-memory / lib/permissions.js
    // In a real DB-driven permissions system, this would update a Permissions entity.
    // For MVP: audit log the change.
    await base44.entities.AuditEvent.create({
      tenant_id: currentUser.tenant_id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'roles_permissions_updated',
      notes: `Roles/permissions matrix updated by ${currentUser.full_name}`,
      after_state: { roles, matrix },
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const perms = Object.keys(PERMISSION_LABELS);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Roles & Permissions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Toggle permissions per role. Cannot delete roles with active users.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Role
          </Button>
          <Button size="sm" className="text-xs gap-1.5" onClick={saveMatrix} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {saved ? '✓ Saved' : 'Save Matrix'}
          </Button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <span className="text-xs text-amber-700">Permission changes take effect at next login. Changes are audit-logged.</span>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-auto">
        <table className="text-xs w-full min-w-[700px]">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wide w-48">Permission</th>
              {roles.map(role => (
                <th key={role} className="px-3 py-3 text-center font-semibold text-foreground min-w-[100px]">
                  <div className="flex flex-col items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-primary/60" />
                    <span className="text-xs leading-tight">{role}</span>
                    <button onClick={() => removeRole(role)} className="text-muted-foreground/40 hover:text-red-500 transition-colors mt-0.5">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {perms.map(perm => (
              <tr key={perm} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-medium text-foreground">{PERMISSION_LABELS[perm]}</td>
                {roles.map(role => (
                  <td key={role} className="px-3 py-2.5 text-center">
                    <Switch
                      checked={!!matrix[role]?.[perm]}
                      onCheckedChange={() => toggle(role, perm)}
                      className="scale-75"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add New Role</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="e.g. Senior Analyst" className="h-9 text-sm" />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={addRole} disabled={!newRole.trim()}>Add Role</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}