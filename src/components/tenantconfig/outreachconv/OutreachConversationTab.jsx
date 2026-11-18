import React from 'react';
import { useOutreachConfig } from './useOutreachConfig';
import BlocksTab from './BlocksTab';
import TemplatesTab from './TemplatesTab';

/** Guided conversation view of the outreach tabs in Tenant Config. view: 'blocks' (Outreach Templates) or 'templates' (Form Templates). */
export default function OutreachConversationTab({ view }) {
  const cfg = useOutreachConfig();
  return view === 'templates' ? <TemplatesTab cfg={cfg} /> : <BlocksTab cfg={cfg} />;
}
