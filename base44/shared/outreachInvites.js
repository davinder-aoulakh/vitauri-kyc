// Guided conversation outreach: the status of an invitation (OutreachInvite) for a related party's own check (phase 7). Pure.
// To invite -> (send) Queued (releaseInvitesAfterIdv on) | Invited (off, the child request is created at once)
// Queued -> (release: the representative passed ID&V, or a staff release) Invited; Invited -> Opened -> Completed.
const T = {
  'To invite': { send: (o) => (o.releaseAfterIdv ? { status: 'Queued', createChild: false } : { status: 'Invited', createChild: true }) },
  Queued: { release: () => ({ status: 'Invited', createChild: true }) },
  Invited: { opened: () => ({ status: 'Opened', createChild: false }), completed: () => ({ status: 'Completed', createChild: false }) },
  Opened: { completed: () => ({ status: 'Completed', createChild: false }) },
};

/** Next status for an event, or null when the event does not apply. */
export function inviteTransition(status, event, opts = {}) {
  const f = T[status]?.[event];
  return f ? f(opts) : null;
}

/** The client may continue when no party is still "To invite". */
export const canContinue = (rows = []) => rows.every((r) => r.status !== 'To invite');
