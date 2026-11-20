// Guided conversation outreach, phase 10: the backstage view of one conversation (spec section 11, seven parts).
// Pure: the staff function loads the rows and passes them in. No personal data beyond what the case already shows staff.
import { describeCondition } from './outreachConditions.js';

const STATE_LABEL = { answered: 'answered', asked: 'now', not_asked: 'not yet', skipped: 'skipped', off: 'off', declined: 'not yet' };
export const SOURCE_TONE = { idv: 'green', doc: 'green', kvk: 'green', didit_reg: 'green', ai: 'indigo' };
export const sourceTone = (s) => SOURCE_TONE[s] || 'neutral';

const fuText = (f) => {
  const when = f.trigger ? describeCondition(f.trigger) : f.when ? describeCondition(f.when) : '';
  const what = f.action || f.type || 'follow-up';
  return `${what}${when ? ` when ${when}` : ''}`;
};

/** 1. Template card: setting / value rows. */
export function templateCard({ conversation, settings = {} }) {
  const t = conversation.template_snapshot || {};
  const isOrg = conversation.client_type === 'ORG';
  const rows = [
    ['Template', `${t.name || conversation.template_key || ''} (v${conversation.template_version || t.version || 1})`],
    ['Client type', conversation.client_type || t.client_type || ''],
    ['Case types', (t.case_types || []).join(', ') || 'all'],
    ['Channel', t.channel || 'Email link'],
    ['Deadline', conversation.deadline ? String(conversation.deadline).slice(0, 10) : `${t.default_deadline_days || settings.defaultDeadlineDays || 14} days`],
    ['Presentation', 'Guided conversation (one question at a time)'],
    ['Languages', [conversation.language || 'en', ...Object.keys(t.translations || {})].filter((x, i, a) => a.indexOf(x) === i).join(', ')],
    ['Risk class', conversation.risk_class || ''],
  ];
  if (isOrg) {
    const eng = conversation.pending_step?.engine || {};
    rows.push(
      ['Route', eng.route === 'nl' ? 'KvK (trade register)' : eng.route === 'didit' ? 'Didit company registry' : eng.route === 'document' ? 'Documents (extract + articles)' : 'chosen by country'],
      ['KvK environment', conversation.kvk_environment || 'off'],
      ['UBO threshold', `${settings.uboThreshold ?? 25}%`],
      ['Order', (t.items || []).map((i) => i.block_key).join(' → ')],
      ['Related parties', 'Each director, UBO and authorised representative gets an own short conversation (ID check and PEP)'],
      ['Queue release', settings.releaseInvitesAfterIdv === false ? 'Invitations are sent at once' : "Invitations wait until the representative's ID check passed"],
    );
  }
  return rows.map(([setting, value]) => ({ setting, value: String(value ?? '') }));
}

/** 2. Blocks and rules table (template order). active = the published template's current switch (applies to new requests). */
export function blocksTable({ conversation, publishedItems = null }) {
  const t = conversation.template_snapshot || {};
  const blocks = conversation.blocks_snapshot || {};
  const states = conversation.block_states || conversation.pending_step?.engine?.block_states || {};
  const current = conversation.current_block_key || conversation.pending_step?.step?.block_key || null;
  return (t.items || []).map((it) => {
    const b = blocks[it.block_key] || {};
    const st = it.active === false ? 'off' : (states[it.block_key]?.state || 'not_asked');
    const pub = publishedItems ? publishedItems.find((p) => p.block_key === it.block_key) : null;
    return {
      key: it.block_key, label: b.label || it.block_key, widget: b.widget || '', section: it.section_key || b.section_key || '',
      kyc_mapping: (b.datapoints || []).map((d) => d.profile_field).filter(Boolean).join(', ') || (typeof b.kyc_mapping === 'string' ? b.kyc_mapping : ''),
      show_if: b.show_if ? describeCondition(b.show_if) : 'always',
      follow_ups: (b.follow_ups || []).map(fuText),
      prefill: b.prefill ? (typeof b.prefill === 'string' ? b.prefill : [b.prefill.from || b.prefill.source, b.prefill.field].filter(Boolean).join(': ') || 'yes') : '',
      evidence: b.evidence ? (b.evidence.required ? 'required' : 'optional') + (b.evidence.allow_defer ? ', may be provided later' : '') : '',
      state: STATE_LABEL[st] || st, reason: states[it.block_key]?.reason || '', current: it.block_key === current,
      active_now: pub ? pub.active !== false : it.active !== false,
    };
  });
}

