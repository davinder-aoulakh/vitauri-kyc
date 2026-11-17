# Build spec: Client Outreach module (Natural Persons, Organisations and related parties)

For: developers building in Base44. Owner: David Zwarts, Vitauri.
Visual and interaction reference: the clickable prototype, shared as `outreach-portal-prototype.html` in this pack and as a hosted link: https://claude.ai/artifact/RHA2DfyK6zRy2Uh6i86ab3
Language of the UI: English. Every client-facing string must be translatable (NL comes later, structure now).

**How to use this document.** The prototype shows what it should look and feel like and gives the exact wording. This document says what must be true underneath: data, rules, states, permissions and integrations. Where the two differ, this document wins on logic and the prototype wins on layout and wording. Everything marked **Tenant config** must be a setting, not hardcoded. Everything marked **Not in prototype** is required here but cannot be seen there.

---

## 0. What is in this pack

| File | What it is |
|---|---|
| `00-README.txt` | Start here: what the pack is and how to use it |
| `01-Base44-Build-Spec-Client-Outreach.md` | This document |
| `02-block-library.json` | Every building block: question, options, why-text, follow-up rules, evidence, KYC mapping, datapoints. NP and ORG. Machine-readable seed for the Outreach Templates page |
| `03-form-templates.json` | The three Form Templates (Onboarding NP, Onboarding ORG, Related party) with block order and settings |
| `04-datapoint-catalogue.txt` | Every datapoint key with label, allowed sources and the block that sets it |
| `05-demo-fixtures.json` | Fictional test data: KvK fixtures, persons, document-reading results. Use as seed and test data |
| `06-conversation-transcripts.txt` | The exact conversations for four client journeys (two NP, two ORG) plus the two related-party journeys, as the prototype produces them (wording reference) |
| `07-adapter-contracts.md` | Interface contracts for KvK, the second source (Company.info or equal), Didit ID&V and AI document reading, with costs and terms to confirm |
| `08-design-tokens-and-ux-notes.txt` | Colors, type, spacing, responsive and accessibility rules taken from the prototype |
| `09-prototype-guide.txt` | How to operate the prototype (demo controls, scenarios) and how to open it on a phone |
| `10-QA-checklist.txt` | Short manual test checklist for the Kanban card |
| `outreach-portal-prototype.html` | The prototype as one file |

Reading order for developers: section 1 to 4 of this document, then open the prototype and click through both client types, then sections 5 to 9, then the JSON files.

---

## 1. Scope

**In scope**

1. Replace the current list-style outreach page for clients with a guided conversation (one question or one small group per step, persistent thread, progress, saved automatically, resumable with the same link).
2. Keep the building blocks and templates in Tenant Config. The conversation is generated from block definitions. No question is hardcoded in the UI.
3. Natural person (NP) onboarding outreach.
4. Organisation (ORG, "KYB") onboarding outreach, including the route by country of registration, the ownership structure with UBO calculation, authorised representatives and related parties.
5. Related parties (directors, UBOs, authorised representatives) who complete their own NP flow, linked to the organisation.
6. Second round: an analyst can ask follow-up questions or request documents in the same thread after submission.
7. A backstage view for staff ("Behind the scenes"): block states, datapoints with source, audit trail, open requests, and for ORG the structure and related parties.
8. Adapters: KvK (NL), a second source for the Dutch management proposal, Didit for ID&V, an AI service for document reading and checking.

**Out of scope here**

- Screening, risk scoring and the pKYC engine (outreach only receives the risk class as an input).
- Case steps 8 to 10 (Draft Report & QC, Compliance Advice, Sign-off): separate spec.
- Verification of authority (tekenbevoegdheid) beyond collecting and storing the proof; an analyst reviews it.
- Didit KYB (not used). Didit is used for ID&V of persons only.
- The choice between Company.info and another second source: the adapter interface is defined, the vendor is an open item (section 16).
- Excluded-jurisdiction stop list, reminder schedule and email template design: described as Tenant config where relevant, not built in the prototype.

---

## 2. Principles that must hold

1. **Three layers.** Content (blocks, templates, KYC mapping, required set; managed by compliance), flow (order, conditions, follow-ups, prefill) and presentation (the conversation). The conversation is a presentation of the same blocks a list form would show.
2. **The template fixes the required set.** The conversation decides only order, explanation and follow-ups. A block that is required stays required.
3. **AI is bounded.** AI may phrase a follow-up question inside a trigger the template defines, simplify, and pre-check documents. AI never drops a required block, never sets or changes a risk class, and never marks an answer as accepted. Every AI-assisted message is labelled for the client ("AI-assisted") and logged with the datapoint it clarifies.
4. **Risk-based human in the loop.** At Low risk a template-defined AI follow-up is sent automatically. At Medium and High an analyst approves it first. The client sees "A colleague is taking a quick look at your answer. This will only take a moment." while waiting.
5. **Source per fact.** Every datapoint carries its source (section 4.6). The source is visible to the client in the review and to staff in the backstage view.
6. **Ask once.** What is known is prefilled and confirmed, never typed again (ID data from Didit, email from the invitation, registry data from KvK or from the extract).
7. **Everything is resumable.** Each answer is saved the moment it is given. The same link reopens the same thread at the first unanswered block.
8. **Versions are frozen.** Block versions and template version are snapshotted into the request when it is sent. Later changes in Tenant Config never alter a request in flight.
9. **Audit everything.** Every question asked, answer given, rule fired, AI message, adapter call and status change is an append-only AuditEvent (section 12).
10. **Our tool is the system of record.** Registry and vendor data are stored in our own datapoints with their source. We do not depend on a vendor to show a case later. (Check the vendor terms on storage, section 10.)

---

## 3. Mapping to the existing app

Keep the existing Tenant Config pages and extend them. Do not rebuild them.

| Existing page | Role | Extension in this spec |
|---|---|---|
| Tenant Config > Outreach Templates | The building blocks (one row per block, with KYC mapping) | New block fields (section 4.2), conditions, follow-ups, evidence, widget type, Active flag, versioning, preview |
| Tenant Config > Form Templates | Templates assembled from blocks | Ordered block list with per-template Active switches, sections, settings (thresholds, queue release), intro messages, expected minutes, deadline days |
| Client outreach page (client-facing) | Today a long list | Replaced by the conversation portal (section 5) |
| Case view | Staff view of the case | New tab "Outreach" with the backstage view (section 11) |

Suggested Base44 mechanisms (developers confirm what the platform supports):

| Need | Mechanism |
|---|---|
| Data | Entities (section 4) |
| Client portal | Public page `/outreach/{token}`; token-based access, no login |
| KvK, second source, Didit, document AI | Server-side backend functions. API keys live in secrets, never in the browser |
| Didit result | Webhook endpoint (backend function) that updates the datapoints and releases the waiting conversation |
| AI document reading and follow-up phrasing | The platform's LLM integration, called from backend functions |
| File uploads | Private file storage with signed URLs; virus scan result stored |
| Emails (invitations, reminders, "new message") | Email integration, template per tenant |
| Queue release and reminders | Automation or scheduled function |

