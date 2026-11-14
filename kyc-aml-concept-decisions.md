# KYC + AML/TM in one tool: concept decisions (working doc)

Status: concept phase with David, nothing built yet. Started 3 Nov 2026 after review of the current TM screens in Vitauri KYC (New Age Bank tenant).

## Findings on the current build
- No Account object: the chain Customer → Account → Data source → Transactions is missing. No place to upload MT940/CAMT/CSV/PDF or connect PSD2; Data coverage stays 0; a manual transaction has no client and no execution date.
- "Cases" appears twice (Reviews → My/All Cases for KYC, Monitoring → Cases for TM) and "Alerts" twice (Screening page is titled "Monitoring Alerts").
- Transactions page description says "screen for sanctions and wallet risk" but it is the transaction ledger; only "+ New Transaction" exists.
- Rules page shows "Library: Curaçao objective indicators" for an NL tenant; libraries must follow tenant jurisdiction. All rules Draft/Not synced; scenario IDs inconsistent.
- FIU Reports "Scan for reports": purpose unclear (reports come from cases or objective indicators).

## Market research (summary)
- Common core objects: Transactions, Alerts, Cases, Rules, with the customer/entity profile as hub.
- Screening hits and TM rule hits usually share one alert queue with a source field (Didit, Salv, SEON, Flagright). Counterparty screening is often a rule type.
- Rules are mostly a top-level item (Didit, Flagright, SEON, Unit21); Sumsub puts them under Configurations → Rule hub.
- Ongoing KYC monitoring is usually a source of case creation, rarely its own menu: a separate KYC monitoring area is a differentiator.
- Typed cases (ComplyAdvantage) and "one case per customer" vs "per rule + customer" grouping (Didit, Sumsub).
- FIU reports live in the case and on their own list (Didit, Sumsub); templates in settings.
- No vendor documents MT940/CAMT.053 import or data-coverage monitoring publicly: opportunity.

## Decisions so far
1. **Cases:** one case engine with types (Onboarding, Periodic review, Event-driven review, TM investigation, Network). Two queues: "Reviews" under KYC and "Investigations" under AML. My Work and the customer file show all.
2. **Navigation (agreed):** Overview (My Work, KYC Dashboard, AML Dashboard with Overview / Data coverage / Detection quality) · Customers (New Client, Client Search; customer file gets "Accounts & transactions") · KYC (Reviews, Screening, Change of circumstances) · AML (Alerts, Investigations, Transactions incl. Import) · Reporting (FIU Reports) · Admin (Audit log, Tenant config General/KYC/AML, Users).
3. **Transaction screening** (counterparty/description sanctions, PEP, adverse media) is a rule type; hits land in AML → Alerts.
4. **Rules setup and calibration live in Tenant config**, not as an operational menu item. Scope (David): detection rules, screening rules, routing & case grouping, FIU mapping & objective indicators, connection to Didit for transaction screening, KYC monitoring triggers (in the KYC tab), customer risk scoring model, risk-class segments, rule governance (versions, backtest, test mode, 4-eyes, owner, review date).
5. **Rule performance** (alerts, outcomes, FP rate, backtest, missed signals) is shown on AML Dashboard → Detection quality, linking back to the rule setup.
6. **Ingestion, all four routes in v1:** upload per account in the customer file (MT940, CAMT.053, CSV, PDF), bulk import under AML → Transactions (match on IBAN, "unmatched" queue), PSD2 via the KYC flow (consent, withdrawal, re-authentication tracked separately), API from the client core system.
7. **KYC risk class tightens TM via thresholds per class** (same rules, class-specific thresholds/windows).
8. **KYC ↔ AML bridge** (to detail):
   - TM → KYC as a Change of circumstances: structural profile overrun, new (high-risk) country or counterparty type, investigation closed with FIU report or true positive, more than X alerts in Y days. Graduated response as in the pKYC design (no action, targeted check, risk reassessment, full CDD refresh; only affected steps re-run).
   - KYC → TM: risk class sets thresholds; PEP / high-risk residence switches on extra rules; approved expected profile version feeds profile rules; "Terminate relationship" puts exit payments under watch; "Blocked" declines transactions.
   - Safeguards: tipping-off lock while an FIU report is in progress; a TM signal never raises the risk class automatically, it proposes and the change goes through the Sign-Off Matrix (highest of existing and proposed).
