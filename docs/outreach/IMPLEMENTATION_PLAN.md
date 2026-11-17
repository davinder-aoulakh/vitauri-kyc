# Client Outreach module: implementation plan for Claude Code

Nov 16, 2026 · @Dave

## 1. Read this first

Build the guided conversation as a new module beside the classic list-style outreach, and keep both. A feature flag in the Ops console, `outreach_conversation` (default off), switches the new outreach on or off per tenant. With the flag off, a tenant has the classic outreach exactly as it works today. Nothing in the classic outreach, the classic portal or the Didit functions is removed.

**Decisions Dave took on 16 and 17 Nov 2026**

- Use new block and template entities; do not extend `OutreachTemplate`.
- Mirror submitted answers into the existing `OutreachRequest.items[]`, so profile suggestions and every other reader of outreach answers keep working.
- Do not remove the classic outreach (17 Nov; this replaces the earlier decision to remove it). The new outreach is switched per tenant with a feature flag in the Ops console.
- For organisations, the company registry lookup uses Didit by default. When Vitauri Ops has configured a KvK key for the tenant, Dutch organisations use KvK instead. ID&V of persons is always Didit.
- Build one phase at a time and stop for a check after each.

**Baseline.** `davinder-aoulakh/vitauri-kyc` at commit `bea2378` (16 Nov 2026): 64 entities, 123 backend functions, 44 pages. Pack version: 8 Nov 2026, owner David Zwarts.

**How this plan relates to the pack**

- The build spec (`01`) leads on logic. The prototype and the transcripts (`06`) lead on layout and wording.
- This plan says where each part of the spec lands in the existing code, which names to use, and in what order to build.
- `CLAUDE.md` in the repo still applies: work on main, one checkpoint before and after each phase, additive schema changes only, pure logic in `base44/shared` with `node:test` tests, tenant from the authenticated user, never publish.
- If the spec and the code disagree in a way this plan does not cover, stop and ask.

**Before phase 1**

1. Copy the whole pack into `docs/``outreach``/` in the repo, with this plan as `docs/outreach/IMPLEMENTATION_PLAN.md`.
2. Add an "Outreach conversation" block to `CLAUDE.md` that points to it and repeats the rules in section 4.
3. Read spec sections 1 to 8, click through the prototype for Person and Organisation, then read sections 3 to 5 of this plan.

**What I read.** All of files 00 to 10 in the pack, and the repo code named in section 2. Of the prototype HTML I read only its function and constant list (1,275 lines, 133 KB), because the spec and transcripts carry the logic and wording. Claude Code must open the prototype itself for layout. I did not run the app.

## 2. What exists today

Outreach today is a list: an analyst picks library items, the client fills them in on one long page at `/portal/:token`, and answers are stored inside the request row.

| Area | Where it lives | How it works now |
| --- | --- | --- |
| Library items | entity `OutreachTemplate` (28 fields), `components/tenantconfig/OutreachTemplatesTab.jsx` (692 lines) | One row per question or document. 16 field types, including `id_verification`, `kyb_verification`, `signature`, `address`, `phone`. One condition only: depends on one other item equalling one value |
| Form templates | entity `OutreachFormTemplate`, `FormTemplatesTab.jsx` (775 lines) | Ordered list of item references, default channel and deadline, email template link |
| Request | entity `OutreachRequest` (14 fields) | `items[]` holds questions and answers together. Status: Draft, Sent, Viewed, Partial\_Response, Complete. `access_token` stored in plain text. `related_party_id` already exists for a UBO or director |
| Client portal | `pages/ClientPortal.jsx` (1,420 lines), route `/portal/:token` | Reads and writes `OutreachRequest`, `Tenant`, `Client`, `Document` and `AuditEvent` straight from the browser without sign-in. Has EN and NL strings, autosave of items, a signature pad |
| Staff side | `components/case/OutreachStep.jsx` (1,645 lines, case step 1), `pages/StandaloneOutreach.jsx`, `pages/OutreachDashboard.jsx` | Create and send requests, review answers, verify documents, profile suggestions |
| Didit ID&V | `createDiditSession`, `getDiditSessionResult`, `diditWebhook`, `shared/diditSessionAuth.js`, `components/portal/IdVerificationField.jsx` | Session per request item, callback plus pull every 4 s, signed webhook with dedupe. A related-party request writes to `RelatedParty.didit_idv_snapshot`. An organisation client never receives a person's identity data |
| Related parties | entities `RelatedParty`, `ClientRelatedPartyLink` (`roles`, `ownership_percentage`), `shared/kybRelatedParty.js`, `sendKeyPersonIdv` | Person or company linked to a client, with verification status. No company-to-company ownership chain |
| Document AI | `ocrDocumentParse` (platform LLM with JSON schema), `shared/docCheckAgent.js`, `shared/docForensics.js`, workflow "Document Checker Sweep" | Field extraction for ID and company documents; advisory authenticity check on every `Document` row |
| Email and tipping-off | `sendOutreachEmail`, `shared/tippingOff.js`, entity `EmailTemplate` | Every customer email passes the tipping-off lock check and returns 423 when locked |
| Secrets and AI | entity `TenantSecret` (backend only), `shared/claudeClient.js`, `aiOrchestrator`, entity `AiAgentRun` | Per-tenant Didit and Anthropic keys; AI runs logged with token counts |
| Audit | entity `AuditEvent` | `actor_type` is User, AI\_Agent or System. No request or party reference, no payload field |

**Three findings that shape the design**

1. `OutreachRequest`, `Document` and `AuditEvent` have no access rules, and the public portal depends on that. Spec section 13 forbids exposing case data through a token, so the new portal must talk to backend functions only.
2. `IdVerificationField.jsx` builds its QR code through `api.qrserver.com`, which sends the Didit session URL to a third party, and switches to the phone layout below 900 px. The spec asks for no external resources and a 760 px rule, so the new ID&V widget is a new component.
3. `getDiditSessionResult` sets a Prospect client to Active as soon as an ID check passes. In the organisation flow the representative passes ID&V before signing, so the organisation would become Active early. See open decision 9.

**What else depends on the classic outreach**

27 backend files and 28 frontend files outside the outreach screens read or create outreach requests. Because the classic outreach stays, every row below keeps working as it does today and is not rebuilt. The table is the list of things the new module must not break.

| Dependent | Files | What it uses |
| --- | --- | --- |
| Answers read by other case steps and jobs | `buildProfileSuggestions`, `runCaseQc`, `shared/qcData.js`, `shared/riskFacts.js`, `shared/customerFile.js`, `runKycScreener`, `getMyWork`, `recordKycDecision`, `shared/tmFiuGather.js`; case steps Identity Verification, Client Profile, Profile Verification, SoF/SoW, Screening, KYC Report, AI assistant | `OutreachRequest.items[]`: `response_text`, `response_value`, `file_url`, `status`, `profile_field` and the Didit fields on the ID&V item |
| Transaction-monitoring case: request information | `components/tm/case/RequestInfoDialog.jsx`, `manageTmCase` | Creates a classic request and emails a `/portal/` link |
| Transaction-monitoring case: re-verify identity | `components/tm/case/ReverifyDialog.jsx` | Starts a Didit session with a `/portal/` return address |
| Key-person ID check | `sendKeyPersonIdv`, `components/case/kyb/KeyPeopleVerification.jsx` | Creates a classic request for a related party and a `/portal/` link |
| Didit KYB (flag `didit_kyb`) | `createDiditKybSession`, `getDiditKybResult`, `components/portal/KybVerificationField.jsx` | The business verification runs as a field inside the classic portal |
| Standalone and bulk outreach | `pages/StandaloneOutreach.jsx`, entity `StandaloneOutreach`, `pages/OutreachDashboard.jsx` | Outreach without a case, to many clients at once |
| Navigation and tests | `AppShell.jsx`, `lib/amlNav.js`, `tests/phase2-nav.test.js` | Two menu items, `/outreach/new` and `/outreach-dashboard`, behind the flag `outreach` |
| Links already sent | Client emails | `/portal/{token}` addresses that clients may still open |

