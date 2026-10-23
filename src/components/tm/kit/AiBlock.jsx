import React from 'react';
import { Sparkles, HelpCircle } from 'lucide-react';
import SourceChips from './SourceChips';
import { cn } from '@/lib/utils';

/**
 * The one AI surface: purple block with title, body, cited sources, an "insufficient evidence" state and the model.
 * AI prepares, people decide: actions (accept / edit / reject) are passed in as children of `actions`.
 */
export default function AiBlock({
  title = 'AI', children, sources, insufficient = false, missing, model, actions, className, compact = false,
}) {
  return (
    <section className={cn(
      'rounded-xl border border-purple-200 bg-purple-50/60 dark:border-purple-500/30 dark:bg-purple-500/10',
      compact ? 'p-3' : 'p-4', className,
    )}>
      <header className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-purple-800 dark:text-purple-200">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />{title}
        {model && <span className="ml-auto font-normal text-[10px] text-purple-700/70 dark:text-purple-200/70">{model}</span>}
      </header>
      {insufficient && (
        <p className="mb-1.5 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span>Insufficient evidence to conclude{missing?.length ? `: ${missing.join('; ')}` : '.'}</span>
        </p>
      )}
      <div className="text-sm text-foreground">{children}</div>
      {sources?.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-purple-800/70 dark:text-purple-200/70">Sources</span>
          <SourceChips refs={sources} />
        </div>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}
