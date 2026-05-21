import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Paperclip, Upload, Eye, X, Loader2, CheckCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const DOC_TYPES = [
  'Passport', 'ID_Card', 'UBO_Register', 'Articles_of_Association',
  'Financial_Statement', 'Tax_Return', 'Salary_Slip', 'Outreach_Response', 'Other'
];

/**
 * Reusable evidence document picker with inline upload.
 * Props:
 *   kycCase, currentUser
 *   documents        — current list of Document records
 *   onDocumentsChange — called with updated list after upload
 *   onSelect(doc, claim) — called when a document is selected
 *   onClose()
 *   claimLabel       — label for the claim textarea (optional)
 */
export default function DocUploadPicker({
  kycCase,
  currentUser,
  documents,
  onDocumentsChange,
  onSelect,
  onClose,
  claimLabel = 'Claim / Note (optional)',
}) {
  const [pendingClaim, setPendingClaim] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedId, setUploadedId] = useState(null);  // id of the just-uploaded doc
  const [uploadDocType, setUploadDocType] = useState('Other');
  const fileInputRef = useRef(null);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadedId(null);

    const { file_url } = await base44.integrations.Core.UploadFile({ file });

    const newDoc = await base44.entities.Document.create({
      tenant_id:           kycCase.tenant_id,
      client_id:           kycCase.client_id,
      case_id:             kycCase.id,
      doc_type:            uploadDocType,
      file_name:           file.name,
      file_url,
      version:             1,
      uploaded_by_user_id: currentUser?.id,
      is_ai_generated:     false,
      review_status:       'Pending_Review',
    });

    const updated = [newDoc, ...documents];
    onDocumentsChange(updated);
    setUploadedId(newDoc.id);
    setUploading(false);

    // Auto-select the newly uploaded doc
    onSelect(newDoc, pendingClaim);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-card border border-border rounded-xl p-5 w-[500px] shadow-xl space-y-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Link Evidence Document</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>

        {/* Claim field */}
        <div>
          <Label className="text-xs mb-1.5 block">{claimLabel}</Label>
          <Textarea
            value={pendingClaim}
            onChange={e => setPendingClaim(e.target.value)}
            placeholder="E.g. 'Salary slip confirms employment income of €4,200/month'"
            className="text-sm min-h-12 resize-none"
          />
        </div>

        {/* Upload new document card */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Upload New Document</div>
          <div className="border-2 border-dashed border-primary/40 rounded-xl p-3 bg-primary/5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Select value={uploadDocType} onValueChange={setUploadDocType}>
                  <SelectTrigger className="h-8 text-xs bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  uploading
                    ? 'bg-muted text-muted-foreground cursor-not-allowed'
                    : 'bg-primary text-white hover:bg-primary/90'
                )}
              >
                {uploading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                  : <><Upload className="w-3.5 h-3.5" /> Choose File</>
                }
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <div className="text-[11px] text-muted-foreground">PDF, JPG or PNG · File will be uploaded, saved and selected automatically</div>
          </div>
        </div>

        {/* Existing documents list */}
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {documents.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">No documents on file yet — upload one above.</p>
          ) : (
            <>
              <div className="text-xs font-medium text-muted-foreground mb-1">Existing Documents</div>
              {documents.map(doc => (
                <div
                  key={doc.id}
                  className={cn(
                    'flex items-center gap-2 p-3 rounded-lg border transition-colors text-xs',
                    doc.id === uploadedId
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-border hover:bg-muted/40'
                  )}
                >
                  <button
                    className="flex-1 text-left flex items-center gap-3"
                    onClick={() => onSelect(doc, pendingClaim)}
                  >
                    {doc.id === uploadedId
                      ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      : <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    }
                    <div>
                      <div className="font-medium text-foreground">{doc.doc_type?.replace(/_/g, ' ')}</div>
                      <div className="text-muted-foreground">{doc.file_name}</div>
                    </div>
                    {doc.id === uploadedId && (
                      <span className="ml-auto text-[11px] text-emerald-600 font-medium">Uploaded ✓</span>
                    )}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}