---

## 4. Data model

Names are suggestions. Keep the fields and relations.

### 4.1 Tenant settings (TenantConfig.Outreach)

- `uboThreshold` (number, default 25), `ownerListThreshold` (number, default 10)
- `releaseInvitesAfterIdv` (boolean, default true)
- `defaultDeadlineDays` (default 14), `reminderDays` (array, for example [3, 7, 12]; Not in prototype)
- `documentMaxAgeMonths` (default 3; used by the extract and proof-of-address checks)
- `aiFollowUp`: `low` = auto, `medium` = analyst approval, `high` = analyst approval (a map per risk class, editable)
- `evidenceStrictness`: per risk class (for example High: payslip required when source of funds includes salary)
- `integrations`: `kvk` (api key, enabled), `secondSource` (vendor, key, enabled), `didit` (api key, workflow id, webhook secret), `documentAI` (model, enabled)
- `eligibleJurisdictions` or `blockedJurisdictions` (list; Not in prototype; stop before ID&V)

### 4.2 OutreachBlock (Outreach Templates page)

- `key` (stable id such as `sof`), `version`, `status` (draft | published)
- `label`, `section_key`, `client_types` (NP | ORG | RP)
- `widget` (see section 5.2)
- `question_template` (text with placeholders), `variants` (for example question per legal-form kind)
- `why_text`
- `options` (array), `multi` (boolean), `none_option` (text or null)
- `datapoints` (array of `{key, label, type, default_source}`) and `kyc_mapping` (text or links to the KYC data model)
- `show_if` (condition, section 5.4)
- `follow_ups` (array of follow-up rules, section 6.1)
- `evidence` (`required`, `allow_defer`, `defer_creates_open_request`, `document_checks[]`, `max_age_months`)
- `prefill` (source of a prefill, if any)
- `validation` (rules and error texts)
- `edit` (how the review can edit this answer)
- `active_default` (boolean)
- `translations` (map language to strings)

The full content of every block is in `02-block-library.json`. Import it as seed data.

### 4.3 FormTemplate (Form Templates page)

- `key`, `name`, `client_type`, `case_types[]`, `version`, `status`
- `sections[]` (`key`, `label`) shown in the progress list
- `items[]` ordered: `block_key`, `block_version`, `active` (boolean per template)
- `settings` (thresholds, `releaseInvitesAfterIdv`)
- `intro_messages[]`, `start_chip` text, `expected_minutes`, `default_deadline_days`

Three templates are delivered in `03-form-templates.json`.

### 4.4 OutreachRequest and thread

**OutreachRequest**
- `id`, `case_id`, `client_id`, `party_id` (null for the main subject), `parent_request_id` (set for related parties)
- `template_key`, `template_version`, `blocks_snapshot` (frozen JSON)
- `token_hash`, `token_expires_at`, `language`
- `status`: Draft | Sent | Opened | In progress | Submitted | Expired | Cancelled
- `risk_class` (snapshot at send, can be updated by staff; the AI-approval rule reads the current value)
- `invited_name`, `invited_email`, `deadline`, `sent_at`, `first_opened_at`, `last_activity_at`, `submitted_at`, `submission_hash`
- `progress_steps`, `progress_total`, `current_block_key`
- `org_context` (ORG only): `route` (nl | document), `country`, `legal_form_kind` (company | partnership | sole), `representative_verified` (boolean), `representative_name`

**ThreadMessage**
- `request_id`, `seq`, `created_at`
- `author_type` (bank | client | analyst | system), `author_name`
- `kind` (message | answer | follow_up | explanation | status_card | system_line)
- `block_key`, `tag` (small label above a message, for example "Document checked"), `ai_assisted` (boolean)
- `approved_by`, `approved_at` (for AI follow-ups at Medium and High)
- `payload` (the widget answer as structured JSON), `display_text`

**BlockState**
- `request_id`, `block_key`, `state` (not asked | asked | answered | skipped | off | declined | deferred), `asked_at`, `answered_at`, `skip_reason`

### 4.5 Datapoint and evidence

**Datapoint**
- `request_id`, `case_id`, `party_id`, `key`, `label`, `value` (JSON), `display_value`
- `source` (section 4.6), `block_key`, `status` (given | edited | deferred)
- `history[]` (`value`, `source`, `changed_at`, `changed_by`, `reason`). An edit never overwrites history.

**EvidenceFile**
- `request_id`, `block_key`, `datapoint_key`, `file` (private reference), `name`, `size`, `mime`, `uploaded_at`, `virus_scan`
- `status` (passed | failed | pending | deferred)
- `checks[]` (`name`, `ok`, `message`)
- `read_result` (for the extract: JSON of AI-read fields, `model_version`, `confirmed_by_client`, `corrected_fields`)

**OpenRequest** (what the client sees under "Open requests", and what staff see in the backstage view)
- `request_id`, `title`, `from` (analyst name or "Template rule"), `block_key`, `party_name`, `status` (open | answered), `created_at`, `answered_at`

### 4.6 Datapoint sources (fixed list)

| Code | Label shown |
|---|---|
| `idv` | Didit ID check |
| `client` | Declared by client |
| `ai` | Declared by client, AI follow-up |
| `doc` | From document |
| `pre` | Prefilled from invitation |
| `kvk` | KvK trade register |
| `prop` | Suggested from registry data, confirmed by client |
| `calc` | Calculated by the tool |
| `rep` | Declared by the representative |

### 4.7 Organisation structure (graph) and related parties

Use a graph model so the same person can hold several roles and appear in several organisations.

**Party**: `id`, `case_id`, `kind` (person | company), `name`, `identifiers` (KvK number, registration number, country), `client_record_id` (link to the person or company record), `roles[]`

**PartyRelation**: `from_party`, `to_party`, `relation` (owns | director_of | authorised_rep_of | ubo_of), `pct` (for owns), `authority` (May sign alone | May sign jointly | Limited authority; with `authority_note`), `source` (from section 4.6), `evidence_id`

**RelatedPartyInvite**: `party_id`, `request_id` (the child OutreachRequest), `roles_text`, `needs` (text), `email`, `status` (To invite | Queued | Invited | Opened | Completed | Declined | Expired), `queued_at`, `invited_at`, `completed_at`

### 4.8 Adapter logging

**AdapterCall**: `vendor`, `operation`, `request_id`, `cost_eur`, `cost_basis`, `status`, `response_hash`, `created_at`. The response body is stored as the source datapoints and (where terms allow) a raw copy. This feeds cost reporting per tenant.

---

## 5. The conversation engine

### 5.1 Presentation

