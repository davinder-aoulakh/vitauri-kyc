import React, { useState, useRef } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import OcrResultPanel from '@/components/client/OcrResultPanel';
import {
  CheckCircle, XCircle, AlertTriangle, User, Building2, Loader2,
  Upload, Sparkles, ScanLine, FileText, Paperclip
} from 'lucide-react';
import { cn } from '@/lib/utils';

const VERIFICATION_STATUS = ['Pending', 'In Progress', 'Verified', 'Failed', 'Unable to Verify'];
const ID_TYPES_NP  = ['Passport', 'National ID Card', 'Driving Licence', 'Residence Permit', 'Other'];
const ID_TYPES_ORG = ['Chamber of Commerce Extract', 'Legal Entity Register', 'LEI Certificate', 'Certificate of Incorporation', 'Other'];

// Map OCR doc type selector to entity doc_type value
const OCR_DOC_OPTIONS = [
  { label: 'Passport',       value: 'Passport',  entity_doc_type: 'Passport' },
  { label: 'National ID Card', value: 'ID_Card', entity_doc_type: 'ID_Card' },
];

const STATUS_ICON = {
  Verified:           <CheckCircle className="w-4 h-4 text-emerald-500" />,
  Failed:             <XCircle className="w-4 h-4 text-red-500" />,
  'Unable to Verify': <AlertTriangle className="w-4 h-4 text-amber-500" />,
};

// Map OCR field names → verification form fields
function ocrToVerification(extracted) {
  const v = {};
  if (extracted.id_type)        v.doc_type   = extracted.id_type;
  if (extracted.id_number)      v.doc_number = extracted.id_number;
  if (extracted.id_expiry_date) v.expiry_date = extracted.id_expiry_date;
  return v;
}

