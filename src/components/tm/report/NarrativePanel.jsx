import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { citationLink, citationLabel } from '@/lib/fiuReport';

export default function NarrativePanel({ report, editable, editing, busy, onSave }) {
  const text = report.narrative?.text || '';
  const [draft, setDraft] = useState(text);
  const cites = report.narrative?.citations || [];
  const paragraphs = text.split('\n\n');
  return (
    <section className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-sm font-semibold mb-2">Reason for reporting</h2>
      {editable && editing ? (
        <div className="space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-48 text-sm" aria-label="Reason for reporting" />
          <Button size="sm" disabled={busy || draft === text} onClick={() => onSave('narrative', draft)}>Save narrative</Button>
        </div>
      ) : (
        <div className="text-sm space-y-3">
          {!text && <p className="text-muted-foreground">No narrative yet.</p>}
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {p}
              {i === 0 && cites.map((c, n) => (
                <sup key={c} className="ml-0.5"><Link to={citationLink(c, report)} title={citationLabel(c, report)} className="text-primary hover:underline">[{n + 1}]</Link></sup>
              ))}
            </p>
          ))}
        </div>
      )}
      {cites.length > 0 && (
        <ol className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground space-y-0.5 list-none">
          {cites.map((c, n) => <li key={c}>[{n + 1}] <Link to={citationLink(c, report)} className="hover:underline">{citationLabel(c, report)}</Link></li>)}
        </ol>
      )}
    </section>
  );
}