- Two columns on a wide screen: a left rail (greeting card, deadline, progress with section list, estimated minutes left, saved indicator, open requests, help line) and the conversation card. On a phone the rail collapses (see `08-design-tokens-and-ux-notes.txt`).
- Bank messages appear after a short typing indicator (about 250 ms for short system replies, otherwise 380 ms plus 7 ms per character, capped at 800 ms extra). Messages may carry a small tag above them and the pill "AI-assisted".
- A bank message that belongs to a block has "Why do we ask this?" (the block `why_text`). Opening it is logged (`client.why_opened`).
- Client answers appear as a client bubble with a readable summary of the answer.
- Widgets sit under the question and disappear when answered; the answer becomes the client bubble.
- The thread is persisted (ThreadMessage). Reloading rebuilds it.

### 5.2 Widget catalogue

| Widget | Used by | Behaviour and result |
|---|---|---|
| `chips` | single choice | One tap answers. Result: the option text |
| `multi` | multiple choice | Toggle chips; "Continue" enabled when at least one is chosen; `none_option` clears the others; result: list |
| `text` / `area` | free text | Required; optional validation (for example email format); Enter sends for `text` |
| `phone` | phone | Country code select (+44, +31, +353, +49, +1) and number; at least 8 digits; error text in the block |
| `address` | residential address | Country, postcode, house number, street, city; lookup on blur fills street and city; all required |
| `upload` | documents | Drop zone or file picker (PDF, JPG, PNG, max 25 MB). After upload the document checks run one by one and show a pass or fail per check. A failed check re-asks (blocks with `allow_defer = false`) or follows the block rule. Button "I will provide this later" only when `allow_defer = true` (creates an OpenRequest) |
| `idv` | ID&V | Wide screen: QR code (opens the Didit session on the phone), three numbered steps, "Waiting for your phone…", "Not now". Phone-sized screen: button "Continue with Didit" on the same device. On completion the four checks show (ID document read, Selfie and liveness checked, Face matches document, Document is genuine and valid) and the conversation continues by itself. Rule for wide: `min(window.innerWidth, screen.width) > 760` |
| `confirm_facts` | show facts, ask yes or no | Key-value list plus chips (for example "Yes, this is correct" / "Something is wrong") and an optional source note |
| `registry_search` | NL organisation | Typeahead (starts at 2 characters), results show name, legal form, city, number and a status pill (Active green, otherwise red); button "I cannot find my organisation" |
| `form` | small corrections | Labelled fields, all required |
| `people_list` | directors | Rows with checkbox, name, role, authority text, source pill; "Add person" (name, role); "Confirm" |
| `reps_list` | authorised representatives | Rows: name, authority (May sign alone | May sign jointly | Limited authority), role or limit; add and remove; "Continue" |
| `owners_builder` | owners | Rows: type (Person | Company), name, share in percent; running total; errors above 100%; add and remove |
| `structure_card` | after owners | Live organisation chart (section 9) with a caption |
| `tracker` | related parties | One row per party: name, roles and need, status pill, button "Send invitation" when status is To invite; "Continue" disabled until nobody is "To invite" |
| `review` | before signing | Grouped rows with value and source label, "Change" link per editable row, button "Everything is correct, continue to sign" |
| `sign` | declaration | Terms checkbox, typed full name (must equal the name from ID&V, case-insensitive), signature canvas (touch and mouse), "Clear", "Confirm and submit" disabled until all three are done |

The prototype also has "Demo:" buttons next to widgets. They are demo aids. Do not build them in production.

### 5.3 Block lifecycle

States: `not asked` > `asked` > `answered`. Other states: `skipped` (show_if false, logged with the reason), `off` (block inactive in the template, logged), `declined` (the client refused, for example "Not now" on ID&V), `deferred` (evidence to be provided later, an OpenRequest exists).

For every block the engine does: evaluate Active and show_if > write `block.asked` > send the message and widget > on answer write the datapoints (with source) > run follow-up rules > write `block.answered`.

A skipped or inactive block is logged (`block.skipped`) so staff can see why it was not asked.

### 5.4 Condition language

Conditions in `show_if` and follow-up `when` are stored as JSON:

- `{"answer_includes": {"block": "sof", "value": "Inheritance or gift"}}`
- `{"answer_equals": {"block": "pep", "value": "Yes"}}`
- `{"risk_in": ["medium", "high"]}`
- `{"legal_form_kind": "partnership"}` (company | partnership | sole)
- `{"route": "nl"}` (nl | document)
- `{"document_check_failed": "Name matches your ID"}`
- `{"calculated": "no owner reaches threshold"}`
- `{"all": [ ... ]}`, `{"any": [ ... ]}`, `{"not": { ... }}`

The editor on the Outreach Templates page needs a simple builder for these (pick a block, an operator and a value). The prototype describes them in a human text field ("Show if") for staff.

### 5.5 Progress

- `progress_total` is computed when the conversation starts, from the template.
- NP: 15 (one per block).
- Related party: 8.
- ORG: 2 (review, sign) + 2 (the ID&V and identity confirmation inside block `rep`) + the number of active blocks, excluding `review_org` and `sign_org`, whose show_if is true at the start. Example at Low risk with the default switches: 2 + 2 + 15 = 19 (`sow_ubo` is not counted at Low; `decl_regulated` and `decl_nominee` are inactive). A block that is counted but later skipped lowers the total by one.
- Each answered block adds one step. Percentage = steps / total, capped at 100.
- Minutes left = round((total − steps) × 0.4). Show "About N minutes left" (singular "minute" for 1), "Almost done" at 0, and after submission "Submitted. You will see here if we need anything else."
- Section list shows: current section highlighted, completed sections ticked.

### 5.6 Persistence, resume, deadline

- Save after each answer. The saved indicator shows "Saved at HH:MM".
- Link: `/outreach/{token}`; token is random, stored hashed, expires at the deadline plus a grace period (tenant config). Expired links show a short page and a way to ask for a new link.
- Reopening rebuilds the thread and resumes at the first block that is not answered.
- Reminders (Not in prototype): at the configured days before the deadline, an email with the same link.

### 5.7 After submission: composer and second round

- After submission a composer appears under the thread ("Ask a question or reply here…"). A client message is stored (`client.message`) and gets the automatic reply: "Thank you for your message. A colleague reads along and will respond in this conversation. Everything is saved in your file." (tag: Automatic reply). Staff are notified.
- An analyst can ask a follow-up in the same thread: an OpenRequest is created (title, from the analyst), the thread shows a system line "New message from a colleague" and a message from the analyst (analyst avatar, tag with name and role) with an upload widget, and the client is emailed. The client can upload, or defer ("I will provide this later"; the OpenRequest stays open). On upload the OpenRequest becomes answered and the analyst gets a message back: "Thank you, received. I will take a look and let you know if I need anything else."
- NP example: income evidence (payslip or bank statement; for the self-employed the latest annual accounts or an extract of the business). ORG example: the latest annual accounts.

### 5.8 Editing answers in the review

- Only rows with an `edit` definition can be changed (text, single choice, multiple choice).
- A change sets the source to "Declared by client", writes `answer.edited` with old and new value, and keeps the old value in `history`.
- In the prototype an edit does not re-run follow-up rules. Decision for build: re-evaluate follow-ups after an edit and ask only what is newly triggered (Open item 5).

