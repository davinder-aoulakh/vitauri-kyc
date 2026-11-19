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
import Upload from './Upload';
import PeopleList from './PeopleList';
import OwnersBuilder from './OwnersBuilder';
import RegistrySearch from './RegistrySearch';

/** The widget for the server's current step (spec 5.2). Widgets of later phases (ORG) are not rendered yet. */
export default function Widget({ step, view, busy, onAnswer, onEdit, onIdv, onUpload, onRegistry }) {
  const p = { step, busy, onAnswer };
  switch (step.widget) {
    case 'chips': return <Chips {...p} />;
    case 'multi': return <Multi {...p} />;
    case 'text': case 'area': return <TextAnswer {...p} />;
    case 'phone': return <Phone {...p} codes={view.phone_codes} />;
    case 'address': return <Address {...p} countries={view.address_countries} />;
    case 'confirm_facts': return <ConfirmFacts {...p} />;
    case 'form': return <FormFields {...p} />;
    case 'people_list': return <PeopleList {...p} />;
    case 'owners_builder': return <OwnersBuilder {...p} />;
    case 'registry_search': return <RegistrySearch {...p} onRegistry={onRegistry} />;
    case 'review': return <Review {...p} onEdit={onEdit} />;
    case 'sign': return <Sign {...p} />;
    case 'idv': return <Idv {...p} onIdv={onIdv} />;
    case 'upload': return <Upload {...p} onUpload={onUpload} />;
    case 'wait': return <div className="oc-widget"><p className="oc-small oc-wait" role="status"><span className="oc-typing" aria-hidden="true"><span /><span /><span /></span></p></div>;
    default: return null;
  }
}
