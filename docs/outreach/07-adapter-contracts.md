# Adapter contracts

Each adapter is a backend function behind a stable interface, so a vendor can be replaced without touching the conversation. The conversation only knows the interfaces below.

**Status of vendor facts.** Facts about KvK, Company.info and Didit come from their public pages at the time of research (autumn 2026) and from earlier analysis in the project (`kyb-integration-brief`, `outreach-module-analyse-advies`). Endpoint names and prices must be checked in the vendors' current documentation before building. Where this file says "verify", the developer must verify.

All adapters:
- read credentials from the tenant's secrets (`TenantConfig.Outreach.integrations`), never from the browser;
- write an `AdapterCall` row (vendor, operation, cost, status) and an audit event;
- return a normalised result, never the raw vendor payload, plus `source` (the datapoint source code) and `retrieved_at`;
- fail soft: return `{ok:false, error_code, message}` and let the conversation fall back (section 10 of the spec).

---

## 1. KvK adapter (Dutch trade register)

Interface

```
kvk.search({query, limit=10}) -> {ok, results:[{kvk, name, legal_form, city, status, branch_type}], cost_eur:0}
kvk.profile({kvk}) -> {ok, profile:{kvk, rsin, name, trade_name, legal_form, status, address, sbi, registered_since}, cost_eur:0.02}
```

Behaviour
- `search` powers the typeahead: debounce about 250 ms, minimum 2 characters, match on name or KvK number. Only active hits are selectable for onboarding; inactive hits are shown with a red status pill and lead to the stop message.
- `profile` is called once, when the client selects an organisation. Cache the result for the life of the request.
- Normalise "Active" and "Inactive (dissolved)" into a single `status` text. The conversation treats any status that does not start with "Active" as inactive.
- Map to datapoints with source `kvk`: `legal_name`, `reg_no`, `rsin`, `legal_form`, `co_status`, `co_address`, `sbi`, `reg_date`, `trade_name`.

Facts to verify (public pages, autumn 2026)
- Zoeken is free. Basisprofiel, Vestigingsprofiel and Naamgeving cost about EUR 0.02 per call. Subscription about EUR 6.40 per month. A Mutatieservice (change notifications) exists at about EUR 1,279 per year. UBO extract about EUR 3.10 (PDF; a JSON "UBO API" is expected later; not used here).
- The API does **not** return directors, signatories, shareholders or annual accounts. That is why the director proposal comes from a second source and the owners come from the client.
- Terms: a vendor may not use one key for many customers (each customer needs its own authorisation and key), may not build its own database from KvK data, and UBO data may only be used for AML purposes. Settle the legal route before production (spec open item 1).
- Test environment: the KvK developer portal offers a test environment with fixed test companies. Verify the base URL and test key there.

Errors to handle: 401 (key), 404 (no such number), 429 (rate limit; back off), 5xx and timeouts (message "We could not reach the trade register right now." with "Try again" and "Continue with documents").

---

## 2. Second source: management and parent company (Dutch organisations)

Candidate: Company.info "Organisatieprofiel" (management, parent and ultimate parent, group tree). Alternatives: any provider that returns management from the trade register extract.

Interface

```
second_source.management({kvk}) -> {ok, directors:[{name, role, authority_text, since}], parent:{name, kvk|null}|null, cost_eur}
```

Behaviour
- Called once after the client confirms the organisation (route nl).
- Output is a **proposal**: it is shown with checkboxes, the client confirms, adds or removes. Source `prop`.
- The parent company, when present, is pre-added as a company row (no percentage) in the owners builder.
- If the vendor fails or is disabled: ask for the directors without a proposal.

Facts to verify
- Prices are not published (pay as you go in arrears, offer required). A trial key takes about two working days. Resale requires written permission (reseller programme). The vendor also offers a "UBO Onderzoek" (beta) that analyses trade register extracts; it is not the official UBO register and is not used here.
- Coverage outside the Netherlands is not verified and not needed here.

---

## 3. Didit ID&V adapter (persons)

Interface

```
idv.createSession({request_id, party_id|null, first_name_hint, locale, return_url}) -> {session_id, url, qr_payload}
webhook /idv/result -> {session_id, status:'approved'|'declined'|'in_review', person:{full_name, date_of_birth, nationality, document:{type, country, number, expires}}, checks:{document_read, liveness, face_match, document_valid}}
```

Behaviour
- `createSession` is called when the `idv` widget is shown. The QR encodes `url`. On a phone-sized screen the button opens `url` on the same device and returns to the portal at `return_url`.
- The portal waits for the webhook (or polls the session status every few seconds as a fallback). On `approved` the four checks show as passed, datapoints `full_name`, `dob`, `nat`, `doc` are written with source `idv`, and the conversation continues with the confirmation question.
- `declined`: tell the client the check did not pass, allow a new session (limit the number of attempts, tenant config). `in_review`: tell the client a colleague will look at it and let the conversation continue where the template allows.
- The webhook must verify its signature with the webhook secret and be idempotent.
- For the representative and related parties the same adapter is used. When a name is known (declared representative, invited person), compare it with `person.full_name` and raise a flag on mismatch (audit `rep.match`).

Facts to verify: current session API and webhook payload in Didit's documentation; processing region of biometric data (the prototype states EU processing and deletion after verification: confirm with Didit before using that text); price per verification.

---

## 4. Document AI adapter

Interface

```
document.check({file, kind, checks:[...], context}) -> {ok, checks:[{name, ok, message}], read_fields:{...}|null, model_version}
document.read_extract({file, country}) -> {ok, fields:{legal_name, registration_number, legal_form, registered_address, activity, registration_date, officers:[{name, role, authority_text}]}, confidence, issue_date, model_version}
```

Behaviour
- `kind`: proof_of_address | trade_register_extract | articles | shareholder_register | partnership_agreement | power_of_attorney | loan_agreement | wealth_evidence | payslip | annual_accounts.
- Checks per kind are defined on the block (`document_checks`). Age checks use the issue date from the document and `documentMaxAgeMonths`. Name checks compare with the ID name or with the registry name.
- `read_extract` output is shown to the client as a proposal (tag "Read from your document", pill "AI-assisted"). The client confirms or corrects. The values get source `doc`, or `rep` after correction. An analyst task is created to compare with the original.
- Use structured output (JSON schema) with the platform's LLM integration; never put the raw model text in front of the client. Store `model_version` on the EvidenceFile.
- The AI result never accepts or rejects the application. It only produces check results and proposals.

---

## 5. AI follow-up phrasing

Interface

```
ai.followup({block_key, trigger_id, answer, default_question, risk_class}) -> {question, model_version}
```

Rules: see spec section 6.2. If the call fails or the output breaks the limits (more than one question, more than two sentences, mentions risk or screening), send `default_question`.

---

## 6. Address lookup (NL, UK, IE)

Simulated in the prototype (UK fixture: Upper Street, London). Production: a postcode lookup provider per country. Not on the critical path; manual entry stays possible.

---

## 7. Email

Templates per tenant: invitation (NP, ORG representative, related party), reminder, "new message from a colleague", "invitation sent to your colleague" (optional). Links always carry the request token. Do not put personal data other than the first name and the company name in the email body.