/** 3. Datapoints with source and tone. */
export function datapointRows(datapoints = []) {
  return datapoints.map((d) => ({ key: d.key, label: d.label || d.key, value: d.display_value ?? '', source: d.source || 'client', tone: sourceTone(d.source), block: d.block_key || '', status: d.status || '' }))
    .sort((a, b) => a.block.localeCompare(b.block) || a.key.localeCompare(b.key));
}

/** 4. Active rules in plain language. */
export function activeRules({ conversation, settings = {} }) {
  const risk = String(conversation.risk_class || 'medium').toLowerCase();
  const mode = settings.aiFollowUp?.[risk] || (risk === 'low' ? 'auto' : 'approval');
  const rules = [
    `Risk class ${risk}: AI follow-up questions ${mode === 'auto' ? 'are sent at once (marked AI-assisted)' : `wait for a colleague's approval (default text after ${settings.aiApprovalWaitMinutes ?? 60} minutes)`}; at most ${settings.aiFollowUpMaxPerRequest ?? 3} per request.`,
    'The required set is fixed by the template; the AI never drops a required block, sets the risk or accepts an answer.',
    'Each question is asked once; answers can be changed in the review before signing.',
    `Documents must not be older than ${settings.documentMaxAgeMonths ?? 3} months; a failed check asks for the document again.`,
    `Reminders ${(settings.reminderDays || []).length ? `${settings.reminderDays.join(', ')} days before the deadline` : 'are off'}; the link expires ${settings.tokenGraceDays ?? 7} days after the deadline.`,
  ];
  if (conversation.client_type === 'ORG') {
    rules.push(
      'Blocks are data: switching a block off in the template applies to the next request only.',
      'The route is chosen by country: KvK for the Netherlands when enabled, otherwise the Didit registry, otherwise documents.',
      'Every fact keeps its source (register, document, ID check or client).',
      `UBOs are calculated from the ownership chain (threshold ${settings.uboThreshold ?? 25}%), not asked.`,
      'Company documents depend on the legal form; a sole proprietorship needs none.',
      'Directors, UBOs and authorised representatives each complete their own ID check and PEP question.',
    );
  }
  return rules;
}

/** 5. Audit trail newest first. */
export function auditRows(events = []) {
  return [...events].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')))
    .map((e) => ({ id: e.id, at: e.created_date, event: String(e.event_type || '').replace(/^outreach\./, ''), actor: e.actor_name || e.actor_type || '', text: e.notes || '' }));
}

/** 6. Requests in the thread. */
export function requestRows(openRequests = []) {
  return openRequests.map((o) => ({ id: o.id, title: o.title, from: o.from_name || (o.kind === 'deferred_evidence' ? 'Client (deferred)' : o.kind === 'own_checks' ? 'Related party' : 'System'), kind: o.kind, status: o.status, created: o.created_date }));
}

/** 7. ORG: parties table from the invitations. */
export function partyRows(invites = []) {
  return invites.map((i) => {
    const [name, roles] = String(i.roles_text || '').split('|');
    return { id: i.id, name, roles: roles || '', need: 'ID check and PEP', status: i.status, email: i.email || '' };
  });
}

/** The whole view model. */
export function backstageView({ conversation, settings, datapoints, events, openRequests, invites, structureCard, publishedItems }) {
  const isOrg = conversation.client_type === 'ORG';
  return {
    conversation: { id: conversation.id, status: conversation.status, client_type: conversation.client_type, invited_name: conversation.invited_name || '', template_key: conversation.template_key, submitted_at: conversation.submitted_at || null, reference: conversation.reference || null },
    template: templateCard({ conversation, settings }),
    blocks: blocksTable({ conversation, publishedItems }),
    datapoints: datapointRows(datapoints),
    rules: activeRules({ conversation, settings }),
    audit: auditRows(events),
    requests: requestRows(openRequests),
    ...(isOrg ? { structure: structureCard || null, parties: partyRows(invites) } : {}),
  };
}