## 3. Gap map: spec against code

| Spec area | Today | Action |
| --- | --- | --- |
| Blocks with widget, why-text, conditions, follow-ups, evidence, versions (4.2) | Flat library items, one equals-condition, no versions | New entity `OutreachBlock`, new tab, seed from `02` |
| Form template with sections, per-template Active, settings, intro (4.3) | Ordered item list only | New entity `OutreachFlowTemplate`, new tab, seed from `03` |
| Tenant settings (4.1) | None for outreach | New JSON field `Tenant.outreach_settings`; keys in `TenantSecret` |
| Request with frozen snapshot, hashed token, progress, org context (4.4) | Plain token, live items | Extend `OutreachRequest` additively as a thin carrier; state in new `OutreachConversation` |
| Thread, block state (4.4) | None | New `OutreachThreadMessage`; block states as a map on the conversation |
| Datapoints with source and history (4.5, 4.6) | Answer text on the item | New `OutreachDatapoint` |
| Evidence with checks and AI read result (4.5) | `Document` row plus advisory check | New `OutreachEvidence`, and a `Document` row per file so the existing checker and case review keep working |
| Open requests (4.5) | None | New `OutreachOpenRequest` |
| Party graph and invitations (4.7) | `RelatedParty` and client link | Reuse both; new `OutreachPartyRelation` for ownership chains; new `OutreachInvite` |
| Adapter cost log (4.8) | None | New `OutreachAdapterCall` |
| Conversation engine, 17 widgets, progress, resume (5) | None | New, server-driven |
| Condition language and editor (5.4) | One equals-condition | New shared evaluator and builder UI |
| Follow-up rules, evidence strictness (6.1, 6.4) | None | New |
| AI follow-up with risk-based approval (6.2) | AI drafts exist for staff, no approval task | New adapter and approval queue; reuse `Notification` and `AiAgentRun` |
| Document checks per upload (6.3) | Advisory forensics after upload | New synchronous check adapter using the platform LLM, plus rule checks |
| Didit ID&V (7, 8.13, 10) | Works | Reuse the three functions unchanged, one small auth addition, new widget |
| Company registry lookup and directors proposal (8.4, 8.6) | None | New registry adapters: Didit by default, KvK when a key is configured (phase 6) |
| AI extract reading (8.5) | `ocrDocumentParse` reads company documents | New adapter modelled on it, with the spec's field list |
| UBO calculation and chart (8.8, 9) | None | New pure module and SVG component |
| Tracker, queued invitations, child requests (8.9, 8.10) | `sendKeyPersonIdv` sends one ID check | New; child request is an `OutreachRequest` with `related_party_id` |
| Review, signature, submission hash (7, 8.14) | Signature pad, no hash | New widgets; reuse the canvas approach, add hash, IP and user agent |
| Second round and composer (5.7) | Staff can add items to a request | New, in the thread |
| Reminders (5.6) | `EmailTemplate` has three reminder situations, no scheduler for them | New scheduled function and workflow |
| Backstage view (11) | None | New panel in case step 1 |
| Audit events (12) | `AuditEvent` without request or payload | Additive fields, events written by the backend only |
| Security (13) | Plain token, direct entity access, public file URLs | Hashed token, functions only, private files with signed URLs, rate limit |
| Translations structure | EN and NL strings inside `ClientPortal.jsx` | `translations` map on blocks; UI strings in one new file |

## 4. Design decisions

These twelve decisions let the new and the classic outreach run side by side. Decisions 1, 2, 11 and 12 were set by Dave on 17 Nov 2026.

1. **Both modules stay.** The new module has its own entities, pages and functions and does not edit the classic files. The classic outreach is never removed. Reason: tenants use it today, other parts of the app depend on it (section 2), and Vitauri wants to switch the new outreach on tenant by tenant.
2. **One flag, in the Ops console.** `outreach_conversation`, `defaultOff: true`, added to `FEATURE_DEFINITIONS` in `src/lib/featureFlags.js` under the Outreach group, so it appears with the other per-tenant feature switches that Vitauri Ops manage. What the flag does is in "Flag behaviour" below.
3. **New block and template entities.** `OutreachBlock` and `OutreachFlowTemplate` are new. `OutreachTemplate` and `OutreachFormTemplate` are not extended.
4. **`OutreachRequest` is the carrier.** Each conversation has one `OutreachRequest` row with `engine: 'conversation'`, so the Didit functions, `related_party_id` and every reader of outreach answers keep working. The carrier holds one item `{ item_id: 'idv', field_type: 'id_verification' }` because `createDiditSession` requires the item to exist. Conversation state lives in `OutreachConversation` and its child entities, which staff of the tenant can read and only the backend can write.
5. **The server runs the conversation.** One public function, `outreachPortal`, validates the token, applies an answer, runs rules and returns the new thread messages plus the next widget. The browser renders and never decides what is asked.
6. **Token.** 32 random bytes, shown once in the link, stored as SHA-256 in `OutreachRequest.token_hash`. `access_token` stays empty on conversation requests, so the classic portal cannot open them.
7. **Route.** Public route `/outreach/:token`, placed beside `/portal/:token` in `src/App.jsx`. Add a test that `/outreach/new` and `/outreach-dashboard` still resolve to their pages. If the route nesting makes that impossible, use `/o/:token` and tell Dave.
8. **Audit names.** Store spec events in `AuditEvent.event_type` with the prefix `outreach.` (for example `outreach.block.asked`) and show them without the prefix in the backstage view. All are written by backend functions.
9. **AI calls use the platform LLM** (`Core.InvokeLLM` with a JSON schema, as `ocrDocumentParse` does), not the tenant's Anthropic key. Every call writes an `AiAgentRun` row through `shared/aiLog.js`.
10. **Mirror answers into the request items.** This is the contract between the new module and the rest of the app; see "Mirror contract" below. It runs at submission and again whenever a deferred or second-round request is answered.
11. **The classic case step stays the review screen.** Mirrored answers and uploaded files appear in the classic "Outreach & Documents" step, where document review, bulk verify and the suggested profile updates already work. The new panel adds what the classic step does not have: starting a conversation, approvals of AI follow-ups, the second round and the backstage view.
12. **Company registry: Didit by default, KvK when configured.** One registry interface with two providers. Didit's company registry search is the default for every country it covers, using the Didit key the tenant already has. For a Dutch organisation, KvK is used instead when the tenant's KvK mode in the Ops console is Live or Test. ID&V of persons is always Didit. This replaces the spec's statement that Didit is used for persons only; details are in phase 6.

**Flag behaviour (decision 2)**

|  | Flag off (default) | Flag on |
| --- | --- | --- |
| Case step 1 | Classic step only, as today | New panel above the classic step: start a guided conversation, approvals, second round, backstage. The classic step below stays fully usable |
| Tenant Config | Classic "Outreach Templates" and "Form Templates" tabs only | The same tabs gain a Classic or Conversation switch, plus the Outreach settings card |
| Classic requests, `/portal/:token`, standalone outreach, outreach dashboard, transaction-monitoring dialogs, key-person ID check, Didit KYB | Work as today | Work as today |
| New conversation requests | Cannot be created | Can be created |
| A conversation already sent, when the flag is switched off later | Its `/outreach/:token` link keeps working until it is submitted or expires, and staff can still finish it from the case |  |

- The flag is checked in the frontend to show or hide the new UI, and in `sendOutreachConversation`, `manageOutreachConfig` and `seedOutreachLibrary` on the server, which refuse when it is off. `outreachPortal` does not check it, so client links never break.
- Switching the flag writes the same audit event as the other feature switches.
- A test asserts that with the flag off no new component is rendered in case step 1 and Tenant Config, and that `sendOutreachConversation` returns 403.

**Mirror contract (decision 10)**

