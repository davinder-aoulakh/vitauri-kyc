import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { Gavel } from 'lucide-react';

const toList = (r) => (Array.isArray(r) ? r : r?.items || []);
const fmt = (d) => { try { return d ? format(new Date(d), 'd MMM yyyy HH:mm') : ''; } catch { return ''; } };

/** Findings of the QC Agent that the QC Officer overruled in the latest QC round (read-only; for the approver). */
export async function loadQcOverrules(caseId) {
  const run = toList(await base44.entities.QcRun.filter({ case_id: caseId }, '-created_date', 1).catch(() => []))[0];
  if (!run) return [];
  const rows = toList(await base44.entities.QcFinding.filter({ case_id: caseId, qc_run_id: run.id, status: 'overruled' }, undefined, 200).catch(() => []));
  return rows;
}

export default function QcOverrulesList({ caseId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { let on = true; loadQcOverrules(caseId).then((r) => { if (on) setRows(r); }); return () => { on = false; }; }, [caseId]);
  if (!rows.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-4 text-xs">
      <div className="flex items-center gap-2 text-sm font-semibold text-violet-900"><Gavel className="h-4 w-4" /> QC overrules ({rows.length})</div>
      <p className="text-muted-foreground">QC passed with these findings of the QC Agent set aside by the QC Officer. Each overrule is in the audit trail.</p>
      <ul className="space-y-1.5">
        {rows.map((f) => (
          <li key={f.id} className="rounded-lg border border-border bg-card p-2.5">
            <div className="text-[10px] capitalize text-muted-foreground">{f.severity} · {f.check === 'report' ? 'Report Check' : 'Case Check'} · {f.code}{f.step_label ? ` · ${f.step_label}` : ''}</div>
            <p className="mt-0.5">{f.text}</p>
            <p className="mt-0.5 text-violet-900"><span className="font-medium">Overruled by {f.resolved_by_name || 'QC Officer'}{f.resolved_at ? ` · ${fmt(f.resolved_at)}` : ''}:</span> {f.resolution_text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
