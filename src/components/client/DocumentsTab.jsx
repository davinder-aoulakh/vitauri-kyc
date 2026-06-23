import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  FileText, Plus, Download, ChevronDown, ChevronRight,
  Loader2, Upload, CheckCircle, XCircle, Clock, Filter, X, Sparkles, Eye,
  Trash2, RotateCcw
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { differenceInDays } from 'date-fns';
import DocumentViewer from '@/components/shared/DocumentViewer';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import OcrResultPanel from '@/components/client/OcrResultPanel';

// Doc types that support OCR extraction
const OCR_SUPPORTED = ['Passport', 'ID_Card', 'Articles_of_Association', 'UBO_Register', 'KYC_Report'];

const DOC_TYPES = [
  'Passport','ID_Card','Selfie','UBO_Register','Articles_of_Association','KYC_Report',
  'Outreach_Response','Financial_Statement','Tax_Return','Salary_Slip','Other'
];

const REVIEW_STATUS_CONFIG = {
  Approved:       { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-700 border border-emerald-200', label: '✓ Approved' },
  Rejected:       { icon: XCircle,     color: 'bg-red-100 text-red-700',                                   label: 'Rejected' },
  Pending_Review: { icon: Clock,       color: 'bg-amber-50 text-amber-700 border border-amber-200',        label: 'Pending Review' },
};

function ReviewStatusBadge({ status }) {
  const cfg = REVIEW_STATUS_CONFIG[status] || REVIEW_STATUS_CONFIG.Pending_Review;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium', cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export default function DocumentsTab({ client, documents, onRefresh, onOcrExtracted }) {
  const { currentUser } = useTenant();
  const [uploadOpen, setUploadOpen]       = useState(false);
  const [reviewOpen, setReviewOpen]       = useState(null);
  const [viewerDoc, setViewerDoc]         = useState(null);
  const [expanded, setExpanded]           = useState({});
  const [filterType, setFilterType]       = useState('all');
  const [filterStatus, setFilterStatus]   = useState('all');
  const [deleteConfirm, setDeleteConfirm] = useState(null); // doc to confirm delete
  const [deletedExpanded, setDeletedExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // doc id

  const userRole = currentUser?.app_role;
  const canDeleteAny = hasPermission(userRole, 'deleteAnyDocument');

  function canDelete(doc) {
    if (canDeleteAny) return true;
    return doc.uploaded_by_user_id === currentUser?.id;
  }

  async function handleDelete(doc) {
    setActionLoading(doc.id);
    await base44.entities.Document.update(doc.id, {
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: currentUser?.id,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: doc.tenant_id,
      client_id: doc.client_id,
      case_id: doc.case_id || undefined,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'document_deleted',
      notes: `Deleted document "${doc.file_name}"`,
    });
    setActionLoading(null);
    setDeleteConfirm(null);
    onRefresh?.();
  }

  async function handleRestore(doc) {
    setActionLoading(doc.id);
    await base44.entities.Document.update(doc.id, {
      is_deleted: false,
      deleted_at: null,
      deleted_by_user_id: null,
    });
    await base44.entities.AuditEvent.create({
      tenant_id: doc.tenant_id,
      client_id: doc.client_id,
      case_id: doc.case_id || undefined,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'document_restored',
      notes: `Restored document "${doc.file_name}"`,
    });
    setActionLoading(null);
    onRefresh?.();
  }

  // Split active vs deleted
  const activeDocuments = documents.filter(doc => !doc.is_deleted);
  const deletedDocuments = documents.filter(doc => doc.is_deleted);

  // Filtering (active only)
  const filtered = activeDocuments.filter(doc => {
    const typeMatch   = filterType === 'all' || doc.doc_type === filterType;
    const statusMatch = filterStatus === 'all' || (doc.review_status || 'Pending_Review') === filterStatus;
    return typeMatch && statusMatch;
  });

  // Group by doc_type
  const grouped = filtered.reduce((acc, doc) => {
    const key = doc.doc_type || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {});
  Object.values(grouped).forEach(docs => docs.sort((a, b) => (b.version || 1) - (a.version || 1)));

  const hasFilters = filterType !== 'all' || filterStatus !== 'all';
  const totalActive = activeDocuments.length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
        <h3 className="font-semibold text-sm">Documents ({filtered.length}{hasFilters ? ` of ${totalActive}` : ''})</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filters */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-7 text-xs w-36 gap-1">
              <Filter className="w-3 h-3 text-muted-foreground" />
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g,' ')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-7 text-xs w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Pending_Review">Pending Review</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => { setFilterType('all'); setFilterStatus('all'); }}>
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setUploadOpen(true)}>
            <Plus className="w-3 h-3" /> Upload
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          {hasFilters ? 'No documents match the current filters.' : 'No documents uploaded yet.'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {Object.entries(grouped).map(([docType, docs]) => {
            const isOpen = expanded[docType] !== false;
            const hasVersions = docs.length > 1;
            return (
              <div key={docType}>
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                  onClick={() => setExpanded(e => ({ ...e, [docType]: !isOpen }))}
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{docType.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-muted-foreground">({docs.length} file{docs.length > 1 ? 's' : ''})</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="divide-y divide-border/50">
                    {docs.map((doc, idx) => (
                      <div
                        key={doc.id}
                        className={cn(
                          'flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 ml-6 pl-6 border-l-2 border-border/30',
                          idx > 0 ? 'opacity-70' : ''
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm text-foreground truncate">{doc.file_name}</span>
                              <span className={cn(
                                'text-xs px-1.5 py-0.5 rounded-full font-mono flex-shrink-0',
                                idx === 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                              )}>
                                v{doc.version || 1}
                              </span>
                              {idx === 0 && hasVersions && (
                                <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Latest</span>
                              )}
                              <ReviewStatusBadge status={doc.review_status || 'Pending_Review'} />
                              {doc?.source === 'didit' && (
                                <span className="ml-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-medium">
                                  🪪 Didit
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {doc.is_ai_generated && <span className="text-purple-600 mr-1">AI Generated · </span>}
                              {doc.created_date ? format(new Date(doc.created_date), 'd MMM yyyy HH:mm') : '—'}
                              {doc.review_notes && <span className="ml-2 italic">"{doc.review_notes}"</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          <Button
                            variant="ghost" size="sm" className="h-7 text-xs gap-1"
                            onClick={() => setViewerDoc({ url: doc.file_url, name: doc.file_name })}
                          >
                            <Eye className="w-3 h-3" />
                          </Button>
                          <a href={doc.file_url} download target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                              <Download className="w-3 h-3" />
                            </Button>
                          </a>
                          {idx === 0 && (
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs"
                              onClick={() => setReviewOpen(doc)}
                            >
                              Review
                            </Button>
                          )}
                          {canDelete(doc) && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteConfirm(doc)}
                              title="Delete document"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Deleted Documents Accordion */}
      {deletedDocuments.length > 0 && (
        <div className="border-t border-border">
          <button
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-sm"
            onClick={() => setDeletedExpanded(v => !v)}
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              {deletedExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <Trash2 className="w-3.5 h-3.5" />
              <span className="font-medium">Deleted Documents ({deletedDocuments.length})</span>
              <span className="text-xs">· restorable within 30 days</span>
            </div>
          </button>
          {deletedExpanded && (
            <div className="divide-y divide-border/50 bg-muted/10">
              {deletedDocuments.map(doc => {
                const daysAgo = doc.deleted_at ? differenceInDays(new Date(), new Date(doc.deleted_at)) : 0;
                const canRestore = daysAgo <= 30;
                return (
                  <div key={doc.id} className="flex items-center justify-between px-4 py-2.5 ml-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-muted-foreground line-through truncate">{doc.file_name}</span>
                        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Deleted</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {doc.deleted_at ? `Deleted ${format(new Date(doc.deleted_at), 'd MMM yyyy')}` : ''}
                        {!canRestore && <span className="text-red-500 ml-1">· Restore period expired</span>}
                      </div>
                    </div>
                    {canRestore && (
                      <Button
                        variant="outline" size="sm" className="h-7 text-xs gap-1 flex-shrink-0"
                        disabled={actionLoading === doc.id}
                        onClick={() => handleRestore(doc)}
                      >
                        {actionLoading === doc.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <RotateCcw className="w-3 h-3" />}
                        Restore
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Document?</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete <span className="font-medium text-foreground">"{deleteConfirm?.file_name}"</span>?
              This can be restored within 30 days.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={actionLoading === deleteConfirm?.id}
                onClick={() => handleDelete(deleteConfirm)}
              >
                {actionLoading === deleteConfirm?.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {viewerDoc && (
        <DocumentViewer
          fileUrl={viewerDoc.url}
          fileName={viewerDoc.name}
          onClose={() => setViewerDoc(null)}
        />
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        client={client}
        currentUser={currentUser}
        existingDocs={documents}
        onUploaded={onRefresh}
        onOcrExtracted={onOcrExtracted}
      />

      <ReviewDialog
        doc={reviewOpen}
        onClose={() => setReviewOpen(null)}
        currentUser={currentUser}
        onSaved={onRefresh}
      />
    </div>
  );
}

function ReviewDialog({ doc, onClose, currentUser, onSaved }) {
  const [status, setStatus]   = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);

  React.useEffect(() => {
    if (doc) {
      setStatus(doc.review_status || 'Pending_Review');
      setNotes(doc.review_notes || '');
    }
  }, [doc]);

  async function handleSave() {
    if (!status) return;
    setSaving(true);
    await base44.entities.Document.update(doc.id, {
      review_status: status,
      review_notes: notes,
      reviewed_by_user_id: currentUser?.id,
      reviewed_at: new Date().toISOString(),
    });
    await base44.entities.AuditEvent.create({
      tenant_id: doc.tenant_id,
      client_id: doc.client_id,
      case_id: doc.case_id || undefined,
      actor_user_id: currentUser?.id,
      actor_name: currentUser?.full_name,
      actor_type: 'User',
      event_type: 'document_reviewed',
      notes: `Document "${doc.file_name}" marked as ${status}${notes ? `: ${notes}` : ''}`,
    });
    setSaving(false);
    onSaved?.();
    onClose();
  }

  return (
    <Dialog open={!!doc} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Review Document</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="bg-muted/40 rounded-lg px-3 py-2 text-sm">
            <div className="font-medium truncate">{doc?.file_name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{doc?.doc_type?.replace(/_/g,' ')} · v{doc?.version || 1}</div>
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Decision *</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select decision" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Approved">✓ Approve</SelectItem>
                <SelectItem value="Rejected">✗ Reject</SelectItem>
                <SelectItem value="Pending_Review">○ Pending Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Notes {status === 'Rejected' && '(required)'}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={status === 'Rejected' ? 'Reason for rejection…' : 'Optional notes…'}
              className="text-sm min-h-16"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !status || (status === 'Rejected' && !notes.trim())}
              className={cn(
                status === 'Approved' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' :
                status === 'Rejected' ? 'bg-red-600 hover:bg-red-700 text-white' : ''
              )}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Decision'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ open, onClose, client, currentUser, existingDocs, onUploaded, onOcrExtracted }) {
  const [file, setFile]           = useState(null);
  const [docType, setDocType]     = useState('');
  const [uploading, setUploading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrResult, setOcrResult]   = useState(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);

  const existingOfType = existingDocs.filter(d => d.doc_type === docType);
  const nextVersion = existingOfType.length > 0 ? Math.max(...existingOfType.map(d => d.version || 1)) + 1 : 1;
  const ocrSupported = OCR_SUPPORTED.includes(docType);

  async function handleUpload() {
    if (!file || !docType) return;
    setUploading(true);

    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setUploadedFileUrl(file_url);

    await base44.entities.Document.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      doc_type: docType,
      file_name: file.name,
      file_url,
      version: nextVersion,
      uploaded_by_user_id: currentUser.id,
      is_ai_generated: false,
      review_status: 'Pending_Review',
    });

    await base44.entities.AuditEvent.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      actor_user_id: currentUser.id,
      actor_name: currentUser.full_name,
      actor_type: 'User',
      event_type: 'document_uploaded',
      notes: `Uploaded ${docType.replace(/_/g,' ')} v${nextVersion}: ${file.name}`,
    });

    setUploading(false);
    onUploaded?.();

    // Run OCR if supported
    if (ocrSupported) {
      setOcrRunning(true);
      const res = await base44.functions.invoke('ocrDocumentParse', {
        file_url,
        doc_type: docType,
        client_type: client.client_type,
      });
      setOcrRunning(false);
      const result = res?.data;
      if (result?.extracted && Object.keys(result.extracted).length > 0) {
        setOcrResult(result);
        return; // Keep dialog open to show OCR results
      }
    }

    // No OCR or no results — close normally
    handleClose();
  }

  function handleApplyOcr(fields) {
    onOcrExtracted?.(fields);
    handleClose();
  }

  function handleClose() {
    setFile(null);
    setDocType('');
    setOcrResult(null);
    setOcrRunning(false);
    setUploadedFileUrl(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ocrResult ? 'OCR Data Extracted' : 'Upload Document'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* OCR results view */}
          {ocrResult ? (
            <OcrResultPanel
              ocrResult={ocrResult}
              onApply={handleApplyOcr}
              onDismiss={handleClose}
            />
          ) : ocrRunning ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="relative">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <Sparkles className="w-3.5 h-3.5 text-primary absolute -top-1 -right-1" />
              </div>
              <div className="text-sm font-medium text-foreground">Analysing document with OCR…</div>
              <div className="text-xs text-muted-foreground">Extracting fields from {docType.replace(/_/g,' ')}</div>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Document Type</Label>
                <Select value={docType} onValueChange={v => { setDocType(v); setOcrResult(null); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(t => (
                      <SelectItem key={t} value={t}>
                        <span>{t.replace(/_/g,' ')}</span>
                        {OCR_SUPPORTED.includes(t) && <span className="ml-1.5 text-[10px] text-primary/60">✦ OCR</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ocrSupported && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Sparkles className="w-3 h-3 text-primary" />
                    <span className="text-xs text-primary/80">OCR will auto-extract profile fields after upload</span>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">File</Label>
                <div
                  className={cn(
                    'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                    file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'
                  )}
                  onClick={() => document.getElementById('doc-upload-input').click()}
                >
                  <Upload className="w-5 h-5 mx-auto text-muted-foreground mb-2" />
                  {file
                    ? <div className="text-sm font-medium">{file.name}</div>
                    : <div className="text-sm text-muted-foreground">Click to select a file</div>
                  }
                  <input id="doc-upload-input" type="file" className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp"
                    onChange={e => setFile(e.target.files?.[0])} />
                </div>
              </div>
              {docType && existingOfType.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                  A previous version exists (v{nextVersion - 1}). This will be saved as v{nextVersion}.
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleUpload} disabled={!file || !docType || uploading} className="gap-2">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? 'Uploading…' : 'Upload'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}