- One item per datapoint that has a `profile_field`, and one item per evidence file. The `idv` item belongs to the Didit functions and is never rewritten by the mirror.
- Item fields, matching what the readers use today: `item_id` (`dp:{key}` or `ev:{evidence id}`), `label`, `field_type`, `item_type` (`data_point` or `document`), `profile_field`, `response_text` (the display value), `response_value` (the structured value), `file_url`, `file_name`, `status: 'Received'`, `received_at`, `source` (the datapoint source code).
- `profile_field` is a new optional key on each block datapoint. Its values come from `PROFILE_FIELDS` in `src/lib/profileFieldMap.js`. The seed sets it where a KYC field clearly matches (`address`, `email`, `phone`, `employment`, `income`, `sof`, the registry fields and so on) and reports the datapoints left unmapped, for David to decide.
- The mirror replaces its own items by `item_id` and leaves any other item alone, so running it twice gives the same result.
- At submission the carrier status becomes `Complete`, the value the existing readers treat as finished.
- A test builds a mirrored request from scenario A and from scenario C and checks that `buildProfileSuggestions` produces suggestions from it without reading `OutreachTemplate`.

**Existing files this work may edit** (nothing else on the guarded list)

| File | Allowed change |
| --- | --- |
| `src/App.jsx` | Add the public route |
| `src/lib/featureFlags.js`, `src/lib/permissions.js` | Add the flag and two permission keys |
| `src/pages/TenantConfig.jsx` | Mount the new tabs and the Outreach settings card when the flag is on |
| `src/pages/CaseWorkspace.jsx` | Render the new backstage panel above `OutreachStep` in step 1 when the flag is on |
| `base44/shared/diditSessionAuth.js` | In `authorizeOutreachCaller` only: also accept a token whose SHA-256 equals `outreach.token_hash` |
| `base44/entities/OutreachRequest.jsonc`, `AuditEvent.jsonc`, `Tenant.jsonc`, `TenantSecret.jsonc`, `Document.jsonc`, `EmailTemplate.jsonc` | Additive fields and enum values listed in section 5 |

This table holds for the whole build. One more existing area is in scope: the Ops console (`src/pages/OpsDashboard.jsx`, `src/components/ops/`), for the "Outreach integrations" card. No classic outreach file is edited or deleted in any phase.

**Rules that hold in every phase**

- No question text, option, threshold or bank name in code. Texts come from the snapshot; settings come from `Tenant.outreach_settings`.
- Every customer email goes through the tipping-off check in `shared/tippingOff.js`.
- Do not copy prototype code. Do not build the "Demo:" buttons or the demo controls.
- Adapters fail soft: `{ ok: false, error_code, message }`, and the conversation falls back as spec section 10 says.

## 5. Data model

Ten new entities and additive changes to six existing ones. Every new entity has `tenant_id`; read access for the tenant's staff and Vitauri Ops; create, update and delete for the backend only (the `__backend_only__` pattern used by `TenantSecret`), except the two config entities, which Tenant Admin and Compliance Admin may edit.

**New entities**

| Entity | Spec name | Fields |
| --- | --- | --- |
| `OutreachBlock` | OutreachBlock | `key`, `version`, `status` (draft, published), `label`, `section_key`, `client_types[]` (NP, ORG, RP), `widget`, `question_template`, `variants` (JSON), `why_text`, `options[]`, `multi`, `none_option`, `datapoints[]`, `kyc_mapping`, `show_if` (JSON), `follow_ups[]`, `evidence` (JSON), `prefill`, `validation` (JSON), `edit` (JSON), `active_default`, `translations` (JSON), `raw` (the seed entry, unchanged) |
| `OutreachFlowTemplate` | FormTemplate | `key`, `name`, `client_type`, `case_types[]`, `version`, `status`, `sections[]` (`key`, `label`), `items[]` (`block_key`, `block_version`, `active`, `section_key` override), `settings` (JSON), `intro_messages[]`, `start_chip`, `expected_minutes`, `default_deadline_days`, `channel` |
| `OutreachConversation` | OutreachRequest (state part) | `request_id`, `case_id`, `client_id`, `party_id`, `parent_conversation_id`, `template_key`, `template_version`, `blocks_snapshot` (JSON), `settings_snapshot` (JSON), `language`, `risk_class`, `invited_name`, `invited_email`, `sent_at`, `first_opened_at`, `last_activity_at`, `submitted_at`, `submission_hash`, `reference`, `progress_steps`, `progress_total`, `current_block_key`, `block_states` (map of key to `state`, `asked_at`, `answered_at`, `skip_reason`), `org_context` (JSON: `route`, `country`, `legal_form_kind`, `representative_verified`, `representative_name`), `pending_step` (JSON: what the engine waits for), `ai_followup_count`, `signature` (JSON: file ref, typed name, timestamp, IP, user agent) |
| `OutreachThreadMessage` | ThreadMessage | `conversation_id`, `seq`, `author_type` (bank, client, analyst, system), `author_name`, `kind` (message, answer, follow\_up, explanation, status\_card, system\_line), `block_key`, `tag`, `ai_assisted`, `approved_by`, `approved_at`, `payload` (JSON), `display_text`, `status` (sent, held) |
| `OutreachDatapoint` | Datapoint | `conversation_id`, `case_id`, `party_id`, `key`, `label`, `value` (JSON), `display_value`, `source` (idv, client, ai, doc, pre, kvk, prop, calc, rep), `block_key`, `status` (given, edited, deferred), `history[]` |
| `OutreachEvidence` | EvidenceFile | `conversation_id`, `block_key`, `datapoint_key`, `file_uri` (private), `document_id`, `name`, `size`, `mime`, `virus_scan`, `status` (passed, failed, pending, deferred), `checks[]`, `read_result` (JSON), `kind` |
| `OutreachOpenRequest` | OpenRequest | `conversation_id`, `title`, `from_name`, `block_key`, `party_name`, `kind` (deferred\_evidence, analyst\_request, own\_checks, ai\_approval), `status` (open, answered), `answered_at`, `assigned_user_id` |
| `OutreachPartyRelation` | PartyRelation | `case_id`, `client_id`, `from_party_id`, `from_name`, `from_kind` (person, company), `to_party_id` (empty means the client itself), `relation` (owns, director\_of, authorised\_rep\_of, ubo\_of), `pct`, `effective_pct`, `authority`, `authority_note`, `source`, `evidence_id` |
| `OutreachInvite` | RelatedPartyInvite | `conversation_id` (parent), `party_id`, `child_request_id`, `roles_text`, `needs`, `email`, `status` (To invite, Queued, Invited, Opened, Completed, Declined, Expired), `queued_at`, `invited_at`, `completed_at` |
| `OutreachAdapterCall` | AdapterCall | `conversation_id`, `vendor`, `operation`, `cost_eur`, `cost_basis`, `status`, `response_hash`, `duration_ms` |

`Party` in the spec maps to the existing `RelatedParty` (person or company, `party_type` NP or ORG), linked to the client through `ClientRelatedPartyLink`. Create or match parties with the same rules as `src/lib/relatedPartyUpsert.js`; put the backend copy in `base44/shared`.

**Additive changes to existing entities**

| Entity | Add |
| --- | --- |
| `OutreachRequest` | `engine` (classic, conversation), `token_hash`, `parent_request_id`, `conversation_id`; status values `Opened`, `In_Progress`, `Submitted`, `Expired`, `Cancelled` |
| `AuditEvent` | `outreach_request_id`, `related_party_id`, `payload` (JSON); `actor_type` value `Client` |
| `Tenant` | `outreach_settings` (JSON string, same pattern as `tm_settings`): `uboThreshold` 25, `ownerListThreshold` 10, `releaseInvitesAfterIdv` true, `defaultDeadlineDays` 14, `tokenGraceDays`, `reminderDays`, `documentMaxAgeMonths` 3, `aiFollowUp` per risk class, `aiFollowUpMaxPerRequest` 3, `idvMaxAttempts`, `legalFormKeywords`, `phoneCountryCodes`, `addressCountries`, `blockedJurisdictions`, `referencePrefix`, `responseTimeTexts`, `integrations` (enabled switches and non-secret values only), `adapterCosts` |
| `TenantSecret` | `kvk_api_key`, `second_source_api_key`, `outreach_rotated_at` |
| `Document` | `doc_type` values `Proof_of_Address`, `Power_of_Attorney`, `Shareholder_Register`, `Partnership_Agreement`, `Loan_Agreement`, `Wealth_Evidence`, `Annual_Accounts` |
| `EmailTemplate` | `situation` values `Conversation_Invite_NP`, `Conversation_Invite_ORG`, `Conversation_Invite_Related_Party`, `Conversation_New_Message`, `Conversation_Reminder` |

