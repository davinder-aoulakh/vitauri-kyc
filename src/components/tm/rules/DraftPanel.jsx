import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';

/** Purple "describe the rule" box. Creates a new draft rule from plain language. */
export default function DraftPanel({ initialText, scenario, busy, onSubmit }) {
  const [text, setText] = useState(initialText || '');
  useEffect(() => { setText(initialText || ''); }, [initialText]);
  const ok = text.trim().length >= 10;
  return (
    <section className="rounded-xl border border-purple-200 bg-purple-50 p-4 mb-5">
      <h2 className="text-sm font-semibold text-purple-800 mb-1">✦ Describe the rule in plain language</h2>
      <p className="text-xs text-purple-700 mb-3">
        {scenario ? `Starting from ${scenario.code} · ${scenario.name}. ` : ''}The assistant drafts a Didit rule. It is validated, saved as a draft and not sent anywhere.
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSubmit(text.trim()); }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} className="bg-white" aria-label="Describe the rule"
          placeholder="e.g. 5 or more different senders paying 4,000 to 9,999 into one account within 7 days" />
        <Button type="submit" disabled={!ok || !!busy} className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5 shrink-0">
          {busy === 'draftRuleFromText' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Turn into rule
        </Button>
      </form>
    </section>
  );
}