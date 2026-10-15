import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Vitauri Ops only. Points the regression harness at a REAL, completed Didit session on the Demo tenant.
export default function RegressionRefFields({ sessionId, outreachId, itemId, onChange }) {
  return (
    <div className="border border-dashed border-border rounded-lg p-4 space-y-3 max-w-2xl">
      <div>
        <div className="text-sm font-medium">Regression harness: real Didit session</div>
        <div className="text-xs text-muted-foreground">Used by the "real session" regression fixtures. Must be a completed session on this Demo tenant. Leave empty to skip those fixtures.</div>
      </div>
      <div>
        <Label className="text-xs mb-1.5 block">regression_session_id</Label>
        <Input value={sessionId} onChange={(e) => onChange({ sessionId: e.target.value })} className="h-9 text-sm font-mono" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs mb-1.5 block">regression_outreach_ref: outreach_id</Label>
          <Input value={outreachId} onChange={(e) => onChange({ outreachId: e.target.value })} className="h-9 text-sm font-mono" />
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">regression_outreach_ref: item_id</Label>
          <Input value={itemId} onChange={(e) => onChange({ itemId: e.target.value })} className="h-9 text-sm font-mono" />
        </div>
      </div>
    </div>
  );
}