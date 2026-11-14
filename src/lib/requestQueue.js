// Request queue for browser entity calls: caps how many run at once, lets writes and the reads of the page the user is
// on go first, and keeps a short record of how long each call waited and ran. Pure (no I/O); used by base44Client.js.

export function createRequestQueue({ max = 10, getScope = () => '', now = () => Date.now(), keep = 60 } = {}) {
  let active = 0;
  const waiting = [];   // { resolve, priority, scope, seq }
  const recent = [];    // finished calls, newest last
  let seq = 0;

  // Next to run: a write first; then the oldest read started on the current page; then the oldest read of any page.
  function pickNext() {
    if (!waiting.length) return null;
    const scope = getScope();
    let i = waiting.findIndex((w) => w.priority);
    if (i < 0) i = waiting.findIndex((w) => w.scope === scope);
    if (i < 0) i = 0;
    return waiting.splice(i, 1)[0];
  }

  function acquire(priority) {
    if (active < max) { active++; return Promise.resolve(0); }
    return new Promise((resolve) => waiting.push({ resolve, priority, scope: getScope(), seq: seq++, ahead: waiting.length }));
  }

  function release() {
    active--;
    const next = pickNext();
    if (next) { active++; next.resolve(next.ahead); }
  }

  /** Runs fn when a slot is free. retryIf(err, attempt) → ms to wait before another try, or null to give up. */
  async function run(fn, { priority = false, label = '', retryIf = () => null } = {}) {
    const queuedAt = now();
    let waited = 0; let ran = 0; let retries = 0; let ahead = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const t0 = now();
        ahead = Math.max(ahead, await acquire(priority));
        const t1 = now();
        waited += t1 - t0;
        let delay = null;
        try {
          return await fn();
        } catch (err) {
          delay = retryIf(err, retries);
          if (delay == null) throw err;
        } finally {
          ran += now() - t1;
          release();
        }
        retries++;
        await new Promise((r) => setTimeout(r, delay));
      }
    } finally {
      recent.push({ label, at: queuedAt, queued_ms: Math.round(waited), net_ms: Math.round(ran), total_ms: Math.round(now() - queuedAt), retries, ahead });
      if (recent.length > keep) recent.shift();
    }
  }

  return {
    run,
    /** Finished calls queued at or after `since` (same clock as `now`). */
    recentSince: (since = 0) => recent.filter((r) => r.at >= since),
    state: () => ({ active, waiting: waiting.length }),
  };
}
