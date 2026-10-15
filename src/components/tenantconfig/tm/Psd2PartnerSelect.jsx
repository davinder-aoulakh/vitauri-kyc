import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Psd2PartnerSelect({ value, onChange }) {
  return (
    <div className="max-w-md space-y-1.5">
      <Label className="text-xs block">PSD2 partner</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">None (manual)</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Vitauri does not act as an account information service provider (AISP). Pulling bank data through PSD2 requires a licensed partner; until one is configured, accounts are fed by API or statement upload.
      </p>
    </div>
  );
}