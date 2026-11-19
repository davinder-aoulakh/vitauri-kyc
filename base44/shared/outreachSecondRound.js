// Guided conversation outreach, phase 9: second round, composer, reminders and the emails that go with them
// (spec 5.6, 5.7). Pure: no I/O. Texts come from MESSAGES or the tenant's EmailTemplate rows; no bank name in code.
import { MESSAGES } from './outreachMessages.js';
import { fillPlaceholders } from './outreachSnapshot.js';

export const SITUATIONS = {
  NP: 'Conversation_Invite_NP', ORG: 'Conversation_Invite_ORG', RP: 'Conversation_Invite_Related_Party',
  NEW_MESSAGE: 'Conversation_New_Message', REMINDER: 'Conversation_Reminder',
};

// Staff role → the label the client sees next to the analyst's name ("Sanne de Vries, Compliance analyst").
const ROLE_LABELS = {
  Analyst: 'Compliance analyst', 'QC Reviewer': 'Quality reviewer', 'Compliance Officer': 'Compliance officer',
  'Compliance Admin': 'Compliance', Manager: 'Compliance manager', Director: 'Director', 'Tenant Admin': 'Compliance',
  'Vitauri Ops': 'Support',
};
export const roleLabel = (role) => ROLE_LABELS[role] || 'Compliance';
export const analystTag = (name, role) => `${String(name || 'A colleague').trim()}, ${roleLabel(role)}`;

/** Thread messages when an analyst asks something after (or before) submission: system line + analyst message. */
export function analystRequestMessages({ name, role, text, request_type = 'document', open_request_id }) {
  return [
    { author_type: 'system', kind: 'system_line', text: MESSAGES.newMessageLine },
    {
      author_type: 'analyst', author_name: String(name || ''), kind: 'message', tag: analystTag(name, role), text: String(text || '').trim(),
      payload: { open_request_id, request_type, widget: request_type === 'document' ? 'upload' : 'text' },
    },
  ];
}

/** The analyst's confirmation after the client answered an open request (spec 5.7, transcript A). */
export function answeredMessage({ name, role }) {
  return { author_type: 'analyst', author_name: String(name || ''), kind: 'message', tag: analystTag(name, role), text: MESSAGES.analystReceived };
}

/** A client message typed in the composer and the automatic reply (AT 35). */
export function clientMessageMessages(text) {
  return [
    { author_type: 'client', kind: 'message', text: String(text || '').trim() },
    { author_type: 'bank', kind: 'message', tag: MESSAGES.autoReplyTag, text: MESSAGES.autoReply },
  ];
}

export const COMPOSER_MAX = 2000;
/** Validates a composer text: returns the cleaned text or throws a 400-style error. */
export function cleanMessage(text) {
  const t = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!t) throw Object.assign(new Error(MESSAGES.required), { status: 400 });
  if (t.length > COMPOSER_MAX) throw Object.assign(new Error(`Please keep your message under ${COMPOSER_MAX} characters.`), { status: 400 });
  return t;
}

const DAY = 86400000;
const OPEN_STATUSES = ['Sent', 'Opened', 'In_Progress'];

/**
 * Which reminder is due now. Reminders go "at the configured days before the deadline" (spec 5.6): for each value d in
 * reminderDays, once, when now >= deadline - d days and the deadline has not passed. Only the closest due value is sent
 * (a sweep that missed several days sends one email, and marks the earlier values as sent). Returns
 * { due: number|null, mark: number[] } where mark lists every value to record in reminders_sent.
 */
export function remindersDue({ conversation, reminderDays = [], now = new Date() }) {
  const c = conversation || {};
  if (!OPEN_STATUSES.includes(c.status) || !c.deadline) return { due: null, mark: [] };
  const deadline = new Date(c.deadline).getTime();
  const t = new Date(now).getTime();
  if (!Number.isFinite(deadline) || t >= deadline) return { due: null, mark: [] };
  const sent = new Set((c.reminders_sent || []).map(Number));
  const reached = [...new Set(reminderDays.map(Number))].filter((d) => d > 0 && t >= deadline - d * DAY && !sent.has(d));
  if (!reached.length) return { due: null, mark: [] };
  return { due: Math.min(...reached), mark: reached.sort((a, b) => b - a) };
}

/** The link has passed token_expires_at and the conversation is still open → it becomes Expired. */
export function linkExpired(conversation, now = new Date()) {
  const c = conversation || {};
  if (!OPEN_STATUSES.includes(c.status) || !c.token_expires_at) return false;
  return new Date(now).getTime() > new Date(c.token_expires_at).getTime();
}