// ── OCR Upload Panel ──────────────────────────────────────────────────────────
function OcrUploadPanel({ kycCase, client, currentUser, onOcrApplied }) {
  const [docType, setDocType]       = useState('Passport');
  const [file, setFile]             = useState(null);
  const [uploading, setUploading]   = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrResult, setOcrResult]   = useState(null);
  const fileInputRef = useRef(null);

  async function handleUploadAndOcr() {
    if (!file) return;
    setUploading(true);

    // Upload file
    const { file_url } = await base44.integrations.Core.UploadFile({ file });

    // Save as Document record
    const existingDocs = await base44.entities.Document.filter({ client_id: kycCase.client_id, doc_type: docType });
    const nextVersion = existingDocs?.length > 0 ? Math.max(...existingDocs.map(d => d.version || 1)) + 1 : 1;

    await base44.entities.Document.create({
      tenant_id:            kycCase.tenant_id,
      client_id:            kycCase.client_id,
      case_id:              kycCase.id,
      doc_type:             docType,
      file_name:            file.name,
      file_url,
      version:              nextVersion,
      uploaded_by_user_id:  currentUser?.id,
      is_ai_generated:      false,
      review_status:        'Pending_Review',
    });

    await base44.entities.AuditEvent.create({
      tenant_id:       kycCase.tenant_id,
      case_id:         kycCase.id,
      client_id:       kycCase.client_id,
      actor_user_id:   currentUser?.id,
      actor_name:      currentUser?.full_name,
      actor_type:      'User',
      event_type:      'document_uploaded',
      notes:           `Uploaded ${docType} v${nextVersion} for OCR identity verification: ${file.name}`,
    });

    setUploading(false);

    // Run OCR
    setOcrRunning(true);
    const res = await base44.functions.invoke('ocrDocumentParse', {
      file_url,
      doc_type: docType,
      client_type: client?.client_type,
    });
    setOcrRunning(false);

    const result = res?.data;
    if (result?.extracted && Object.keys(result.extracted).length > 0) {
      setOcrResult(result);
    } else {
      // No extractable data — reset
      setFile(null);
    }
  }

  function handleApplyOcr(fields) {
    // Apply to client profile fields
    onOcrApplied(fields, ocrToVerification(fields));
    setOcrResult(null);
    setFile(null);
  }

  function handleDismiss() {
    setOcrResult(null);
    setFile(null);
  }

  const isLoading = uploading || ocrRunning;

  return (
    <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/20 bg-primary/10">
        <ScanLine className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-primary">OCR Identity Document Scanner</span>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full ml-auto">
          Auto-extracts Name · DOB · Document № · Expiry
        </span>
      </div>

      <div className="p-4">
        {ocrResult ? (
          <OcrResultPanel
            ocrResult={ocrResult}
            onApply={handleApplyOcr}
            onDismiss={handleDismiss}
          />
        ) : isLoading ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                {uploading
                  ? <Upload className="w-5 h-5 text-primary animate-pulse" />
                  : <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                }
              </div>
              <Loader2 className="w-4 h-4 animate-spin text-primary absolute -bottom-1 -right-1" />
            </div>
            <div className="text-center">
              <div className="text-sm font-medium">
                {uploading ? 'Uploading document…' : 'Extracting data with AI OCR…'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {ocrRunning && 'Reading fields from document image'}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-3 flex-wrap">
            <div className="w-40">
              <Label className="text-xs font-medium mb-1.5 block">Document Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-8 text-sm bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OCR_DOC_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-48">
              <Label className="text-xs font-medium mb-1.5 block">Document File</Label>
              <div
                className={cn(
                  'border-2 border-dashed rounded-lg px-4 py-2.5 cursor-pointer transition-colors flex items-center gap-2',
                  file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40 bg-white'
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground truncate">
                  {file ? file.name : 'Click to select image or PDF…'}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.pdf,.webp,.tiff"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            <Button
              onClick={handleUploadAndOcr}
              disabled={!file}
              className="gap-1.5 h-8 text-xs flex-shrink-0"
            >
              <ScanLine className="w-3.5 h-3.5" />
              Upload & Scan
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Simple doc upload card ────────────────────────────────────────────────────
function SimpleDocUpload({ kycCase, currentUser, onUploaded }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [lastUploaded, setLastUploaded] = useState(null);
  const [docType, setDocType] = useState('Other');

  const DOC_TYPES = ['Passport','ID_Card','Articles_of_Association','UBO_Register','Financial_Statement','Tax_Return','Salary_Slip','Other'];

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    const newDoc = await base44.entities.Document.create({
      tenant_id: kycCase.tenant_id,
      client_id: kycCase.client_id,
      case_id: kycCase.id,
      doc_type: docType,
      file_name: file.name,
      file_url,
      version: 1,
      uploaded_by_user_id: currentUser?.id,
      is_ai_generated: false,
      review_status: 'Pending_Review',
    });
    setLastUploaded(file.name);
    setUploading(false);
    onUploaded?.(newDoc);
    e.target.value = '';
  }

  return (
    <div className="border-2 border-dashed border-border rounded-xl p-3 bg-muted/20 space-y-2">
      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Paperclip className="w-3.5 h-3.5" /> Upload Supporting Document
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g,' ')}</SelectItem>)}</SelectContent>
        </Select>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
        >
          {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : <><Upload className="w-3.5 h-3.5" /> Choose File</>}
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFile} />
        {lastUploaded && <span className="text-xs text-emerald-600 font-medium">✓ {lastUploaded}</span>}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IdentityVerificationStep({ kycCase, client, currentUser }) {
  const isOrg = client?.client_type === 'ORG';
  const [verifications, setVerifications] = useState({
    primary: { status: 'Pending', doc_type: '', doc_number: '', issue_date: '', expiry_date: '', notes: '' },
    secondary: { status: 'Pending', doc_type: '', doc_number: '', notes: '' },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [ocrApplied, setOcrApplied] = useState(null); // track what was OCR-applied

  const set = (key, field, val) => setVerifications(v => ({ ...v, [key]: { ...v[key], [field]: val } }));

  // Auto-save verification state to AuditEvent (lightweight — just record state snapshot)
  const { autoSaving, lastSaved } = useAutoSave(
    verifications,
    async (data) => {
      if (!kycCase?.id) return;
      await base44.entities.AuditEvent.create({
        tenant_id:     kycCase.tenant_id,
        case_id:       kycCase.id,
        client_id:     kycCase.client_id,
        actor_user_id: currentUser?.id,
        actor_name:    currentUser?.full_name,
        actor_type:    'User',
        event_type:    'identity_verification_autosaved',
        after_state:   data,
        notes:         `Auto-saved: Primary ${data.primary.status} | Secondary ${data.secondary.status}`,
      });
    },
    1500,
  );

  // Called when analyst applies OCR results
  async function handleOcrApplied(profileFields, verificationFields) {
    // Pre-fill verification form
    setVerifications(v => ({
      ...v,
      primary: { ...v.primary, ...verificationFields },
    }));

    // Update client profile via entity
    const updatePayload = {};
    if (profileFields.full_name)            updatePayload.full_name            = profileFields.full_name;
    if (profileFields.date_of_birth)        updatePayload.date_of_birth        = profileFields.date_of_birth;
    if (profileFields.nationality)          updatePayload.nationality          = profileFields.nationality;
    if (profileFields.id_number)            updatePayload.id_number            = profileFields.id_number;
    if (profileFields.id_type)              updatePayload.id_type              = profileFields.id_type;
    if (profileFields.id_expiry_date)       updatePayload.id_expiry_date       = profileFields.id_expiry_date;
    if (profileFields.country_of_residence) updatePayload.country_of_residence = profileFields.country_of_residence;
    // ORG fields
    if (profileFields.registration_number) updatePayload.registration_number  = profileFields.registration_number;
    if (profileFields.registered_country)  updatePayload.registered_country   = profileFields.registered_country;
    if (profileFields.registered_address)  updatePayload.registered_address   = profileFields.registered_address;
    if (profileFields.legal_form)          updatePayload.legal_form           = profileFields.legal_form;

    if (Object.keys(updatePayload).length > 0) {
      await base44.entities.Client.update(kycCase.client_id, updatePayload);

      await base44.entities.AuditEvent.create({
        tenant_id:     kycCase.tenant_id,
        case_id:       kycCase.id,
        client_id:     kycCase.client_id,
        actor_user_id: currentUser?.id,
        actor_name:    currentUser?.full_name,
        actor_type:    'User',
        event_type:    'ocr_profile_prefill',
        notes:         `OCR pre-filled ${Object.keys(updatePayload).length} profile field(s): ${Object.keys(updatePayload).join(', ')}`,
        after_state:   updatePayload,
      });
    }

    setOcrApplied(Object.keys(updatePayload));
  }

  async function saveVerification() {
    setSaving(true);
    await base44.entities.AuditEvent.create({
      tenant_id:     kycCase.tenant_id,
      case_id:       kycCase.id,
      client_id:     kycCase.client_id,
      actor_user_id: currentUser?.id,
      actor_name:    currentUser?.full_name,
      actor_type:    'User',
      event_type:    'identity_verification_updated',
      notes:         `Primary ID: ${verifications.primary.status} | Secondary: ${verifications.secondary.status}`,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const docTypes = isOrg ? ID_TYPES_ORG : ID_TYPES_NP;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            {isOrg ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
            Identity Verification — {isOrg ? 'Organisation' : 'Natural Person'}
          </h3>
          <AutoSaveIndicator autoSaving={autoSaving} lastSaved={lastSaved} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isOrg
            ? 'Verify legal entity existence and registration details'
            : 'Upload an identity document to auto-extract fields, then verify manually'}
        </p>
      </div>

      {/* ── OCR Upload Panel (NP: Passport/ID only) ── */}
      {!isOrg && (
        <OcrUploadPanel
          kycCase={kycCase}
          client={client}
          currentUser={currentUser}
          onOcrApplied={handleOcrApplied}
        />
      )}

      {/* OCR applied confirmation */}
      {ocrApplied && ocrApplied.length > 0 && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-700">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            OCR pre-filled <strong>{ocrApplied.length} profile field{ocrApplied.length !== 1 ? 's' : ''}</strong>: {ocrApplied.join(', ')}. Review below and save verification.
          </span>
        </div>
      )}

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
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Full Name</span><span className={cn('font-medium', ocrApplied?.includes('full_name') ? 'text-emerald-600' : '')}>{client?.full_name || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Date of Birth</span><span className={cn('font-medium', ocrApplied?.includes('date_of_birth') ? 'text-emerald-600' : '')}>{client?.date_of_birth || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Nationality</span><span className={cn('font-medium', ocrApplied?.includes('nationality') ? 'text-emerald-600' : '')}>{client?.nationality || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">Country of Residence</span><span className={cn('font-medium', ocrApplied?.includes('country_of_residence') ? 'text-emerald-600' : '')}>{client?.country_of_residence || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">ID Type</span><span className={cn('font-medium', ocrApplied?.includes('id_type') ? 'text-emerald-600' : '')}>{client?.id_type || '—'}</span></div>
              <div className="flex justify-between border-b border-border/50 py-1"><span className="text-muted-foreground">ID Number</span><span className={cn('font-medium', ocrApplied?.includes('id_number') ? 'text-emerald-600' : '')}>{client?.id_number || '—'}</span></div>
            </>
          )}
        </div>
      </div>

      {/* Upload supporting documents */}
      <SimpleDocUpload kycCase={kycCase} currentUser={currentUser} />

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
              <Label className="text-xs mb-1 block flex items-center gap-1">
                Document Type
                {key === 'primary' && ocrApplied?.includes('id_type') && (
                  <span className="text-[10px] text-emerald-600 font-normal">· OCR filled</span>
                )}
              </Label>
              <Select value={verifications[key].doc_type} onValueChange={v => set(key, 'doc_type', v)}>
                <SelectTrigger className={cn('h-8 text-sm', key === 'primary' && ocrApplied?.includes('id_type') ? 'border-emerald-300 bg-emerald-50/40' : '')}>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>{docTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block flex items-center gap-1">
                Document Number
                {key === 'primary' && ocrApplied?.includes('id_number') && (
                  <span className="text-[10px] text-emerald-600 font-normal">· OCR filled</span>
                )}
              </Label>
              <Input
                value={verifications[key].doc_number}
                onChange={e => set(key, 'doc_number', e.target.value)}
                className={cn('h-8 text-sm', key === 'primary' && ocrApplied?.includes('id_number') ? 'border-emerald-300 bg-emerald-50/40' : '')}
              />
            </div>
            {key === 'primary' && !isOrg && (
              <>
                <div>
                  <Label className="text-xs mb-1 block">Issue Date</Label>
                  <Input type="date" value={verifications[key].issue_date} onChange={e => set(key, 'issue_date', e.target.value)} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    Expiry Date
                    {ocrApplied?.includes('id_expiry_date') && (
                      <span className="text-[10px] text-emerald-600 font-normal">· OCR filled</span>
                    )}
                  </Label>
                  <Input
                    type="date"
                    value={verifications[key].expiry_date}
                    onChange={e => set(key, 'expiry_date', e.target.value)}
                    className={cn('h-8 text-sm', ocrApplied?.includes('id_expiry_date') ? 'border-emerald-300 bg-emerald-50/40' : '')}
                  />
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