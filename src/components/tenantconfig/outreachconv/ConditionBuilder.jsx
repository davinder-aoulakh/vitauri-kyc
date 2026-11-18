import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-react';
import { describeCondition, validateCondition } from '@/lib/outreachConditions';

// Condition builder for show_if and follow-up `when` (spec 5.4): pick a block, an operator and a value; nest with all / any / not.
const OPS = [
  ['answer_includes', 'answer includes'], ['answer_equals', 'answer is'], ['risk_in', 'risk class is'], ['legal_form_kind', 'legal form is'],
  ['route', 'route is'], ['document_check_failed', 'document check failed'], ['calculated', 'calculation'], ['all', 'all of'], ['any', 'any of'], ['not', 'not'],
];
const opOf = (c) => (c && typeof c === 'object' ? Object.keys(c)[0] : null);
const sel = 'h-8 rounded-md border border-border bg-background px-2 text-xs';

function blank(op) {
  switch (op) {
    case 'answer_includes': case 'answer_equals': return { [op]: { block: '', value: '' } };
    case 'risk_in': return { risk_in: ['high'] };
    case 'legal_form_kind': return { legal_form_kind: 'company' };
    case 'route': return { route: 'nl' };
    case 'all': case 'any': return { [op]: [] };
    case 'not': return { not: { route: 'nl' } };
    default: return { [op]: '' };
  }
}

function Node({ cond, onChange, onRemove, blocks, depth }) {
  const op = opOf(cond);
  const arg = op ? cond[op] : null;
  const set = (v) => onChange({ [op]: v });
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-2" style={{ marginLeft: depth ? 12 : 0 }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label="Operator" className={sel} value={op || ''} onChange={(e) => onChange(blank(e.target.value))}>
          {OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {(op === 'answer_includes' || op === 'answer_equals') && (
          <>
            <select aria-label="Block" className={sel} value={arg?.block || ''} onChange={(e) => set({ ...arg, block: e.target.value })}>
              <option value="">Block…</option>
              {blocks.map((b) => <option key={b.key} value={b.key}>{b.key} · {b.label}</option>)}
            </select>
            {(blocks.find((b) => b.key === arg?.block)?.options || []).length ? (
              <select aria-label="Value" className={sel} value={arg?.value || ''} onChange={(e) => set({ ...arg, value: e.target.value })}>
                <option value="">Value…</option>
                {blocks.find((b) => b.key === arg.block).options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : <Input aria-label="Value" className="h-8 w-48 text-xs" value={arg?.value || ''} onChange={(e) => set({ ...arg, value: e.target.value })} placeholder="Value" />}
          </>
        )}
        {op === 'risk_in' && ['low', 'medium', 'high'].map((r) => (
          <label key={r} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={(arg || []).includes(r)} onChange={(e) => set(e.target.checked ? [...new Set([...(arg || []), r])] : (arg || []).filter((x) => x !== r))} /> {r}
          </label>
        ))}
        {op === 'legal_form_kind' && <select aria-label="Legal form kind" className={sel} value={arg} onChange={(e) => set(e.target.value)}>{['company', 'partnership', 'sole'].map((x) => <option key={x}>{x}</option>)}</select>}
        {op === 'route' && <select aria-label="Route" className={sel} value={arg} onChange={(e) => set(e.target.value)}>{['nl', 'document'].map((x) => <option key={x}>{x}</option>)}</select>}
        {(op === 'document_check_failed' || op === 'calculated') && <Input aria-label="Value" className="h-8 w-64 text-xs" value={arg || ''} onChange={(e) => set(e.target.value)} placeholder={op === 'calculated' ? 'e.g. no owner reaches threshold' : 'Check name'} />}
        {onRemove && <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label="Remove condition" onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>}
      </div>
      {(op === 'all' || op === 'any') && (
        <div className="space-y-1.5">
          {(arg || []).map((c, i) => (
            <Node key={i} cond={c} blocks={blocks} depth={depth + 1}
              onChange={(n) => set(arg.map((x, j) => (j === i ? n : x)))} onRemove={() => set(arg.filter((_, j) => j !== i))} />
          ))}
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => set([...(arg || []), blank('answer_includes')])}><Plus className="h-3 w-3" /> Add condition</Button>
        </div>
      )}
      {op === 'not' && <Node cond={arg} blocks={blocks} depth={depth + 1} onChange={(n) => set(n)} />}
    </div>
  );
}

/** value: condition or null (always). onChange(condition | null). blocks: [{ key, label, options }]. */
export default function ConditionBuilder({ value, onChange, blocks = [], label = 'Show if' }) {
  const problems = validateCondition(value, blocks.map((b) => b.key));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium">
        {label}
        {value ? <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onChange(null)}>Always (remove)</Button>
          : <Button type="button" size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => onChange(blank('answer_includes'))}><Plus className="h-3 w-3" /> Add a condition</Button>}
      </div>
      {value && <Node cond={value} blocks={blocks} depth={0} onChange={onChange} />}
      <p className="text-[11px] text-muted-foreground">Reads as: <span className="text-foreground">{describeCondition(value)}</span></p>
      {problems.length > 0 && <p className="text-[11px] text-red-700">{problems.join(' · ')}</p>}
    </div>
  );
}
