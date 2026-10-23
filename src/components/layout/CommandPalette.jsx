import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useTenant } from '@/lib/tenantContext';
import { hasPermission } from '@/lib/permissions';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { toAlert, toClient, toKycCase, toReport, toTmCase, toWork } from '@/lib/routes';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Briefcase, FileText, FolderOpen, Inbox, Users, SlidersHorizontal, Activity, Sparkles } from 'lucide-react';

const list = (r) => (Array.isArray(r) ? r : r?.items || []);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Debounced value. */
function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * ⌘K / Ctrl+K: find any customer, KYC case, TM case, alert or FIU report by name or reference, or jump to an action.
 * Every query is tenant-scoped; TM objects only for users who may see them.
 */
export default function CommandPalette({ open: openProp, onOpenChange }) {
  const { currentUser, tenant } = useTenant();
  const navigate = useNavigate();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const tenantId = currentUser?.tenant_id;
  const role = currentUser?.app_role;
  const tmOn = isFeatureEnabled(tenant, 'tm_core') && hasPermission(role, 'tmViewAlerts');
  const fiuOn = tmOn && isFeatureEnabled(tenant, 'tm_fiu');

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(!open); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  useEffect(() => { if (!open) setText(''); }, [open]);

  const results = useQuery({
    queryKey: ['cmdk', tenantId, q, tmOn, fiuOn],
    enabled: open && !!tenantId && q.length >= 2,
    staleTime: 30000,
    queryFn: async () => {
      const rx = { $regex: esc(q), $options: 'i' };
      const safe = (p) => p.then(list).catch(() => []);
      const [clients, alerts, cases, reports] = await Promise.all([
        safe(base44.entities.Client.filter({ tenant_id: tenantId, $or: [{ full_name: rx }, { external_id: rx }, { registration_number: rx }] }, '-updated_date', 8)),
        tmOn ? safe(base44.entities.TmAlert.filter({ tenant_id: tenantId, $or: [{ ref: rx }, { title: rx }] }, '-created_date', 6)) : [],
        tmOn ? safe(base44.entities.TmCase.filter({ tenant_id: tenantId, $or: [{ case_ref: rx }, { title: rx }] }, '-created_date', 6)) : [],
        fiuOn ? safe(base44.entities.FiuReport.filter({ tenant_id: tenantId, report_ref: rx }, '-created_date', 6)) : [],
      ]);
      // KYC cases of the matched customers (cases have no name of their own).
      const ids = clients.map((c) => c.id);
      const kyc = ids.length ? await safe(base44.entities.KycCase.filter({ tenant_id: tenantId, client_id: { $in: ids } }, '-created_date', 8)) : [];
      const nameOf = new Map(clients.map((c) => [c.id, c.full_name]));
      return { clients, alerts, cases, reports, kyc: kyc.map((k) => ({ ...k, client_name: nameOf.get(k.client_id) })) };
    },
  });

  const go = (to) => { setOpen(false); navigate(to); };
  const actions = useMemo(() => [
    tmOn && { label: 'My work', to: toWork(), icon: Inbox },
    tmOn && { label: 'Alerts due within 24 hours', to: '/tm/alerts?filter=soon', icon: AlertTriangle },
    tmOn && { label: 'Data coverage · upload statement', to: '/tm/coverage', icon: Activity },
    tmOn && isFeatureEnabled(tenant, 'tm_rules') && (hasPermission(role, 'tmManageRules') || hasPermission(role, 'tmApproveRules')) && { label: 'Rules · create a rule in plain language', to: '/tm/rules', icon: SlidersHorizontal },
    hasPermission(role, 'createEditClient') && { label: 'New client', to: '/new-client', icon: Users },
    { label: 'My cases', to: '/my-cases', icon: FolderOpen },
  ].filter(Boolean), [tmOn, tenant, role]);

  const r = results.data;
  const needle = text.trim().toLowerCase();
  const shownActions = needle ? actions.filter((a) => a.label.toLowerCase().includes(needle)) : actions;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0">
      <DialogTitle className="sr-only">Search</DialogTitle>
      {/* Results are already filtered on the server: no client-side cmdk filtering. */}
      <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5">
      <CommandInput value={text} onValueChange={setText} placeholder="Search customers, cases, alerts (AL-…), reports (UTR-…)…" />
      <CommandList>
        <CommandEmpty>{q.length < 2 ? 'Type at least 2 characters.' : results.isFetching ? 'Searching…' : 'No results.'}</CommandEmpty>
        {r?.clients?.length > 0 && (
          <CommandGroup heading="Customers">
            {r.clients.map((c) => (
              <CommandItem key={c.id} value={`client ${c.full_name} ${c.external_id || ''} ${c.id}`} onSelect={() => go(toClient(c.id))}>
                <Users className="mr-2 h-4 w-4" />{c.full_name}<span className="ml-2 text-xs text-muted-foreground">{c.client_type}{c.external_id ? ` · ${c.external_id}` : ''}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r?.kyc?.length > 0 && (
          <CommandGroup heading="KYC cases">
            {r.kyc.map((k) => (
              <CommandItem key={k.id} value={`kyc ${k.client_name} ${k.case_type} ${k.id}`} onSelect={() => go(toKycCase(k.id))}>
                <FolderOpen className="mr-2 h-4 w-4" />{k.client_name} · {String(k.case_type || '').replace(/_/g, ' ')}<span className="ml-2 text-xs text-muted-foreground">{String(k.status || '').replace(/_/g, ' ')}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r?.alerts?.length > 0 && (
          <CommandGroup heading="TM alerts">
            {r.alerts.map((a) => (
              <CommandItem key={a.id} value={`alert ${a.ref || ''} ${a.title || ''} ${a.id}`} onSelect={() => go(toAlert(a.id))}>
                <AlertTriangle className="mr-2 h-4 w-4" /><span className="font-mono text-xs mr-2">{a.ref || 'Alert'}</span>{a.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r?.cases?.length > 0 && (
          <CommandGroup heading="TM cases">
            {r.cases.map((c) => (
              <CommandItem key={c.id} value={`case ${c.case_ref || ''} ${c.title || ''} ${c.id}`} onSelect={() => go(toTmCase(c.id))}>
                <Briefcase className="mr-2 h-4 w-4" /><span className="font-mono text-xs mr-2">{c.case_ref}</span>{c.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r?.reports?.length > 0 && (
          <CommandGroup heading="FIU reports">
            {r.reports.map((rp) => (
              <CommandItem key={rp.id} value={`report ${rp.report_ref} ${rp.id}`} onSelect={() => go(toReport(rp.id))}>
                <FileText className="mr-2 h-4 w-4" /><span className="font-mono text-xs mr-2">{rp.report_ref}</span>{String(rp.status || '').replace(/_/g, ' ')}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {shownActions.map((a) => (
            <CommandItem key={a.to + a.label} value={`action ${a.label}`} onSelect={() => go(a.to)}>
              <a.icon className="mr-2 h-4 w-4" />{a.label}
            </CommandItem>
          ))}
          {tmOn && (!needle || 'run ai triage'.includes(needle)) && (
            <CommandItem value="action run ai triage" onSelect={() => go('/tm/alerts')}>
              <Sparkles className="mr-2 h-4 w-4 text-purple-600" />Run AI triage on new alerts<CommandShortcut>Alerts</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
      </Command>
      </DialogContent>
    </Dialog>
  );
}