**Seed mapping.** `02-block-library.json` and `03-form-templates.json` do not match the spec's field names one to one. The seed function must normalise these points and keep the original entry in `raw`:

- Widget names: `confirm_or_text`, `registry_lookup_or_document`, `ownership_builder`, `calculated_confirm` and the composite values with "+" map to the catalogue in spec 5.2.
- `name_confirm.show_if` is the text "after idv", not a condition. Treat it as always true; the order already guarantees it.
- `default_source` values such as `kvk|doc` become a list of allowed sources.
- Templates give `blocks` as a list of ids and `sections` as pairs. Convert to `items[]` and `sections[]`.
- The related-party template reuses NP blocks. Add `RP` to their `client_types`, and set the `section_key` override `contact` for `pep` on that template.
- The ORG block `rep` contains the NP blocks `idv`, `name_confirm` and `pep` as steps.
- Block texts name "New Age Bank". Replace with `{tenant_name}` during seeding.
- `pep` follow-ups write `pep_detail_who` and `pep_detail_rel`, combined into `pep_detail`.

## 6. Backend and frontend structure

Pure logic goes in `base44/shared/outreach*.js` with tests; functions stay thin. The frontend does not import from `base44/shared`: a rule needed on both sides gets a copy in `src/lib` and an entry in `tests/shared-copies.test.js`.

**Shared modules (pure, tested)**

| Module | Does |
| --- | --- |
| `outreachConditions.js` | Evaluates the condition language of spec 5.4 against answers, risk class, route, legal form kind, check results and calculations. Copy in `src/lib` for the editor preview |
| `outreachEngine.js` | Block lifecycle, next step, skip and off logging, progress total and steps (spec 5.5), resume |
| `outreachFollowUps.js` | The nine rule actions of spec 6.1, one follow-up per trigger, AI limit per request |
| `outreachSeed.js` | Maps the pack JSON to entity rows (section 5) |
| `outreachSnapshot.js` | Freezes blocks, template and settings into a request |
| `outreachToken.js` | Token, hash, expiry with grace, attempt counting |
| `outreachUbo.js` | Effective share over all paths, rounding to 0.1, cycle protection by company id, threshold, senior-official fallback |
| `outreachLegalForm.js` | Legal form kind from keywords (spec 8.12), tenant-extendable |
| `outreachParties.js` | Union of directors, UBOs and authorised representatives, roles text, role text for the intro, invite states |
| `outreachDocRules.js` | Rule checks: document age against `documentMaxAgeMonths`, name match with ID or registry name |
| `outreachSubmission.js` | Canonical JSON of the answers and SHA-256, reference number |
| `outreachAudit.js` | One writer for all spec section 12 events, with PII kept in `payload`, not in `notes` |
| `outreachIdv.js` | Maps the Didit fields on the carrier item to `full_name`, `dob`, `nat`, `doc` and the four checks |
| `outreachAdapters/kvk.js`, `diditRegistry.js`, `documentAi.js`, `aiFollowup.js`, `address.js` | The interfaces in `07-adapter-contracts.md`. Each has a fixture mode fed by `05-demo-fixtures.json` and writes `OutreachAdapterCall` |

**Functions**

| Function | Caller | Does |
| --- | --- | --- |
| `seedOutreachLibrary` | Tenant Admin, Vitauri Ops | Imports blocks and the three templates for the caller's tenant; idempotent by `key` |
| `manageOutreachConfig` | Tenant Admin, Compliance Admin | Save draft, publish (version + 1), toggle a block's Active on a template, save settings; writes `config.changed` |
| `sendOutreachConversation` | Work roles | Creates carrier and conversation, snapshot, token, tipping-off check, invitation email, `request.sent` |
| `outreachPortal` | Public, token | Actions: `open`, `answer`, `edit`, `why_opened`, `defer`, `idv_status`, `message`, `invite`, `kvk_search` |
| `outreachUpload` | Public, token | Stores the file privately, creates `OutreachEvidence` and `Document`, runs the checks, returns results |
| `outreachStaff` | Work roles | Backstage data, approve or edit an AI follow-up, analyst question or document request, change risk class, resend link, cancel |
| `outreachSweep` | Scheduled | Reminders, expiry, held AI follow-ups past a time limit, safety release of queued invitations. New workflow file "Outreach Conversation Sweep" |

**ID&V path (no change to the Didit functions)**

1. The portal calls the existing `createDiditSession` with `outreach_id`, `item_id: 'idv'`, the link token as `access_token` and `portal_url` set to the `/outreach/{token}` address.
2. The existing callback, 4-second pull and webhook update the carrier item.
3. The portal calls `outreachPortal` action `idv_status`, which reads the item, writes the four datapoints with source `idv`, logs `prefill` and continues.
4. A related-party request has `related_party_id` set, so the existing code writes the result to that party.

**Save, resume and connection loss**

Data is saved answer by answer on the server, never only at the end. The link always resumes at the first unanswered block.

| Moment | What is stored, and where it shows |
| --- | --- |
| Each answer | Thread message, datapoint with source and block state, written by `outreachPortal` before it replies. Visible at once in the staff panel on the case |
| Didit decision | Written to the carrier's `idv` item by the existing Didit functions; the webhook delivers it even when the client's browser is closed |
| Signing | Answers frozen with a hash, carrier set to `Complete`, answers mirrored into the request items that the other case steps read |

| Situation | Required behaviour |
| --- | --- |
| Browser closed between questions | Nothing lost. `open` rebuilds the thread and asks the first unanswered block |
| Closed while typing | Only the unsent answer is lost; the block is asked again |
| Connection drops while an answer is being sent | The browser retries with the same answer id; the server applies it once. The widget shows "Not saved. Try again." until the server confirms |
| Laptop closed while the phone runs the Didit check | The webhook stores the result. On the next `open` the server finds it and continues at `name_confirm` without showing the QR code again |
| Phone loses connection during the Didit check | The Didit session stays open until it expires. The same QR code or button continues it; no new session is created |
| Upload interrupted | No evidence row is created; the upload widget is shown again |
| Two tabs or devices open | The server is the only writer of state. An answer for a block that is no longer current is refused and the tab reloads the thread |
| Client never returns | Reminders on `reminderDays`, expiry at the deadline plus grace, expired page with a way to ask for a new link. The partial answers stay in the conversation entities |

**Frontend**

| Path | Content |
| --- | --- |
| `src/pages/OutreachConversation.jsx` | Public page: left rail, thread, widget slot, composer, expired page |
| `src/components/outreachconv/widgets/*` | One file per widget in spec 5.2 |
| `src/components/outreachconv/StructureCard.jsx` | SVG chart per spec section 9 |
| `src/components/outreachconv/backstage/*` | The seven parts of spec section 11 |
| `src/components/tenantconfig/outreachconv/*` | Blocks tab, block editor, condition builder, templates tab, settings card, preview |
| `src/lib/outreachConvStrings.js` | All client-facing UI strings, keyed, English only for now |
| `src/lib/outreachConvTokens.css` | The tokens from `08-design-tokens-and-ux-notes.txt`, scoped to the portal page; tenant branding colours override `--brand` |

The portal page loads no external fonts, scripts or images. Generate the QR code in the browser; this needs one new dependency (open decision 6).

## 7. Phases

Eleven phases, in the order of the card's subtasks. The classic outreach is not touched in any of them. Do one phase at a time, with a Base44 checkpoint before and after. Each phase ends with its own tests green, the classic smoke checklist in `docs/kyc-aml/IMPLEMENTATION_PLAN.md` section 5 passing, and the demo check shown against the prototype. AT numbers refer to the acceptance tests in spec section 14.

