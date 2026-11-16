// A page made of existing pages shown as tabs (KYC Dashboard, AML Dashboard). The inner pages keep their own header,
// data loading and permission checks; only the app shell is drawn once, here. The tab is kept in ?tab=.
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import EmptyState from '@/components/shared/EmptyState';
import { EmbeddedContext } from '@/lib/embedded';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TabbedPage({ title, tabs }) {
  const [params, setParams] = useSearchParams();
  const visible = tabs.filter((t) => t.show !== false);
  const active = visible.find((t) => t.id === params.get('tab')) || visible[0];
  const select = (id) => {
    const next = new URLSearchParams(params);
    if (id === visible[0]?.id) next.delete('tab'); else next.set('tab', id);
    setParams(next, { replace: true });
  };
  if (!active) {
    return <AppShell><EmptyState icon={Lock} title="Not available" description={`Nothing on the ${title} is available for your role.`} /></AppShell>;
  }
  return (
    <AppShell>
      {/* The title is a heading on its own line, so it cannot be mistaken for a tab. */}
      <div className="border-b border-border bg-card px-4 md:px-6 pt-4">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <div role="tablist" aria-label={title} className="mt-2 flex flex-wrap gap-1">
          {visible.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === active.id} onClick={() => select(t.id)}
              className={cn('px-3 pb-2.5 pt-1 text-sm border-b-2 -mb-px transition-colors',
                t.id === active.id ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <EmbeddedContext.Provider value>
        <div key={active.id}>{active.render()}</div>
      </EmbeddedContext.Provider>
    </AppShell>
  );
}
