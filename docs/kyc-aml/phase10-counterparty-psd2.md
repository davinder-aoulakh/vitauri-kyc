# Phase 10: the two items that could not be built yet

Written 17 Nov 2026. No code was changed for these two items. Each needs an answer from outside Vitauri first.

## 1. Counterparty enrolment in ongoing monitoring

**What the spec asks (section 11, AML; action point 15.3):** counterparties that matter (repeat counterparties, high amounts) are re-screened over time, with enrolment criteria set per tenant.

**What exists today**
- `Counterparty` records hold `screening_status`, `screening_hit_ids` and `last_screened_at`. Counterparties are resolved and merged by `resolveCounterparty`, `mergeCounterparties` and `linkCounterparty`.
- Didit screens the counterparty of each transaction when the transaction is submitted (its counterparty presets). That is a one-time check per transaction.
- Customers and related parties are in Didit ongoing monitoring through `toggleDiditMonitoring` and the daily job. Those files are on the do-not-edit list.

**Why it is blocked**
- Open question to Didit (spec action point 15.3): can a counterparty, which has no Didit session, be enrolled in ongoing monitoring other than through the `/v3/aml` screening call? Which party fields do the counterparty presets use? Without this answer the design could be built on an endpoint that does not exist, as happened with the FIU report path.
- The code that would call Didit for it (`screenEntityAml`, `toggleDiditMonitoring`, `dailyMonitoring`) is frozen. A change there needs your approval per file.
- Each re-screen is a billable Didit call. The enrolment criteria decide the cost, so they are a Compliance and budget decision.

**Proposed design once Didit answers**
1. Tenant settings: enrolment criteria (minimum number of transactions, minimum total amount in a period, countries, manual enrolment) and a re-screen interval.
2. A new `Counterparty.monitoring` object (enrolled, since, reason, next due date). Additive.
3. A scheduled job that selects enrolled counterparties that are due, screens them through one new shared helper, and stores hits as `ScreeningHit` rows linked to the counterparty.
4. A new hit on a counterparty raises an alert with source "Provider" for every customer that transacts with it, through the existing alert path.
5. A column and filter in the counterparty list; enrol and remove actions with a reason, audited.

**Decisions needed:** the Didit answer; approval to add a call next to the frozen screening code; the enrolment criteria and interval; who pays per re-screen.

## 2. PSD2 partner

**What the spec asks (sections 5.3 and 11):** bank data through a licensed account-information partner, started from the KYC flow or a secure link; consent, withdrawal and re-authentication tracked separately; a "send re-auth link" action; re-auth due appears in My Work.

**What exists today**
- `base44/shared/psd2Adapter.js`: an adapter interface and registry with no partner connected.
- `BankConnection` with `consent_id`, `consent_status` and `consent_granted_at`; functions `manageBankConnection` and `syncBankConnection`.
- Tenant Config has a "PSD2 partner" selector that states Vitauri is not itself an account-information service provider.
- The ingestion path accepts the `psd2` channel, and the historical window applies to it.

**Why it is blocked**
- No partner is chosen. The adapter needs the partner's API (consent start, account list, transactions, consent status) and its webhooks for consent given, withdrawn and re-authentication due. These differ per partner.
- The partner contract and the customer consent texts are legal and commercial decisions.

**Proposed design once a partner is chosen**
1. One adapter file for that partner implementing the existing interface; credentials stored per tenant in `TenantSecret` through Tenant Config, never in code.
2. A webhook function for the partner's consent events, verified the way the partner specifies, updating `BankConnection`.
3. Daily sync through `syncBankConnection`, feeding `normaliseTransactions` on the `psd2` channel.
4. "Send re-auth link" on the account, and a data action in My Work (AML section) when re-authentication is due or a connection has stalled.
5. Consent start from the outreach portal. The portal is on the do-not-edit list, so that step needs your approval.

**Decisions needed:** the partner; who signs the contract; consent wording; approval for the portal change.
