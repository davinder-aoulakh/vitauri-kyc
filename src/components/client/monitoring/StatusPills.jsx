import React from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  ok: 'bg-green-100 text-green-700 border-green-200',
  warn: 'bg-amber-100 text-amber-700 border-amber-200',
  bad: 'bg-red-100 text-red-700 border-red-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
};

function Pill({ label, value, tone }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', TONES[tone])}>
      <span className="opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export default function StatusPills({ pills }) {
  const screening = {
    clear: ['Clear', 'ok'],
    potential: ['Potential match', 'warn'],
    confirmed: ['Confirmed match', 'bad'],
  }[pills.screening] || ['Clear', 'ok'];
  return (
    <div className="flex flex-wrap gap-2">
      <Pill label="KYC" value={String(pills.kyc_status || '—').replace(/_/g, ' ')} tone="neutral" />
      <Pill label="ID verified" value={pills.idv_verified ? 'Yes (Didit)' : 'No'} tone={pills.idv_verified ? 'ok' : 'warn'} />
      <Pill label="PEP / sanctions" value={screening[0]} tone={screening[1]} />
      <Pill label="Ongoing screening" value={pills.ongoing_screening ? 'On' : 'Off'} tone={pills.ongoing_screening ? 'ok' : 'neutral'} />
    </div>
  );
}