### Phase 1: Entities, Tenant Config and seed

- Create `OutreachBlock` and `OutreachFlowTemplate`; add `Tenant.outreach_settings`, the `TenantSecret` fields, the flag and permission keys `outreachConfig` and `outreachConversationWork`.
- Write `outreachConditions.js`, `outreachSeed.js` and the function `seedOutreachLibrary`; write `manageOutreachConfig`.
- Tenant Config: under "Outreach Templates" and "Form Templates" add a Classic or Conversation switch (in `TenantConfig.jsx`, flag on only). Conversation view: block list with Active default, block editor for every field in spec 4.2, condition builder (pick block, operator, value; nest with all, any, not), template editor with ordered items, per-template Active switch, sections, settings and intro messages; "Import starter library" button; Outreach settings card.
- Publishing a block or template raises its version. Drafts are never used by a request.
- Tests: `outreach-conditions.test.js` (every operator, nesting, unknown block), `outreach-seed.test.js` (15 NP blocks, 20 ORG blocks, 3 templates, the normalisations in section 5).
- Demo: import the library, open `sof`, see its three follow-ups and conditions, save a changed condition, publish.

**Added 17 Nov 2026: integration keys live in the Ops panel**

- The feature flag `outreach_conversation` shows in the Ops console with the other per-tenant feature switches, labelled "Guided conversation outreach", default off (section 4, "Flag behaviour").
- A new "Outreach integrations" card on the Ops console (`src/pages/OpsDashboard.jsx`, `src/components/ops/`) shows, per tenant, which company registry is in use: "Didit (default)" or "KvK for the Netherlands". Tenant Admins do not see or edit keys.
- The card holds the KvK settings: mode (Off, Test, Live), key set or not with the last four characters, date of last change, and a "Test connection" button. With mode Off the tenant uses Didit for every country.
- The KvK key is stored in `TenantSecret.kvk_api_key` through `manageOutreachConfig`, action `set_integration`, allowed for the role Vitauri Ops only. A key is never returned to the browser. Every change writes an audit event without the value.
- One KvK key per tenant. KvK allows a key to be used within one organisation only, so a single Vitauri key shared by all tenants is not built (open decision 1).
- Didit needs no new key: the registry lookup uses the tenant's existing Didit key from `TenantSecret`. The card shows whether that key is set.
- The field `second_source_api_key` listed in section 5 is not created; there is no second vendor any more (phase 6).
- The Tenant Config settings card keeps the non-secret settings (thresholds, deadlines, reminder days) and shows the integration status read-only.

**Added 17 Nov 2026: KvK test mode in the Ops panel**

Test mode lets Vitauri Ops prove the KvK integration end to end before any tenant has a real key. The card is built in phase 1 with the mode switch and key fields; the lookup tool and the calls behind it arrive with the KvK adapter in phase 6.

| Part of the card | What it does |
| --- | --- |
| Mode switch per tenant | Off, Test or Live. Test needs no tenant key. Live cannot be chosen until a key is saved |
| "Test connection" | One free search call in the chosen mode. Shows success with the response time, or the error (wrong key, rate limit, register unreachable) |
| "Try a lookup" | Ops types a name or KvK number, sees the result list, picks one and sees the profile exactly as the conversation would map it to datapoints. Nothing is saved to a client or case |
| Recent calls | The last 20 `OutreachAdapterCall` rows for the tenant: operation, environment, status, duration, cost |

- Test mode calls KvK's public test environment (`https://api.kvk.nl/test/api/v2/zoeken` and `https://api.kvk.nl/test/api/v1/basisprofielen`) with the public test key that KvK publishes on developers.kvk.nl. Read the current key and URLs there before building; keep them in one config constant in `outreachAdapters/kvk.js`, not in `TenantSecret`.
- The adapter takes `environment` (`test` or `live`) from the tenant's mode. Base URL and key are the only differences; mapping and error handling are the same code, so a pass in Test mode is evidence for Live.
- Add `environment` to `OutreachAdapterCall`. Test calls are logged with cost 0.
- A conversation that runs while the tenant is in Test mode uses the fictitious KvK test companies. Mark it: the staff panel shows a "KvK test data" pill, the datapoint source label reads "KvK trade register (test)", and the conversation stores `kvk_environment: 'test'`.
- Guard against test data in a real file: `sendOutreachConversation` refuses an ORG request for a client with status other than Prospect while the tenant is in Test mode, and the Ops card shows a warning banner for every tenant left in Test.
- Switching mode writes an audit event with the old and new mode and applies to new requests only; a request in flight keeps the mode from its snapshot.
- Tests: adapter unit tests against recorded test-environment responses (search, profile, not found, 401, 429, timeout); a test that Live is refused without a key; a test that the mode is frozen in the snapshot.
- Demo for phase 6: set the Demo tenant to Test, run "Test connection" and "Try a lookup" with one of KvK's test companies, then run the organisation conversation against the same company.

### Phase 2: Request, thread, datapoints, token link and portal shell

- Create the remaining eight entities and the additive fields on `OutreachRequest` and `AuditEvent`.
- Write `outreachToken.js`, `outreachSnapshot.js`, `outreachAudit.js`; functions `sendOutreachConversation` and `outreachPortal` with action `open`.
- Staff entry point: a "Start guided conversation" button in the new panel in case step 1 (template picked by client type and case type; invited name and email from the client; risk class from the case).
- Portal shell at `/outreach/:token`: left rail (greeting, deadline, progress, minutes left, saved indicator, open requests, help line), empty thread, expired page with a way to ask for a new link, phone layout per `08`.
- Rate-limit failed token attempts per IP and per hash prefix.
- Tests: `outreach-token.test.js`, `outreach-snapshot.test.js` (a later block edit does not change a sent request), route test for `/outreach/new`.
- Demo: send a request, open the link in a private window, see the intro and the rail; the classic portal still works.

### Phase 3: Conversation engine and NP widgets

- Write `outreachEngine.js` and the simple follow-up actions `ask_text`, `ask_area`, `ask_choice`, `explain_and_reask`, `rule`.
- `outreachPortal` actions `answer`, `why_opened`, `edit`.
- Widgets: `chips`, `multi`, `text`, `area`, `phone`, `address`, `confirm_facts`, `form`, `review`, `sign`, and a stub `idv` and `upload` that pass in fixture mode.
- Thread rendering with typing delay per spec 5.1, tags, "Why do we ask this?", auto-scroll, `aria-live`, reduced motion.
- Progress: 15 for NP, steps, percentage, minutes left, section ticks. Resume at the first unanswered block.
- Submission: canonical hash, reference, status card, `case.submitted`.
- Tests: `outreach-engine.test.js` replays scenario A from `06` with scripted answers and asserts each BANK line, the datapoints with source and the audit order; `outreach-progress.test.js`.
- Covers AT 1, 2, 3, 4, 11.
- Demo: run scenario A end to end with stubs; close after block 6, reopen, continue at block 7.

**Added 17 Nov 2026: retry without duplicates**

- Every `answer`, `edit`, `defer` and `message` call carries an id made in the browser (`client_answer_id`) and the `seq` of the last message the browser has. The server stores the id on the thread message, returns the stored result when the same id arrives again, and refuses an answer whose block is no longer the current one.
- The widget stays on screen until the server confirms. On a failed call it shows "Not saved. Try again." with a retry button, and retries by itself when the browser reports it is online again. The saved indicator changes only after a confirmed save.
- Tests: the same answer sent twice produces one thread message and one datapoint; an answer for a block that is not current is refused.

### Phase 4: Didit ID&V and the related-party template

