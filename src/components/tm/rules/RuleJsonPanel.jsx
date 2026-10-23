import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import InlineError from '@/components/shared/InlineError';
import { prettyJson } from '@/lib/tmRules';
import { Loader2 } from 'lucide-react';
import RuleSentence from '@/components/tm/rules/RuleSentence';

/** Read-only generated Didit rule, with an advanced mode to edit the JSON. The server validates every save. */
export default function RuleJsonPanel({ rule, canEdit, busy, onSave }) {
  const [advanced, setAdvanced] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [text, setText] = useState(prettyJson(rule.definition));
  const [error, setError] = useState('');
  useEffect(() => { setText(prettyJson(rule.definition)); setAdvanced(false); setError(''); }, [rule.id, rule.updated_date]);

  const save = async () => {
    let parsed;
    try { parsed = JSON.parse(text); } catch { setError('This is not valid JSON. Check commas and quotes.'); return; }
    setError('');
    if (await onSave(parsed) === false) setError('The rule was not saved. See the message above for what to fix.');
    else setAdvanced(false);
  };

  return (
    <section className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold">What this rule does</h2>
        <div className="flex items-center gap-3">
          {!advanced && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowJson(!showJson)}>{showJson ? 'Hide JSON' : 'Show JSON'}</button>}
          {canEdit && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Cancel editing' : 'Advanced: edit JSON'}</button>}
        </div>
      </div>
      {advanced ? (
        <div className="space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="font-mono text-xs min-h-80" aria-label="Rule JSON" />
          {error && <InlineError message={error} />}
          <Button size="sm" disabled={!!busy} onClick={save}>{busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Validate and save</Button>
        </div>
      ) : (
        <>
          <RuleSentence definition={rule.definition} className="text-sm text-foreground bg-secondary/60 rounded-lg px-3 py-2.5" />
          {showJson && <pre className="mt-2 font-mono text-xs bg-secondary rounded-lg p-3 overflow-auto max-h-96 whitespace-pre-wrap break-words">{prettyJson(rule.definition)}</pre>}
        </>
      )}
      <p className="text-xs text-muted-foreground mt-2">Thresholds are illustrative; field names follow Didit docs.</p>
    </section>
  );
}