// Guided conversation outreach: the invitation email. Uses the tenant's EmailTemplate for the situation when there is one,
// else a neutral default (no bank name in code: {tenant_name} comes from the tenant). Pure: no I/O.
import { fillPlaceholders } from './outreachSnapshot.js';

export const INVITE_SITUATION = { NP: 'Conversation_Invite_NP', ORG: 'Conversation_Invite_ORG', RP: 'Conversation_Invite_Related_Party' };

const DEFAULT_SUBJECT = 'Please complete your details for {tenant_name}';
const DEFAULT_BODY = '<p>Hi {first_name},</p><p>{tenant_name} asks you to complete a few details. It takes about {minutes} minutes and your answers are saved automatically, so you can stop and continue later with the same link.</p><p><a href="{link}">Continue</a></p><p>Please respond by {deadline_date}.</p>';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** { subject, body } for the invitation. templates: the tenant's EmailTemplate rows. vars: first_name, tenant_name, link, deadline_date, minutes. */
export function inviteEmail({ templates = [], clientType = 'NP', vars = {} }) {
  const situation = INVITE_SITUATION[clientType] || INVITE_SITUATION.NP;
  const t = templates.find((x) => x.situation === situation && x.is_active !== false);
  const safe = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, k === 'link' ? v : esc(v)]));
  const subject = fillPlaceholders(t?.subject || DEFAULT_SUBJECT, vars);
  let body = String(t?.body_html || DEFAULT_BODY);
  body = body.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, k) => (safe[k] === undefined ? '' : String(safe[k])));
  if (!body.includes(vars.link)) body += `<p><a href="${vars.link}">${esc(vars.link)}</a></p>`;
  return { subject, body, situation, from_template: !!t };
}
