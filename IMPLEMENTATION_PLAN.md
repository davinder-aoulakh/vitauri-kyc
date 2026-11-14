# Vitauri KYC + AML: implementation plan for Claude Code

Nov 14, 2026 · @Dave

## 1. Read this first

Most of what the build spec asks for already exists in the repo behind the `tm_core` feature flags. This is a restructure plus about 25 specific gaps, not a rebuild.

Baseline: `davinder-aoulakh/vitauri-kyc` at commit `15579a7` (14 Nov 2026): 63 entities, 117 backend functions, 41 pages. The spec was written from a UI review on 3 Nov; the accounts, statement upload, expected profile, alerts, TM cases, FIU register and tipping-off lock were all committed between 23 Oct and 2 Nov.

**Why David saw "no way to get transaction data in"**

- Add account and Upload statement need the `tmWorkCase` permission: Analyst, QC Reviewer, Compliance Officer, Manager. Tenant Admin, Compliance Admin and Director do not have it. The buttons are hidden for them, and `manageBankAccount`, `parseStatement` and `commitStatement` reject them. David tests as Tenant Admin.
- The upload sits three levels deep: Client → Overview tab → Transactions sub-view → Bank accounts card.
- The Transactions page still shows the older Didit screening form ("+ New Transaction") and the old description.

**What the sample MT940 does today**

I ran the repo's own parser (`base44/shared/tmStatementParse.js` and `tmStatementChecks.js`) on `Lotte_Vermeulen_NL02ABNA0123456789_Jul-Oct2026.mt940`.

| Check | Result today |
| --- | --- |
| IBAN from `:25:` | NL02ABNA0123456789, read correctly |
| Balance | €1,250.00 + €8,480.00 = €9,730.00, reconciles |
| Transactions and period | 18, from 25-07 to 25-10 |
| Counterparties | 11 distinct IBANs, names from `/NAME/` |
| Historical vs recent | Not computed. Uploads never set `historical`, so all 18 go to Didit |
| IBAN mismatch | Warning only, processing is not blocked |
| Coverage | 107 empty days would be written as "missing" because the account defaults to daily data |
| Several statements in one file | Merged into the first account |

**How to use this plan**

- The build spec stays leading on logic and the prototype on layout. This plan says what to change in the existing code to get there.
- Keep existing entity and field names. The spec calls its names "suggestions" (spec section 3); section 3 below maps them.
- Work phase by phase (section 6). Each phase ends with the smoke checklist in section 5.
- Section 8 lists decisions that need David or Compliance. Phases 0 to 2 do not depend on them.

## 2. The Didit FIU report question

Yes: Didit has a documented API that generates goAML XML and PDF. It lives in the Management API, not under the `/v3/fiu-reports/` path the code calls today.

Source: docs.didit.me, read on 14 Nov 2026. I read the documentation; I did not run these calls against your Didit account.

