CLIENT OUTREACH MODULE: DEVELOPER PACK FOR BASE44
Owner: David Zwarts, Vitauri. Version of this pack: 8 November 2026.

WHAT THIS IS
Everything needed to build the Client Outreach module 1 on 1 in Base44: a guided, conversational outreach for natural persons (NP), organisations (ORG, also called KYB) and related parties, generated from the building blocks and form templates in Tenant Config.

START HERE
1. Open outreach-portal-prototype.html in a desktop browser. Click through "Person" and "Organisation" (see 09-prototype-guide.txt). 15 minutes.
2. Read 01-Base44-Build-Spec-Client-Outreach.md, sections 1 to 8.
3. Look at 06-conversation-transcripts.txt to see the exact wording and the audit trail per scenario.
4. Import 02-block-library.json and 03-form-templates.json as seed data; use 05-demo-fixtures.json for test data and the UBO test vectors.
5. Build in the order of section 15 of the spec. Use 10-QA-checklist.txt and section 14 of the spec as the definition of done.

FILES
00-README.txt                                  this file
01-Base44-Build-Spec-Client-Outreach.md        the build spec
02-block-library.json                          building blocks (NP and ORG)
03-form-templates.json                         three form templates
04-datapoint-catalogue.txt                     datapoint keys, labels, sources
05-demo-fixtures.json                          fictional test data and UBO test vectors
06-conversation-transcripts.txt                exact conversations of six scenario runs
07-adapter-contracts.md                        KvK, second source, Didit, document AI
08-design-tokens-and-ux-notes.txt              colors, type, responsive, accessibility
09-prototype-guide.txt                         how to operate the prototype
10-QA-checklist.txt                            manual test list
outreach-portal-prototype.html                 the clickable prototype (single file)

RULES OF THUMB
- Logic: the spec wins. Layout and wording: the prototype wins.
- Everything marked "Tenant config" in the spec is a setting, not code.
- AI never drops a required block, sets a risk class or accepts an answer.
- Facts about vendors (KvK, Company.info, Didit) must be verified in their current documentation before building (see 07).
- Do not copy the prototype's code into production. It is a behaviour reference.

OPENING THE PROTOTYPE ON A PHONE
Files and Quick Look previews (iPhone, WhatsApp) do not run JavaScript, so buttons will not work. Open it in Safari from a hosted link instead. The hosted copy is linked in the spec; it is private until the owner shares it.

QUESTIONS
David Zwarts, david@vitauri.com
