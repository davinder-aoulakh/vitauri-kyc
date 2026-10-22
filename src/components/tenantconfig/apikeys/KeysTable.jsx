import React from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

export default function KeysTable({ keys, onRevoke }) {
  if (!keys.length) return <div className="py-8 text-center text-sm text-muted-foreground">No API keys yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {['Label', 'Key', 'Created', 'Last used', 'Status', ''].map((h) => <th key={h} className="eyebrow px-3 py-2">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2.5 font-medium">
                {k.label}
                {k.scopes?.includes('tm:token') && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">tm:token</span>}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs">{k.key_prefix}…</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmt(k.created_date)}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmt(k.last_used_at)}</td>
              <td className="px-3 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-xs ${k.status === 'active' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                  {k.status === 'active' ? 'Active' : 'Revoked'}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right">
                {k.status === 'active' && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button size="sm" variant="outline" className="text-xs text-destructive">Revoke</Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke "{k.label}"?</AlertDialogTitle>
                        <AlertDialogDescription>Systems using this key will immediately be rejected. This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onRevoke(k.id)}>Revoke key</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}