- Add the `token_hash` branch to `authorizeOutreachCaller`. Add a test for it; do not change anything else in that file.
- Real `idv` widget: QR when `min(window.innerWidth, screen.width) > 760`, otherwise the button "Continue with Didit"; three numbered steps; "Not now" logs `block.declined` and re-asks; attempt limit from settings; `in_review` and `declined` texts per adapter contract 3.
- Handle the return with `didit_done=1` on the new route, then action `idv_status`. Keep the pull as the fallback when the webhook is late, using a ref-based timer as the classic field does.
- `name_confirm` shows the four values; the sign widget compares the typed name with the ID name, case-insensitive.
- Related-party mode: template `related_party_np` (8 blocks), intro with `{company}` and `{role_text}`, child carrier with `related_party_id` and `parent_request_id`.
- Tests: `outreach-idv.test.js` (field mapping, the four checks, name comparison). Use the Didit sandbox and `didit_session_simulate` for approved, declined and in review.
- Covers AT 12, 13.
- Demo: QR on a laptop, finish on a phone, the chat continues by itself; same on a phone alone.

**Added 17 Nov 2026: resume around the Didit check**

- `open` checks the carrier's `idv` item before anything else in an ID&V block. A stored decision is applied at once (datapoints, `prefill`, continue at `name_confirm`); the QR code is not shown again.
- A session that is still open is reused: the widget shows the same session address as QR code or button. A new session is created only when the earlier one was declined, abandoned or expired, and it counts against `idvMaxAttempts`.
- While waiting, the page keeps the 4-second pull and also checks once when the tab becomes visible again or the browser comes back online.
- Tests: `open` with a stored approved item continues without a new session; `open` with an open session returns the same session address; an expired session leads to a new one and raises the attempt count.

### Phase 5: Rules, document checks and AI follow-up

- Remaining actions: `ask_file`, `ask_file_per_person`, `ask_people`, `re_request`, `ai_followup`.
- `outreachUpload` with private storage, signed URLs for staff, type and size limits (PDF, JPG, PNG, 25 MB), a `Document` row per file.
- `upload` widget: checks appear one by one with pass or fail; "I will provide this later" only when `allow_defer`; a deferral creates an `OutreachOpenRequest` and logs `request.deferred`.
- `documentAi.check` for the checks on the block, plus `outreachDocRules.js`. If the AI call fails, mark the file pending for manual review and continue where the block allows.
- `aiFollowup`: rephrase inside the limits of spec 6.2; validate the output (one question, at most two sentences, no mention of risk or screening) and fall back to the default text.
- Approval by risk class from settings: Low sends at once; Medium and High hold the message, show the waiting text, create an approval open request and a `Notification` for the case analyst. Approval UI in the new panel: approve, edit then approve, or replace with the default text. The tag names the approver.
- Tests: `outreach-followups.test.js`, `outreach-docrules.test.js`, engine replay of scenario B.
- Covers AT 5, 6, 7, 8, 9, 10.
- Demo: scenario B at High risk with a failing proof of address, payslip without "later", approval by a second signed-in user.

### Phase 6: ORG entity and structure

- Blocks `country`, `registry`, `directors`, `authreps`, `owners`, `ubo`. The country question offers the tenant's configured countries plus "Other country", which asks which. Blocked jurisdictions stop here when configured.
- One registry interface with two providers (decision 12): `outreachAdapters/diditRegistry.js` and `outreachAdapters/kvk.js`, both returning the same normalised result. A pure function in `outreachRegistryProvider.js` picks the provider.
- Widgets: `registry_search`, `confirm_facts`, `people_list`, `reps_list`, `owners_builder` (running total, block above 100%, nested company owners, registry match for company owners), `structure_card`.
- `outreachUbo.js`, `outreachLegalForm.js`; write `OutreachPartyRelation` rows and `RelatedParty` rows for every person and company named.

**Which provider is used**

| Situation | Provider | Datapoint source |
| --- | --- | --- |
| Netherlands, tenant's KvK mode is Live or Test | KvK | `kvk` |
| Netherlands with KvK mode Off, or any other country Didit covers (Curaçao included) | Didit company registry | `didit_reg`, label "Didit company registry" (new source) |
| Country Didit does not cover, company not found, client taps "I cannot find my organisation", or the provider fails | Document route: extract upload and AI reading, as in the spec | `doc` |

**Didit provider**

- Calls Didit's registry search and select endpoints (`POST /v3/kyb/search/`, `POST /v3/kyb/select/`) with the tenant's Didit key through `withDiditCredentials`. Basic tier only. Read the current contract on docs.didit.me before building.
- Search runs when the client presses a Search button, not while typing: Didit bills a search that returns results ($0.50 on 17 Nov 2026), and selecting a company bills the lookup ($2 for the Netherlands and Curaçao). Allow three searches per conversation, then offer the document route. Log each call in `OutreachAdapterCall` with its price from settings.
- A result that is still pending shows a short waiting line and is polled; after a time limit the conversation falls back to the document route.
- Map to datapoints: legal name, registration number, registered address, activity, and the officers as the directors proposal (source `prop`).
- Do not store the website, phone number, sales or employee figures Didit returns; the spec does not ask for them and they were unreliable in testing.

**Gaps in Didit's data, and how the conversation closes them**

Three live lookups on 17 Nov 2026 (one Dutch, one Curaçao, one Australian company) showed that the basic tier does not always return what the flow needs.

| Missing or unreliable | Seen in | Rule |
| --- | --- | --- |
| Legal form (came back as "Corporation", and as "Partnership of unknown type" for a B.V.) | NL, CW | Never derive the legal form kind from Didit. Ask the client "What is the legal form of your organisation?" with chips from settings; source `rep` |
| Status | NL, CW | When no status is returned, ask for the trade-register extract (same upload and checks as the document route) and read status and registration date from it. An inactive status, from Didit or from the extract, shows the stop message |
| Registration date | NL, CW | From the extract, as above |
| Officers' roles ("Principal" only), or no officers | CW, AU | Show the names as a proposal; the client sets each person's role. With no officers, ask for the directors without a proposal |
| RSIN, trade name | NL | Not collected on the Didit route |

**KvK provider**

- KvK Zoeken as typeahead and Basisprofiel once per selection, in Live or Test mode (phase 1, "KvK test mode"). Inactive status shows the stop message. Failure or "I cannot find my organisation" falls back to the Didit provider first, then to the document route, each with `route.fallback`.
- KvK returns no directors. The directors proposal on the KvK route comes from one Didit lookup of the same KvK number when the tenant setting `directorsFromDidit` is on (default on); otherwise the directors are asked without a proposal. The Company.info adapter in the pack is not built.

**Tests, acceptance and demo**

- Tests: `outreach-registry-provider.test.js` (every row of the provider table), Didit mapping and gap rules from recorded sandbox responses, KvK mapping from the test environment, `outreach-ubo.test.js` with the five vectors in `05-demo-fixtures.json` plus thresholds 30 and 31, `outreach-legalform.test.js`, engine replay of scenarios C and D up to `ubo`.
- Develop the Didit provider against the tenant's Didit sandbox application, which is free and returns mock data. Real lookups cost money and are run only with Dave's go-ahead.
- Covers AT 14 to 24 and 26. AT 14 to 16 run with KvK in Test mode. New AT 14b: with KvK off, a Dutch organisation is searched through Didit, confirmed, asked its legal form, and asked for the extract when no status came back.
- AT 21 to 23 change meaning: Curaçao and other countries now try Didit first, and the document route is reached through "I cannot find my organisation" or an uncovered country. David should confirm the new wording of these tests (decision 21).
- Demo: Netherlands through Didit with KvK off; the same company through KvK in Test mode; Curaçao through Didit; a V.O.F. extract on the document route that fails once.

### Phase 7: ORG related parties

- Block `invites`: "which of these people are you?", `outreachParties.js`, `tracker` widget, `OutreachInvite` rows.
- With `releaseInvitesAfterIdv` on, "Send invitation" sets Queued; otherwise it creates the child request, the open request "Own checks: {name}" and the email at once.
- Email address per party: from the data when known, otherwise asked in the tracker row (the prototype invents addresses).
- Child completion: `related_party.completed` on the parent, invite Completed, open request answered, tracker and left rail updated on the next `open` or poll.
- Tests: `outreach-parties.test.js` (AT 27 and 32 as data cases), queue and release state tests.
- Covers AT 27, 28, 29, 31, 32.
- Demo: scenario C with three queued invitations; open one child link and complete it.

