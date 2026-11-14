# Build spec: KYC + AML/TM in one tool (navigation, accounts and ingestion, alerts, investigations, FIU register, KYC↔AML bridge)

For: developers building in Base44. Owner: David Zwarts, Vitauri.
Visual and interaction reference: clickable prototype "Vitauri KYC + AML Prototype" (https://claude.ai/artifact/P1Ha3MEA4QhgWkCXSPb8QJ, also shared as HTML). Use "View as" to switch roles and "Show build notes" to see which decision each screen implements.
Concept decisions: project doc `aml-tm/kyc-aml-concept-decisions.md` (decision numbers below refer to it).

**How to use this document.** The prototype shows layout and flow. This document says what must be true underneath: data, rules, states, permissions and wording. Where the two differ, this document wins on logic and the prototype wins on layout. Everything marked **Tenant config** must be a setting, not hardcoded. UI language: English.

---

## 1. Scope and what changes in the current build

| Current build | Problem | Change |
|---|---|---|
| No Account object; Transactions only via "+ New Transaction" | MT940/CAMT/CSV/PDF cannot be uploaded; Data Coverage stays 0; a manual transaction has no client and no execution date | Add Account, DataSource, ImportBatch (section 3). Upload in customer file, bulk import under AML → Transactions. Manual entry requires customer, account and execution date |
| Reviews → My Cases / All Cases and Monitoring → Cases | Two "Cases" | One case engine with `case_type`. KYC queue "Reviews", AML queue "Investigations" |
| Monitoring → Screening page titled "Monitoring Alerts" | Two "Alerts" | Screening moves to KYC group (customer, UBO, director screening). Transaction/counterparty screening becomes rule types in AML → Alerts |
| Monitoring → Transactions described as "screen for sanctions and wallet risk" | It is the ledger | AML → Transactions = ledger + Import. Description: "Transaction ledger across all customers and accounts" |
| Control → Rules | Setup is admin work, performance is operational | Rules setup and calibration → Tenant Config → AML → Rules & scenarios. Performance → AML Dashboard → Detection quality |
| Control → Data Coverage | Measurement belongs on a dashboard | AML Dashboard → Data coverage tab. Actions (upload, re-auth link) stay in the customer file |
| Rules page shows "Library: Curaçao objective indicators" for an NL tenant | Wrong library | Libraries offered follow `tenant.jurisdictions` |
| Scenario IDs inconsistent (—, S-CW-OBJ-CASH, S-12) | No traceability | Every rule links to a risk and a scenario ID in the coverage matrix |
| FIU Reports "Scan for reports" | Unclear | Remove. Drafts come from investigations, KYC reviews and objective-indicator rules |

Out of scope here: the existing 8-step KYC workspace and the Sign-off & QC flow (see `case-workspace/base44-build-spec-signoff-qc.md`), PDF statement extraction (AI), PSD2 partner selection.

---

## 2. Navigation (final)

```
OVERVIEW   My Work · KYC Dashboard · AML Dashboard (tabs: Overview, Data coverage, Detection quality)
CUSTOMERS  New Client · Client Search  (customer file gets tabs: Overview, Accounts & transactions, Expected profile, Reviews & changes, Alerts & investigations)
KYC        Reviews · Screening · Change of circumstances
AML        Alerts · Investigations · Transactions
REPORTING  FIU Reports
ADMIN      Audit Log · Tenant Config (General / KYC / AML) · Users
```

Visibility per role is in section 4. Badges show open counts (Alerts badge red).

---

## 3. Data model

Names are suggestions. Keep the fields and relations. Existing entities (Client, Case, ReportVersion, AuditEvent, TenantConfig.SignOffMatrix) stay as specified in the sign-off spec; additions are marked.

**Client** (existing, add fields)
- `risk_class` (official, Low | Medium | High | Unacceptable; only changed via a review and the Sign-Off Matrix)
- `behaviour_score` (0–100, live, calculated by TM; null if no data)
- `segment` (for segment-default profile), `pep` (bool), `aml_hold` (calculated: open investigation or FIU report not yet Received)

**Account** (new)
- `id`, `client_id`, `iban`, `account_type` (Own | External (PSD2) | Joint | Business)
- `holders` (array of client/related-party refs; joint = several natural persons; business = org + UBOs/directors as related parties)
- `source` (Upload | PSD2 | API | SFTP), `status` (No data yet | Live | Processed | Re-auth pending | Re-auth link sent | No data for n days | Consent withdrawn), `last_data_date`
- PSD2 only: `consent_given_at`, `consent_withdrawn_at`, `reauth_due_at` (consent, withdrawal and re-authentication are separate fields)

**ImportBatch** (new, one per uploaded/imported file)
- `id`, `route` (customer_upload | bulk_import | api | psd2_sync), `file_name`, `format` (MT940 | CAMT.053 | CSV | PDF), `uploaded_by`, `uploaded_at`
- `statements[]`: `iban`, `opening_balance`, `closing_balance`, `period_from`, `period_to`, `tx_count`, `balance_reconciles` (bool), `duplicates_skipped`, `own_transfers`, `historical_count`, `matched_account_id` (null → unmatched queue)

**Transaction** (existing, add fields)
- `client_id` (required), `account_id` (required), `executed_at` (required; original booking date), `received_at` (when Vitauri got it), `intended_at` (API only)
- `amount` (signed), `currency`, `direction`, `lifecycle` (Intended | Declined | Booked | Reversed | Corrected), `related_to` (original booking for reversal/correction)
- `counterparty_name`, `counterparty_iban`, `counterparty_country` (from IBAN), `counterparty_id` (entity resolution), `reference` (REMI), `raw_description` (:86:)
- `import_batch_id`, `dedupe_key` (hash of account + executed_at + amount + counterparty_iban + reference), `own_transfer` (bool), `historical` (bool, see 5.4)
- Didit: `didit_txn_uuid`, `didit_status` (Approved | In review | Declined | Awaiting user | Not submitted), `didit_score`, `rule_runs`, `last_event_id`

**Counterparty** (new)
- `id`, `name_normalised`, `iban(s)`, `country`, `entity_type`, `match_confidence`, `merged_from[]` (reversible merges)
- `screening_status` (Not screened | Clear | Hit), `last_screened_at`, `ongoing_monitoring` (bool, Didit /v3/aml enrolment)

**ExpectedProfile** (new, versioned per client)
- `client_id`, `version`, `status` (Draft | Approved | Superseded), `approved_by`, `approved_at`, `valid_until`, `rationale`
- `inbound_max_month`, `outbound_abroad_max_month`, `tx_max_month`, `countries[]`, `cash`, `purpose`
- `sources` (client_declaration | kyc_transaction_analysis | analyst | segment_default), `declared_values` (from outreach), `analysis_values`, `finding_gap` (text, when declaration and analysis differ)
- Rule: segment default applies only until a personal profile is Approved. Deviating behaviour never becomes the new normal automatically.

**Alert** (new or replace)
- `id`, `client_id`, `source` (Rule | Provider | Profile | Manual), `rule_id`, `rule_version`, `score`, `due_at`, `status` (New | Triage | Escalated | Closed)
- `transactions[]`, `ai_proposal`, `ai_reason`, `ai_followed` (bool, set on decision), `closed_reason`, `investigation_id`
- `snapshot`: profile version, risk class, FX rate, screening result, model version (reproducibility)

**Case** (existing, extend `case_type`)
- `case_type`: Onboarding | Periodic review | Event-driven review | Re-application | **TM investigation** | **Network investigation**
- TM/Network only: `alerts[]`, `subjects[]` (Network: several clients), `outcome` (Reported to FIU | No report, explained | True positive, motivated no-report), `fiu_report_id`

**ChangeOfCircumstances** (new)
- `id`, `client_id`, `source` (Screening | Registry | ID document | Address | TM · profile deviation | TM · new country/counterparty type | TM · investigation outcome | TM · alert frequency), `text`, `restricted` (bool: TM outcome details hidden from KYC roles)
- `response` (No action | Targeted check | Risk reassessment | Full CDD refresh), `status` (Awaiting response | Outreach sent | Review started | Closed), `review_case_id`

**FIUReport** (new or replace)
- `id`, `source` (AML investigation | KYC review | Objective indicator), `origin_id`, `client_id`, `fiu_profile` (FIU-Netherlands | CTIF-CFI | FIU Curaçao), `report_type`, `indicator_codes[]`
- `status` (Draft | In review | Approved | Generated | Submitted | Received), `approved_by`, `generated_at`, `file_hash`, `submitted_at`, `submission_method` (portal upload | API), `fiu_reference`, `received_evidence`
- Deadline clock: `executed_at`, `received_at`, `discovered_at`, `escalated_at`, `decided_at`, `due_at`

**Rule** (existing, extend)
- `id` (scenario ID, unique), `name`, `type` (Detection | Screening), `engine` (Didit | Vitauri), `library` (Wwft | AMLR | Didit preset | Custom), `risk_id`, `scenario_id`
- `thresholds_by_class` {Low, Medium, High, PEP}, `mode` (Draft | Test | Active | Disabled), `version`, `sync_status`, `owner`, `review_date`, `fiu_mapping` {profile: indicator code}, `auto_fiu_draft` (bool), `last_backtest` {evaluated, matched, affected_entities, period_days}

**TenantConfig** (additions, section 11) and **AuditEvent** (append-only, section 12).

---

## 4. Roles and visibility (need-to-know)

Role model is **Tenant config**: `separate` (KYC analyst, AML analyst, Compliance officer/MLRO, Tenant admin) or `combined` (one analyst role does both).

| Item | KYC analyst | AML analyst | Compliance / MLRO | Tenant admin |
|---|---|---|---|---|
| KYC group, KYC Dashboard | yes | no (yes if combined) | yes | yes |
| AML group, AML Dashboard, Reporting | no | yes | yes | yes |
| Customer file: AML tab | no | yes | yes | yes |
| "AML hold" badge on customer | yes | yes | yes | yes |
| Investigation / FIU content | no | yes | yes | yes |
| Approve FIU report | no | no | yes | no |
| Tenant Config, Users | no | no | yes | yes |

Rules:
- While `aml_hold` is true, client outreach about transactions is blocked or must use a neutral template (no tipping-off). Applies to KYC outreach, secure links and RFIs.
- `restricted` CoC events show to KYC roles as "AML outcome requires a review · details restricted to AML and Compliance".
- The preparer of an FIU report cannot approve it (four eyes).

---

## 5. Ingestion

### 5.1 Upload in the customer file (first test flow)
Customer → Accounts & transactions → **Add account** (IBAN, type, holders, source) → **Upload statement** on the account → 4-step dialog:
1. **Account**: show customer, IBAN, type, holders.
2. **File**: drag and drop or choose. Accept MT940 (.sta, .940, .mt940, .txt, .swi); CAMT.053 and CSV use the same flow with their own parser.
3. **Checks & preview** (all shown, before anything is saved):
   - IBAN in file (`:25:`) equals the account IBAN. If not: block, offer "choose other account", "add this IBAN as account", "cancel".
   - Balance: `:60F:` + sum of `:61:` = `:62F:`. Show the three amounts.
   - Count and period of transactions; number of months.
   - Duplicates against earlier uploads (by `dedupe_key`) are skipped and counted.
   - Transfers between the customer's own accounts are flagged and not counted twice in profile checks.
   - Count historical vs recent (5.4).
   - Counterparties found in `:86:`.
   - Preview table: date, amount, counterparty (/NAME/), IBAN (/IBAN/), reference (/REMI/).
4. **Process** → result: transactions added (historical count), coverage filled, counterparties screened, recent transactions submitted to Didit, alerts raised, CoC events proposed. Buttons: View transactions, Open alerts.

**MT940 parsing.** Tags: `:20:` (statement ref), `:25:` (account; strip non-alphanumerics), `:28C:`, `:60F:`/`:60M:` (C/D, YYMMDD, currency, amount with comma), `:61:` (value date YYMMDD, optional entry date MMDD, `C`/`D`/`RC`/`RD`, optional funds code letter, amount with comma, transaction type), `:86:` (continuation lines joined; structured subfields `/NAME/`, `/IBAN/`, `/BIC/`, `/REMI/`, `/EREF/`, `/TRTP/`; fall back to free text), `:62F:`/`:62M:`. A file can contain several statements (split on `:20:`). `RC`/`RD` → lifecycle Reversed.

### 5.2 Bulk import (AML → Transactions → Import file)
One file, many statements. Each statement is matched on IBAN to an Account. Matched statements run the same checks and processing as 5.1. Unmatched IBANs go to an **Unmatched accounts** queue on the Transactions page (IBAN, count, period, "Link to customer"); their transactions are held until linked.

### 5.3 PSD2 and API
- **PSD2** via a licensed AIS partner, started from the KYC flow or a secure link to the customer. Daily sync = post-event review. Track consent, withdrawal and re-authentication separately; "Send re-auth link" action on the account; re-auth due creates a data action in My Work.
- **API / SFTP** from the client's core system: canonical transaction schema incl. `intended_at` for pre-execution checks.

### 5.4 Historical data: analyse, don't alert (Tenant config `historical_window_days`, default 30)
Transactions with `executed_at` older than the window are stored with `historical = true`, feed the KYC transaction analysis and velocity windows, and are **not** submitted to Didit for decisions and raise **no alerts**. Didit is called with the original `executed_at`; it cannot stop past transactions.

---

## 6. Detection and Didit integration

**Didit facts (public docs, Nov 2026)** used in this design:
- Transaction party fields: `entity_type`, `vendor_data`, `full_name`/`first_name`/`last_name`, `date_of_birth`, `country_code`, `address`. `payment_method`: `method_type`, `account_id`, `issuing_country`. `transaction_details`: `direction`, `amount`, `currency`, `currency_kind`, `action_type`, `payment_details`, `payment_reference_id`. Top level: `transaction_id`, `transaction_at`, `transaction_category`, `custom_properties` (rules read `custom_values.<key>`).
- No BIC/bank name field. IBAN goes in `account_id`.
- Counterparty screening via presets "Sanctions counterparty matching" and "PEP counterparty exposure"; reference keywords via `contains_any`/regex. Hits arrive as alerts with source `PROVIDER`.
- Alerts are console-only (no public alert API). Webhooks: `transaction.created`, `transaction.status.updated` (alert lifecycle webhooks on Didit's roadmap).
- Rules API: `GET/POST /v3/transactions/rules/`, `GET/PATCH/DELETE /v3/transactions/rules/{uuid}/`, `POST /v3/transactions/rules/backtest/`, `GET /v3/transactions/rules/library/`, `POST/DELETE /v3/transactions/rules/install/`. Modes Active/Test/Disabled.
- Lists API: `POST /v3/lists/` (custom lists; entry type `bank_account` for IBANs), referenced in rules with `value_type: "list"`.
- Cases: one subject per case; grouping `by_applicant` or `by_rule_and_applicant`.
- No bulk transaction API: submit per transaction.

**Mapping.** `vendor_data` = Vitauri client ID. Send `custom_properties`: `risk_class`, `pep`, `profile_version`, `profile_inbound_max`, `profile_countries`. Counterparty party object from the parsed `:86:` (name, IBAN in `payment_method.account_id`, country from IBAN).

**Webhooks.** Verify HMAC signature; deduplicate on `event_id` (not on transaction id); then fetch the full record with `GET /v3/transactions/{id}/`; create or update the Vitauri Alert from `rule_runs` / provider results. Replay on failure.

**Where rules run.**
- Didit: thresholds, velocity, structuring, rapid in/out, FATF countries, counterparty sanctions/PEP presets, reference keywords.
- Vitauri: profile rules (actual vs approved expected profile), money-flow/network scenarios across accounts and customers, alert-frequency triggers. Their alerts use the same Alert entity (`source` Profile or Rule).

**Risk-class thresholds** (decision 7): same rules for all; `thresholds_by_class` per rule (Low/Medium/High/PEP). Pushed to Didit as separate rule variants or as conditions on `custom_values.risk_class`.

**Counterparty screening** (decision 9 as updated): Didit presets on every transaction in real time; plus recurring or high-risk counterparties (Tenant config: e.g. ≥ 3 transactions in 90 days, high-risk country, or client High/PEP) enrolled in Didit ongoing monitoring via `/v3/aml` after entity resolution. Internal watchlist of names and IBANs via Didit custom lists.

---

## 7. Alerts and investigations

**Alert states:** New → (AI triage proposal) → Closed (reason required; AI followed/overridden stored) or Escalated.
**Escalate:** adds the alert to the client's open investigation, or creates one (Tenant config `grouping`: one open investigation per customer | per rule + customer). Auto-create investigation for objective indicators and confirmed sanctions hits (Tenant config).
**AI triage:** shows proposal + reason + sources, never a percentage until calibrated per scenario. AI never closes a true hit and never submits a report. Bulk close only for alert types released after measurement.

**Investigation screen:** bundled alerts, AI evidence (with sources), transactions in scope, outcome buttons: **Prepare FIU report** (AI agent drafts from KYC file + transactions + investigation; sets `aml_hold`), **Close: explained, no report**, **Close: true positive, motivated no-report**. Network investigation links several clients (Didit cases have one subject: keep the link in Vitauri).

---

## 8. KYC monitoring and the KYC↔AML bridge

- **Screening** (customer, UBOs, directors; Didit `/v3/aml` with ongoing monitoring): disposition only: **True match** | **Not this person** (with rationale). True match → creates a ChangeOfCircumstances event (source Screening).
- **Change of circumstances**: one list of events from all sources. Analyst chooses the response: No action | Targeted check | Risk reassessment | Full CDD refresh. Anything but No action creates an **Event-driven review** case; only affected steps re-run (delta review).
- **TM → KYC triggers** (Tenant config, KYC tab): structural profile overrun (e.g. 2 months above ceiling + tolerance per class), new high-risk country or counterparty type, investigation closed with FIU report or as true positive (`restricted`), more than X alerts in Y days.
- **KYC → TM:** risk class selects thresholds; PEP / high-risk residence enable extra rules; approved profile version feeds profile rules; "Terminate relationship" puts exit payments under watch; status Blocked declines transactions.
- **Behaviour score** can only propose a reclassification (CoC event). The official risk class changes only through a review and the Sign-Off Matrix (highest of existing and proposed).
- **Expected profile sources:** client declaration via outreach (purpose of the relationship, expected transaction pattern), KYC transaction analysis (1 day to 60 months of statements), analyst input, segment default. Gap between declaration and analysis = finding.

---

## 9. FIU register (Reporting → FIU Reports)

- One register for all sources: AML investigation, KYC review (e.g. decline flow step "Assess unusual-transaction reporting obligation"), objective-indicator rule (auto draft).
- Status flow: Draft → In review → Approved (MLRO, four eyes) → Generated (goAML XML + hash) → Submitted (method + FIU reference) → Received (evidence). **A generated file is not a submission.**
- Deadline clock per report: executed, received by Vitauri, discovered, escalated, decided, due. Never measured from upload time alone; show expired deadlines.
- FIU profiles (Tenant config General): FIU-Netherlands, CTIF-CFI (BE), FIU Curaçao; per profile: language, timing rules, goAML schema version, indicator code lists.
- Receiving the report closes the investigation as "Reported to FIU" and creates a restricted CoC event.

> **Developer action point (priority):** Didit's public docs show FIU report generation (goAML XML / PDF, report types incl. UTR) as console-only, without an API. David indicates an API was tested. Confirm the endpoint (create report from case, fetch XML, template fields `rentity_id`, submission code, currency, `enabled_fields`) and document it. If no API exists, Vitauri generates goAML XML itself per FIU profile. Either way the register, statuses and evidence live in Vitauri.

---

## 10. Dashboards and My Work

- **My Work:** two sections, "My KYC work" (reviews, screening hits, CoC responses) and "My AML work" (alerts, investigations, FIU reports, data actions like stalled connections and PSD2 re-auth). Sorted by due date; each row deep-links.
- **KYC Dashboard:** reviews & backlog (open by type, sign-off queue, SLA, upcoming periodic reviews, CoC events) and risk portfolio (clients per class, PEPs, classification changes).
- **AML Dashboard:** tab Overview (open alerts by source, deadlines, investigations, FIU), tab Data coverage (per account per day: expected, received, processed, reviewed; stalled connections; no data yet), tab Detection quality (per rule: alerts, escalation rate, FP rate, last backtest, below-the-line results; coverage gaps; AI performance per scenario; link to the rule in Tenant config).

---

## 11. Tenant config

- **General:** company & jurisdictions (drive libraries and FIU profiles), users & roles (role model separate | combined), FIU profiles, data retention (set by Compliance and privacy officer; no default).
- **KYC:** workflows (incl. new outreach questions), review cycles, sign-off matrix (existing), screening settings, change-of-circumstances triggers and default responses, risk scoring model (official class + behaviour score inputs + proposal threshold).
- **AML:** data sources (routes, formats, PSD2 partner, `historical_window_days`), Didit connection (key, webhooks, field mapping), rules & scenarios (libraries per jurisdiction, plain-language rule drafting, mode, version, owner, review date), risk-class thresholds, routing & case grouping (unit of work, grouping, auto-create, priority, SLA, auto-close policy), FIU mapping & objective indicators, counterparty screening (real-time presets, re-screening enrolment criteria, custom lists), rule governance (versions, backtest + test mode + four eyes before Active, reproducibility snapshot).

---

## 12. Audit trail events (append-only)

`account.added`, `import.uploaded`, `import.checked` (balance result, duplicates, historical count), `import.processed`, `import.unmatched`, `psd2.consent_given|withdrawn|reauth_sent`, `didit.submitted`, `didit.webhook_received` (event_id), `alert.created` (source, rule version), `alert.ai_proposed`, `alert.closed` (reason, AI followed/overridden), `alert.escalated`, `investigation.created|closed`, `fiu.drafted` (AI-assisted), `fiu.approved`, `fiu.generated` (hash), `fiu.submitted` (reference), `fiu.received`, `screening.dispositioned`, `coc.created|responded`, `profile.version_approved`, `rule.changed|backtested|approved|mode_changed`, `config.changed`.

---

## 13. Acceptance tests (Given / When / Then)

Use the sample file `Lotte_Vermeulen_NL02ABNA0123456789_Jul-Oct2026.mt940` (client Lotte Vermeulen, Medium, profile v2 inbound ≤ €3,800; today 3 Nov 2026; window 30 days).

1. **Upload checks.** When the sample is uploaded on account NL02ABNA0123456789: IBAN matches; €1,250.00 + €8,480.00 = €9,730.00; 18 transactions 25-07 → 25-10; 8 historical, 10 recent; 11 counterparties.
2. **IBAN mismatch.** Given the account is another IBAN, processing is blocked with the three options.
3. **Historical.** The 8 transactions before 4 Oct are stored as historical, not sent to Didit for decisions and raise no alert.
4. **Structuring.** 6 different senders paying €1,750–€1,999 between 14 and 20 Oct → one structuring alert (Medium threshold 4).
5. **Rapid in/out.** €5,000 to LT on 16 Oct (90% of €5,550) and €5,100 to LT on 21 Oct (91% of €5,630) → two rapid in/out alerts.
6. **Profile.** October inbound €14,080 vs ceiling €3,800 → profile alert + CoC event "TM · profile deviation" in KYC.
7. **Re-upload.** Uploading the same file again adds 0 transactions (18 duplicates skipped).
8. **Escalate.** Escalating two of Lotte's alerts creates one investigation and adds the second to it (grouping one open per customer).
9. **FIU flow.** Prepare FIU report → Draft (source AML investigation) → analyst cannot approve; MLRO approves → Generate → Submitted requires an FIU reference → Received closes the investigation "Reported to FIU" and creates a restricted CoC event.
10. **Need-to-know.** As KYC analyst, the AML group and Reporting are hidden; Lotte shows "AML hold" while the report is open; the CoC text reads "details restricted"; outreach links are blocked.
11. **Screening → CoC.** "True match" on a screening hit creates a CoC event; choosing "Risk reassessment" creates an Event-driven review.
12. **Bulk import.** A file with statements for a known and an unknown IBAN processes the known one and puts the unknown in Unmatched accounts.
13. **Libraries.** For an NL tenant, the Curaçao library is not offered.
14. **Manual transaction.** Cannot be saved without customer, account and execution date.
15. **Webhook dedupe.** The same `event_id` delivered twice creates one update; a second status change with a new `event_id` is applied.

---

## 14. Suggested build order for Base44

1. Entities: Account, ImportBatch, Transaction fields, Counterparty, ExpectedProfile, Alert, case_type extension, ChangeOfCircumstances, FIUReport, Rule fields; roles and visibility (sections 3, 4).
2. Navigation restructure (section 2) with empty states.
3. MT940 parser + upload dialog + checks (5.1) as one backend function `parseAndCheckStatement(file, accountId)` with tests 1–3 and 7.
4. Processing: ledger write, dedupe, historical flag, Didit submission, webhook handler with event_id dedupe (section 6).
5. Vitauri profile rule + alert creation; Alerts screen; escalate → investigation (section 7).
6. FIU register and status flow (section 9) — after the Didit FIU API check.
7. Screening disposition → CoC → event-driven review (section 8).
8. Dashboards and My Work (section 10), then Tenant config screens (section 11).
9. Bulk import + unmatched queue, PSD2 connection, CAMT.053/CSV parsers.

**Prompt starters** (attach the prototype HTML as visual reference):
- "Add the entities from section 3 of the attached spec. Do not add fields that are not listed. Transactions require client_id, account_id and executed_at."
- "Restructure the sidebar exactly as section 2. Hide groups per role as in section 4."
- "Create a backend function parseAndCheckStatement for MT940 as specified in 5.1 and return the check list and preview rows. Write tests with the attached sample file (acceptance tests 1–3, 7)."
- "Build the Upload statement dialog like the prototype (4 steps). Nothing is saved before the user clicks Process."

---

## 15. Developer action points and open items

1. **Didit FIU report API** (section 9): confirm and document, or build goAML generation in Vitauri.
2. **Didit alert API / alert webhooks**: on Didit's roadmap; until then build alerts from `transaction.status.updated` + `rule_runs`.
3. **Fiat counterparty screening details**: confirm which party fields the Didit presets use, and whether counterparties can be enrolled in ongoing monitoring other than via `/v3/aml`.
4. **CSV/CAMT.053 formats**: define mapping templates; PDF extraction is a later item.
5. **PSD2 partner**: selection and consent/re-auth webhooks.
6. **Field naming**: Didit docs use both `transaction_at` and `txn_date`; verify against the API.
7. **Thresholds and review cycles**: example values in the prototype are illustrative; Compliance sets real values.
