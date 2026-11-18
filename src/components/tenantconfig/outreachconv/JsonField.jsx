import React, { useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { toJsonText, fromJsonText } from '@/lib/outreachConfigView';

/**
 * A structured block field edited as JSON. Reports its parsed value (or an error) to the parent. The text is only replaced
 * from outside when the value changes for another reason than this field's own typing (e.g. another block opened).
 */
export default function JsonField({ label, hint, value, kind = 'object', onChange, rows = 5 }) {
  const [text, setText] = useState(toJsonText(value));
  const [error, setError] = useState('');
  const own = useRef(JSON.stringify(value ?? null));
  useEffect(() => {
    const v = JSON.stringify(value ?? null);
    if (v !== own.current) { own.current = v; setText(toJsonText(value)); setError(''); }
  }, [value]);
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{label}</label>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <Textarea rows={rows} className="font-mono text-[11px]" value={text} spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const r = fromJsonText(e.target.value, { kind });
          setError(r.error || '');
          if (!r.error) own.current = JSON.stringify(r.value ?? null);
          onChange(r.error ? { error: r.error } : { value: r.value });
        }} />
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