### Phase 8: ORG profile, documents, representative, review and signature

- Blocks `purpose_org`, `nature_org`, `activity`, `countries_org`, `volume`, `sof_org`, `sow_ubo`, `decl_regulated`, `decl_nominee`, `docs`, `rep`, `review_org`, `sign_org`.
- `docs` by legal form kind: shareholder register, partnership agreement, or skipped for a sole proprietorship with the reason logged.
- `rep`: ID&V on the ORG carrier, identity confirmation, name comparison with the declared person (`rep_flag`, `rep.match`, analyst notification), PEP, `rep.verified`, release of queued invitations with the "Invitations sent" message.
- ORG progress formula of spec 5.5 (19 at Low risk with default switches).
- Review groups, organisation signature text, status card listing pending parties. Required documents block submission.
- Tests: engine replay of scenarios C and D complete, E and F as shorter cases.
- Covers AT 25, 30, 33.
- Demo: scenarios C and D end to end, compared line by line with `06`.

### Phase 9: Second round, composer, reminders, emails

- Composer after submission; `client.message`, automatic reply, staff notification.
- Analyst question or document request from the panel: open request, system line, analyst message with upload widget, "new message" email; upload answers it and sends the confirmation message.
- `outreachSweep` and its workflow: reminders on `reminderDays`, expiry status, `request.opened` on first open.
- Email templates for the five new situations, seeded per tenant; first name and company name only in the body.
- Covers AT 34, 35.
- Demo: ask for annual accounts on a submitted ORG request and answer it from the client side.

### Phase 10: Backstage, audit and cost log

- The panel in case step 1 gets the seven parts of spec section 11, including the Active checkbox per block for ORG (saves to the template, applies to the next request, needs `outreachConfig`).
- The mirror of decision 10: `outreachMirror.js` in `base44/shared`, called at submission and when an open request is answered. Add `profile_field` to the block datapoints and to the block editor.
- Check that the classic step below the panel shows the mirrored answers and files, and that document review, bulk verify and the suggested profile updates work on them without any change to the classic files (decision 11). If one of them needs a classic file changed, stop and ask.
- Audit trail check: a script that runs the six scenarios in fixture mode and lists any spec section 12 event that was never written.
- Cost view per tenant from `OutreachAdapterCall` on the Outreach settings card and on the Ops console card.
- Tests: `outreach-mirror.test.js` (item shape, idempotent, `idv` item untouched, profile suggestions built from a mirrored request).
- Covers AT 36, 37.
- Demo: backstage of scenario C next to the prototype's "Behind the scenes"; then open Client Profile and see suggestions that came from the conversation.

### Phase 11: Hardening

- Security pass against spec section 13: token scope, rate limits, no entity access from the portal page, signed URL lifetime, upload limits, PII out of audit notes, webhook unchanged and still verified.
- Accessibility: keyboard path through every widget, focus ring, contrast check of both themes and of tenant brand colours, chart text alternative.
- Error path of every adapter, and a 25 MB upload.
- Real-device pass with Dave: iPhone Safari and Android Chrome, covering the signature canvas, the QR hand-off, safe areas and thread scrolling.
- Tick `10-QA-checklist.txt` in the built app and record the result in `docs/outreach/QA-result.md`.

**Added 17 Nov 2026: connection-loss pass**

- Run every row of the "Save, resume and connection loss" table in section 6 by hand, on a laptop and on a phone, using the browser's offline switch and flight mode.
- Close the laptop tab while the phone finishes the Didit check in the sandbox, reopen the link, and confirm the conversation continues by itself.
- Record the results in `docs/outreach/QA-result.md`.

## 8. Definition of done

The module is done at the end of phase 11, when the five acceptance criteria on the card and the flag checks below hold in the built app, with the flag on for the Demo tenant and off for every other tenant.

- [ ] All 37 acceptance tests in spec section 14 pass. Tests that are pure logic (2, 5, 17, 18, 19, 24, 25, 27, 32 and the engine replays) are automated; the rest are run by hand and recorded.
- [ ] `tests/outreach-ubo.test.js` matches the five vectors in `05-demo-fixtures.json`.
- [ ] `10-QA-checklist.txt` is fully ticked.
- [ ] Every event in spec section 12 appears in the audit trail of at least one scenario run.
- [ ] Tested on a real iPhone and a real Android phone (Dave does this; Claude Code cannot).

**Per phase, before the closing checkpoint**

- [ ] `npm run lint`, `npm run typecheck`, `npm run build` and `npm test` add no new errors (the baseline had lint and typecheck errors before this work).
- [ ] `tests/shared-copies.test.js` covers every new copy in `src/lib`.
- [ ] Classic smoke check: send a classic outreach, open `/portal/:token`, answer one item, run a Didit ID check from the classic portal, send a standalone outreach.
- [ ] With `outreach_conversation` off, Tenant Config, case step 1 and the sidebar look as before.
- [ ] The app is not published.

**Acceptance tests by phase**

| Phase | Acceptance tests |
| --- | --- |
| 3 | 1, 2, 3, 4, 11 |
| 4 | 12, 13 |
| 5 | 5, 6, 7, 8, 9, 10 |
| 6 | 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26 |
| 7 | 27, 28, 29, 31, 32 |
| 8 | 25, 30, 33 |
| 9 | 34, 35 |
| 10 | 36, 37 |

**Flag checks**

- [ ] Flag off: Tenant Config, case step 1, the sidebar and the classic portal look and behave as before, and a conversation cannot be created.
- [ ] Flag on: a conversation runs end to end, and the classic outreach, standalone outreach, outreach dashboard, transaction-monitoring request dialogs and key-person ID check still work for the same tenant.
- [ ] Flag switched off while a conversation is open: the client's link still works and the conversation can be submitted.
- [ ] Profile suggestions, case QC, the KYC report and the customer file show answers from a submitted conversation.
- [ ] Registry: Didit is used with no KvK key; KvK is used for a Dutch organisation once a key is set in the Ops console; ID&V runs through Didit in both cases.
- [ ] Didit ID&V, screening, transaction screening and the webhook test behave as before.

**Baseline measured in the Base44 workspace on 16 Nov 2026 at commit `bea2378`:** lint 69 errors, typecheck 2,671 error lines, 162 tests passing. A phase passes when it adds none. A restore point named "Before outreach conversation phase 1" exists in the builder's version history; no code has been changed after it.

## 9. Open decisions and risks

None of these block phases 1 to 5. Rows marked "closed" were settled by Dave's decisions on 17 Nov 2026 and are kept so the numbering stays stable.

| # | Decision | Needed by | Default until decided |
| --- | --- | --- | --- |
| 1 | KvK terms: per-tenant authorisation and key, no own database of KvK data (spec open item 1) | Before a tenant goes Live on KvK | Didit is the registry; KvK Test mode for development |
| 2 | Closed. No second vendor: the directors proposal comes from Didit's officers list | Done | Phase 6 |
| 3 | Didit: data region and deletion text shown to the client; prices per ID check, per registry search and per lookup for the cost log | Phase 4 and 6 | No region claim in the client text; prices from `adapterCosts` in settings |
| 4 | Document AI model and prompt tuning with real extracts from Curaçao and other countries | Phase 6 | Platform LLM with the spec's field list; real samples needed from David |
| 5 | Closed. New entities, mirror into request items, classic outreach kept, flag in the Ops console | Done | Section 4 |
| 6 | Add one dependency to draw the QR code in the browser | Phase 4 | Add `qrcode`; no third-party QR service |
| 7 | Virus scanning: the repo has no scanner and the spec requires a stored scan result | Phase 5 | Store `virus_scan: 'not_scanned'`, keep type and size limits, staff open files through signed URLs only |
| 8 | Phone country codes and address countries: the pack lists five codes and three countries, without Curaçao (+599) | Phase 3 | Lists come from `outreach_settings`, seeded with the pack values plus Curaçao |
| 9 | An organisation client becomes Active when its representative passes ID&V, before signing (existing behaviour in `getDiditSessionResult`) | Phase 8 | Leave as is and report it; changing it means editing a guarded Didit file |
| 10 | Editing an answer in the review re-evaluates follow-ups (spec open item 5). In scenario A the edit to "Employed" leaves the company name in place | Phase 3 | Re-evaluate and ask only what is newly triggered; keep earlier follow-up answers |
| 11 | Reference number format and the response-time texts ("1 working day", "2 working days") | Phase 3 | Settings, seeded with the pack values |
| 12 | How long a client waits for an analyst to approve an AI follow-up outside office hours | Phase 5 | After a configurable time the default question text is sent and logged |
| 13 | Per-role needs and proof of address for related parties (open items 10, 11) | Phase 7 | Same short flow for every related party, as in the prototype |
| 14 | Retention of outreach data and files (open item 13) | Phase 11 | Follows the case |
| 15 | Closed. Didit KYB in the classic portal stays as it is, because the classic outreach stays | Done | No change |
| 16 | Closed. Standalone and bulk outreach stay in the classic module | Done | No change |
| 17 | Closed. No classic request is closed or reissued | Done | No change |
| 18 | Which KYC field each datapoint feeds (`profile_field`), for the datapoints the seed cannot map by itself | Phase 10 | Unmapped datapoints are mirrored without a field link, so they show as answers but create no suggestion |

