import React, { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { amlHit } from '@/lib/diditReadable';
import { Rows } from './DiditDecisionView';

/** A screening hit's provider details (Didit AML) in readable sections, with source links. */
export default function AmlHitView({ details }) {
  const view = useMemo(() => amlHit(details), [details]);
  if (!view.sections.length && !view.sources.length) return <p className="text-xs text-muted-foreground">No further details from the provider.</p>;
  return (
    <div className="space-y-2">
      {view.sections.map((s) => (
        <section key={s.title} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</h4>
          <Rows rows={s.rows} />
        </section>
      ))}
      {view.sources.length > 0 && (
        <section className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sources</h4>
          <ul className="space-y-0.5 text-xs">
            {view.sources.slice(0, 10).map((s, i) => (
              <li key={i}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">{s.label}<ExternalLink className="h-3 w-3" /></a>
                ) : s.label}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
