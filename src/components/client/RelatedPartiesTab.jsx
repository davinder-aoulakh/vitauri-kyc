import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import RiskBadge from '@/components/shared/RiskBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Search as SearchIcon, Network, Loader2, CheckCircle2, Clock, XCircle, ShieldQuestion, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const ROLES = ['UBO','Director','Shareholder','Beneficiary','Insured','Authorized Signatory','Other'];
const COUNTRIES = ['Netherlands (NL)','Belgium (BE)','Germany (DE)','France (FR)','United Kingdom (GB)','United States (US)','Luxembourg (LU)','Switzerland (CH)','Other'];
const ID_TYPES = ['Passport','National ID Card','Drivers Licence','Residence Permit','Other'];
const LEGAL_FORMS = ['BV','NV','Ltd','SA','GmbH','LLC','Inc','PLC','SRL','AG','SARL','Other'];

const VERIFICATION_CONFIG = {
  Unverified:            { label: 'Unverified',            icon: ShieldQuestion, cls: 'bg-muted text-muted-foreground border-border' },
  Pending_Verification:  { label: 'Pending Verification',  icon: Clock,          cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  Verified:              { label: 'Verified',              icon: CheckCircle2,   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Rejected:              { label: 'Rejected',              icon: XCircle,        cls: 'bg-red-50 text-red-700 border-red-200' },
};

function VerificationBadge({ status }) {
  const cfg = VERIFICATION_CONFIG[status] || VERIFICATION_CONFIG.Unverified;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border', cfg.cls)}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

export default function RelatedPartiesTab({ client, relatedParties, links, onRefresh }) {
  const navigate = useNavigate();
  const { currentUser } = useTenant();
  const [addOpen, setAddOpen]   = useState(false);
  const [slideOver, setSlideOver] = useState(null);
  const [editOpen, setEditOpen] = useState(null); // RelatedParty to edit

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">Related Parties ({relatedParties.length})</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => navigate(`/org-chart/${client.id}`)}>
            <Network className="w-3 h-3" /> Org Chart
          </Button>
          <Button size="sm" className="gap-1 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="w-3 h-3" /> Add Related Party
          </Button>
        </div>
      </div>

      {relatedParties.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">No related parties added yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Role</th>
                <th className="text-left px-4 py-2.5">Ownership %</th>
                <th className="text-left px-4 py-2.5">Verification</th>
                <th className="text-left px-4 py-2.5">Risk</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {relatedParties.map(rp => {
                const link = links.find(l => l.related_party_id === rp.id);
                return (
                  <tr key={rp.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSlideOver(rp)}>
                    <td className="px-4 py-3 font-medium text-foreground">{rp.full_name}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                        rp.party_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                      )}>
                        {rp.party_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{link?.role || rp.role_in_relationship || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                      {link?.ownership_percentage != null ? `${link.ownership_percentage}%` : rp.ownership_percentage != null ? `${rp.ownership_percentage}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <VerificationBadge status={rp.verification_status || 'Unverified'} />
                    </td>
                    <td className="px-4 py-3"><RiskBadge risk={rp.risk_classification} /></td>
                    <td className="px-4 py-3">
                      <button
                        className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                        onClick={e => { e.stopPropagation(); setEditOpen(rp); }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add RP Dialog */}
      <AddRelatedPartyDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        client={client}
        currentUser={currentUser}
        onAdded={onRefresh}
      />

      {/* Edit + Verify Dialog */}
      {editOpen && (
        <EditRelatedPartyDialog
          rp={editOpen}
          client={client}
          currentUser={currentUser}
          onClose={() => setEditOpen(null)}
          onSaved={onRefresh}
        />
      )}

      {/* Slide-over detail */}
      {slideOver && (
        <Sheet open={!!slideOver} onOpenChange={() => setSlideOver(null)}>
          <SheetContent className="w-[420px] sm:w-[500px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{slideOver.full_name}</SheetTitle>
            </SheetHeader>
            <RPDetailPanel
              rp={slideOver}
              currentUser={currentUser}
              client={client}
              onVerify={async (status, notes) => {
                await base44.entities.RelatedParty.update(slideOver.id, {
                  verification_status: status,
                  verification_notes: notes,
                  verified_by_user_id: status === 'Verified' ? currentUser.id : undefined,
                  verified_at: status === 'Verified' ? new Date().toISOString() : undefined,
                });
                await base44.entities.AuditEvent.create({
                  tenant_id: client.tenant_id,
                  client_id: client.id,
                  actor_user_id: currentUser.id,
                  actor_name: currentUser.full_name,
                  actor_type: 'User',
                  event_type: 'related_party_verification_updated',
                  notes: `${slideOver.full_name} verification status set to ${status}. ${notes || ''}`,
                });
                onRefresh?.();
                setSlideOver(null);
              }}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/* ── Edit Dialog ── */
function EditRelatedPartyDialog({ rp, client, currentUser, onClose, onSaved }) {
  const isOrg = rp.party_type === 'ORG';
  const [form, setForm] = useState({ ...rp });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    await base44.entities.RelatedParty.update(rp.id, form);
    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'related_party_updated',
      before_state: rp,
      after_state: form,
      notes: `Related party ${rp.full_name} updated`,
    });
    setSaving(false);
    onSaved?.();
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Related Party — {rp.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Full Name *" value={form.full_name} onChange={v => set('full_name', v)} />
            <div>
              <Label className="text-xs mb-1 block">Role</Label>
              <Select value={form.role_in_relationship || ''} onValueChange={v => set('role_in_relationship', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <FormField label="Ownership %" value={form.ownership_percentage?.toString() || ''} onChange={v => set('ownership_percentage', parseFloat(v) || undefined)} type="number" />

          {!isOrg && <>
            <div className="border-t border-border pt-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Identity</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Date of Birth</Label>
                  <Input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Nationality</Label>
                  <Select value={form.nationality || ''} onValueChange={v => set('nationality', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">ID Type</Label>
                  <Select value={form.id_type || ''} onValueChange={v => set('id_type', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{ID_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <FormField label="ID Number" value={form.id_number || ''} onChange={v => set('id_number', v)} />
              </div>
            </div>
          </>}

          {isOrg && <>
            <div className="border-t border-border pt-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Organisation</div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Registration No." value={form.registration_number || ''} onChange={v => set('registration_number', v)} />
                <div>
                  <Label className="text-xs mb-1 block">Legal Form</Label>
                  <Select value={form.legal_form || ''} onValueChange={v => set('legal_form', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{LEGAL_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Registered Country</Label>
                  <Select value={form.registered_country || ''} onValueChange={v => set('registered_country', v)}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </>}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!form.full_name || saving} className="gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Slide-over Detail Panel ── */
function RPDetailPanel({ rp, currentUser, client, onVerify }) {
  const isOrg = rp.party_type === 'ORG';
  const [verifyMode, setVerifyMode] = useState(false);
  const [newStatus, setNewStatus]   = useState(rp.verification_status || 'Unverified');
  const [notes, setNotes]           = useState('');
  const [saving, setSaving]         = useState(false);

  const fields = isOrg
    ? [
        { label: 'Registration No.',  value: rp.registration_number },
        { label: 'Registered Country', value: rp.registered_country },
        { label: 'Address',           value: rp.registered_address },
        { label: 'Sector',            value: rp.sector },
        { label: 'Legal Form',        value: rp.legal_form },
        { label: 'Role',              value: rp.role_in_relationship },
        { label: 'Ownership %',       value: rp.ownership_percentage != null ? `${rp.ownership_percentage}%` : null },
      ]
    : [
        { label: 'Date of Birth',         value: rp.date_of_birth },
        { label: 'Nationality',           value: rp.nationality },
        { label: 'Country of Residence',  value: rp.country_of_residence },
        { label: 'ID Type',               value: rp.id_type },
        { label: 'ID Number',             value: rp.id_number },
        { label: 'Role',                  value: rp.role_in_relationship },
        { label: 'Ownership %',           value: rp.ownership_percentage != null ? `${rp.ownership_percentage}%` : null },
      ];

  async function submitVerification() {
    setSaving(true);
    await onVerify(newStatus, notes);
    setSaving(false);
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('text-xs px-2 py-0.5 rounded font-medium',
          rp.party_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
        )}>
          {rp.party_type}
        </span>
        <RiskBadge risk={rp.risk_classification} />
        <VerificationBadge status={rp.verification_status || 'Unverified'} />
      </div>

      {/* Fields */}
      <div className="divide-y divide-border">
        {fields.map(f => (
          <div key={f.label} className="flex justify-between py-2">
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <span className="text-xs font-medium text-foreground">{f.value || '—'}</span>
          </div>
        ))}
      </div>

      {/* Verification info */}
      {rp.verified_at && (
        <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-2.5">
          Verified {format(new Date(rp.verified_at), 'd MMM yyyy HH:mm')}
          {rp.verification_notes && <div className="mt-1 italic">"{rp.verification_notes}"</div>}
        </div>
      )}

      {/* Verification action panel */}
      <div className="border-t border-border pt-4">
        {!verifyMode ? (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs w-full" onClick={() => setVerifyMode(true)}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Update Verification Status
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update Verification</div>
            <div>
              <Label className="text-xs mb-1 block">New Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(VERIFICATION_CONFIG).map(([v, cfg]) => (
                    <SelectItem key={v} value={v}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Notes / Justification</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add notes about the verification decision…"
                className="text-sm min-h-16 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => setVerifyMode(false)}>Cancel</Button>
              <Button size="sm" className="flex-1 text-xs gap-1.5" onClick={submitVerification} disabled={saving}>
                {saving && <Loader2 className="w-3 h-3 animate-spin" />} Confirm
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Add RP Dialog (unchanged logic, cleaned up) ── */
function AddRelatedPartyDialog({ open, onClose, client, currentUser, onAdded }) {
  const [mode, setMode]           = useState('search');
  const [query, setQuery]         = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedRP, setSelectedRP] = useState(null);
  const [role, setRole]           = useState('');
  const [ownership, setOwnership] = useState('');
  const [saving, setSaving]       = useState(false);
  const [newRP, setNewRP] = useState({ party_type: 'NP', full_name: '', role_in_relationship: '', ownership_percentage: '' });

  const debounceRef = React.useRef();
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await base44.entities.RelatedParty.filter({ tenant_id: client.tenant_id });
      const lower = query.toLowerCase();
      setSearchResults((res || []).filter(r => r.full_name?.toLowerCase().includes(lower)));
      setSearching(false);
    }, 300);
  }, [query]);

  async function linkExisting() {
    if (!selectedRP) return;
    setSaving(true);
    await base44.entities.ClientRelatedPartyLink.create({
      tenant_id: client.tenant_id, client_id: client.id,
      related_party_id: selectedRP.id,
      role: role || selectedRP.role_in_relationship,
      ownership_percentage: ownership ? parseFloat(ownership) : undefined,
      added_by_user_id: currentUser.id,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id, client_id: client.id,
      actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
      event_type: 'related_party_linked',
      notes: `${selectedRP.full_name} linked as ${role || selectedRP.role_in_relationship || 'Related Party'}`,
    });
    setSaving(false); onAdded?.(); onClose();
  }

  async function createAndLink() {
    if (!newRP.full_name) return;
    setSaving(true);
    const rp = await base44.entities.RelatedParty.create({
      ...newRP, tenant_id: client.tenant_id,
      ownership_percentage: newRP.ownership_percentage ? parseFloat(newRP.ownership_percentage) : undefined,
      verification_status: 'Unverified',
    });
    await base44.entities.ClientRelatedPartyLink.create({
      tenant_id: client.tenant_id, client_id: client.id,
      related_party_id: rp.id, role: newRP.role_in_relationship,
      ownership_percentage: newRP.ownership_percentage ? parseFloat(newRP.ownership_percentage) : undefined,
      added_by_user_id: currentUser.id,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id, client_id: client.id,
      actor_user_id: currentUser.id, actor_name: currentUser.full_name, actor_type: 'User',
      event_type: 'related_party_created_and_linked',
      notes: `${newRP.full_name} created and linked as ${newRP.role_in_relationship || 'Related Party'}`,
    });
    setSaving(false); onAdded?.(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Related Party</DialogTitle></DialogHeader>
        <div className="flex gap-2 mb-4">
          {['search','create'].map(m => (
            <button key={m}
              className={cn('flex-1 py-2 text-sm rounded-lg border transition-colors',
                mode === m ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/50')}
              onClick={() => setMode(m)}
            >
              {m === 'search' ? 'Search existing' : 'Create new'}
            </button>
          ))}
        </div>

        {mode === 'search' ? (
          <div className="space-y-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Search by name…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9 h-9 text-sm" autoFocus />
            </div>
            {searching && <div className="text-xs text-muted-foreground text-center py-2">Searching…</div>}
            {searchResults.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {searchResults.map(rp => (
                  <div key={rp.id}
                    className={cn('flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors text-sm',
                      selectedRP?.id === rp.id && 'bg-primary/10 border-l-2 border-primary')}
                    onClick={() => setSelectedRP(rp)}
                  >
                    <div>
                      <div className="font-medium">{rp.full_name}</div>
                      <div className="text-xs text-muted-foreground">{rp.party_type} · {rp.role_in_relationship || '—'}</div>
                    </div>
                    <VerificationBadge status={rp.verification_status || 'Unverified'} />
                  </div>
                ))}
              </div>
            )}
            {selectedRP && (
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="text-xs font-medium text-muted-foreground">Link details for "{selectedRP.full_name}"</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Role</Label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select role" /></SelectTrigger>
                      <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Ownership %</Label>
                    <Input type="number" value={ownership} onChange={e => setOwnership(e.target.value)} placeholder="e.g. 25" className="h-8 text-sm" min="0" max="100" />
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={linkExisting} disabled={!selectedRP || saving} className="gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Link Party
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Party Type</Label>
                <Select value={newRP.party_type} onValueChange={v => setNewRP(p => ({ ...p, party_type: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NP">NP — Natural Person</SelectItem>
                    <SelectItem value="ORG">ORG — Organisation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <FormField label="Full Name *" value={newRP.full_name} onChange={v => setNewRP(p => ({ ...p, full_name: v }))} />
              <div>
                <Label className="text-xs mb-1 block">Role</Label>
                <Select value={newRP.role_in_relationship} onValueChange={v => setNewRP(p => ({ ...p, role_in_relationship: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <FormField label="Ownership %" value={newRP.ownership_percentage} onChange={v => setNewRP(p => ({ ...p, ownership_percentage: v }))} type="number" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={createAndLink} disabled={!newRP.full_name || saving} className="gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create & Link
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormField({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
      <Input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
    </div>
  );
}