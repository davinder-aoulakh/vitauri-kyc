// enrichTransactions — categorise, resolve counterparties, mark coverage processed, submit to Didit.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { runTmAgent } from '../../shared/tmAi.js';
import { categoriseByRules, CATEGORIES, CATEGORY_SCHEMA, CATEGORY_SYSTEM_PROMPT } from '../../shared/tmCategory.js';
import { resolveAndStore } from '../../shared/tmResolve.js';
import { writeAudit } from '../../shared/tmAudit.js';
import {
  authenticate, errorResponse, httpError, invokeNext, loadTenant, chunk, asList, INGEST_ROLES,
} from '../../shared/tmAuth.js';

const MAX_IDS = 50;
const AI_GROUP = 25;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const auth = await authenticate(base44, req, body, { roles: INGEST_ROLES, scope: 'ingest:write' });
    const tenantId = auth.tenantId;
    const E = base44.asServiceRole.entities;

    const ids = [...new Set(body.transaction_ids || [])];
    if (!ids.length) throw httpError(400, 'transaction_ids is required');
    if (ids.length > MAX_IDS) throw httpError(413, `Max ${MAX_IDS} transaction_ids per call`);

    const tenant = await loadTenant(base44, tenantId);
    const txns = asList(await E.Transaction.filter({ tenant_id: tenantId, id: { $in: ids } }, undefined, MAX_IDS));
    if (!txns.length) return Response.json({ enriched: 0, note: 'No matching transactions for this tenant' });

    // ── 1. Category: rules first, own transfers fixed, rest to AI in groups of 25 ──
    const patches = new Map(txns.map((t) => [t.id, {}]));
    const stats = { by_rules: 0, by_ai: 0, ai_failed: 0, ai_groups: 0, already_categorised: 0 };
    const unmatched = [];
    for (const t of txns) {
      if (t.category) { stats.already_categorised++; continue; }
      if (t.own_transfer) { patches.get(t.id).category = 'own_transfer'; patches.get(t.id).category_confidence = 1; continue; }
      const c = categoriseByRules(t.description_raw);
      if (c) { Object.assign(patches.get(t.id), { category: c, category_confidence: 0.8 }); stats.by_rules++; }
      else unmatched.push(t);
    }
    for (const group of chunk(unmatched, AI_GROUP)) {
      stats.ai_groups++;
      const sources = group.map((_, i) => `desc:${i}`);
      try {
        const { output } = await runTmAgent(base44, {
          tenantId, agent: 'StatementExtract', schema: CATEGORY_SCHEMA, systemPrompt: CATEGORY_SYSTEM_PROMPT,
          input: { descriptions: group.map((t, i) => ({ index: i, description: t.description_raw || '' })) },
          sources,
        });
        const answered = new Set();
        for (const it of output.items || []) {
          const t = group[it.index];
          if (!t || answered.has(it.index)) continue;
          answered.add(it.index);
          const p = patches.get(t.id);
          p.category = CATEGORIES.includes(it.category) ? it.category : 'other';
          p.category_confidence = Math.max(0, Math.min(1, Number(it.confidence) || 0));
          if (!t.counterparty_name && it.counterparty_name) { p.counterparty_name = it.counterparty_name; t.counterparty_name = it.counterparty_name; }
          stats.by_ai++;
        }
        for (let i = 0; i < group.length; i++) if (!answered.has(i)) { patches.get(group[i].id).category = 'other'; patches.get(group[i].id).category_confidence = 0; }
      } catch (_e) {
        stats.ai_failed += group.length;
        for (const t of group) { patches.get(t.id).category = 'other'; patches.get(t.id).category_confidence = 0; }
      }
    }
    for (const t of txns) if (patches.get(t.id).category) t.category = patches.get(t.id).category;

    // ── 2. Counterparties (own transfers are skipped) ──
    const toResolve = txns.filter((t) => !t.own_transfer);
    const { updates, stats: cpStats } = await resolveAndStore(base44, auth, tenantId, toResolve, body.batch_id);
    for (const u of updates) Object.assign(patches.get(u.id), { counterparty_id: u.counterparty_id, counterparty_match_confidence: u.counterparty_match_confidence });

    const bulk = [...patches.entries()].filter(([, p]) => Object.keys(p).length).map(([id, p]) => ({ id, ...p }));
    for (const g of chunk(bulk, 100)) await E.Transaction.bulkUpdate(g);

    // ── 3. CoverageDay -> processed ──
    const covKeys = new Map();
    for (const t of txns) if (t.bank_account_id && t.coverage_date) covKeys.set(`${t.bank_account_id}|${t.coverage_date}`, t);
    let covUpdated = 0;
    if (covKeys.size) {
      const accIds = [...new Set([...covKeys.values()].map((t) => t.bank_account_id))];
      const dates = [...new Set([...covKeys.values()].map((t) => t.coverage_date))];
      const days = asList(await E.CoverageDay.filter({ tenant_id: tenantId, bank_account_id: { $in: accIds }, date: { $in: dates } }, undefined, 1000));
      for (const d of days) {
        if (covKeys.has(`${d.bank_account_id}|${d.date}`) && d.state === 'received') {
          await E.CoverageDay.update(d.id, { state: 'processed' });
          covUpdated++;
        }
      }
    }

    // ── 4. Submit to Didit (not own transfers) ──
    const submitIds = txns.filter((t) => !t.own_transfer).map((t) => t.id);
    let submit = { skipped: true };
    if (submitIds.length) {
      try {
        submit = await invokeNext(base44, auth, 'submitToDidit', { tenant_id: tenantId, transaction_ids: submitIds });
      } catch (e) {
        submit = { error: String(e?.message || e).slice(0, 200) };
      }
    }

    const clientIds = [...new Set(txns.map((t) => t.client_id))];
    await writeAudit(base44, auth, {
      tenantId, clientId: clientIds.length === 1 ? clientIds[0] : undefined, eventType: 'tm_transactions_enriched',
      before: { transactions: txns.length },
      after: { categorisation: stats, counterparties: cpStats, coverage_days_processed: covUpdated, own_transfers_skipped: txns.length - submitIds.length, submit: { submitted: submit.submitted, failed: submit.failed, skipped: submit.skipped_count ?? submit.skipped } },
      notes: `Enriched ${txns.length} transaction(s) for ${tenant.name || tenantId}.`,
    });

    return Response.json({ enriched: txns.length, categorisation: stats, counterparties: cpStats, coverage_days_processed: covUpdated, submit });
  } catch (error) {
    return errorResponse(error);
  }
}