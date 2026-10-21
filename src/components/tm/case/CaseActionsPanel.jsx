import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Banknote, ScanFace, Network, ClipboardCheck, Loader2 } from 'lucide-react';
import RequestInfoDialog from '@/components/tm/case/RequestInfoDialog';
import ReverifyDialog from '@/components/tm/case/ReverifyDialog';
import EdrStatusPill from '@/components/tm/case/EdrStatusPill';

const OPEN = ['open', 'investigating', 'pending_co'];

export default function CaseActionsPanel({ tmCase, client, tenant, tenantId, canWork, fiuLocked, run, busy }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState('');
  const open = OPEN.includes(tmCase.status);
  const lockReason = client?.tipping_off_lock ? 'Blocked: tipping-off lock is active for this client.' : fiuLocked ? 'Locked: an FIU report is being prepared.' : '';
  const requestsOff = !canWork || !open || !!lockReason;

  const network = async () => {
    const res = await run('open_network_case', {}, { success: 'Network case opened', fail: 'Could not open network case' });
    if (res?.network_case_id) navigate(`/tm/case/${res.network_case_id}`);
  };
  const edr = async () => {
    const res = await run('open_edr', {}, { success: 'Event-driven review opened', fail: 'Could not open review' });
    if (res?.kyc_case_id) navigate(`/case/${res.kyc_case_id}`);
  };

  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-sm font-semibold mb-3">Actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="justify-start gap-2" disabled={requestsOff} onClick={() => setDialog('request')}><Banknote className="w-4 h-4" /> Request source of funds</Button>
        <Button variant="outline" size="sm" className="justify-start gap-2" disabled={requestsOff} onClick={() => setDialog('idv')}><ScanFace className="w-4 h-4" /> Re-verify identity (Didit)</Button>
        <Button variant="outline" size="sm" className="justify-start gap-2" disabled={!canWork || !open || !!busy} onClick={network}>
          {busy === 'open_network_case' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />} Open network case
        </Button>
        <Button variant="outline" size="sm" className="justify-start gap-2" disabled={!canWork || !open || !!busy || !!tmCase.kyc_edr_case_id} onClick={edr}>
          {busy === 'open_edr' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />} {tmCase.kyc_edr_case_id ? 'Review already open' : 'Open event-driven review'}
        </Button>
      </div>
      {lockReason && <p className="text-xs text-amber-700 mt-2">{lockReason}</p>}
      {tmCase.kyc_edr_case_id && (
        <div className="flex items-center gap-2 mt-2">
          <button className="text-xs text-primary hover:underline" onClick={() => navigate(`/case/${tmCase.kyc_edr_case_id}`)}>Open the event-driven review</button>
          <EdrStatusPill kycCaseId={tmCase.kyc_edr_case_id} />
        </div>
      )}
      <RequestInfoDialog open={dialog === 'request'} onOpenChange={(v) => !v && setDialog('')} run={run} client={client} tenant={tenant} />
      <ReverifyDialog open={dialog === 'idv'} onOpenChange={(v) => !v && setDialog('')} run={run} client={client} tenantId={tenantId} />
    </section>
  );
}