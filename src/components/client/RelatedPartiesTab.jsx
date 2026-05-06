import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import RiskBadge from '@/components/shared/RiskBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Plus, Search, Network, User, Building2, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLES = ['UBO','Director','Shareholder','Beneficiary','Insured','Authorized Signatory','Other'];
const COUNTRIES = ['Netherlands (NL)','Belgium (BE)','Germany (DE)','France (FR)','United Kingdom (GB)','United States (US)','Luxembourg (LU)','Switzerland (CH)','Other'];

export default function RelatedPartiesTab({ client, relatedParties, links, onRefresh }) {
  const navigate = useNavigate();
  const { currentUser } = useTenant();
  const [addOpen, setAddOpen] = useState(false);
  const [slideOver, setSlideOver] = useState(null); // RelatedParty record

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
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {relatedParties.map(rp => {
                const link = links.find(l => l.related_party_id === rp.id);
                return (
                  <tr
                    key={rp.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSlideOver(rp)}
                  >
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
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-full border',
                        rp.is_active !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-muted text-muted-foreground border-border'
                      )}>
                        {rp.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3"><RiskBadge risk={rp.risk_classification} /></td>
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

      {/* Slide-over detail */}
      {slideOver && (
        <Sheet open={!!slideOver} onOpenChange={() => setSlideOver(null)}>
          <SheetContent className="w-[420px] sm:w-[480px]">
            <SheetHeader>
              <SheetTitle>{slideOver.full_name}</SheetTitle>
            </SheetHeader>
            <RPDetailPanel rp={slideOver} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function AddRelatedPartyDialog({ open, onClose, client, currentUser, onAdded }) {
  const [mode, setMode]         = useState('search'); // 'search' | 'create'
  const [query, setQuery]       = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedRP, setSelectedRP] = useState(null);
  const [role, setRole]         = useState('');
  const [ownership, setOwnership] = useState('');
  const [saving, setSaving]     = useState(false);

  // New RP form
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
      tenant_id: client.tenant_id,
      client_id: client.id,
      related_party_id: selectedRP.id,
      role: role || selectedRP.role_in_relationship,
      ownership_percentage: ownership ? parseFloat(ownership) : undefined,
      added_by_user_id: currentUser.id,
    });
    setSaving(false);
    onAdded?.();
    onClose();
  }

  async function createAndLink() {
    if (!newRP.full_name) return;
    setSaving(true);
    const rp = await base44.entities.RelatedParty.create({
      ...newRP,
      tenant_id: client.tenant_id,
      ownership_percentage: newRP.ownership_percentage ? parseFloat(newRP.ownership_percentage) : undefined,
    });
    await base44.entities.ClientRelatedPartyLink.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      related_party_id: rp.id,
      role: newRP.role_in_relationship,
      ownership_percentage: newRP.ownership_percentage ? parseFloat(newRP.ownership_percentage) : undefined,
      added_by_user_id: currentUser.id,
    });
    setSaving(false);
    onAdded?.();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Related Party</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button
            className={cn('flex-1 py-2 text-sm rounded-lg border transition-colors',
              mode === 'search' ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/50')}
            onClick={() => setMode('search')}
          >Search existing</button>
          <button
            className={cn('flex-1 py-2 text-sm rounded-lg border transition-colors',
              mode === 'create' ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/50')}
            onClick={() => setMode('create')}
          >Create new</button>
        </div>

        {mode === 'search' ? (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Search by name…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9 h-9 text-sm" autoFocus />
            </div>
            {searching && <div className="text-xs text-muted-foreground text-center py-2">Searching…</div>}
            {searchResults.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {searchResults.map(rp => (
                  <div
                    key={rp.id}
                    className={cn('flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors text-sm',
                      selectedRP?.id === rp.id && 'bg-primary/10 border-l-2 border-primary')}
                    onClick={() => setSelectedRP(rp)}
                  >
                    <div>
                      <div className="font-medium">{rp.full_name}</div>
                      <div className="text-xs text-muted-foreground">{rp.party_type} · {rp.role_in_relationship || '—'}</div>
                    </div>
                    <RiskBadge risk={rp.risk_classification} />
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
              <div>
                <Label className="text-xs mb-1 block">Full Name *</Label>
                <Input value={newRP.full_name} onChange={e => setNewRP(p => ({ ...p, full_name: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Role</Label>
                <Select value={newRP.role_in_relationship} onValueChange={v => setNewRP(p => ({ ...p, role_in_relationship: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Ownership %</Label>
                <Input type="number" value={newRP.ownership_percentage} onChange={e => setNewRP(p => ({ ...p, ownership_percentage: e.target.value }))} className="h-8 text-sm" placeholder="e.g. 25" />
              </div>
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

function RPDetailPanel({ rp }) {
  const isOrg = rp.party_type === 'ORG';
  const fields = isOrg
    ? [
        { label: 'Full Name', value: rp.full_name },
        { label: 'Registration No.', value: rp.registration_number },
        { label: 'Registered Country', value: rp.registered_country },
        { label: 'Address', value: rp.registered_address },
        { label: 'Sector', value: rp.sector },
        { label: 'Legal Form', value: rp.legal_form },
        { label: 'Role', value: rp.role_in_relationship },
        { label: 'Ownership %', value: rp.ownership_percentage != null ? `${rp.ownership_percentage}%` : null },
      ]
    : [
        { label: 'Full Name', value: rp.full_name },
        { label: 'Date of Birth', value: rp.date_of_birth },
        { label: 'Nationality', value: rp.nationality },
        { label: 'Country of Residence', value: rp.country_of_residence },
        { label: 'ID Type', value: rp.id_type },
        { label: 'ID Number', value: rp.id_number },
        { label: 'Role', value: rp.role_in_relationship },
        { label: 'Ownership %', value: rp.ownership_percentage != null ? `${rp.ownership_percentage}%` : null },
      ];

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className={cn('text-xs px-2 py-0.5 rounded font-medium',
          rp.party_type === 'ORG' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
        )}>
          {rp.party_type}
        </span>
        <RiskBadge risk={rp.risk_classification} />
        <span className={cn('text-xs px-2 py-0.5 rounded-full border',
          rp.is_active !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-muted text-muted-foreground border-border'
        )}>
          {rp.is_active !== false ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="divide-y divide-border">
        {fields.map(f => (
          <div key={f.label} className="flex justify-between py-2">
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <span className="text-xs font-medium text-foreground">{f.value || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}