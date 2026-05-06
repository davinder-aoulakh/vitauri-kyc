import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FileText, Plus, Download, ChevronDown, ChevronRight, Loader2, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const DOC_TYPES = [
  'Passport','ID_Card','UBO_Register','Articles_of_Association','KYC_Report',
  'Outreach_Response','Financial_Statement','Tax_Return','Salary_Slip','Other'
];

export default function DocumentsTab({ client, documents, onRefresh }) {
  const { currentUser } = useTenant();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expanded, setExpanded]     = useState({});

  // Group by doc_type
  const grouped = documents.reduce((acc, doc) => {
    const key = doc.doc_type || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {});

  // Sort versions within each group (latest first)
  Object.values(grouped).forEach(docs => docs.sort((a, b) => (b.version || 1) - (a.version || 1)));

  function toggleGroup(key) {
    setExpanded(e => ({ ...e, [key]: !e[key] }));
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">Documents ({documents.length})</h3>
        <Button size="sm" className="gap-1 text-xs" onClick={() => setUploadOpen(true)}>
          <Plus className="w-3 h-3" /> Upload Document
        </Button>
      </div>

      {documents.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">No documents uploaded yet</div>
      ) : (
        <div className="divide-y divide-border">
          {Object.entries(grouped).map(([docType, docs]) => {
            const isOpen = expanded[docType] !== false; // default open
            const latest = docs[0];
            const hasVersions = docs.length > 1;
            return (
              <div key={docType}>
                {/* Group header */}
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                  onClick={() => toggleGroup(docType)}
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{docType.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-muted-foreground">({docs.length} file{docs.length > 1 ? 's' : ''})</span>
                  </div>
                </button>

                {/* File rows */}
                {isOpen && (
                  <div className="divide-y divide-border/50">
                    {docs.map((doc, idx) => (
                      <div
                        key={doc.id}
                        className={cn(
                          'flex items-center justify-between px-4 py-2.5 hover:bg-muted/20',
                          idx > 0 ? 'opacity-70' : '',
                          'ml-6 pl-6 border-l-2 border-border/30'
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
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
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {doc.is_ai_generated && <span className="text-purple-600 mr-1">AI Generated · </span>}
                              {doc.created_date ? format(new Date(doc.created_date), 'd MMM yyyy HH:mm') : '—'}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost" size="sm" className="text-xs gap-1 flex-shrink-0"
                          onClick={() => window.open(doc.file_url, '_blank')}
                        >
                          <Download className="w-3 h-3" /> Download
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upload dialog */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        client={client}
        currentUser={currentUser}
        existingDocs={documents}
        onUploaded={onRefresh}
      />
    </div>
  );
}

function UploadDialog({ open, onClose, client, currentUser, existingDocs, onUploaded }) {
  const [file, setFile]     = useState(null);
  const [docType, setDocType] = useState('');
  const [uploading, setUploading] = useState(false);

  // Check if a doc of this type already exists (for versioning)
  const existingOfType = existingDocs.filter(d => d.doc_type === docType);
  const nextVersion = existingOfType.length > 0 ? Math.max(...existingOfType.map(d => d.version || 1)) + 1 : 1;

  async function handleUpload() {
    if (!file || !docType) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await base44.entities.Document.create({
      tenant_id: client.tenant_id,
      client_id: client.id,
      doc_type: docType,
      file_name: file.name,
      file_url,
      version: nextVersion,
      uploaded_by_user_id: currentUser.id,
      is_ai_generated: false,
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
    setFile(null);
    setDocType('');
    onUploaded?.();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">Document Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g,' ')}</SelectItem>)}
              </SelectContent>
            </Select>
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
              <input id="doc-upload-input" type="file" className="hidden" onChange={e => setFile(e.target.files[0])} />
            </div>
          </div>

          {docType && existingOfType.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
              A previous version exists (v{nextVersion - 1}). This will be saved as v{nextVersion}.
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!file || !docType || uploading} className="gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}