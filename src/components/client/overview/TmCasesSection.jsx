import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { CASE_STATUS_LABEL } from '@/lib/tmCase';
import { useCustomerFile } from './useCustomerFile';

/** Small 'TM' badge for a KYC case row linked to a TM case. Stops the row click. */
export function TmCaseBadge({ tmCaseId }) {
  if (!tmCaseId) return null;
  return (
    <Link
      to={`/tm/case/${tmCaseId}`}
      onClick={(e) => e.stopPropagation()}
      className="ml-2 inline-flex items-center rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary hover:bg-primary/20"
      title="Linked TM case"
    >
      TM
    </Link>
  );
}

/** 'TM cases' section for the client Cases tab, from getCustomerFile.tm_cases. */
export default function TmCasesSection({ client, users }) {
  const navigate = useNavigate();
  const { data } = useCustomerFile(client.id, true);
  const tmCases = data?.tm_cases || [];

  return (
    <div className="border-t border-border">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">TM Cases ({tmCases.length})</h3>
      </div>
      {tmCases.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">No TM cases for this client</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Case Ref</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Alerts</th>
                <th className="text-left px-4 py-2.5">Assignee</th>
                <th className="text-left px-4 py-2.5">Due</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tmCases.map((t) => {
                const assignee = users?.find((u) => u.id === t.assigned_to_user_id);
                return (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/tm/case/${t.id}`)}>
                    <td className="px-4 py-3 font-medium text-foreground">{t.case_ref || '—'}</td>
                    <td className="px-4 py-3 text-xs">{CASE_STATUS_LABEL[t.status] || String(t.status || '—').replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.alert_ids_count ?? 0}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{assignee?.full_name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{t.due_at ? format(new Date(t.due_at), 'd MMM yyyy') : '—'}</td>
                    <td className="px-4 py-3 text-right"><span className="text-xs text-primary font-medium">Open →</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
