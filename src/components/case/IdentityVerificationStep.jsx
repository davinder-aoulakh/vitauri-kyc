import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, XCircle, AlertTriangle, User, Building2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const VERIFICATION_STATUS = ['Pending', 'In Progress', 'Verified', 'Failed', 'Unable to Verify'];
const ID_TYPES_NP  = ['Passport', 'National ID Card', 'Driving Licence', 'Residence Permit', 'Other'];
const ID_TYPES_ORG = ['Chamber of Commerce Extract', 'Legal Entity Register', 'LEI Certificate', 'Certificate of Incorporation', 'Other'];

const STATUS_ICON = {
  Verified:           <CheckCircle className="w-4 h-4 text-emerald-500" />,
  Failed:             <XCircle className="w-4 h-4 text-red-500" />,
  'Unable to Verify': <AlertTriangle className="w-4 h-4 text-amber-500" />,
};

export default function IdentityVerificationStep({ kycCase, client, currentUser }) {
  const isOrg = client?.client_type === 'ORG';
  const [verifications, setVerifications] = useState({
    primary: { status: 'Pending', doc_type: '', doc_number: '', issue_date: '', expiry_date: '', notes: '' },
    secondary: { status: 'Pending', doc_type: '', doc_number: '', notes: '' },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const set = (key, field, val) => setVerifications(v => ({ ...v, [key]: { ...v[key], [field]: val } }));

  async function saveVerification() {
    setSaving(true);
    await base44.entities.AuditEvent.create({
      tenant_id: kycCase.tenant_id,
      case_id: kycCase.id,
      client_id: kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'identity_verification_updated',
      notes: `Primary ID: ${verifications.primary.status} | Secondary: ${verifications.secondary.status}`,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const docTypes = isOrg ? ID_TYPES_ORG : ID_TYPES_NP;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          {isOrg ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
          Identity Verification — {isOrg ? 'Organisation' : 'Natural Person'}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isOrg ? 'Verify legal entity existence and registration details' : 'Verify identity documents and personal details'}
        </p>
      </div>

      {/* Client data summary */}
      <div className="bg-muted/30 rounded-xl border border-border p-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Client Data on File</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          {isOrg ? (
            <>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Legal Name</span><span className="font-medium">{client?.full_name || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Reg. No.</span><span className="font-medium">{client?.registration_number || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Country</span><span className="font-medium">{client?.registered_country || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Legal Form</span><span className="font-medium">{client?.legal_form || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">LEI Code</span><span className="font-medium">{client?.lei_code || '—'}</span></div>
            </>
          ) : (
            <>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Full Name</span><span className="font-medium">{client?.full_name || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Date of Birth</span><span className="font-medium">{client?.date_of_birth || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Nationality</span><span className="font-medium">{client?.nationality || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Country of Residence</span><span className="font-medium">{client?.country_of_residence || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">ID Type</span><span className="font-medium">{client?.id_type || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">ID Number</span><span className="font-medium">{client?.id_number || '—'}</span></div>
            </>
          )}
        </div>
      </div>

      {/* Verification forms */}
      {[
        { key: 'primary',   label: isOrg ? 'Primary Registration Document' : 'Primary ID Document' },
        { key: 'secondary', label: isOrg ? 'Secondary Supporting Document' : 'Secondary Document / Proof of Address' },
      ].map(({ key, label }) => (
        <div key={key} className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">{label}</h4>
            {STATUS_ICON[verifications[key].status] && (
              <div className="flex items-center gap-1">
                {STATUS_ICON[verifications[key].status]}
                <span className="text-xs font-medium">{verifications[key].status}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Document Type</Label>
              <Select value={verifications[key].doc_type} onValueChange={v => set(key, 'doc_type', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>{docTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Document Number</Label>
              <Input value={verifications[key].doc_number} onChange={e => set(key, 'doc_number', e.target.value)} className="h-8 text-sm" />
            </div>
            {key === 'primary' && !isOrg && (
              <>
                <div>
                  <Label className="text-xs mb-1 block">Issue Date</Label>
                  <Input type="date" value={verifications[key].issue_date} onChange={e => set(key, 'issue_date', e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Expiry Date</Label>
                  <Input type="date" value={verifications[key].expiry_date} onChange={e => set(key, 'expiry_date', e.target.value)} className="h-8 text-sm" />
                </div>
              </>
            )}
            <div className="col-span-2">
              <Label className="text-xs mb-1 block">Verification Status</Label>
              <Select value={verifications[key].status} onValueChange={v => set(key, 'status', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{VERIFICATION_STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs mb-1 block">Analyst Notes</Label>
              <Textarea value={verifications[key].notes} onChange={e => set(key, 'notes', e.target.value)} className="text-sm min-h-12" placeholder="Verification notes…" />
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button onClick={saveVerification} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Save Verification
        </Button>
        {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
      </div>
    </div>
  );
}