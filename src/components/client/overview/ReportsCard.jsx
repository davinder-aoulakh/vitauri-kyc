import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Download } from 'lucide-react';
import { STATUS_LABEL } from '@/lib/fiuReport';

/** FIU reports for this customer with FIU reference, status and a download menu of their FiuArtefact files. */
export default function ReportsCard({ reports, artefacts }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Reports</h3>
      {reports.length === 0 ? <p className="text-xs text-muted-foreground">No FIU reports for this customer.</p> : (
        <ul className="divide-y divide-border">
          {reports.map((r) => {
            const files = artefacts.filter((a) => a.fiu_report_id === r.id);
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <div className="min-w-0">
                  <Link to={`/tm/report/${r.id}`} className="font-medium text-primary hover:underline">{r.report_ref || 'FIU report'}</Link>
                  <div className="text-muted-foreground">FIU reference: {r.fiu_reference || '—'}</div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium">{STATUS_LABEL[r.status] || String(r.status || '').replace(/_/g, ' ')}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"><Download className="h-3 w-3" /> Files ({files.length})</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {files.length === 0 ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No files yet</DropdownMenuLabel> : files.map((f) => (
                        <DropdownMenuItem key={f.id} asChild className="text-xs">
                          <a href={f.file_url} target="_blank" rel="noopener noreferrer">{f.file_name || String(f.kind || 'file').replace(/_/g, ' ')}</a>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
