import React from 'react';
import { Input } from '@/components/ui/input';
import CountrySelect from '@/components/shared/CountrySelect';

// Structured address for the client portal — same parts as the KYC tool (AddressFields):
// country, street + number, zipcode + city. value: { country, street, number, zipcode, city }
const T = {
  en: { country: 'Country', street: 'Street', number: 'Number', zipcode: 'Postcode', city: 'City' },
  nl: { country: 'Land', street: 'Straat', number: 'Huisnummer', zipcode: 'Postcode', city: 'Plaats' },
};

export default function PortalAddressInput({ value, onChange, language = 'en', borderColor }) {
  const a = value || {};
  const t = T[language] || T.en;
  const set = (k, v) => onChange({ ...a, [k]: v });
  const style = borderColor ? { borderColor } : undefined;
  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs mb-1 opacity-70">{t.country}</div>
        <CountrySelect value={a.country || ''} onChange={(v) => set('country', v)} placeholder={t.country} className="rounded-xl" includeOther={false} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <div className="text-xs mb-1 opacity-70">{t.street}</div>
          <Input value={a.street || ''} onChange={(e) => set('street', e.target.value)} className="text-sm rounded-xl" style={style} />
        </div>
        <div>
          <div className="text-xs mb-1 opacity-70">{t.number}</div>
          <Input value={a.number || ''} onChange={(e) => set('number', e.target.value)} className="text-sm rounded-xl" style={style} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="text-xs mb-1 opacity-70">{t.zipcode}</div>
          <Input value={a.zipcode || ''} onChange={(e) => set('zipcode', e.target.value)} className="text-sm rounded-xl" style={style} />
        </div>
        <div className="col-span-2">
          <div className="text-xs mb-1 opacity-70">{t.city}</div>
          <Input value={a.city || ''} onChange={(e) => set('city', e.target.value)} className="text-sm rounded-xl" style={style} />
        </div>
      </div>
    </div>
  );
}

/** Enough to count as answered: street, city and country. */
export const isAddressComplete = (a) => !!(a && String(a.street || '').trim() && String(a.city || '').trim() && String(a.country || '').trim());