| Step | Endpoint (prefix `/v3/organization/{organization_id}/application/{application_id}`) | Notes |
| --- | --- | --- |
| Create case | `POST …/cases/` | [Docs](https://docs.didit.me/management-api/cases/create). `title` required. Exactly one subject (user or business). `links[]` takes up to 500 sessions or transactions. Source is always MANUAL |
| Add links later | `POST …/cases/{case_uuid}/links/` | Same `entity_type` and `entity_uuid` pair |
| Create draft report | `POST …/cases/{case_uuid}/regulatory-reports/` | [Docs](https://docs.didit.me/management-api/regulatory-reports/create-for-case). `report_type` (SAR, STR, CTR, TTR, UTR, IFT, CBR, TFR, FFR, PNMR), `jurisdiction`, optional `template`, optional `transactions[]` |
| Validate | `POST …/regulatory-reports/{report_uuid}/validate/` | [Docs](https://docs.didit.me/management-api/regulatory-reports/validate). Returns `is_valid` and `errors[] {field, message}` |
| Finalize | `POST …/regulatory-reports/{report_uuid}/finalize/` | [Docs](https://docs.didit.me/management-api/regulatory-reports/finalize). Renders XML and PDF |
| Download | `GET …/regulatory-reports/{report_uuid}/download-url/?file=xml` or `pdf` | [Docs](https://docs.didit.me/management-api/regulatory-reports/download-url). Presigned URL, 409 until finalized |
| List | `GET …/regulatory-reports/` | [Docs](https://docs.didit.me/management-api/regulatory-reports/list). Filter by status, type, case |
| Templates | `GET` and `POST …/report-templates/` | [Docs](https://docs.didit.me/management-api/report-templates/list). Hold `rentity_id`, `submission_code`, `currency_code_local`, `enabled_fields` |

Authentication is `x-api-key`. Cases endpoints need a full-access key; a restricted key gets 403 ([docs](https://docs.didit.me/management-api/cases/update#access)).

**Limits that matter for the design**

- Didit never submits to the FIU. Its statuses stop at Draft, Validated, Finalized ([docs](https://docs.didit.me/console/case-management/fiu-reports)).
- Validation needs at least one attached Didit transaction, except for FFR and PNMR.
- Schema-level validation is documented for the UAE FIU only. NL, BE and Curaçao get the generic obligatory-field check.
- One subject per case.
- I found no documented endpoint to edit a draft's narrative or fields after creation. Treat that as unconfirmed.

**What the code does today**

- `base44/shared/diditTm.js` defines `fiuReports: '/v3/fiu-reports/'` and `cases: '/v3/cases/'`. Neither path is in the docs, which explains the `generation_path_missing` flag and `DiditConsoleFallback.jsx`.
- Since 2 Nov, Vitauri generates the goAML XML and PDF itself: `goamlXml.js`, `goamlValidate.js`, `fiuReportPdf.js`, called from `tmFiuGenerate.js`. The Didit call is optional behind `tm_settings.fiu_didit_generation`.

**Recommendation: keep Vitauri generation as the primary path, and the register in Vitauri**

1. Reports from a KYC review (declined onboarding) and from historical uploads have no Didit transaction, so Didit validation would fail.
2. A network investigation has several subjects; a Didit case has one.
3. Four-eyes, the deadline clock, and Submitted and Received with evidence exist only in Vitauri. The spec requires them either way.
4. Didit does not validate against the NL, BE or Curaçao schemas.

Repointing the optional Didit path to the real endpoints is a small task in phase 7. It needs the Didit organization id (not stored today; `Tenant.didit_app_id` exists) and a full-access key. This closes spec action point 15.1 once David agrees (decision D5).

## 3. What the codebase already has

Every object in spec section 3 has an existing counterpart. Extend these; do not create parallel entities.

| Spec object | Existing entity (`base44/entities`) | Main code |
| --- | --- | --- |
| Account | `BankAccount`, plus `BankConnection` for PSD2 consent and re-auth | `manageBankAccount`, `manageBankConnection`, `src/components/client/bankaccounts/` |
| ImportBatch | `StatementUpload` (file, checks, parsed rows) and `TransactionIngestBatch` (counts) | `parseStatement`, `commitStatement`, `tmStatementParse.js`, `tmStatementChecks.js` |
| Transaction | `Transaction`: already has `executed_at`, `received_at`, `intended_at`, `lifecycle`, `related_to`, `dedupe_key`, `own_transfer`, `historical`, Didit fields | `normaliseTransactions`, `enrichTransactions`, `submitToDidit`, `tmCanonical.js` |
| Counterparty | `Counterparty`, `CounterpartyEdge` | `tmCounterparty.js`, `resolveCounterparty`, `mergeCounterparties`, `buildCounterpartyGraph` |
| ExpectedProfile | `ExpectedProfile` (versioned, proposed, approved, superseded) | `proposeExpectedProfile`, `approveExpectedProfile`, `tmActuals.js` |
| Alert | `TmAlert` (AI proposal, reasons with sources, deadline clock) | `tmTxnDecision.js`, `tmDeviationAlert.js`, `triageAlerts`, `closeTmAlert` |
| Case, TM and Network types | `TmCase` (separate from `KycCase`; has `network_client_ids`) | `manageTmCase`, `tmCaseCore.js`, `src/pages/TmCaseWorkspace.jsx` |
| ChangeOfCircumstances | `EdrTrigger` (proposed, accepted, dismissed) and `MonitoringAlert` | `edrTriggers.js`, `evaluateEdrTriggers`, `decideEdrTrigger` |
| FIUReport | `FiuReport`, `FiuArtefact`, `FiuProfile` | `prepareFiuReport`, `fiuReportAction`, `recordFiuSubmission`, `tmFiu*.js` |
| Rule | `TmRule`, `TmScenario`, `TmRisk`, `RuleBacktest` | `tmRuleAction`, `syncDiditRule`, `backtestRule`, `seedTmLibrary` |
| `aml_hold` | `TippingOffLock`, mirrored on `Client.tipping_off_lock` | `tippingOff.js`, `unlockTippingOff` |
| `behaviour_score` | `CustomerRiskScore`, `Client.customer_risk_score` and `customer_risk_band` | `tmRisk.js`, `recomputeCustomerRisk` |
| Data coverage | `CoverageDay` | `coverageJob`, `getCoverageMatrix`, `src/pages/TmCoverage.jsx` |
| Webhook dedupe on `event_id` | `DiditWebhookEvent` | `diditWebhook` |
| Screening | `ScreeningHit`, `MonitoringAlert` | `screenEntityAml`, `dailyMonitoring`, `src/pages/MonitoringAlerts.jsx` |
| My Work | no entity | `getMyWork`, `src/pages/MyWork.jsx` at `/work` |

**The ingestion pipeline as built**

1. `StatementUploadDrawer.jsx` stores the file privately and creates a `StatementUpload`.
2. `parseStatement` detects the format (CSV, XLSX, MT940, CAMT.053, PDF by AI), reconciles balances, finds gaps, marks duplicates and own transfers, and sets status `review`.
3. `commitStatement` builds items and calls `normaliseTransactions`, which writes `Transaction` rows, FX and `CoverageDay`.
4. `enrichTransactions` categorises, resolves counterparties and calls `submitToDidit`.
5. `submitToDidit` posts each transaction with the original `executed_at`. A Didit answer of In review, Awaiting user or Declined creates a `TmAlert` at once through `applyTxnDecision`; the webhook extends it later.
6. Nightly jobs (`base44/workflows`): profile deviation, coverage check, EDR trigger scan, FIU proposals, Didit rule drift, Didit reconcile, deadline sweep (hourly), PSD2 sync.

**Feature flags** (`src/lib/featureFlags.js`, all default off): `tm_core`, `tm_ingest_api`, `tm_kyc_analysis`, `tm_rules`, `tm_fiu`, `tm_quality`. With `tm_core` off the app shows the legacy sidebar and none of the above.

## 4. Gap analysis

Twenty-six gaps separate the current build from the spec. Five of them (G1 to G5) decide whether the MT940 test passes.

**Ingestion (spec sections 3 and 5)**

| ID | Spec requires | Current code | Change | Phase |
| --- | --- | --- | --- | --- |
| G1 | Admin and compliance roles can add accounts and upload | `WORK_ROLES` in `tmAuth.js` and `tmWorkCase` in `permissions.js` exclude Tenant Admin, Compliance Admin, Director | New permission for accounts and uploads, applied in UI and the three functions | 0 |
| G2 | Rows older than `historical_window_days` (default 30) are stored historical, not sent to Didit, raise no alert | Uploads never set `historical` (`tmStatementRows.buildItems`). The API channel uses a fixed 7 days (`ingestTransactions`) | One tenant setting, applied in `normaliseTransactions` for every channel | 1 |
| G3 | IBAN mismatch blocks with three options | `parseStatement` adds a warning and continues | Return a blocking check; drawer offers choose other account, add this IBAN, cancel | 1 |
| G4 | Coverage filled for the statement period | `findGaps` marks every empty day missing when `expected_frequency` is daily: 107 days for the sample | A reconciling statement covers its whole period; only balance breaks are gaps | 1 |
| G5 | 4-step dialog with result: added, historical, counterparties screened, alerts, CoC | Drawer has select, review, done. Done shows the accepted count only. Re-upload of the same file ends in a 422 "No rows left to commit" | Add the account step, the historical count, the result summary and a clean "0 added, 18 duplicates skipped" | 1 |
| G6 | `account_type` (Own, External PSD2, Joint, Business) and `holders[]` | `BankAccount` has `holder_name`, `source_type`, `is_customer_owned` only | Add both fields and show them in `AccountFormDialog.jsx` | 1 |
| G7 | `reference` (REMI) and `counterparty_country` from the IBAN | REMI stays inside `description_raw`. Country is not derived | Parse `/REMI/` and `/EREF/` into new fields; derive country from the first two IBAN letters | 1 |
| G8 | A file can hold several statements, split on `:20:` | `parseMt940` keeps the first `:25:` and merges all rows | Return an array of statements | 8 |
| G9 | Bulk import with an Unmatched accounts queue | Not built. The Transactions page upload asks for one client | New route in the drawer, queue on the Transactions page, held rows | 8 |
| G10 | Manual transaction needs customer, account, execution date | `TransactionForm.jsx` and `createDiditTransaction` set `executed_at` to now and take no account | Add both inputs and validate server-side. Leave the Didit call itself unchanged | 8 |

**Detection, alerts, investigations (spec sections 6 and 7)**

| ID | Spec requires | Current code | Change | Phase |
| --- | --- | --- | --- | --- |
| G11 | `custom_properties` carry `risk_class`, `pep`, profile values | `buildTransactionBody` sends profile values only | Add `risk_class` and `pep` | 3 |
| G12 | Thresholds per risk class (Low, Medium, High, PEP) | Not present. `TmSettingsTab` holds objective thresholds only | `thresholds_by_class` on `TmRule`, synced as conditions on `custom_values.risk_class` | 3 |
| G13 | Profile alert and CoC right after processing | `profileDeviationJob` runs nightly on a rolling 30 days from now. The `profile_breach` trigger needs a score above 70 on two consecutive daily runs | Run the comparison for the affected client after commit; accept an `as_of` date. Trigger rule per decision D7 | 3 |
| G14 | Alert `source` Rule, Provider, Profile, Manual | `TmAlert.source`: `didit_rule`, `profile_deviation`, `manual`, `quality_sample` | Add `didit_provider`; map labels in the UI | 3 |
| G15 | Escalate adds to the open investigation or creates one, by tenant grouping | `CaseActions.jsx`: the analyst picks an open case or creates one | `tm_settings.case_grouping`; one Escalate button that resolves the target | 4 |
| G16 | Outcome "true positive, motivated no-report" | `TmCase.co_decision`: report or no\_report | Add an `outcome` field with the three spec values | 4 |

**KYC monitoring and the bridge (spec section 8)**

| ID | Spec requires | Current code | Change | Phase |
| --- | --- | --- | --- | --- |
| G17 | Screening decides only: True match or Not this person, then a CoC event | `AlertDetailPanel.jsx` offers Dismiss and Escalate to EDR, which opens a review directly. The page is titled "Monitoring Alerts" and also lists register changes and transaction rule hits | Rename, filter to screening types, two dispositions, True match creates an `EdrTrigger` | 5 |
| G18 | Change of circumstances page with a graduated response | No page. `decideEdrTrigger` accepts or dismisses | New page; `response` and `restricted` on `EdrTrigger`; new trigger types | 5 |
| G19 | Delta review: only affected steps re-run | `KycCase` has `step_N_not_required` and `reopen_scope`, unused for this | Map response to step scope on case creation | 5 |
| G20 | Profile sources: declaration, analysis, analyst, segment default; gap is a finding | `ExpectedProfile.source`: `kyc_case`, `kyc_txn_analysis`, `manual`, `tm_review`. Outreach answers already map in (`expectedUseFromOutreach.js`) | Add `client_declaration` and `segment_default`, `declared_values`, `finding_gap` | 10 |

**Roles and FIU (spec sections 4 and 9)**

| ID | Spec requires | Current code | Change | Phase |
| --- | --- | --- | --- | --- |
| G21 | Role model separate or combined; KYC roles see the badge only | One `Analyst` role sees everything | Decision D6, then nav, routes, customer file and function guards | 6 |
| G22 | `aml_hold` while an investigation is open or a report is not yet Received | Lock applies only to a non-draft, non-rejected FIU report | Extend `isClientLocked` to open `TmCase` rows | 6 |
| G23 | Remove "Scan for reports" | Button in `FiuReports.jsx` calls `scanFiuProposals` | Remove the button; keep the daily workflow | 7 |
| G24 | Submitted needs an FIU reference; Received creates a restricted CoC | Reference is required at Received, not at Submitted. Received closes the `TmCase`; no CoC | Move the check; create the trigger | 7 |
| G25 | FIU profile CTIF-CFI | `FiuProfile.code` and `FiuReport.fiu_profile_code` enums: CW, NL | Add BE when needed (decision D9) | 7 |

**Navigation, dashboards, config (spec sections 2, 10, 11)**

| ID | Spec requires | Current code | Change | Phase |
| --- | --- | --- | --- | --- |
| G26 | Overview, Customers, KYC, AML, Reporting, Admin. Rules in Tenant Config. Coverage on the AML Dashboard. Libraries follow tenant jurisdictions. Two My Work sections. Config split General, KYC, AML | `tmNavItems` in `AppShell.jsx`: Overview, Customers, Reviews, Monitoring, Control, Outreach, Reports & Admin. `TmRules.jsx` hardcodes the Curaçao and Wwft library buttons. `Tenant` has no jurisdictions field. `MyWork.jsx` is one filtered list. `TenantConfig.jsx` has 11 flat tabs | See phases 2 and 9 | 2, 9 |

**Already in line with the spec, no change needed:** webhook HMAC check and `event_id` dedupe, four-eyes on FIU approval (`tmFiuActions.approve` rejects the preparer), FIU status flow with evidence, deadline clock, reproducibility snapshot on approval, rule versions with backtest and approval, own-transfer detection, reversal linking, FX to reporting currency, tipping-off check in `sendOutreachEmail`.

## 5. Guardrails: Didit and outreach must keep working

Three integrations are live and must behave the same after every phase: Didit identity verification, Didit transaction screening, and client outreach.

**Do not edit these files unless a task in section 6 names them**

| Area | Backend (`base44/functions`, `base44/shared`) | Frontend (`src`) |
| --- | --- | --- |
| Didit ID&V sessions | `createDiditSession`, `getDiditSessionResult`, `getDiditSessionDetails`, `catchUpDiditDecisions`, `backfillIdvWorkflows`, `diditDecision.js`, `diditSessionAuth.js`, `diditDeviceLane.js`, `diditWorkflows.js`, `diditMedia.js` | `components/case/IdentityVerificationStep.jsx`, `components/client/DiditVerificationPanel.jsx`, `components/didit/*`, `components/portal/DiditCallbackScreen.jsx`, `components/portal/IdVerificationField.jsx`, `lib/diditReadable.js`, `lib/diditReport.js` |
| Didit KYB | `createDiditKybSession`, `getDiditKybResult`, `acceptKybReview`, `sendKeyPersonIdv`, `diditKyb.js`, `kybReview.js` | `components/case/kyb/*`, `components/portal/KybVerificationField.jsx` |
| Didit AML screening | `screenEntityAml`, `toggleDiditMonitoring`, `updateDiditHitStatus`, `dailyMonitoring`, `adverseMediaMonitoring`, `diditAml.js` | `components/case/ScreeningStep.jsx`, `components/case/screening/*` |
| Didit credentials and webhook | `diditCredentials.js`, `diditWebhookVerify.js`, `registerDiditWebhook`, `replayDiditWebhook`, `migrateDiditSecrets`, entities `TenantSecret` and `DiditWebhookEvent` | `components/tenantconfig/DiditConnectionCard.jsx` |
| Outreach | `sendOutreachEmail`, `buildProfileSuggestions`, entities `OutreachRequest`, `OutreachTemplate`, `OutreachFormTemplate`, `StandaloneOutreach`, `EmailTemplate` | `pages/ClientPortal.jsx`, `pages/StandaloneOutreach.jsx`, `pages/OutreachDashboard.jsx`, `components/case/OutreachStep.jsx`, `components/case/outreach/*`, `lib/outreach*.js`, `lib/profileFieldMap.js`, `lib/expectedUseFromOutreach.js`, `lib/portalAnswers.js` |

**Rules**

1. Schema changes are additive only. Add fields and enum values; never rename or remove one. Entities hold live tenant data and Base44 applies schema changes directly.
2. `diditWebhook/entry.ts` (706 lines) serves sessions, KYB and transactions. Change only the transaction branch that starts at the `transaction.created` check. Never touch signature verification, the `event_id` dedupe or the session branches.
3. `submitToDidit` and `createDiditTransaction`: add fields to the body through `buildTransactionBody` in `diditTm.js`. Do not change the idempotency key (`our_transaction_id`), the retry logic or the reconcile job.
4. Tipping-off: extend behaviour only inside `base44/shared/tippingOff.js`. `sendOutreachEmail`, `createDiditSession`, `createDiditKybSession` and `sendKeyPersonIdv` all call it and expect a 423 when locked. Widening the lock (G22) will block outreach for more clients; that is intended, so show the reason in `TippingOffBanner.jsx`.
5. Keep every existing route working. `/portal/:token`, `/onboard/:token`, `/case/:id`, `/client/:id`, `/tm/*`, `/work`, `/monitoring` and `/outreach*` appear in sent emails, notifications (`lib/routes.js`) and Didit callbacks. New paths get added; old ones redirect.
6. Leave the legacy `navItems` array in `AppShell.jsx` untouched. Tenants with `tm_core` off must see no change. Put the new sidebar behind a new flag `aml_nav_v2`, default off, so it can be switched per tenant.
7. The Outreach nav group and its role gate (`OUTREACH_ROLES`) move into the new sidebar unchanged.
8. The repo receives daily commits from the Base44 builder ("External agent changes", 23 on 14 Nov, mostly outreach and profile files). Work on a branch, rebase before each push, and stay out of `ClientProfileStep.jsx`, `OutreachStep.jsx`, `OutreachTemplatesTab.jsx` and `profileFieldMap.js`.

**Smoke checklist after each phase** (Demo tenant, Didit sandbox)

- [ ] Create a client with a case; start a Didit ID verification; the result returns to the Identity Verification step.
- [ ] Open the portal link from an outreach email; answer one item; it shows as Received in the Outreach step.
- [ ] Run screening on a client; a hit appears; set a hit status.
- [ ] Send a standalone outreach from `/outreach/new`.
- [ ] Submit one manual transaction; a Didit status comes back.
- [ ] Tenant Config → Integrations → Didit → webhook test passes.
- [ ] With `tm_core` off, the sidebar and client page look as before.
- [ ] `npm run lint`, `npm run typecheck` and `npm run build` pass.

## 6. Implementation phases

Eleven phases, ordered so the MT940 test passes first (phases 0, 1 and 3) and the structural moves follow. One branch and one pull request per phase.

| Phase | Outcome | Gaps | Spec tests |
| --- | --- | --- | --- |
| 0 | Admin roles can upload; test harness and test clock exist | G1 | none |
| 1 | Upload checks, historical flag, coverage and account model are correct | G2 to G7 | 1, 2, 3, 7 |
| 2 | New sidebar and labels behind `aml_nav_v2` | G23, G26 (part) | 13 |
| 3 | Upload raises the expected alerts and a change of circumstances | G11 to G14 | 4, 5, 6 |
| 4 | Escalate groups alerts into investigations | G15, G16 | 8 |
| 5 | Screening dispositions and the Change of circumstances page | G17 to G19 | 11 |
| 6 | Role model and AML hold | G21, G22 | 10 |
| 7 | FIU register finishing; optional Didit endpoints | G24, G25 | 9 |
| 8 | Bulk import, unmatched queue, manual transaction | G8 to G10 | 12, 14 |
| 9 | Dashboards, My Work, Tenant Config regroup, rules move | G26 (rest) | none |
| 10 | Later: profile sources, counterparty re-screening, PSD2 partner | G20 | none |

### Phase 0: unblock and safety net

1. Create branch `feature/kyc-aml-v2`. Copy the package (build spec, decisions, sign-off spec, sample MT940, this plan) to `docs/kyc-aml/`.
2. Add permission `tmManageAccounts` in `src/lib/permissions.js` and `ACCOUNT_ROLES` in `base44/shared/tmAuth.js`: the four `WORK_ROLES` plus Tenant Admin and Compliance Admin (decision D3).
3. Use it in `manageBankAccount`, `manageBankConnection`, `parseStatement`, `commitStatement`, and in `BankAccountsCard.jsx`, `TransactionMonitoring.jsx`, `TmCoverage.jsx`, `KycTxnAnalysisPanel.jsx`. `normaliseTransactions`, `enrichTransactions` and `submitToDidit` already accept ingest roles.
4. Add `tests/` run with `node --test`. The modules in `base44/shared` are plain ES modules; `tmStatementParse.js` and `tmStatementChecks.js` import cleanly in Node. First test: the sample file gives the numbers in section 1.
5. Add `base44/shared/tmNow.js`: `nowFor(tenant, body)` returns `body.as_of` only for a tenant with status `Demo` or a Vitauri Ops caller, otherwise the real time. The spec tests assume today is 3 Nov 2026; without this they cannot pass on any later date.
6. Check the test tenant: `tm_reporting_currency` EUR and `tm_timezone` Europe/Amsterdam. `tmCanonical.js` falls back to America/Curacao, which shifts coverage dates.

Done when: a Tenant Admin adds account NL02ABNA0123456789 on a client and reaches the review screen with the sample file.

### Phase 1: ingestion correctness

1. **Historical window (G2).** Add `tm_settings.historical_window_days`, default 30. In `normaliseTransactions`, when `historical` is not given and lifecycle is not `intended`, set it from `executed_at` against `nowFor()` minus the window. Replace the fixed 7 days in `ingestTransactions` (decision D4). In `parseStatement`, flag preview rows and store `historical_count` on `StatementUpload`.
2. **IBAN mismatch (G3).** In `parseStatement`, when the upload names an account and `:25:` differs, store `blocking: [{code: 'iban_mismatch', file_iban, account_iban}]`. `commitStatement` refuses while `blocking` is not empty. The drawer offers: choose another account, add this IBAN as an account (calls `manageBankAccount`, then re-parses), cancel.
3. **Coverage (G4).** In `tmStatementChecks.findGaps`, a statement whose opening balance plus movements equals the closing balance has no gaps. In `commitStatement`, write `CoverageDay` rows with state `processed` and `txn_count` 0 for empty days inside the period (keep the 366-day cap).
4. **Fields (G6, G7).** Additive schema changes: `BankAccount.account_type` (`own`, `external_psd2`, `joint`, `business`) and `holders` (array of `{name, client_id, related_party_id, role}`); `Transaction.reference` and `end_to_end_id`; `StatementUpload.historical_count` and `blocking`. In `parseMt940`, read `/IBAN/`, `/BIC/`, `/REMI/`, `/EREF/` explicitly and keep the current regex as fallback. In `toCanonical`, derive `counterparty_country` from an IBAN when it is empty.
5. **Dialog (G5).** `StatementUploadDrawer.jsx` becomes four steps: Account, File, Checks and preview, Result. Layout from the prototype's `drawUpload()`. `commitStatement` returns `{accepted: 0, duplicates: n}` instead of a 422 when every row is a duplicate.
6. Unit tests for 1 to 3 with the sample file and a copy with a changed `:25:`.

Done when: spec tests 1, 2, 3 and 7 pass with `as_of` 2026-11-03: 18 transactions, 8 historical and not submitted to Didit, 10 recent, 11 counterparties, second upload adds 0.

### Phase 2: navigation and labels

1. Add `aml_nav_v2` to `featureFlags.js` (default off) and a third array `amlNavItems` in `AppShell.jsx`, structured as spec section 2. Keep permission and feature checks per item. Existing pages the spec does not place go where decision D1 says.
2. Relabel without moving routes: `CasesList` becomes "Reviews", `TmCases` becomes "Investigations", `MonitoringAlerts` becomes "Screening". `TransactionMonitoring` becomes "Transactions" with the description "Transaction ledger across all customers and accounts".
3. Customer file: lift the sub-views of `MonitoringTab.jsx` to top-level tabs in `ClientDetail.jsx` named Overview, Accounts & transactions, Expected profile, Reviews & changes, Alerts & investigations. Keep `?tab=overview&view=` working (`toClientView` in `lib/routes.js`).
4. Add `Tenant.jurisdictions` (array of ISO codes). `TmRules.jsx` shows a library button only for a listed jurisdiction; `seedTmLibrary` seeds only those scenarios and deletes nothing.
5. Remove the "Scan for reports" button from `FiuReports.jsx`. The "Daily FIU Report Proposals" workflow stays.

Done when: with the flag on, the sidebar matches spec section 2 for each role; with it off nothing changed; an NL tenant sees no Curaçao library (test 13).

### Phase 3: detection on upload

1. **Check Didit first.** In the sandbox, confirm that starter rules S-07a (smurfing) and S-11 (rapid in/out) are active, and that velocity rules count backdated transactions by `transaction_at`. The answer decides task 3 (decision D8).
2. **Submit in order.** `submitToDidit` posts six at a time with `mapLimit`, so order is not guaranteed. Sort by `executed_at` and post one client's transactions sequentially; velocity rules depend on it.
3. If Didit cannot evaluate backdated velocity, evaluate S-07a and S-11 in Vitauri against the ledger (`tmRuleEval.js` is the start) and create the `TmAlert` there.
4. **Risk class (G11, G12).** Add `risk_class` and `pep` to `custom_properties` in `buildTransactionBody`. Add `thresholds_by_class` to `TmRule` and render it in `tmRuleSync.js` as conditions on `custom_values.risk_class`. Medium needs 4 distinct senders for S-07a.
5. **Profile check after commit (G13).** Move the per-client block of `profileDeviationJob.processTenant` into `base44/shared/tmProfileCheck.js`. Call it from a new function `runProfileCheck` that `commitStatement` invokes for the affected client, with `as_of`. The nightly job calls the same module.
6. **Change of circumstances.** Create the `EdrTrigger` (`profile_breach`) according to decision D7.
7. **Alert source (G14).** In `tmTxnDecision.js`, set `source: 'didit_provider'` when the hit comes from a counterparty screening preset.
8. The Result step lists alerts raised and the proposed change of circumstances.

Done when, on the sample: one structuring alert (6 senders, 14 to 20 Oct), two rapid in/out alerts (€5,000 on 16 Oct, €5,100 on 21 Oct), one profile alert (€14,080 against €3,800) and one change-of-circumstances event.

### Phase 4: alerts and investigations

1. Add `tm_settings.case_grouping` (`one_open_per_customer`, `per_rule_customer`) and auto-create switches for objective indicators and confirmed sanctions hits, in `TmSettingsTab.jsx`.
2. Add an `escalate` action in `tmAlertActions` that finds or creates the `TmCase` by the grouping rule. `CaseActions.jsx` shows one Escalate button.
3. Add `TmCase.outcome`: `reported_to_fiu`, `no_report_explained`, `true_positive_no_report`. Wire the three outcome buttons in `CaseActionsPanel.jsx`.
4. Check that `closeTmAlert` stores whether the AI proposal was followed; add `ai_followed` to `TmAlert` if it does not.

Done when: escalating two alerts of one client gives one investigation holding both (test 8).

### Phase 5: screening and change of circumstances

1. Screening page: show screening alert types only. Replace the actions in `AlertDetailPanel.jsx` with True match and Not this person (rationale required). True match sets `ScreeningHit.status` to `Confirmed_Match` and calls `proposeTriggers` from `edrTriggers.js`.
2. Extend `EdrTrigger`: `response` (`no_action`, `targeted_check`, `risk_reassessment`, `full_cdd_refresh`), `restricted`, `source_label`, and trigger types `id_expiry`, `address_change`, `tm_alert_frequency`, `tm_new_country`, `tm_investigation_outcome`.
3. New page `/kyc/changes` listing triggers with the response picker. Status labels: proposed is "Awaiting response", accepted is "Review started", dismissed is "Closed".
4. `decideEdrTrigger` takes `response`. Anything but `no_action` creates the Event-driven review as today and sets `step_N_not_required` for unaffected steps. The trigger-to-steps table needs David's input; start with screening hit to Screening and Risk assessment, profile breach to Client profile, SoF and Risk assessment.
5. A read function returns triggers with restricted text replaced for KYC-only users (used from phase 6).

Done when: True match creates an event; choosing Risk reassessment opens an Event-driven review (test 11).

### Phase 6: roles and AML hold

1. Implement decision D6. Recommended: `tm_settings.role_model` (`separate`, `combined`) and `User.work_domain` (`kyc`, `aml`, `both`; default `both`, so nothing changes until set).
2. Add `canKyc` and `canAml` to `permissions.js` and to `authenticate` in `tmAuth.js`. Apply to the sidebar, routes, the customer file AML tab, `getCustomerFile` and the TM functions.
3. Entity RLS today lets any tenant user read `TmAlert`, `TmCase` and `FiuReport`. Add a `user_condition` on `data.work_domain`, the pattern `FiuArtefact` already uses for roles. Test with a KYC-only user through the SDK, not only the UI.
4. AML hold (G22): `isClientLocked` also returns true for a client with an open `TmCase`. Show an "AML hold" badge in `ClientSearch.jsx` and the client header. Outreach stays blocked with 423; a neutral template is a later option.

Done when: test 10 passes for a KYC-only user, including a direct entity read.

### Phase 7: FIU register

1. `recordFiuSubmission`: require `fiu_reference` at Submitted (G24). On Received, create a restricted `EdrTrigger` of type `tm_investigation_outcome`.
2. Confirm the KYC decline path creates a `FiuReport` with origin `kyc_case` when the reporting-obligation assessment says a report is still to be filed (`prepareFiuReport` accepts `kyc_case_id`).
3. Add `BE` to the profile enums if decision D9 says so.
4. Optional, after decision D5: point `DIDIT_TM_PATHS` in `diditTm.js` to the Management API paths in section 2 and rewrite `runDiditGeneration` in `tmFiuGenerate.js` as create case, link transactions, create draft, validate, finalize, download. Store the Didit organization id in `TenantSecret`. Update `diditEndpointCheck`. Keep it off by default.

Done when: test 9 passes end to end with the Vitauri-generated XML.

### Phase 8: bulk import and manual transaction

1. `parseMt940` and `parseCamt053` return one result per statement (G8). `parseStatement` keeps handling the single-statement case.
2. Bulk route (G9): a `StatementUpload` without `client_id` is not allowed today (required field), so add entity `UnmatchedStatement` (tenant, IBAN, period, count, parsed rows, source upload id). Matched statements run the phase 1 path per account. "Link to customer" creates the account and commits the held rows.
3. Manual transaction (G10): add account and execution date to `TransactionForm.jsx`; `createDiditTransaction` rejects without them and stores `bank_account_id`.

Done when: tests 12 and 14 pass, and the smoke check for a manual transaction still returns a Didit status.

### Phase 9: dashboards, My Work, Tenant Config

1. AML Dashboard at `/aml/dashboard` with tabs Overview, Data coverage (content of `TmCoverage.jsx`) and Detection quality (content of `TmQuality.jsx` and `TmMi.jsx`). Old routes redirect.
2. KYC Dashboard: reuse `Dashboard.jsx`, `MIDashboard.jsx` and `RiskDashboard.jsx` content as tabs.
3. `MyWork.jsx`: two sections, My KYC work and My AML work; `getMyWork` already returns typed items.
4. `TenantConfig.jsx`: group the existing tabs under General, KYC and AML. Move the rules screen in as AML → Rules & scenarios; `/tm/rules` redirects.

### Phase 10: later

Profile sources and segment defaults (G20), counterparty enrolment in ongoing monitoring, CSV and CAMT.053 mapping templates, PSD2 partner, behaviour-score proposal threshold. Each needs input listed in spec section 15.

## 7. Acceptance tests against the current build

Of the 15 tests in spec section 13, 1 passes in the code as read, 3 pass in part, 9 fail and 2 depend on the Didit rule setup. These come from reading the code and running the parser, not from clicking through a deployed tenant.

| Test | Today | Why | Fixed in phase |
| --- | --- | --- | --- |
| 1. Upload checks | Partly | IBAN, balance, 18 transactions and 11 counterparties are right. The historical and recent counts are not shown | 1 |
| 2. IBAN mismatch | Fails | Warning only | 1 |
| 3. Historical | Fails | All 18 rows are submitted to Didit | 1 |
| 4. Structuring | Depends on Didit | Needs S-07a active, ordered submission and backdated velocity | 3 |
| 5. Rapid in/out | Depends on Didit | Same, with S-11 | 3 |
| 6. Profile and CoC | Fails | Alert only after the nightly job; the trigger needs two consecutive runs | 3 |
| 7. Re-upload | Partly | All 18 are recognised as duplicates, but the commit ends in a 422 error | 1 |
| 8. Escalate | Fails | Analyst picks the case by hand; no grouping setting | 4 |
| 9. FIU flow | Partly | Draft, review, approval by a Compliance Officer other than the preparer, generation, submission and receipt all work, and Received closes the case. The reference is asked at Received and no CoC event is created | 7 |
| 10. Need-to-know | Fails | No KYC and AML role split | 6 |
| 11. Screening to CoC | Fails | Escalate opens a review directly | 5 |
| 12. Bulk import | Fails | No multi-statement parsing, no unmatched queue | 8 |
| 13. Libraries | Fails | Curaçao button is hardcoded | 2 |
| 14. Manual transaction | Fails | No account or execution date on the form | 8 |
| 15. Webhook dedupe | Passes | `DiditWebhookEvent` is keyed on `event_id`; add an automated test | 0 |

All date-dependent tests (1, 3, 4, 5, 6) need `as_of` 2026-11-03 from phase 0. On the real calendar every row in the sample is older than 30 days from 25 Nov 2026 onward.

## 8. Decisions needed

Ten decisions are open; D3, D5 and D7 block work in phases 0, 7 and 3.

| ID | Question | Recommendation | Blocks | Owner |
| --- | --- | --- | --- | --- |
| D1 | Where do existing pages go that spec section 2 does not list: New Outreach, Outreach Dashboard, Batch Screening, Review Planner, MI Dashboard, Risk Dashboard, Quality, Monitoring MI, Archive, and the client tabs Profile, Related parties, Documents, Audit trail? | Outreach items and Review Planner under KYC. Batch Screening as a button on Screening. MI and Risk as KYC Dashboard tabs. Quality and Monitoring MI as AML Dashboard tabs. Archive under Admin. Client tabs stay after the five new ones | Phase 2 | David |
| D2 | One case engine: merge `KycCase` and `TmCase` into one entity, or keep two and present them as one? | Keep two. The sign-off flow, QC and reports hang on `KycCase`; a merge risks all of it for no user-visible gain | Phase 4 | Dave |
| D3 | Which roles may add accounts and upload statements? | Analyst, QC Reviewer, Compliance Officer, Manager, Compliance Admin, Tenant Admin | Phase 0 | David |
| D4 | One historical window for every channel? The API channel uses 7 days today; the spec default is 30 | One setting, 30 days | Phase 1 | David |
| D5 | FIU generation: Vitauri as primary, Didit API as optional second file? | Yes, for the reasons in section 2 | Phase 7 | David |
| D6 | Role model: a `work_domain` on each user, or new roles "KYC Analyst" and "AML Analyst"? | `work_domain`. New roles would touch every permission list and the sign-off matrix | Phase 6 | Dave |
| D7 | When does a profile overrun become a change of circumstances? Spec test 6 and the prototype create it on the first overrun. Spec section 8 says a structural overrun (2 months above ceiling). The code needs a score above 70 on two consecutive daily runs | Alert at once; CoC by a tenant setting with the spec section 8 rule as default, and a lower setting for the demo tenant so test 6 passes | Phase 3 | David, Compliance |
| D8 | Does Didit count backdated transactions in velocity rules by `transaction_at`? | Test in the sandbox with the 10 recent sample rows. If not, evaluate S-07a and S-11 in Vitauri | Phase 3 | Dave |
| D9 | Is the CTIF-CFI (BE) profile needed now? The enums hold CW and NL | Add when the first BE tenant is signed | Phase 7 | David |
| D10 | Real thresholds, tolerances and review cycles | Keep prototype values as demo data only | Go-live | Compliance |

## 9. Working instructions for Claude Code

Give Claude Code this plan and the package as files in the repo, then run one phase per session.

**Setup**

1. Put the five package files and a Markdown export of this plan in `docs/kyc-aml/`. Name the plan `IMPLEMENTATION_PLAN.md`.
2. Add a `CLAUDE.md` at the repo root with the rules below.
3. Stack: React with Vite in `src`; Base44 backend functions in `base44/functions/<name>/entry.ts` (Deno, `npm:@base44/sdk`); shared modules in `base44/shared`; entity schemas in `base44/entities/*.jsonc`; schedules in `base44/workflows`.
4. Checks available locally: `npm run lint`, `npm run typecheck`, `npm run build`, and `node --test tests/`. Backend functions cannot run locally, so put new logic in `base44/shared` as pure functions and keep `entry.ts` thin.
5. Pushing to the repo updates the Base44 Builder. Work on a branch; merge only after the section 5 smoke checklist passes on the Demo tenant.

**Rules for `CLAUDE.md`**

```markdown
# Vitauri KYC: rules for this repo
- Read docs/kyc-aml/IMPLEMENTATION_PLAN.md first. The build spec leads on logic, the prototype HTML on layout.
- Do one phase per branch. Do not start a later phase early.
- Entity changes are additive only: never rename or remove a field or enum value.
- Reuse existing entities (BankAccount, StatementUpload, Transaction, TmAlert, TmCase, EdrTrigger, FiuReport, TmRule). Do not create Account, Alert, ImportBatch or ChangeOfCircumstances entities.
- Do not edit the files listed in section 5 of the plan unless the current task names them.
- In diditWebhook/entry.ts change only the transaction branch.
- Keep every existing route; add redirects for moved pages.
- New UI goes behind the aml_nav_v2 flag; with tm_core off nothing may change.
- New backend logic goes in base44/shared as pure functions with node:test tests.
- Every backend function scopes by the authenticated user's tenant, never by a tenant id in the payload.
- Write an AuditEvent for every state change, using the existing tm_* event names where one exists.
- UI language is English. No hardcoded thresholds: tenant settings only.
- Before finishing: npm run lint, npm run typecheck, npm run build, node --test tests/.
- If the spec and the code disagree in a way the plan does not cover, stop and ask.
```

**Prompt to start a phase**

```text
Read docs/kyc-aml/IMPLEMENTATION_PLAN.md and docs/kyc-aml/base44-build-spec-kyc-aml.md.
Implement Phase <N> only. Before changing code, list the files you will touch and
confirm none is on the section 5 do-not-edit list unless the phase names it.
Write the unit tests first where the phase lists them. Use
docs/kyc-aml/Lotte_Vermeulen_NL02ABNA0123456789_Jul-Oct2026.mt940 as the fixture with
as_of = 2026-11-03. When done, report: files changed, tests added and their results,
schema fields added, and which smoke-checklist items need a manual check in Base44.
```

**What Claude Code cannot verify itself**

- Anything that needs the deployed Base44 app or the Didit sandbox: the smoke checklist, decision D8, spec tests 4 and 5.
- Row-level security for a KYC-only user (phase 6) needs a real test user.
- These checks stay with Dave or Sai after each phase.