**Decision 19, added 17 Nov 2026.** Should the other case steps (profile suggestions, QC, report) see answers only after the client signs, or also from an unfinished conversation? Needed by phase 10. Default until decided: only after signing; an unfinished conversation is visible in the staff panel on the case.

**Decision 20, changed 17 Nov 2026.** Didit's registry returned no status, no registration date and an unreliable legal form for the Dutch and the Curaçao company tested. Is it acceptable to Compliance that, on the Didit route, the client states the legal form and uploads an extract whenever the status is missing? Needed by phase 6. Default until decided: yes, as written in phase 6; a tenant that wants register-sourced status for Dutch organisations gets a KvK key.

**Decision 21, added 17 Nov 2026.** Spec section 1 says Didit is used for persons only, and acceptance tests 21 to 23 expect Curaçao and other countries to start with a document upload. With Didit as the default registry both change. David should confirm the new behaviour and the reworded tests. Needed by phase 6. Default until decided: as written in phase 6.

**Risks**

- **Open access rules on `OutreachRequest`, `Document` and `AuditEvent`.** The classic portal needs them, so carrier rows stay readable without sign-in. Keep personal data in the new entities, and plan a separate change to move the classic portal behind functions.
- **Daily commits from the Base44 builder.** `App.jsx`, `TenantConfig.jsx` and `CaseWorkspace.jsx` may change under this work. Keep each edit to a few lines and re-read the file before editing.
- **Function time limits.** A document check or extract read may exceed the platform's function timeout. If it does, return a pending result and let the portal poll.
- **Platform LLM reading PDFs.** `ocrDocumentParse` already passes files to it, but multi-page extracts are untested here.
- **Size of `blocks_snapshot`.** The ORG snapshot is about 30 KB of JSON per request. If Base44 limits field size, store it as a private file and keep the hash on the conversation.
- **Pack inconsistencies.** The transcript titled "SCENARIO C2: Related party (Tom Becker)" shows David Okoye's flow. The block library uses widget names that differ from the spec's catalogue (see seed mapping). Where others turn up, the spec wins on logic.

**Added risks from running two outreach modules and from Didit as registry**

- **Two modules to maintain.** Classic and conversation outreach share `OutreachRequest`, the Didit functions and case step 1. A change to one can break the other; the flag checks in section 8 run after every phase and after any later change to either module.
- **Mixed requests on one case.** A tenant with the flag on can have classic and conversation requests on the same case. Readers of `OutreachRequest.items[]` must treat both alike; the mirror test covers profile suggestions, and the other readers in the section 2 table are checked by hand in phase 10.
- **Didit registry data quality.** Three lookups are a small sample. The data appears to come from commercial company databases, not from the register directly, and one record carried a website that looked unrelated to the company. Treat every Didit registry value as a proposal the client confirms, never as verified.
- **Didit registry cost.** About $2.50 per organisation (one search, one lookup) against about €0.02 through KvK, plus another lookup for each company owner that is matched. The cost log in phase 10 makes this visible per tenant.
- **More extracts than expected.** If Didit rarely returns a status, most organisations on the Didit route will be asked for an extract, which is close to the document route with an extra paid lookup in front. Measure this in the first weeks and revisit decision 20.

## 10. Prompts for Claude Code

Give Claude Code the setup prompt once, then one phase prompt per phase. Do not paste the whole plan into a prompt; it lives in the repo.

**Before the first prompt**

1. Export this doc as Markdown.
2. Start a Claude Code session on the Vitauri KYC app and attach the Markdown file and all twelve pack files (00 to 10 and the prototype HTML).
3. Check that the session works on the app "Vitauri KYC" and not on "Duplicate Vitauri KYC (Copy)".

**Prompt 0: setup, run once**

```text
You are implementing the Client Outreach conversation module in the Vitauri KYC app (Base44, main branch).

1. Save the attached plan as docs/outreach/IMPLEMENTATION_PLAN.md and the twelve attached pack files, with their original names (00-README.txt ... 10-QA-checklist.txt, outreach-portal-prototype.html), in docs/outreach/.
2. Add a section "Outreach conversation" to CLAUDE.md that says: read docs/outreach/IMPLEMENTATION_PLAN.md first; the build spec leads on logic, the prototype and transcripts on layout and wording; one phase at a time; in phases 1 to 11 edit only the existing files listed in plan section 4; all new UI behind the flag outreach_conversation; never publish.
3. Read plan sections 1 to 6, spec sections 1 to 8, and the prototype.
4. Run npm run lint, npm run typecheck, npm test and report the three numbers.
5. Tell me anything in the plan that does not match the code as it is today.

Do not write any feature code yet. Stop after the report.
```

**Phase prompt: use for phases 1 to 11, changing the number**

```text
Implement phase N of docs/outreach/IMPLEMENTATION_PLAN.md, and only phase N.

Before you start: create a Base44 checkpoint "Before outreach phase N", and re-read CLAUDE.md, plan sections 4 to 6 and the spec sections that phase N names.

Rules:
- Work on main. Schema changes are additive only.
- Do not edit any existing file that plan section 4 does not list. Do not touch the classic outreach, the classic portal or the Didit functions.
- Pure logic goes in base44/shared with node:test tests; every backend function takes the tenant from the signed-in user or from the request token, never from the payload.
- No question text, option, threshold or bank name in code.
- If the spec, the plan and the code disagree in a way the plan does not cover, stop and ask me.

When done: run npm run lint, npm run typecheck, npm run build and npm test; run the classic smoke check in plan section 8; create a checkpoint "After outreach phase N"; then report what you built, the files you changed, the test numbers against the baseline, which acceptance tests now pass, and what I should click to see the phase's demo. Do not publish. Do not start phase N+1.
```

**Add to the phase prompt for these phases**

| Phase | Extra line |
| --- | --- |
| 1 | "The flag outreach\_conversation must appear with the other per-tenant feature switches in the Ops console. Show me a tenant with the flag off and confirm nothing changed for it." |
| 4 | "Use the Didit sandbox application only. The one allowed change in diditSessionAuth.js is the token\_hash branch in authorizeOutreachCaller." |
| 5 | "Show me the AI follow-up prompt and the document-check prompt before you wire them in." |
| 6 | "Didit is the default registry and KvK replaces it for the Netherlands only when the tenant's KvK mode is Live or Test. Build the Didit provider against the Didit sandbox application and KvK against its public test environment. Make no paid live lookup without asking me." |
| 10 | "List the datapoints you could not map to a profile\_field and stop for my answer before finishing." |
| 11 | "Give me the list of checks I must do on a real iPhone and a real Android phone." |

**If a phase goes wrong**

```text
Stop. Do not fix forward. Tell me what failed and what you changed since the checkpoint "Before outreach phase N". I will decide whether to restore that checkpoint.
```
