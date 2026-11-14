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
- Before finishing: npm run lint, npm run typecheck, npm run build, node --test tests/.
  Lint and typecheck had errors before this work started (14 Nov 2026: lint 74 errors, typecheck 2,560 error lines); a phase passes when it adds none.
- If the spec and the code disagree in a way the plan does not cover, stop and ask.
- Never publish the app; the owner publishes after their own checks.
