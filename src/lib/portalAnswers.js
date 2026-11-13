// Client portal: keeping the client's answers safe (used by src/pages/ClientPortal.jsx). No Didit logic here.
//  - selectedFromItem: restore a multi-select answer from what was saved;
//  - mergeItemState:   after a reload (e.g. the return from the Didit flow) keep what the client typed in this session;
//  - createSaveQueue:  one serialized read-merge-write per outreach request, so two fields never overwrite each other,
//                      with flush() for the moment the page is left;
//  - draft helpers:    a tab-scoped copy (sessionStorage) of answers that are not yet saved on the server.

/** Ticked options of a multi-select item: the saved array, or (older saves) the options found in the saved text. */
export function selectedFromItem(item) {
  const options = item?.field_options || [];
  if (Array.isArray(item?.response_value)) return item.response_value.filter((v) => !options.length || options.includes(v));
  const text = String(item?.response_text || '');
  if (!text) return [];
  // Per option, longest first: options may contain commas ("Frequent transactions > € 15.000,-") or contain each other.
  let rest = `, ${text}, `;
  const found = [];
  for (const opt of [...options].sort((a, b) => String(b).length - String(a).length)) {
    const needle = `, ${opt}, `;
    if (rest.includes(needle)) { found.push(opt); rest = rest.replace(needle, ', '); }
  }
  return options.filter((o) => found.includes(o));
}

const ANSWER_KEYS = ['text', 'value', 'selected', 'confirmed', 'prefilled', 'signerName'];

/**
 * State of one item after a reload. The server decides status, verification result and files; what the client changed in
 * this session (dirty) is kept. A local draft (unsaved answer from before a redirect) is applied the same way.
 */
export function mergeItemState(local, server, draft) {
  const out = { ...server };
  const src = local?.dirty ? local : (draft && !server.done ? { ...draft, prefilled: false } : null);
  if (src && !server.done) {
    for (const k of ANSWER_KEYS) if (src[k] !== undefined) out[k] = src[k];
    out.dirty = true;
  }
  if (local?.uploading) out.uploading = true;
  if (local?.fileUrl && !server.fileUrl && local.dirty) out.fileUrl = local.fileUrl;
  return out;
}

/** Later patch for the same item wins per key; patches for different items are kept side by side. */
export function mergePatches(pending, itemId, patch) {
  return { ...pending, [itemId]: { ...(pending?.[itemId] || {}), ...patch } };
}

const LOCKED_TYPES = ['id_verification', 'kyb_verification', 'section_header'];

/**
 * Save queue. deps: { fetchRequest(outreachId) -> request | null, writeItems(outreachId, items), delay, onSaved(outreachId, itemIds) }.
 * schedule() debounces; now() saves at once; flush() writes everything pending and resolves when the writes are done.
 * Verification items are never written from here (their result belongs to the Didit flow).
 */
export function createSaveQueue({ fetchRequest, writeItems, delay = 600, onSaved, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = {}; // outreachId -> { itemId: patch }
  const timers = {};
  const chains = {}; // outreachId -> promise (one write at a time per request)

  function run(outreachId) {
    clearTimer(timers[outreachId]);
    delete timers[outreachId];
    const prev = chains[outreachId] || Promise.resolve();
    const next = prev.then(async () => {
      const batch = pending[outreachId];
      if (!batch || !Object.keys(batch).length) return;
      delete pending[outreachId];
      try {
        const req = await fetchRequest(outreachId);
        if (!req) return;
        const saved = [];
        const items = (req.items || []).map((i) => {
          const patch = batch[i.item_id];
          if (!patch || LOCKED_TYPES.includes(i.field_type)) return i;
          saved.push(i.item_id);
          return { ...i, ...patch };
        });
        if (!saved.length) return;
        await writeItems(outreachId, items);
        // Items changed again while this write ran are not reported as saved yet.
        onSaved?.(outreachId, saved.filter((id) => !pending[outreachId]?.[id]));
      } catch {
        // Keep the answers for the next attempt (newer patches win).
        pending[outreachId] = { ...batch, ...(pending[outreachId] || {}) };
        for (const id of Object.keys(batch)) pending[outreachId][id] = { ...batch[id], ...(pending[outreachId][id] || {}) };
      }
    });
    chains[outreachId] = next.catch(() => {});
    return chains[outreachId];
  }

  return {
    schedule(outreachId, itemId, patch) {
      pending[outreachId] = mergePatches(pending[outreachId], itemId, patch);
      clearTimer(timers[outreachId]);
      timers[outreachId] = setTimer(() => run(outreachId), delay);
    },
    now(outreachId, itemId, patch) {
      pending[outreachId] = mergePatches(pending[outreachId], itemId, patch);
      return run(outreachId);
    },
    flush() {
      return Promise.all([...new Set([...Object.keys(pending), ...Object.keys(chains)])].map((id) => run(id)));
    },
    hasPending: () => Object.values(pending).some((b) => Object.keys(b).length > 0),
    cancel() { Object.values(timers).forEach(clearTimer); },
  };
}

// ---- Local draft (sessionStorage: this tab only; no files, no verification data) ----
const draftKey = (token) => `vitauri_portal_draft:${token}`;
function store() { try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; } }

export function readDraft(token) {
  try { return JSON.parse(store()?.getItem(draftKey(token)) || '{}') || {}; } catch { return {}; }
}
export function writeDraftItem(token, outreachId, itemId, state) {
  try {
    const d = readDraft(token);
    const entry = {};
    for (const k of ['text', 'value', 'selected', 'confirmed']) if (state?.[k] !== undefined) entry[k] = state[k];
    d[outreachId] = { ...(d[outreachId] || {}), [itemId]: entry };
    store()?.setItem(draftKey(token), JSON.stringify(d));
  } catch { /* storage full or blocked: the server save still runs */ }
}
/** Remove saved items (itemIds) of a request from the draft, or the whole request when itemIds is omitted. */
export function clearDraft(token, outreachId, itemIds) {
  try {
    const d = readDraft(token);
    if (!d[outreachId]) return;
    if (!itemIds) delete d[outreachId];
    else { for (const id of itemIds) delete d[outreachId][id]; if (!Object.keys(d[outreachId]).length) delete d[outreachId]; }
    if (Object.keys(d).length) store()?.setItem(draftKey(token), JSON.stringify(d)); else store()?.removeItem(draftKey(token));
  } catch { /* ignore */ }
}
