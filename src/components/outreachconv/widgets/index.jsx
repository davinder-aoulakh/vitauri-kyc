import React from 'react';
import Chips from './Chips';
import Multi from './Multi';
import TextAnswer from './TextAnswer';
import Phone from './Phone';
import Address from './Address';
import ConfirmFacts from './ConfirmFacts';
import FormFields from './FormFields';
import Review from './Review';
import Sign from './Sign';
import Idv from './Idv';
import UploadStub from './UploadStub';

/** The widget for the server's current step (spec 5.2). Widgets of later phases (ORG) are not rendered yet. */
export default function Widget({ step, view, busy, onAnswer, onEdit, onIdv }) {
  const p = { step, busy, onAnswer };
  switch (step.widget) {
    case 'chips': return <Chips {...p} />;
    case 'multi': return <Multi {...p} />;
    case 'text': case 'area': return <TextAnswer {...p} />;
    case 'phone': return <Phone {...p} codes={view.phone_codes} />;
    case 'address': return <Address {...p} countries={view.address_countries} />;
    case 'confirm_facts': return <ConfirmFacts {...p} />;
    case 'form': return <FormFields {...p} />;
    case 'review': return <Review {...p} onEdit={onEdit} />;
    case 'sign': return <Sign {...p} />;
    case 'idv': return <Idv {...p} onIdv={onIdv} />;
    case 'upload': return <UploadStub {...p} />;
    default: return null;
  }
}