9. **Counterparty screening (updated after Didit docs check):** Didit presets "Sanctions counterparty matching" and "PEP counterparty exposure" run on every transaction (hits = alerts with source Provider). Recurring and high-risk counterparties are additionally enrolled in Didit ongoing monitoring via /v3/aml after entity resolution. Payment-reference keywords via Didit rule operators; internal watchlist via Didit custom lists.
10. **Unit of work in AML:** alert first. The analyst triages and closes or escalates; escalation creates or adds to an investigation (default one open investigation per customer, configurable per rule).
11. **"Scan for reports" is removed.** Report drafts come from investigations, KYC reviews and objective-indicator rules.
12. **Tenant config split (agreed):** General: company, jurisdictions, users & roles, FIU profiles, data retention. KYC: workflows, review cycles, sign-off matrix, screening settings, change-of-circumstances triggers, risk scoring model. AML: data sources, rules & scenarios, risk-class thresholds, routing & case grouping, FIU mapping, rule governance.
13. **Customer risk:** one official risk class (KYC, via Sign-Off Matrix) with two inputs. TM adds a live behaviour score that can propose a reclassification but never changes the class itself.
14. **Account model:** accounts of one customer, joint accounts (several natural persons), business accounts with related parties (UBOs/directors count for screening and changes), and the customer's own external accounts (PSD2) for own-transfer recognition and KYC transaction analysis.
15. **Who brings data:** analyst in Vitauri (upload, bulk), end customer via secure portal/link (upload, PSD2 connect and re-authentication), client system via API/SFTP.
16. **One FIU register** for reports from AML investigations, KYC reviews (e.g. declined onboarding) and objective indicators.

17. **Screening decides, Change of circumstances acts.** Screening = disposition of hits (is it this person?). A confirmed hit becomes a CoC event next to registry, UBO, ID expiry, address and TM events; CoC sets the graduated response.
18. **Expected profile sources:** client declaration via the KYC client outreach module (purpose of the relationship, expected transaction pattern), KYC transaction analysis, manual input by the analyst, segment defaults. Precedence: segment default applies only until a personal profile is approved; the analyst sets the personal profile from declaration + analysis; a gap between declaration and analysis is recorded as a finding.
19. **First MT940 test = upload in the customer file:** Add account (IBAN, type, holders, source) → upload → IBAN check against :25: → parse :61: and structured :86: (/NAME/, /IBAN/, /REMI/) → checks (:60F: + movements = :62F:, gaps, duplicates, own transfers) → preview → Process → ledger, coverage, one-time counterparty screening, Didit rules → alerts and profile comparison.
20. **Historical uploads: analyse, don't alert.** History feeds the KYC transaction analysis and velocity windows, using original execution dates; only transactions from the last N days (tenant setting) can raise alerts.
21. **Dashboards:** KYC Dashboard = reviews & backlog and risk portfolio. AML Dashboard = alerts & deadlines, and data & detection.
22. **My Work:** two sections, My KYC work and My AML work.

## Didit: datapoints for transaction screening (from public docs, Nov 2026)
- Transaction party object (subject, counterparty): entity_type, vendor_data, full_name / first_name / last_name, date_of_birth, country_code, address, device_context. payment_method: method_type, account_id, issuing_country. transaction_details: direction, amount, currency, currency_kind, action_type, payment_details (free text), payment_reference_id. Plus transaction_id, transaction_at, transaction_category, custom_properties (rules read custom_values.<key>).
- Rules can test payment_details with contains / contains_any / regex / fuzzy_match, and test fields against custom lists (value_type "list").
- Blocklists (account_id, IP, device, vendor_data) are checked before rules.
- Crypto counterparty wallet screening is automatic and well documented.
- **Fiat counterparty sanctions/PEP screening on the transaction is mentioned but not specified** (which fields, automatic or per rule, results). Person AML endpoint POST /v3/aml/ (full_name, entity_type, date_of_birth, nationality, include_adverse_media, vendor_data; ongoing monitoring optional) is documented and returns hits with match and risk scores.
- Not documented: BIC/bank name fields, sanctions screening of the payment reference, ongoing monitoring of counterparties. Ask Didit to confirm.

23. **Visibility: need-to-know.** KYC roles see an "AML hold" badge but not investigation or FIU content; outreach is blocked or neutral while an AML matter is open. Role model (separate or combined) is configurable per tenant.
24. **Didit:** use the public docs, no question list to Didit. Developer action point: Didit FIU report generation is console-only in the public docs; David indicates an API was tested; developers confirm, otherwise Vitauri generates goAML XML.
25. **Deliverables:** clickable prototype (https://claude.ai/artifact/P1Ha3MEA4QhgWkCXSPb8QJ) and Base44 build spec `aml-tm/base44-build-spec-kyc-aml.md`, plus sample MT940 file for testing.

## Open questions
- Real thresholds, review cycles and tolerance values (Compliance).
- PSD2 partner selection.
