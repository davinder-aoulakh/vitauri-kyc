# Vitauri KYC: rules for this repo
- Read docs/kyc-aml/IMPLEMENTATION_PLAN.md first. The build spec leads on logic, the prototype HTML on layout.
- Work on main. One checkpoint before and one after each phase.
- Do one phase at a time. Do not start a later phase early.
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
- Before finishing: npm run lint, npm run typecheck, npm run build, npm test (node --test "tests/*.test.js").
  Lint and typecheck had errors before this work started (14 Nov 2026: lint 74 errors, typecheck 2,560 error lines); a phase passes when it adds none.
- If the spec and the code disagree in a way the plan does not cover, stop and ask.
- Never publish the app; the owner publishes after their own checks.

## Shared rules on both sides
- The frontend (`src/`) does not import from `base44/shared`. A rule needed on both sides lives in `base44/shared/<name>.js` with a copy in `src/lib/<name>.js` (`cocResponse`, `workDomain`, `tmFiuSubmission`, `tmLibraryScope`, and the settings readers in `tmTenantSettings`).
- Change both in the same commit. `tests/shared-copies.test.js` fails when a copy differs from its original.
- Inside `src/lib`, files that tests load import each other with relative paths (`./cocResponse.js`), not the `@/` alias.

## Outreach conversation
- Read docs/outreach/IMPLEMENTATION_PLAN.md first. The build spec (01) leads on logic; the prototype and transcripts (06) lead on layout and wording. The plan says where things land in this repo.
- One phase at a time, on main, with a checkpoint before and after each phase. Do not start a later phase early.
- The classic outreach stays. Never edit or delete the classic outreach, the classic portal (pages/ClientPortal.jsx, /portal/:token) or the Didit functions. The only existing files that may be edited are listed in plan section 4, plus the Ops console for the "Outreach integrations" card.
- All new UI sits behind the flag outreach_conversation (default off, switched per tenant in the Ops console). With the flag off nothing may change for a tenant. sendOutreachConversation, manageOutreachConfig and seedOutreachLibrary refuse when it is off; outreachPortal does not check it, so client links never break.
- New entities only: OutreachBlock, OutreachFlowTemplate, OutreachConversation and its child entities. Do not extend OutreachTemplate or OutreachFormTemplate. OutreachRequest is the carrier (engine: 'conversation') and takes additive fields only.
- The server runs the conversation (outreachPortal). The browser renders and never decides what is asked. The public page calls backend functions only, never entities.
- Link token: 32 random bytes, stored as SHA-256 in OutreachRequest.token_hash. access_token stays empty on conversation requests.
- Mirror submitted answers into OutreachRequest.items[] as plan section 4 "Mirror contract" says. Never rewrite the 'idv' item.
- Company registry: Didit by default; KvK for the Netherlands only when the tenant's KvK mode is Live or Test. ID&V of persons is always Didit. No paid live lookup without asking.
- No question text, option, threshold or bank name in code: texts come from the request snapshot, settings from Tenant.outreach_settings. Keys live in TenantSecret and are set by Vitauri Ops only.
- Audit events use the prefix outreach. and are written by backend functions. Every customer email passes the tipping-off check.
- AI calls use the platform LLM with a JSON schema and write an AiAgentRun row. AI never drops a required block, sets a risk class or accepts an answer.
- Do not copy prototype code. Do not build the "Demo:" buttons or demo controls.
- If the spec, the plan and the code disagree in a way the plan does not cover, stop and ask.
