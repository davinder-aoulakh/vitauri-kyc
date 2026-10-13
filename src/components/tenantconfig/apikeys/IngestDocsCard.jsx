import React from 'react';

export const INGEST_URL = 'https://vitauri-kyc.base44.app/functions/ingestTransactions';

const EXAMPLE = {
  batch_ref: 'core-banking-2026-10-13',
  transactions: [
    {
      external_id: 'TX-100234',
      client_id: '<client id in your tenant>',
      account: 'CW11TEST0001',
      lifecycle: 'booked',
      executed_at: '2026-10-12T10:15:00Z',
      direction: 'inbound',
      amount: 2500,
      currency: 'USD',
      description: 'SALARY OCT ACME BV',
      counterparty: { name: 'Acme BV', account: 'NL91ABNA0417164300', country: 'NL' },
    },
    {
      external_id: 'TX-100235',
      client_id: '<client id in your tenant>',
      account: 'CW11TEST0001',
      lifecycle: 'intended',
      intended_at: '2026-10-13T08:00:00Z',
      direction: 'outbound',
      amount: 900,
      currency: 'USD',
      description: 'Pending wire',
      counterparty: { name: 'John Smith', country: 'GB' },
    },
  ],
};

export default function IngestDocsCard() {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">Ingest endpoint</h3>
      <div>
        <div className="eyebrow mb-1">POST</div>
        <code className="block break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">{INGEST_URL}</code>
      </div>
      <p className="text-xs text-muted-foreground">
        Send <code className="font-mono">Authorization: Bearer &lt;your key&gt;</code> and a JSON body with up to 1,000 transactions.
        Limit: 60 valid requests per minute per key. Returns <code className="font-mono">202</code> with <code className="font-mono">batch_id</code>, <code className="font-mono">accepted</code>, <code className="font-mono">duplicates</code> and <code className="font-mono">rejected</code>.
        Executed items older than 7 days are marked historical; <code className="font-mono">intended</code> items are not.
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(EXAMPLE, null, 2)}</pre>
    </div>
  );
}