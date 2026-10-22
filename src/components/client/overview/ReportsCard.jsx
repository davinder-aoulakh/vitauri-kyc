import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { Download, FileText, Loader2 } from 'lucide-react';
import { STATUS_LABEL } from '@/lib/fiuReport';

const KIND_LABEL = { goaml_xml: 'goAML XML', report_pdf: 'Report PDF', submission_evidence: 'Submission evidence', fiu_receipt: 'FIU receipt' };

function ArtefactLink({ a }) {
  const [busy, setBusy] = useState(false);
  const label = a.file_name || KIND_LABEL[a.kind] || 'File';
  if (!a.file_url) {
    return <span className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground"><FileText className="h-3 w-3" /> {label}</span>;
  }
  const open = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('getFiuArtefactUrl', { artefact_id: a.id });
      const url = res?.data?.signed_url;
      if (!url) throw new Error(res?.data?.error || 'No link returned');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast({ title: 'Could not open the file', description: e?.response?.data?.error || e?.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={open} disabled={busy} title={KIND_LABEL[a.kind]} className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-muted disabled:opacity-60">
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} {label}
    </button>
  );
}

/** FIU reports for this customer with FIU reference, status and their filed FiuArtefact files (signed download links). */
export default function ReportsCard({ reports, artefacts }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Reports</h3>
      {reports.length === 0 ? <p className="text-xs text-muted-foreground">No FIU reports for this customer.</p> : (
        <ul className="divide-y divide-border">
          {reports.map((r) => {
            const files = artefacts.filter((a) => a.fiu_report_id === r.id);
            return (
              <li key={r.id} className="space-y-1.5 py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/tm/report/${r.id}`} className="font-medium text-primary hover:underline">{r.report_ref || 'FIU report'}</Link>
                    <div className="text-muted-foreground">FIU reference: {r.fiu_reference || '—'}</div>
                  </div>
                  <span className="flex-shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium">{STATUS_LABEL[r.status] || String(r.status || '').replace(/_/g, ' ')}</span>
                </div>
                {files.length === 0
                  ? <div className="text-[11px] text-muted-foreground">No files filed yet</div>
                  : <div className="flex flex-wrap gap-1.5">{files.map((a) => <ArtefactLink key={a.id} a={a} />)}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
