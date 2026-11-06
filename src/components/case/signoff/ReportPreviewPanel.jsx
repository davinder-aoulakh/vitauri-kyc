import React, { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { getSignedUrl } from '@/lib/securityUtils';
import { cn } from '@/lib/utils';
import { Download, Eye, FileText, Loader2, Paperclip } from 'lucide-react';

const LABEL_TONE = (label) => (String(label).startsWith('FINAL') ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-900 border-amber-200');
const resolve = async (url) => (url && !/^(https?:|data:|blob:)/i.test(url) ? getSignedUrl(url) : url);

/** Compact report row with an eye icon (spec §7). No download on the page: the PDF is downloaded inside the panel. */
export function ReportRow({ report, label, onPreview, empty = 'No report generated yet' }) {
  if (!report) return <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{empty}</div>;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <FileText className="h-4 w-4 text-primary" />
      <span className="text-sm font-medium">KYC Investigation Report · v{report.version_number}</span>
      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', LABEL_TONE(label))}>{label}</span>
      {report.hash && <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline" title={report.hash}>#{report.hash.slice(0, 10)}</span>}
      <button type="button" className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => onPreview(report)} aria-label="Preview report">
        <Eye className="h-3.5 w-3.5" /> Preview
      </button>
    </div>
  );
}

/** Wide side panel with the report and the Compliance attachments; Download PDF lives only here. ESC closes it. */
export default function ReportPreviewPanel({ open, onOpenChange, report, label, advice }) {
  const [tab, setTab] = useState('report');
  const [src, setSrc] = useState(null);
  const [att, setAtt] = useState(null);
  const attachments = advice?.attachments || [];

  useEffect(() => {
    if (!open || !report?.pdf_url) return;
    setTab('report'); setAtt(null); setSrc(null);
    resolve(report.pdf_url).then(setSrc).catch(() => setSrc(report.pdf_url));
  }, [open, report?.id]);

  const openAttachment = async (a) => { setTab('attachments'); setAtt({ ...a, url: null }); setAtt({ ...a, url: await resolve(a.file_url) }); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl flex flex-col gap-3">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle>KYC Investigation Report{report ? ` · v${report.version_number}` : ''}</SheetTitle>
            {label && <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', LABEL_TONE(label))}>{label}</span>}
          </div>
          <SheetDescription>
            {report?.hash ? `Frozen · SHA-256 ${report.hash}` : 'Draft version: it changes until the case is signed off.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-1 border-b border-border">
          <button type="button" onClick={() => setTab('report')} className={cn('-mb-px border-b-2 px-3 py-1.5 text-sm', tab === 'report' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>Report</button>
          {attachments.length > 0 && (
            <button type="button" onClick={() => setTab('attachments')} className={cn('-mb-px border-b-2 px-3 py-1.5 text-sm', tab === 'attachments' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>
              Compliance attachments ({attachments.length})
            </button>
          )}
          {tab === 'report' && src && (
            <Button asChild size="sm" className="ml-auto mb-1 gap-1.5 h-8">
              <a href={src} download={`KYC_Report_v${report?.version_number}.pdf`} target="_blank" rel="noopener noreferrer"><Download className="h-3.5 w-3.5" /> Download PDF</a>
            </Button>
          )}
        </div>
        {tab === 'report' && (
          !report ? <p className="text-sm text-muted-foreground">No report yet.</p>
            : !src ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
              : <iframe title="Report preview" src={src} className="min-h-[70vh] w-full flex-1 rounded-md border border-border" />
        )}
        {tab === 'attachments' && (
          <div className="grid flex-1 gap-3 md:grid-cols-[16rem_1fr]">
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.index}>
                  <button type="button" onClick={() => openAttachment(a)} className={cn('w-full rounded-md border px-2 py-1.5 text-left text-xs', att?.index === a.index ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
                    <div className="flex items-center gap-1 font-medium"><Paperclip className="h-3 w-3" /> {a.index} · {a.title}</div>
                    {a.description && <div className="mt-0.5 text-muted-foreground line-clamp-2">{a.description}</div>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-h-[60vh] rounded-md border border-border">
              {!att ? <p className="p-4 text-sm text-muted-foreground">Choose an attachment. In the PDF they are appended as annexes C1, C2…</p>
                : !att.url ? <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  : /\.(png|jpe?g|webp|gif)(\?|$)/i.test(att.file_name || att.url) ? <img src={att.url} alt={att.title} className="max-h-[70vh] w-full object-contain" />
                    : <iframe title={att.title} src={att.url} className="h-[70vh] w-full" />}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
