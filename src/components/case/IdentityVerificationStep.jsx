import React, { useState, useRef, useEffect } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import OcrResultPanel from '@/components/client/OcrResultPanel';
import DiditVerificationPanel from '@/components/client/DiditVerificationPanel';
import {
  CheckCircle, XCircle, AlertTriangle, User, Building2, Loader2,
  Upload, Sparkles, ScanLine, FileText, Paperclip, Send, Copy, Mail, Pencil
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addDays } from 'date-fns';
import { resolvePendingDiditSessions } from '@/lib/diditResolve';

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

// ── OCR Upload Panel ──────────────────────────────────────────────────────────────────────
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

// ── Simple doc upload card ─────────────────────────────────────────────────────────────────────────
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

function generateAccessToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Send Didit Verification (empty-state primary action) ──────────────────────────────────
function SendDiditCard({ kycCase, client, currentUser, tenant, onSent }) {
  const [loading, setLoading]   = useState(true);
  const [template, setTemplate] = useState(null);   // matching OutreachTemplate (id_verification)
  const [pending, setPending]   = useState(null);    // { req, item } — already-outstanding request
  const [sending, setSending]   = useState(false);
  const [result, setResult]     = useState(null);    // { portalUrl, emailSent }
  const [copied, setCopied]     = useState(false);

  useEffect(() => { load(); }, [kycCase.id, client?.id]);

  async function load() {
    setLoading(true);
    try {
      const [templates, requests] = await Promise.all([
        base44.entities.OutreachTemplate.filter({ tenant_id: kycCase.tenant_id, field_type: 'id_verification', is_active: true }),
        base44.entities.OutreachRequest.filter({ case_id: kycCase.id }),
      ]);
      const npTemplates = (templates || []).filter(t => !t.client_types?.length || t.client_types.includes('NP'));
      setTemplate(npTemplates[0] || null);

      for (const req of (requests || [])) {
        const item = (req.items || []).find(i =>
          i.field_type === 'id_verification' && (!i.idv_status || i.idv_status === 'Pending')
        );
        if (item) { setPending({ req, item }); break; }
      }
    } finally {
      setLoading(false);
    }
  }

  function getPortalUrl(req) {
    return `${window.location.origin}/portal/${req.access_token}`;
  }

  function copyLink(url) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function sendRequest() {
    if (!template) return;
    setSending(true);
    try {
      const token = generateAccessToken();
      const tokenExpiry = addDays(new Date(), 14);
      const item = {
        item_id:              template.id,
        item_type:            'data_point',
        field_type:           'id_verification',
        label:                template.label || 'Identity Verification',
        description:          template.description || '',
        idv_workflow_id:      template.idv_workflow_id || '',
        idv_workflow_name:    template.idv_workflow_name || '',
        idv_min_match_score:  template.idv_min_match_score ?? 75,
        status:               'Requested',
      };
      const hasEmail = !!client?.primary_contact_email;

      const req = await base44.entities.OutreachRequest.create({
        tenant_id:         kycCase.tenant_id,
        case_id:           kycCase.id,
        client_id:         kycCase.client_id,
        message:           `Dear ${client?.full_name || 'Client'}, please complete a short identity verification.`,
        deadline:          format(addDays(new Date(), 14), 'yyyy-MM-dd'),
        delivery_channel:  hasEmail ? 'Email' : 'Portal',
        status:            'Draft',
        access_token:       token,
        token_expires_at:   tokenExpiry.toISOString(),
        items:              [item],
      });

      const portalUrl = getPortalUrl(req);
      let emailSent = false;

      if (hasEmail) {
        const primaryColor = tenant?.branding_primary_color || '#1A6BFF';
        try {
          await base44.integrations.Core.SendEmail({
            from_name: tenant?.email_from_name || tenant?.name || 'Compliance Team',
            ...(tenant?.email_from_address ? { from_email: tenant.email_from_address } : {}),
            to: client.primary_contact_email,
            subject: `Action Required: Identity Verification — ${tenant?.name || 'KYC Review'}`,
            body: `
              <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;">
                <p style="font-size:15px;color:#111827;">Dear ${client?.full_name || 'Client'},</p>
                <p style="font-size:14px;color:#374151;">As part of our review, please complete a short identity
                  verification — it takes about 2 minutes and requires your ID document and a selfie.</p>
                <div style="text-align:center;margin:28px 0;">
                  <a href="${portalUrl}" style="background:${primaryColor};color:#fff;padding:14px 32px;
                     border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
                    Verify My Identity →
                  </a>
                </div>
                <p style="font-size:12px;color:#9CA3AF;">This is a secure, personalised link. Please do not share it with others.</p>
              </div>`,
          });
          emailSent = true;
        } catch (err) {
          console.warn('Email send failed (external email not supported), link still generated:', err);
        }
      }

      await base44.entities.OutreachRequest.update(req.id, { status: 'Sent' });
      await base44.entities.AuditEvent.create({
        tenant_id:     kycCase.tenant_id,
        case_id:       kycCase.id,
        client_id:     kycCase.client_id,
        actor_user_id: currentUser?.id,
        actor_name:    currentUser?.full_name,
        actor_type:    'User',
        event_type:    'outreach_sent',
        notes: `Didit identity verification request sent${emailSent ? ` via email to ${client.primary_contact_email}` : ' (portal link generated)'} from the Identity Verification step.`,
      });

      setResult({ portalUrl, emailSent });
      onSent?.();
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="border border-border rounded-xl p-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking verification status…
      </div>
    );
  }

  // No id_verification field configured in this tenant's outreach library
  if (!template) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
        <div className="font-medium mb-1">Didit identity verification isn't set up yet</div>
        <div>
          Ask your tenant admin to add an "Identity Verification" field (field type <code className="font-mono">id_verification</code>) to{' '}
          <a href="/tenant-config" className="underline font-medium">Tenant Config → Outreach Templates</a>. Until then, verification
          can only be recorded manually below.
        </div>
      </div>
    );
  }

  // Result of a just-sent request
  if (result) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle className="w-4 h-4" />
          Verification request sent{result.emailSent ? ` — emailed to ${client.primary_contact_email}` : ''}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5 flex-1 min-w-0 truncate">{result.portalUrl}</code>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => copyLink(result.portalUrl)}>
            <Copy className="w-3 h-3" /> {copied ? 'Copied' : 'Copy Link'}
          </Button>
        </div>
        <p className="text-xs text-emerald-700">This card updates automatically once the client completes verification.</p>
      </div>
    );
  }

  // An outstanding (already sent, not yet completed) request exists
  if (pending) {
    const portalUrl = getPortalUrl(pending.req);
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          🪪 Verification link already sent — awaiting client
        </div>
        <div className="text-xs text-amber-700">
          Status: {pending.req.status} · sent for {pending.item.label || 'Identity Verification'}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs bg-white border border-amber-200 rounded-lg px-2.5 py-1.5 flex-1 min-w-0 truncate">{portalUrl}</code>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => copyLink(portalUrl)}>
            <Copy className="w-3 h-3" /> {copied ? 'Copied' : 'Copy Link'}
          </Button>
        </div>
      </div>
    );
  }

  // Default: primary CTA
  return (
    <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">🪪</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">Verify identity via Didit</div>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            {client?.primary_contact_email
              ? `Sends a secure verification link to ${client.primary_contact_email} — document scan + selfie, ~2 minutes.`
              : 'Generates a secure verification link to share with the client — document scan + selfie, ~2 minutes.'}
          </p>
          <Button size="sm" onClick={sendRequest} disabled={sending} className="gap-1.5">
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : client?.primary_contact_email ? <Mail className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
            {sending ? 'Sending…' : client?.primary_contact_email ? 'Send Verification Email' : 'Generate Verification Link'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────────────────
export default function IdentityVerificationStep({ kycCase, client, currentUser, tenant, onAutoComplete }) {
  const isOrg = client?.client_type === 'ORG';
  const [verifications, setVerifications] = useState({
    primary: { status: 'Pending', doc_type: '', doc_number: '', issue_date: '', expiry_date: '', notes: '' },
    secondary: { status: 'Pending', doc_type: '', doc_number: '', notes: '' },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [ocrApplied, setOcrApplied] = useState(null); // track what was OCR-applied
  const [portalIdvResults, setPortalIdvResults] = useState([]);
  const [extractedData, setExtractedData]           = useState(null);
  const [showExtractedPrompt, setShowExtractedPrompt] = useState(false);
  const [diditPanelOpen, setDiditPanelOpen]   = useState(false);
  const [selectedDiditItem, setSelectedDiditItem] = useState(null);
  const [showManualOcr, setShowManualOcr] = useState(false);
  const [showPrimaryOverride, setShowPrimaryOverride] = useState(false);

  const set = (key, field, val) => setVerifications(v => ({ ...v, [key]: { ...v[key], [field]: val } }));

  async function fetchAllOutreaches() {
    // Search 1: outreach requests directly linked to this case
    const caseOutreaches = await base44.entities.OutreachRequest.filter({ case_id: kycCase.id });

    // Search 2: ALL outreach requests for this client (catches standalone outreach
    // where case_id is null — sent before a case was created).
    // Filter out anything already found in Search 1 to avoid duplicates.
    const caseOutreachIds = new Set((caseOutreaches || []).map(r => r.id));
    const clientOutreaches = await base44.entities.OutreachRequest.filter({
      client_id: kycCase.client_id
    });
    const standaloneOutreaches = (clientOutreaches || []).filter(r =>
      !caseOutreachIds.has(r.id)
    );
    return [...(caseOutreaches || []), ...standaloneOutreaches];
  }

  async function loadPortalIdvResults() {
    try {
      let allOutreaches = await fetchAllOutreaches();

      // Reliability backstop: any item whose Didit session never got read back
      // (client closed the tab before the client-side poll caught the result)
      // gets actively re-checked here. Re-fetch afterwards if anything resolved.
      const resolvedAny = await resolvePendingDiditSessions(allOutreaches, kycCase.tenant_id);
      if (resolvedAny) allOutreaches = await fetchAllOutreaches();

      // Extract all completed IDV items across all outreach requests, most recent first
      const idvItems = allOutreaches
        .flatMap(req =>
          (req.items || [])
            .filter(item =>
              // Accept if explicitly typed as id_verification
              (item.field_type === 'id_verification' ||
               // OR accept if Didit processed it (didit_session_id is proof)
               item.didit_session_id) &&
              // Must have a terminal IDV status
              item.idv_status &&
              item.idv_status !== 'Pending'
            )
            .map(item => ({
              ...item,
              outreach_req_id: req.id,
              _source: req.case_id ? 'case_outreach' : 'standalone_outreach',
            }))
        )
        .sort((a, b) => {
          if (!a.idv_checked_at && !b.idv_checked_at) return 0;
          if (!a.idv_checked_at) return 1;
          if (!b.idv_checked_at) return -1;
          return new Date(b.idv_checked_at) - new Date(a.idv_checked_at);
        });

      setPortalIdvResults(idvItems);

      // Auto-apply most recent Didit result so form fields are pre-filled
      if (idvItems.length > 0 && idvItems[0].idv_status === 'Pass') {
        const best = idvItems[0];
        set('primary', 'doc_type',   best.idv_document_type  || '');
        set('primary', 'doc_number', best.idv_document_number || '');
        set('primary', 'status',     'Verified');
        set('primary', 'notes',
          `Verified via Didit — ${best.idv_similarity_score ?? '?'}% face match · ` +
          `Liveness: ${best.idv_liveness_passed ? 'passed' : 'not confirmed'} · ` +
          `Doc: ${best.idv_document_type || 'unknown'} · ` +
          `${best.idv_issuing_country || ''} · ` +
          `${best.idv_checked_at ? new Date(best.idv_checked_at).toLocaleDateString() : ''}`
        );
      }
    } catch (err) {
      console.error('Could not load portal IDV results:', err);
    }
  }

  useEffect(() => { loadPortalIdvResults(); }, [kycCase.id]);

  function applyPortalIdv(idvItem) {
    setShowPrimaryOverride(false);
    set('primary', 'doc_type',   idvItem.idv_document_type || '');
    set('primary', 'doc_number', idvItem.idv_document_number || '');
    set('primary', 'status',     idvItem.idv_status === 'Pass' ? 'Verified' : 'Failed');
    set('primary', 'notes',
      `Verified via Didit — ` +
      `${idvItem.idv_similarity_score != null ? idvItem.idv_similarity_score + '% face match' : 'result recorded'} · ` +
      `Liveness: ${idvItem.idv_liveness_passed ? 'passed' : 'not confirmed'} · ` +
      `Doc: ${idvItem.idv_document_type || 'unknown'} · ` +
      `${idvItem.idv_issuing_country || ''} · ` +
      `${idvItem.idv_checked_at ? new Date(idvItem.idv_checked_at).toLocaleDateString() : ''}`
    );

    const extractedName = [idvItem.idv_extracted_first_name, idvItem.idv_extracted_last_name]
      .filter(Boolean).join(' ');
    const hasExtracted = extractedName || idvItem.idv_extracted_dob || idvItem.idv_extracted_nationality;

    if (hasExtracted) {
      setExtractedData({
        full_name:     extractedName  || null,
        date_of_birth: idvItem.idv_extracted_dob || null,
        nationality:   idvItem.idv_extracted_nationality || null,
        id_number:     idvItem.idv_document_number || null,
      });
      setShowExtractedPrompt(true);
    }
  }

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

    // Primary ID verified and case not already marked done — this save IS
    // the analyst's confirmation, so complete the step instead of making
    // them find and click "Mark Complete" separately.
    if (verifications.primary.status === 'Verified' && kycCase?.step_2_status !== 'complete') {
      onAutoComplete?.();
    }
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

      {/* ── Portal IDV Results (primary dashboard cards) ── */}
      {portalIdvResults.length > 0 && portalIdvResults.map((item, idx) => {
        const passed = item.idv_status === 'Pass';
        const score  = item.idv_similarity_score;
        const lScore = item.idv_liveness_score;

        function ScoreRing({ value, color, label, subLabel }) {
          if (value == null) return null;
          const r   = 26;
          const c   = 2 * Math.PI * r;
          const arc = (value / 100) * c;
          return (
            <div className="flex flex-col items-center gap-1">
              <svg width="66" height="66" viewBox="0 0 66 66">
                <circle cx="33" cy="33" r={r} fill="none" stroke="#E5E7EB" strokeWidth="5.5" />
                <circle cx="33" cy="33" r={r} fill="none" stroke={color} strokeWidth="5.5"
                        strokeLinecap="round"
                        strokeDasharray={`${arc} ${c}`}
                        transform="rotate(-90 33 33)" />
                <text x="33" y="37" textAnchor="middle" fontSize="13" fontWeight="700" fill={color}>
                  {Math.round(value)}%
                </text>
              </svg>
              <span className="text-xs font-medium text-foreground">{label}</span>
              {subLabel && (
                <span className={cn('text-xs font-semibold',
                  subLabel === 'Approved' ? 'text-emerald-600' : 'text-red-600')}>
                  {subLabel}
                </span>
              )}
            </div>
          );
        }

        return (
          <div key={idx} className={cn(
            'rounded-xl border-2 overflow-hidden',
            passed ? 'border-emerald-200' : 'border-red-200'
          )}>
            {/* Header */}
            <div className={cn(
              'flex items-center justify-between px-4 py-3 gap-3 flex-wrap',
              passed ? 'bg-emerald-50' : 'bg-red-50'
            )}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{passed ? '✅' : '❌'}</span>
                <div>
                  <div className="font-semibold text-sm">
                    {item.label || 'Identity Verification'}
                    <span className={cn('ml-2 text-xs font-bold px-2 py-0.5 rounded-full',
                      passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                      {item.idv_status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.idv_document_type || '—'}
                    {item.idv_issuing_country && ` · ${item.idv_issuing_country}`}
                    {item.idv_checked_at && ` · ${new Date(item.idv_checked_at).toLocaleDateString()}`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {item.didit_session_id && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => { setSelectedDiditItem(item); setDiditPanelOpen(true); }}>
                    🪪 Full Didit Report →
                  </Button>
                )}
                <Button size="sm" className="h-7 text-xs gap-1"
                  onClick={() => applyPortalIdv(item)}
                  variant={passed ? 'default' : 'outline'}>
                  Apply to Case ↓
                </Button>
              </div>
            </div>

            {/* Biometric scores */}
            <div className="px-4 py-4 bg-card border-b border-border">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Biometric Verification
              </div>
              <div className="flex gap-8 items-start">
                <ScoreRing value={score} color={passed ? '#10B981' : '#EF4444'}
                           label="Face Match"
                           subLabel={score != null ? (score >= 75 ? 'Approved' : 'Below Threshold') : null} />
                <ScoreRing value={lScore || (item.idv_liveness_passed ? 100 : null)}
                           color="#3B82F6"
                           label="Liveness"
                           subLabel={item.idv_liveness_passed ? 'Approved' : 'Not Confirmed'} />
                <div className="flex flex-col items-center gap-1">
                  <div className={cn('text-2xl font-bold',
                    (item.idv_aml_hits || 0) > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                    {item.idv_aml_hits || 0}
                  </div>
                  <span className="text-xs font-medium text-foreground">AML Hits</span>
                  <span className={cn('text-xs font-semibold',
                    (item.idv_aml_hits || 0) > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                    {(item.idv_aml_hits || 0) > 0 ? 'Review Required' : 'Clear'}
                  </span>
                </div>
              </div>
            </div>

            {/* OCR Extracted Data */}
            {(item.idv_extracted_first_name || item.idv_extracted_dob || item.idv_document_number) && (
              <div className="px-4 py-3 bg-muted/20 border-b border-border">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  OCR Extracted Data
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
                  {[
                    ['Verified Name',   [item.idv_extracted_first_name, item.idv_extracted_last_name].filter(Boolean).join(' ')],
                    ['Date of Birth',   item.idv_extracted_dob],
                    ['Nationality',     item.idv_extracted_nationality],
                    ['Document #',      item.idv_document_number],
                    ['Expiry Date',     item.idv_document_expiry],
                    ['Issuing Country', item.idv_issuing_country],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label}>
                      <span className="text-muted-foreground">{label}: </span>
                      <span className="font-medium text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failure reason */}
            {item.idv_failure_reason && (
              <div className="px-4 py-2 bg-red-50 text-xs text-red-700">
                Issue: {item.idv_failure_reason}
              </div>
            )}
          </div>
        );
      })}

      {showExtractedPrompt && extractedData && (
        <div className="border border-primary/20 bg-primary/5 rounded-xl p-3 mt-2 text-xs">
          <div className="font-medium mb-1.5">
            Apply Didit OCR data to client profile?
          </div>
          <div className="text-muted-foreground space-y-0.5 mb-3">
            {extractedData.full_name    && <div>Name: <span className="text-foreground font-medium">{extractedData.full_name}</span></div>}
            {extractedData.date_of_birth && <div>DOB: <span className="text-foreground font-medium">{extractedData.date_of_birth}</span></div>}
            {extractedData.nationality  && <div>Nationality: <span className="text-foreground font-medium">{extractedData.nationality}</span></div>}
            {extractedData.id_number    && <div>Document #: <span className="font-mono text-foreground">{extractedData.id_number}</span></div>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={async () => {
              if (kycCase?.client_id) {
                const updates = {};
                if (extractedData.full_name)     updates.full_name     = extractedData.full_name;
                if (extractedData.date_of_birth) updates.date_of_birth = extractedData.date_of_birth;
                if (extractedData.nationality)   updates.nationality   = extractedData.nationality;
                if (extractedData.id_number)     updates.id_number     = extractedData.id_number;
                await base44.entities.Client.update(kycCase.client_id, updates).catch(console.error);
              }
              setShowExtractedPrompt(false);
            }}>
              Apply to Client Profile
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => setShowExtractedPrompt(false)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* ── Send Didit Verification: primary empty-state action ── */}
      {!isOrg && portalIdvResults.length === 0 && (
        <SendDiditCard
          kycCase={kycCase}
          client={client}
          currentUser={currentUser}
          tenant={tenant}
          onSent={loadPortalIdvResults}
        />
      )}

      {/* ── Manual OCR / Upload: collapsed fallback, either as the exception path
           before Didit runs, or as an optional re-check once Didit has ── */}
      {!isOrg && (
        <div className="border border-border rounded-xl">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-xs
                       text-muted-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setShowManualOcr(s => !s)}
          >
            <span className="flex items-center gap-2">
              <span>📋</span>
              <span className="font-medium">Manual OCR / Upload</span>
              <span className="text-muted-foreground/60">
                {portalIdvResults.length > 0
                  ? '(optional — Didit already extracted document data)'
                  : "(client can't complete Didit? enter manually instead)"}
              </span>
            </span>
            <span>{showManualOcr ? '▲' : '▼'}</span>
          </button>
          {showManualOcr && (
            <div className="border-t border-border">
              <OcrUploadPanel
                kycCase={kycCase}
                client={client}
                currentUser={currentUser}
                onOcrApplied={handleOcrApplied}
              />
            </div>
          )}
        </div>
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

      {/* Analyst case record — required regardless of Didit */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {portalIdvResults.length > 0
            ? '📝 Analyst Verification Record'
            : '📝 Primary ID Document'}
        </div>
        {portalIdvResults.length > 0 && (
          <span className="text-xs text-muted-foreground italic">
            Pre-filled from Didit · please confirm and save
          </span>
        )}
      </div>

      {/* Verification forms */}
      {[
        { key: 'primary',   label: isOrg ? 'Primary Registration Document' : 'Primary ID Document' },
        { key: 'secondary', label: isOrg ? 'Secondary Supporting Document' : 'Secondary Document / Proof of Address' },
      ].map(({ key, label }) => {
        // A Didit Pass already fully populated this — show a confirmed, read-only
        // summary instead of an editable form, so nothing here reads as if
        // re-entry is expected. "Edit / Override" expands the full form.
        const isConfirmedDidit = key === 'primary' && portalIdvResults.length > 0 &&
          verifications.primary.status === 'Verified' && !showPrimaryOverride;

        if (isConfirmedDidit) {
          const v = verifications.primary;
          return (
            <div key={key} className="bg-card border border-emerald-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  {label} — Confirmed via Didit
                </h4>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline flex items-center gap-1"
                  onClick={() => setShowPrimaryOverride(true)}
                >
                  <Pencil className="w-3 h-3" /> Edit / Override
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div><span className="text-muted-foreground">Document Type: </span><span className="font-medium">{v.doc_type || '—'}</span></div>
                <div><span className="text-muted-foreground">Document Number: </span><span className="font-medium">{v.doc_number || '—'}</span></div>
                {v.expiry_date && <div><span className="text-muted-foreground">Expiry: </span><span className="font-medium">{v.expiry_date}</span></div>}
              </div>
              {v.notes && <p className="text-xs text-muted-foreground">{v.notes}</p>}
              <p className="text-xs text-muted-foreground/70">No changes needed — click "Save Verification" below to record this.</p>
            </div>
          );
        }

        return (
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
        );
      })}

      <div className="flex items-center gap-3">
        <Button onClick={saveVerification} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Save Verification
        </Button>
        {saved && <span className="text-xs text-emerald-600 font-medium">✓ Saved</span>}
      </div>

      {diditPanelOpen && selectedDiditItem?.didit_session_id && (
        <DiditVerificationPanel
          sessionId={selectedDiditItem.didit_session_id}
          tenantId={kycCase?.tenant_id}
          clientName={client?.full_name || 'Client'}
          onClose={() => { setDiditPanelOpen(false); setSelectedDiditItem(null); }}
        />
      )}
    </div>
  );
}