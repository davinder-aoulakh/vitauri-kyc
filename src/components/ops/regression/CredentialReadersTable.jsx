import React from 'react';
import { CREDENTIAL_READERS, ALLOWED_METHODS } from '@/lib/diditCredentialReaders';
import { cn } from '@/lib/utils';

export default function CredentialReadersTable() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-sm">Credential readers</h2>
        <p className="text-xs text-muted-foreground">Server files that use Didit credentials and how each obtains the tenant. Anything outside the approved methods is shown in red.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-2.5">File</th>
              <th className="text-left px-4 py-2.5">Tenant obtained by</th>
              <th className="text-left px-4 py-2.5">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {CREDENTIAL_READERS.map((r) => {
              const ok = ALLOWED_METHODS.includes(r.method);
              return (
                <tr key={r.file} className={cn(!ok && 'bg-red-50')}>
                  <td className="px-4 py-2 text-xs font-mono">{r.file}</td>
                  <td className={cn('px-4 py-2 text-xs font-medium', ok ? 'text-foreground' : 'text-red-600')}>{r.method || 'unknown'}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.note || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}