/** A held AI follow-up (Medium/High) waited longer than aiApprovalWaitMinutes → the default text goes out (decision 12). */
export function followUpTimedOut(queueEntry, waitMinutes, now = new Date()) {
  if (!queueEntry?.held || !queueEntry.held_since) return false;
  return new Date(now).getTime() - new Date(queueEntry.held_since).getTime() >= Number(waitMinutes || 60) * 60000;
}

// ---- Emails ---------------------------------------------------------------------------------------------------
// First name and company name only in the body (plan phase 9): never answers, risk or case data.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const DEFAULT_EMAILS = {
  [SITUATIONS.NP]: { name: 'Guided conversation: invitation (person)', subject: 'Please complete your details for {tenant_name}', body_html: '<p>Hi {first_name},</p><p>{tenant_name} asks you to complete a few details. It takes about {minutes} minutes and your answers are saved automatically, so you can stop and continue later with the same link.</p><p><a href="{link}">Continue</a></p><p>Please respond by {deadline_date}.</p>' },
  [SITUATIONS.ORG]: { name: 'Guided conversation: invitation (organisation)', subject: 'Please complete the details of {company} for {tenant_name}', body_html: '<p>Hi {first_name},</p><p>{tenant_name} asks you to complete a few details about {company}. Your answers are saved automatically, so you can stop and continue later with the same link.</p><p><a href="{link}">Continue</a></p><p>Please respond by {deadline_date}.</p>' },
  [SITUATIONS.RP]: { name: 'Guided conversation: invitation (related party)', subject: 'Please complete your own checks for {company}', body_html: '<p>Hi {first_name},</p><p>{tenant_name} asks you to complete a short identity check as part of the application of {company}.</p><p><a href="{link}">Continue</a></p><p>Please respond by {deadline_date}.</p>' },
  [SITUATIONS.NEW_MESSAGE]: { name: 'Guided conversation: new message', subject: 'You have a new message from {tenant_name}', body_html: '<p>Hi {first_name},</p><p>A colleague at {tenant_name} has sent you a message in your conversation. Please open it to read and reply.</p><p><a href="{link}">Open the conversation</a></p>' },
  [SITUATIONS.REMINDER]: { name: 'Guided conversation: reminder', subject: 'Reminder: please complete your details for {tenant_name}', body_html: '<p>Hi {first_name},</p><p>This is a friendly reminder that {tenant_name} is still waiting for a few details. Your earlier answers are saved; you can continue where you left off.</p><p><a href="{link}">Continue</a></p><p>Please respond by {deadline_date}.</p>' },
};
const NO_LINK = '<p>Please use the link in the invitation email you received earlier.</p>';

/**
 * { subject, body, situation, from_template } for any conversation email. vars: first_name, company, tenant_name, link
 * (may be empty: older conversations have no stored link), deadline_date, minutes.
 */
export function conversationEmail({ templates = [], situation, vars = {} }) {
  const t = templates.find((x) => x.situation === situation && x.is_active !== false);
  const def = DEFAULT_EMAILS[situation] || DEFAULT_EMAILS[SITUATIONS.NEW_MESSAGE];
  const link = String(vars.link || '');
  const v = { ...vars, link };
  const safe = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'link' ? x : esc(x)]));
  const subject = fillPlaceholders(t?.subject || def.subject, v).replace(/\s+for\s*$/, '').trim();
  let body = String(t?.body_html || def.body_html);
  if (!link) body = body.replace(/<p>\s*<a href="\{link\}">[^<]*<\/a>\s*<\/p>/g, NO_LINK).replace(/<a href="\{link\}">([^<]*)<\/a>/g, '$1');
  body = body.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, k) => (safe[k] === undefined ? '' : String(safe[k])));
  if (link && !body.includes(link)) body += `<p><a href="${link}">${esc(link)}</a></p>`;
  if (!link && !body.includes(NO_LINK)) body += NO_LINK;
  return { subject, body, situation, from_template: !!t };
}

/** EmailTemplate rows to seed for a tenant: the five conversation situations that are not there yet. */
export function emailTemplatesToSeed(existing = [], tenantId) {
  const have = new Set(existing.map((x) => x.situation));
  return Object.entries(DEFAULT_EMAILS).filter(([s]) => !have.has(s)).map(([situation, d]) => ({
    tenant_id: tenantId, situation, name: d.name, subject: d.subject, body_html: d.body_html, is_active: true,
  }));
}