### 5.9 Accessibility and responsive behaviour

See `08-design-tokens-and-ux-notes.txt`. Key points: the thread is an `aria-live` region; inputs are 16 px (no zoom on iOS); touch targets at least 40 px; safe-area insets respected; dark mode follows the system; reduced motion respected; the page works without any external fonts or scripts.

---

## 6. Rules and AI

### 6.1 Follow-up rule types

| Action | Meaning |
|---|---|
| `ask_text` / `ask_area` | Ask a free-text question and store it as a datapoint |
| `ask_choice` | Ask a single choice |
| `ask_file` | Ask for a document; checks; optional defer |
| `ask_file_per_person` | Same, once per person in a list |
| `ask_people` | Ask a list of people with attributes |
| `explain_and_reask` | Show an explanation and ask the same block again |
| `re_request` | A document failed a check: explain and ask for a new upload |
| `ai_followup` | AI-assisted follow-up question (section 6.2) |
| `rule` | Apply an effect without a question (for example record the directors as UBO) |

Every rule that fires writes an audit event `rule` with the text of the rule.

### 6.2 AI-assisted follow-up questions

1. Trigger: a template-defined condition on an answer (for example "Cash deposits" chosen).
2. Phrase: the template holds a default question text. The AI service may rephrase it using the answer, within these limits: one question, no advice, no judgement, no mention of risk or screening, English plain language, at most 2 sentences. If the AI service fails, the default text is sent.
3. Approval by risk class (tenant config): Low = send at once (audit `ai.followup.auto`); Medium and High = hold, show the client "A colleague is taking a quick look at your answer. This will only take a moment.", create an approval task for an analyst, and send after approval (audit `ai.followup.pending`, then `ai.followup.approved` with the approver's name). The question is shown with tag "Follow-up question, checked by {analyst name}". The prototype auto-approves after 1.4 seconds as a demo.
4. The client's answer is stored with source `ai` ("Declared by client, AI follow-up") and logged (`ai.followup.answered`).
5. Limits: one follow-up per trigger per block; at most three AI follow-ups per request unless an analyst adds more (tenant config).

### 6.3 Document checks

Every upload runs through checks defined on the block (`document_checks`). Each check shows pending, then pass or fail, one by one. Results are stored on the EvidenceFile and logged (`doc.checked`). The checks are executed by the document AI service plus simple rules (age of the document, name match). In the prototype they are simulated; the first upload fails on the "Name matches your ID" check (address proof) or the "Not older than 3 months" check (extract) when the demo control is set to fail.

### 6.4 Evidence strictness by risk

Example from the prototype: at High risk, when source of funds includes salary, a payslip is required (no defer). At Medium and High, ORG block `sow_ubo` is asked; at High it also asks for evidence (defer allowed with an OpenRequest). Make these editable per risk class through the block rules.

---

## 7. NP flow, step by step

Template: Onboarding NP. 15 blocks, 6 sections. Exact questions and options are in `02-block-library.json` and `06-conversation-transcripts.txt`.

| # | Block | Section | Widget | Rule highlights | Datapoints (source) |
|---|---|---|---|---|---|
| 1 | `idv` | Identity | `idv` | QR on wide screens; decline: reply and re-ask | `full_name`, `dob`, `nat`, `doc` (idv) |
| 2 | `name_confirm` | Identity | `confirm_facts` | "Something is wrong": ask what, flag the case for the analyst | `id_dispute` (client) |
| 3 | `address` | Identity | `address` | Lookup fills street and city | `address` (client) |
| 4 | `address_proof` | Identity | `upload` | Name mismatch: re-request; no defer | `address_proof` (doc) |
| 5 | `email` | Contact | `chips` | Prefilled from invitation; other email validated | `email` (pre or client) |
| 6 | `phone` | Contact | `phone` | At least 8 digits | `phone` (client) |
| 7 | `purpose` | Purpose of relationship | `multi` | "Other": short text | `purpose` (client) |
| 8 | `nature` | Purpose of relationship | `multi` | none | `nature` (client) |
| 9 | `employment` | Financial situation | `chips` | Self-employed: company name | `employment`, `company` (client) |
| 10 | `income` | Financial situation | `chips` | none | `income` (client) |
| 11 | `sof` | Financial situation | `multi` | Inheritance or sale: deed (defer allowed). Other: AI follow-up. High risk and salary: payslip (no defer) | `sof`, `sof_doc`, `payslip`, `sof_other` |
| 12 | `activities` | Expected activity | `multi` | Outside the EU: countries. Cash and crypto: AI follow-ups. "None of these" exclusive | `activities`, `countries`, `cash_reason`, `crypto_reason` |
| 13 | `pep` | Expected activity | `chips` | "I don't know": explain and re-ask. Yes: who, relation | `pep`, `pep_detail` (client) |
| 14 | `review` | Declaration | `review` | Edit rows | none |
| 15 | `sign` | Declaration | `sign` | Typed name must match the ID name | `declaration` (client) |

After submission: status card "Received", reference number, expected response time (text: "We will review your details and usually let you know within 1 working day how to proceed. If we need anything else, we will ask here, in this conversation, and by email."), the composer, and the second round (section 5.7).

The hash of the answers is written at submission (`case.submitted`: "Client declaration signed; answers frozen as version 1 (sha256:…)").

---

## 8. ORG flow, step by step

Template: Onboarding ORG (KYB). Sections in this order: Organisation, People and ownership, Business profile, You, Declaration.

### 8.1 Order and why

1. **The entity comes first.** The case is about the organisation. The register lookup uses public data only, so no verification is needed to start. The flow can also stop early (inactive organisation) before anybody spends time or a paid ID check.
2. **The representative's own identity comes last** (just before review and signing), together with their PEP declaration. During the flow the representative only declares which listed person they are ("which of these people are you?"); this is not yet verified.
3. **Related parties are derived, then invited.** Directors, UBOs and authorised representatives are known only after the structure is built. Invitations are chosen in block `invites`, and with `releaseInvitesAfterIdv` they are queued and sent only after the representative passed ID&V, so an unverified person cannot send invitations in the bank's name.

### 8.2 Block order

`country` > `registry` > `directors` > `authreps` > `owners` > `ubo` > `invites` > `purpose_org` > `nature_org` > `activity` > `countries_org` > `volume` > `sof_org` > `sow_ubo` (Medium and High only) > `decl_regulated` (inactive) > `decl_nominee` (inactive) > `docs` (not for sole proprietorships) > `rep` > review > sign.

Tenant config can switch any block off per template. The two declaration blocks are delivered inactive.

### 8.3 Routes

| Country chosen | Route | What happens |
|---|---|---|
| Netherlands | `nl` | KvK lookup, confirm, proposal for directors |
| Curaçao | `document` | Client uploads the documents; AI reads the extract |
| Other country | `document` | Same, after the question "Which country?" |

KvK is the only register link. If a Dutch organisation cannot be found ("I cannot find my organisation"), the route falls back to `document`.

### 8.4 Block `registry`, route nl

1. Typeahead against KvK Zoeken (free of charge). Matches on name or KvK number, from 2 characters.
2. Each result shows name, legal form, city, KvK number and status.
3. When the client picks an organisation: if status does not start with "Active", say "The trade register lists {name} as {status}. We cannot open an account for an inactive organisation. Please pick another organisation, or contact your relationship manager." and ask again (audit `rule`).
4. Otherwise call Basisprofiel for that KvK number (EUR 0.02; audit `kvk.zoeken`, `kvk.basisprofiel`) and show the facts: legal name, KvK number, RSIN, legal form, status, registered address, main activity (SBI), registered since, trade name. Ask: "Is this your organisation? This is what the register shows." [Yes, this is my organisation | No, search again]. Source note: "Source: Dutch trade register (KvK)."
5. Datapoints with source `kvk`: `legal_name`, `reg_no`, `rsin`, `legal_form`, `co_status`, `co_address`, `sbi`, `reg_date`, `trade_name`.

### 8.5 Block `registry`, route document

1. Say: "For an organisation registered in {country} we work from your documents. We start with the extract of the trade register (Chamber of Commerce). It must not be older than 3 months."
2. Upload the extract. Checks: Readable and complete; Issued by a trade register or Chamber of Commerce; Not older than 3 months. A failed check: "This document does not pass our check. Please upload a current version." and ask again. No defer.
3. The AI document service reads name, registration number, legal form, registered address, activity, registration date and listed officers (audit `ai.document.read`). The client sees the facts with the tag "Read from your document" and the pill "AI-assisted": "We read your extract. Is this correct?" [Yes, this is correct | Something is wrong], note "Read from your document. A colleague checks it against the original."
4. "Something is wrong" opens a correction form (name, registration number, legal form, registered address); the corrected values get source `rep` ("Declared by the representative").
5. Then upload the articles of association. Checks: Readable and complete; Company name matches the extract; Signed and dated. No defer.
6. Datapoints with source `doc` (or `rep` when corrected): the same keys as route nl, but `co_activity` instead of `sbi`; status is stored as "Active (per extract)". `doc_extract` and `doc_articles` hold the files.
7. An analyst checks the values against the original document later (backstage task).

### 8.6 Block `directors`

- Route nl: a proposal from the second source (Company.info Organisatieprofiel or equal). The KvK API does not return directors. The client sees: "From registry data we suggest these directors. The trade register does not list everyone, so untick anyone who is not correct and add anyone who is missing." Each row: checkbox (ticked), name, role, authority text, pill "Suggested from registry data".
- Route document: the officers read from the extract. Text: "Your extract lists these people. Untick anyone who is not correct and add anyone who is missing." Pill "Read from your extract".
- No proposal available: "Who are the directors or managing officers of your organisation? Add everyone who may act for it." (empty list, add rows).
- At least one person must remain.
- Datapoint `directors`; source `prop` for a proposal, `doc` when read from the extract, `rep` when only added by the client.

### 8.7 Block `authreps` (authorised representatives)

1. Ask: "Besides the directors: does anyone else act for the organisation, for example an employee with a power of attorney?" [Yes, there are others | No, only the directors].
2. Yes: ask for the people ("Who are they, and what may they do on behalf of the organisation?"): name, authority (May sign alone | May sign jointly | Limited authority), role or limit.
3. For each person: "Please upload the power of attorney, or another document that shows the authority of {name}." Checks: Readable and complete; Names {name} and the authority granted; Signed by a director. No defer.
4. Datapoints: `authreps` (list), `auth_doc_{slug}` (file, source `doc`).
5. Every authorised representative who is not already a director or UBO becomes a related party (section 8.9).

### 8.8 Blocks `owners` and `ubo`

**Owners.** The wording depends on the legal form. Companies: "Please list everyone who owns {ownerListThreshold}% or more of the organisation, with their share." (NL adds: "The trade register does not publish shareholders. Registry data suggests that {parent} is the parent company." and pre-adds the parent as a company row without percentage.) Partnerships: "Please list all partners, with their share in the partnership."

For every owner that is a company:
- Route nl: try to match the name to KvK Zoeken. A match that is active: "We found {name} in the trade register. Is this the same company?" [Yes, same company | No, a different company]. Source `kvk`.
- No match, or another country: "Where is {name} registered, and what is its registration number?" (free text).
- Always: "Who owns {name}? List everyone who holds {ownerListThreshold}% or more of it." and repeat the owners builder for that company. The chain can nest; protect against cycles by company id.

Datapoints `owners` and `chain_{slug}` (source `rep`).

**UBO calculation.**

```
effective(person) = sum over all ownership paths from the entity down to that person
                    of the product of the shares along the path
round to 0.1 percentage point
UBO if effective(person) >= uboThreshold   (tenant config, default 25)
```

Worked example (NL demo): Harbour Logistics B.V. is owned 60% by Harbour Logistics Holding B.V., 25% by Emma Clarke, 15% by David Okoye. The Holding is owned 50% by Emma Clarke and 50% by Tom Becker. Emma = 25 + 60 × 0.5 = 55%. Tom = 60 × 0.5 = 30%. David = 15%. UBOs: Emma (55%) and Tom (30%). David is below 25%: recorded as owner, no UBO.

Second example (partnership demo): Blue Coral Partners V.O.F. with partners Emma 70% and Tom 30%: both UBO.

After the calculation:
1. Show the structure card (section 9).
2. Ask: "Based on what you told us, these people own the organisation, directly or through other companies. At {uboThreshold}% or more they count as ultimate beneficial owners (UBO). Is this complete?" with a facts list (name, effective share, "UBO" or "below 25%") and chips [Yes, this is complete | Someone else also controls the organisation]. Note: "Calculated by multiplying shares along the ownership chain."
3. "Someone else also controls the organisation": ask "Who is this, and how do they control the organisation? For example through voting rights or the right to appoint directors." The person is added as UBO "(control)".
4. If nobody reaches the threshold: record the directors as UBO (senior managing officials) and write an audit event.
5. Datapoints `ubos` (source `calc`) and `control` (source `rep`).

### 8.9 Block `invites` and related parties

1. Ask "Before we continue: which of these people are you?" with the names of directors, UBOs and authorised representatives plus "None of these". "None of these" asks "What is your role at {company}?".
2. Parties = unique union of directors, UBOs and authorised representatives. Each party has roles text (for example "Director · UBO 55%"), the need ("ID check and PEP declaration") and an email (the demo derives it from the name; production takes it from the data or asks the representative).
3. The declared representative gets status "Your check comes last" and no invitation.
4. Other parties start as "To invite". Button "Send invitation":
   - with `releaseInvitesAfterIdv = true`: status "Queued" (audit `invitation.queued`);
   - otherwise status "Invited" at once, an OpenRequest "Own checks: {name}" is created, an email is sent (audit `invitation.sent`).
5. Text: "Each person below needs to complete a short check of their own: an identity check and a PEP declaration. Choose who to invite, so they can do it while you carry on." plus, when queued release is on, "Invitations go out as soon as you have verified your own identity at the end of this conversation." Owners below the threshold that are not parties: "No check needed for {names}: below the 25% threshold. We record them as owners."
6. "Continue" is enabled only when no party is "To invite".

### 8.10 Related party flow

Template: Related party (person), 8 blocks: `idv`, `name_confirm`, `address`, `email`, `phone`, `pep`, `review`, `sign` (no proof of address). The intro says "Hi {first_name}, {company} has asked you to complete your own details as {role_text}." and "This takes about 4 minutes. Your answers are saved automatically." Role text replaces " · " by " and " (for example "Managing partner and UBO (30%)").

On completion: `related_party.completed` (audit on the parent), the party status becomes Completed, the OpenRequest "Own checks: {name}" becomes answered, and the representative's tracker updates. The prototype jumps back to the organisation view with a button "Back to the organisation's view". In production the related party uses their own link and the representative sees the status in the tracker and in the left rail.

### 8.11 Business profile blocks

Questions, options and follow-ups are in `02-block-library.json`. Summary:

| Block | Widget | Follow-up |
|---|---|---|
| `purpose_org` | multi | "Other": short text |
| `nature_org` | multi | none |
| `activity` | confirm | Registry or extract activity shown: "Yes, that is accurate" or "I want to add detail" (then free text; value = registered activity + client text) |
| `countries_org` | multi | Caribbean, Asia, Africa or Other: AI follow-up on countries and purpose |
| `volume` | chips | "Over € 1 million": AI follow-up on what drives it |
| `sof_org` | multi | Shareholder funding: loan or capital contribution agreement (defer allowed). Other: AI follow-up |
| `sow_ubo` | area | Medium and High only; names the first UBO; at High also evidence of wealth (defer allowed) |
| `decl_regulated`, `decl_nominee` | chips | Inactive by default; Yes opens details |

### 8.12 Documents by legal form

| Legal form kind | Examples | Extract | Articles | Ownership document |
|---|---|---|---|---|
| company | B.V., N.V. | document route only | document route only | Shareholder register |
| partnership | V.O.F., C.V., maatschap, general partnership | document route only | document route only | Partnership agreement (replaces the register) |
| sole | eenmanszaak | document route only | document route only | none (block `docs` is skipped) |

Legal form kind is derived from the legal form (KvK, or read from the extract) with a keyword rule: partnership when the form contains "vennootschap onder firma", "V.O.F.", "commanditaire", "C.V.", "maatschap" or "partnership"; sole when it contains "eenmanszaak" or "sole proprietor"; otherwise company. The tenant can extend the keyword lists. The route nl asks for the shareholder register or partnership agreement only (the KvK extract is public data).

Document requirements are **required before submitting** (no "later") for: extract, articles, ownership document, proof of authority. Evidence that depends on answers (shareholder loan agreement, evidence of wealth at High risk) may be deferred with an OpenRequest.

Document check for the ownership document: Readable and complete; Lists all shareholders (or partners) and their shares; (partnership) Signed by the partners; Percentages (or shares) match what you declared.

### 8.13 Block `rep` (the representative, last)

1. Message: "Finally, your own identity, as the person who submits this application. After that you do not have to type your name, date of birth or nationality." Widget `idv`.
2. Confirm identity data (same as NP `name_confirm`).
3. If the representative declared a person in `invites`: compare the name on the ID with the declared name. A mismatch: "The name on your ID ({id_name}) differs from the person you selected ({declared}). A colleague will check this. You can simply continue." The datapoint `rep_flag` is stored and the analyst is alerted (audit `rep.match`).
4. PEP declaration (same block behaviour as NP `pep`, including "I don't know" and the Yes follow-ups).
5. Mark the representative verified (audit `rep.verified`), set their party status "Verified (you)", release all queued invitations (audit `invitation.sent`, OpenRequests, emails) and say "Thank you, you are verified. We have now sent the invitations to {names}. They can complete their own checks while you finish here." (tag "Invitations sent"; names joined as "A, B and C").

### 8.14 Review, signature and submission

- Review groups: Organisation, People and ownership, Business profile, Documents, You (as representative). Each row with value and source label; editable rows get "Change".
- Signature text: "I declare that the information above is true and complete, and that I am authorised to submit it on behalf of {company}." Typed name must equal the name from ID&V.
- Message: "Thank you, {first_name}. The application for {company} has been submitted." Status card: "Received", reference number, and "We are still waiting for {names} to complete their own checks. We will review the file and usually let you know within 2 working days how to proceed. If we need anything else, we will ask here, in this conversation, and by email." (the first sentence only when parties are still open).
- After submission the composer and the second round are available (section 5.7).

---
## 9. Structure card and organisation chart

Shown after the owners step (block `ubo`) and in the backstage view. Built from the owners and the ownership chain the client entered, plus the directors.

**Layout (SVG, scales to the width of the card, viewBox 600 wide)**
- Row 0 (top): owners of company owners. Row 1: direct owners. Row 2 (bottom): the organisation itself. Height 210 without row 0, 300 with row 0.
- Persons are pills (corner radius 20, 150 × 40). Companies are rectangles (corner radius 8, 150 × 40). The organisation is a filled box (190 × 44, brand color, light text).
- A line joins each owner to what it owns, with the percentage next to the line (small monospace text).
- A person who is a UBO has a 2 px brand-colored outline and the label "UBO {effective}%" under the pill. A person who owns both directly and indirectly appears in both rows (the label shows the combined effective share).
- Names longer than 22 characters are cut with an ellipsis.
- Footer line: "Directors: {names}".
- Caption below: "Built from registry data and your answers. Highlighted people are ultimate beneficial owners at {uboThreshold}% or more."

**Rules**
- The chart is a visual aid. The text list that follows (name, effective share, UBO or below the threshold) is the accessible alternative and must stay visible. Give the SVG `role="img"` and `aria-label="Ownership structure"`.
- The prototype draws at most two levels of owners (direct owners and the owners of company owners). Deeper chains are calculated correctly but the chart should then show a "+N more levels" note or use a proper tree layout (Open item 6).
- Colors come from the design tokens so the chart works in dark mode.

---

## 10. Adapters and integrations

Details per adapter (inputs, outputs, errors, costs, terms to confirm) are in `07-adapter-contracts.md`. Summary:

| Adapter | Used for | Called when | Notes |
|---|---|---|---|
| KvK | NL: search and basic profile | Block `registry` (route nl); company owner match in `owners` | Zoeken is free, Basisprofiel is about EUR 0.02. The API gives no directors, signatories, shareholders or annual accounts |
| Second source (Company.info Organisatieprofiel or equal) | NL: proposal for management and parent company | Block `directors` (route nl), block `owners` (parent) | Vendor not chosen. Pricing is not public (offer needed). Resale terms need written permission |
| Didit | ID&V of persons | Blocks `idv` (NP, related party, representative) | Session link and QR; result by webhook |
| Document AI | Read the extract, check documents | Block `registry` (route document), every upload | Output is a proposal; the client confirms; an analyst checks the original |
| Address lookup | NL, UK, IE postcode lookup | Block `address` | Simulated in the prototype |
| Email | Invitations, reminders, "new message" | Request send, queue release, analyst message | Template per tenant |

**Rules for all adapters**
- Credentials per tenant, in secrets. KvK terms say a vendor may not use one key for many customers: each tenant needs its own agreement and key (or the commercial and legal route is settled first, Open item 1).
- Every call writes an AdapterCall row with its cost and an audit event.
- A failed or slow call never blocks the client. KvK failing: say "We could not reach the trade register right now." and offer "Try again" and "Continue with documents" (document route). These texts are new and not in the prototype. Second source failing: ask for the directors without a proposal. Document AI failing: ask the client to enter the details in the correction form and queue the document for manual reading.
- Store what the vendor returns as datapoints with the vendor as source. Check the vendor's terms on storing and reusing the data; the KvK terms restrict building an own database of KvK data and restrict UBO data to AML use (Open item 1).

---

## 11. Backstage view (staff)

Shown as a tab "Outreach" on the case (the prototype calls it "Behind the scenes"). It explains the case to a developer, a compliance officer and an analyst. Required content:

1. **Template card**: setting and value table (client type, case types, channel, deadline, presentation, languages, version). For ORG also: route selection, UBO threshold, order, how related parties are handled, queue release setting.
2. **Building blocks and rules table**: per block the label and key, widget, KYC mapping, show-if text, follow-ups, prefill and source, evidence, and the state (now, answered, not yet, skipped, off). The current block is highlighted. For ORG there is an **Active** checkbox per block. Changing it saves to the template, writes `config.changed`, and applies to new requests only (the page says so: "Saved. The change applies to the next request.").
3. **Data points and source**: every datapoint with value, source pill and block. Colors: green for `idv`, `doc`, `kvk`; indigo for `ai`; neutral otherwise.
4. **Active rules**: plain-language list of the rules in force for this case (risk class and AI approval, required set fixed, ask once, evidence strictness; for ORG also: blocks are data, route by country, source per fact, UBO is calculated, documents required, related parties).
5. **Audit trail**: newest first, time, event, text.
6. **Requests in the thread**: title, from, status, created.
7. **ORG only: Structure and related parties**: the organisation chart (section 9) and a table of parties with role, need and status.

Permissions: Analyst and Compliance can view; Admin edits Tenant Config. The Active checkbox is a Tenant Config change and needs the same permission as the Outreach Templates page.

---

## 12. Audit events (append-only)

Every event: `case_id`, `request_id`, `party_id` (if any), `timestamp`, `actor_type` (client | person | agent | system), `actor_name`, `event_type`, `text`, `payload`. Events listed here are the ones the prototype writes; production adds the usual security events (login, permission changes).

| Event | When |
|---|---|
| `request.sent`, `request.opened` | Not in prototype: invitation sent, link first opened |
| `block.asked`, `block.answered` | Each block |
| `block.skipped` | Block inactive or show_if false (text says why) |
| `block.declined` | Client refused a step (for example ID&V "Not now", registry match rejected) |
| `prefill` | A value was taken from a source instead of asked |
| `rule` | A follow-up or stop rule fired (text names the rule) |
| `client.why_opened` | Client opened "Why do we ask this?" |
| `answer.edited` | Edit in the review (old and new value) |
| `doc.checked` | Result of the checks on an upload |
| `ai.followup.auto` | Low risk: AI follow-up sent at once |
| `ai.followup.pending`, `ai.followup.approved` | Medium and High: waiting, then approved (with approver) |
| `ai.followup.answered` | Client answered an AI follow-up |
| `ai.document.read` | AI read an extract |
| `route.selected`, `route.fallback` | Route by country; fallback from nl to document |
| `kvk.zoeken`, `kvk.basisprofiel` | KvK calls (with cost) |
| `company.info.organisatieprofiel` | Second-source call (name the real vendor in production) |
| `ubo.calculated` | Result of the calculation |
| `rep.declared`, `rep.match`, `rep.verified` | Representative steps |
| `invitation.queued`, `invitation.sent`, `invitation.completed` | Related party invitation lifecycle |
| `related_party.completed` | A related party finished their flow |
| `case.submitted` | Declaration signed, answers frozen, hash |
| `request.created`, `request.deferred`, `request.answered` | Second round and deferred evidence |
| `client.message` | Message typed in the composer |
| `config.changed` | Tenant config changed (for example a block switched on or off) or risk class changed |

---

## 13. Security, privacy and retention

- **Link and session.** Random token, stored hashed, bound to one request. Expiry at the deadline plus grace. Rate-limit token attempts. No login for the client. A related party gets their own token. Do not expose the case, other parties' data or staff data through a token.
- **Identity and biometrics.** Handled by Didit. We store the outcome and the extracted ID data, not the images, unless the tenant policy requires it.
- **Files.** Private storage, signed short-lived URLs, virus scan before the file is usable, size and type limits (PDF, JPG, PNG, 25 MB).
- **Personal data.** Collect only what the blocks require. Keep PII out of audit texts where possible (use keys and ids; the prototype puts names in some audit texts for readability, production may mask them).
- **Retention.** Tenant config; follow the sign-off spec (DeclinedRecord) for declined cases. Outreach data of a case follows the case.
- **Signature.** Store the image, typed name, timestamp, IP, user agent and the submission hash.
- **Invitations.** Queued until the representative passed ID&V (default). Related party invitations are personal and cannot be forwarded in a way that bypasses ID&V: the person flow starts with ID&V and compares the name when a name is known.

---

## 14. Acceptance tests (Given / When / Then)

**Engine and templates**

1. Given a published block with a changed question text, When a new request is sent, Then the conversation shows the new text; a request sent earlier still shows the old text.
2. Given a template where block `nature` is set inactive, When a conversation runs, Then the block is not asked, `block.skipped` is written and progress total is one lower.
3. Given an NP conversation, When the client closes the page after block 6 and reopens the link, Then the thread is rebuilt and the next question is block 7.
4. Given the client opens "Why do we ask this?", Then the why-text shows and `client.why_opened` is written.
5. Given the template requires a block, When the AI service is down, Then the block is still asked with its default text.

**NP flow**

6. Given Low risk, When the client chooses "Cash deposits", Then the AI follow-up is sent at once and `ai.followup.auto` is written.
7. Given High risk, When the client chooses "Cash deposits", Then the client sees the waiting message, an analyst approval task exists, and the question is sent only after approval with the tag naming the approver.
8. Given High risk and source of funds includes "Salary", Then a payslip is requested and "later" is not offered.
9. Given source of funds includes "Inheritance or gift", Then a deed is requested; When the client taps "I will provide this later", Then an OpenRequest is created and the case can still be submitted.
10. Given a proof of address that fails "Name matches your ID", Then the client sees the failed check and the re-request message, and can upload again.
11. Given the client answers "I don't know" on PEP, Then the explanation is shown and the question is asked again.
12. Given the client types a name different from the ID name at signing, Then submission is blocked with the message and the rule is logged.
13. Given a wide screen, Then the ID&V step shows a QR code; Given a phone-sized screen, Then it shows the button; When the Didit result arrives, Then the conversation continues at "This is what we read from your identity document. Is it correct?".

**ORG, route nl**

14. Given "Netherlands", When the client types "Harbour" and picks "Harbour Logistics B.V.", Then Basisprofiel is called once and the facts are shown with source "KvK trade register".
15. Given the client picks an inactive organisation, Then the stop message is shown and the client can pick another.
16. Given "I cannot find my organisation", Then the route becomes document and `route.fallback` is written.
17. Given owners Holding 60%, Emma 25%, David 15% and Holding owned by Emma 50% and Tom 50%, Then UBOs are Emma 55% and Tom 30% and David is below the threshold.
18. Given the threshold is changed to 30 in the template settings, Then Tom (30%) is still a UBO and Emma stays; Given 31, Then Tom is not a UBO.
19. Given nobody reaches the threshold, Then the directors are recorded as UBO and an audit event is written.
20. Given the client answers "Someone else also controls the organisation", Then the control question is asked and the person is listed as UBO "(control)".

**ORG, route document**

21. Given "Curaçao", Then the extract is asked first; Given an extract older than 3 months, Then the check fails and a new upload is requested; "later" is not offered.
22. Given a passing extract, Then the AI-read facts are shown with the tag "Read from your document" and the AI-assisted pill; When the client picks "Something is wrong", Then the correction form opens and the corrected values have source "Declared by the representative".
23. Given "Other country", Then "Which country?" is asked first.
24. Given the extract shows a V.O.F., Then the owners question asks for partners and the ownership document is the partnership agreement.
25. Given a sole proprietorship, Then block `docs` is skipped and `block.skipped` says why.

**People, authorised representatives, related parties**

26. Given the client adds an authorised representative, Then a power of attorney is required for that person and "later" is not offered.
27. Given directors Emma and David, UBOs Emma and Tom and authorised representative Anna, When the client declares to be Emma, Then the parties are Emma ("Your check comes last"), David, Tom and Anna (three to invite).
28. Given `releaseInvitesAfterIdv` is on, When the client taps "Send invitation" for David, Then David's status is Queued and no email is sent; When the representative passes ID&V, Then David becomes Invited, the OpenRequest exists and the email is sent.
29. Given `releaseInvitesAfterIdv` is off, When the client taps "Send invitation", Then the email is sent at once.
30. Given the representative declared "Emma Clarke" and the ID says another name, Then the mismatch message is shown, `rep_flag` is stored and the analyst is alerted.
31. Given a related party completes their flow, Then their status becomes Completed, the OpenRequest becomes answered and the representative's tracker shows it.
32. Given the representative chose "None of these", Then the role is asked and no party is marked "Your check comes last".

**Submission and second round**

33. Given all required documents are uploaded, When the client signs, Then `case.submitted` is written with a hash and the status card lists parties that are still pending.
34. Given a submitted case, When an analyst asks for annual accounts, Then the client sees the system line, the analyst message and an upload widget; When the client uploads, Then the OpenRequest is answered and the analyst gets the confirmation message.
35. Given the client types in the composer after submission, Then the automatic reply is shown and staff are notified.

**Backstage**

36. Given an ORG case, Then the backstage view shows the block table with Active checkboxes, the organisation chart and the parties table; Given a block is switched off there, Then it applies from the next request only.
37. Given any answer from an adapter, Then the datapoint shows the adapter as source and an AdapterCall row with cost exists.

---

## 15. Suggested build order for Base44

1. **Entities and Tenant Config pages.** OutreachBlock, FormTemplate, TenantConfig.Outreach. Import `02-block-library.json` and `03-form-templates.json`. Extend the existing pages with the new fields and the condition editor.
2. **Request and thread.** OutreachRequest, ThreadMessage, BlockState, Datapoint, EvidenceFile, OpenRequest. Token link and the public portal page shell with the left rail.
3. **Conversation engine (data-driven).** Block runner, condition evaluator, widgets for NP (chips, multi, text, phone, address, upload, confirm, review, sign), progress, resume, the thread. Run NP with stub adapters.
4. **Didit ID&V.** Session, QR and button, webhook, prefill and confirm. Related-party mode of the NP template.
5. **Rules and AI.** Follow-ups, evidence rules, document checks (stub then real), AI follow-up with risk-based approval and the analyst approval task.
6. **ORG: entity and structure.** Country and route, KvK adapter, registry widgets, document route with AI reading, directors, authorised representatives, owners builder, UBO calculation, structure card.
7. **ORG: related parties.** Parties and relations, tracker, queue and release, child requests, status sync, completion flow.
8. **ORG: profile, documents, representative step, review and sign.**
9. **Second round and composer**, reminders, emails.
10. **Backstage tab**, audit events, cost reporting from AdapterCall.
11. **Hardening**: security items (section 13), accessibility pass, mobile pass on real devices, load of large files, error paths of every adapter.

Each step can be demonstrated against the prototype. Use `10-QA-checklist.txt` and the acceptance tests above as the definition of done.

---

## 16. Open items (not decided yet)

1. **KvK terms and cost.** The KvK terms say a vendor may not use one key for many customers and may not build an own database; UBO data is for AML use only. Needs a legal check of the per-tenant (gevolmachtigde) model before build of production keys.
2. **Second source for the Dutch management proposal.** Company.info Organisatieprofiel is the candidate. Prices are not public, resale needs written permission, a trial key takes about two working days. Alternative: ask the client for directors without a proposal. The adapter interface is fixed; the vendor is open.
3. **Curaçao and other countries.** No register link. If Didit KYB or another provider is added later, it becomes a new route behind the same interface. Pending: Didit NL and Curaçao test reports.
4. **Authority check (tekenbevoegdheid).** Only collected and stored. A real check against the extract or articles is a later step.
5. **Editing answers re-evaluates follow-ups** (decision for build, see 5.8): confirm with compliance.
6. **Deep ownership chains** in the chart (more than two levels): tree layout or collapse.
7. **Reminder schedule and email templates** per tenant.
8. **Excluded jurisdictions** list as Tenant config, evaluated right after the country question.
9. **Translations.** The structure is there; the NL texts are not written.
10. **Per-role needs.** The prototype asks the same short person flow of every related party. Tenant config could define different needs per role (for example no address for authorised representatives).
11. **Proof of address for related parties** is not asked in the prototype; decide per role.
12. **AI follow-up limits** (one per trigger, three per request) are proposals.
13. **Data retention** periods for outreach data and for the files.
