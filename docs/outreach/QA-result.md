# Guided conversation outreach: QA result (phase 11)

Status on 20 Nov 2026, after the checkpoint "After outreach phase 11". The app is **not published**, so nothing below has run in the built app yet.

**Legend:**
- **Automated:** covered by a test that runs with `npm test` (file named).
- **Manual:** must be ticked by a person in the published app. These are all still open.

Claude Code cannot use a real phone, the browser's offline switch or the live Didit webhook, so every device and connection-loss item is manual (plan phase 11; Dave).

## 1. QA checklist (`10-QA-checklist.txt`)

### General

| Item | Status |
| --- | --- |
| Link opens without login; expired link shows the expired page | Automated in part (`outreach-token`: link states). Manual: open in the app |
| Close after a few answers, reopen: thread, progress and next question are right | Automated (`outreach-progress`: resume at the right block). Manual in the app |
| Progress bar, minutes left, section list and saved indicator update | Automated (`outreach-progress`). Manual: visual |
| "Why do we ask this?" opens and closes | Automated (`outreach-engine`: `client.why_opened`). Manual: visual |
| iPhone Safari, Android Chrome, desktop Chrome and Safari; dark mode readable | Dark-mode contrast automated (`outreach-hardening`). **Manual: devices** |
| No horizontal scroll at 360 px | **Manual** |

### Templates

| Item | Status |
| --- | --- |
| Changed question text: new request shows it, old request keeps the old one | Automated (`outreach-snapshot`) |
| Block switched off: skipped, logged, lower progress total | Automated (`outreach-progress`, `outreach-mirror` backstage switch). Manual: Tenant Config and backstage |
| Condition editor saves and the rule fires | Automated (`outreach-conditions`). Manual: the editor UI |

### NP

| Item | Status |
| --- | --- |
| ID&V: QR on a wide screen, button on a phone; chat continues after the phone finishes | Automated in part (`outreach-idv`: 760 px rule, decision applied). **Manual: Didit sandbox on two devices** |
| Name, date of birth and nationality prefilled from the ID and only confirmed | Automated (`outreach-idv`) |
| Address; proof of address fails, is asked again, passes on the second upload | Automated (`outreach-followups`, scenario B). Address lookup service: not built (fields stay editable) |
| Email prefilled from the invitation; another email is validated | Automated (`outreach-engine`) |
| Self-employed asks the company name | Automated (`outreach-engine`) |
| Inheritance or property sale asks for a deed; "later" creates an open request | Automated (`outreach-engine`, `outreach-docrules`). Manual: the later upload from the composer (phase 9) |
| High risk and salary asks for a payslip without "later" | Automated (`outreach-followups`) |
| AI follow-up: Low sends at once; Medium and High wait and then send with the approver's name | Automated (`outreach-followups`). Manual: staff approval in the panel |
| PEP "I don't know" explains and asks again; "Yes" asks who and the relation | Automated (`outreach-engine`) |
| Review: change an answer; source label changes; history kept | Automated (`outreach-engine`) |
| Signature: typed name must equal the ID name; canvas works with a finger | Name rule automated (`outreach-idv`). Keyboard signing added (`outreach-hardening`). **Manual: finger on a phone** |
| Submission: status card, reference, composer appears | Automated (`outreach-engine`, `outreach-second-round`) |
| Second round: analyst asks, client uploads, analyst sees it | Automated (`outreach-second-round`). Manual: end to end |

### ORG

| Item | Status |
| --- | --- |
| Country routing (NL to KvK; Curaçao and other countries to Didit, then documents) | Automated (`outreach-registry`: provider table, AT 14b) |
| KvK search while typing; facts with KvK source; Basisprofiel called once | Automated (`outreach-registry`, KvK test shape). Manual: KvK Test mode with a key |
| Inactive organisation stops; "I cannot find my organisation" falls back to documents | Automated (`outreach-registry`) |
| Document route: extract (3 months), AI read, correction form, articles | Automated (`outreach-org`, scenario D). Manual: real extracts (open decision 4) |
| Directors proposal from the register or the extract; at least one person | Automated (`outreach-org`, `outreach-registry`) |
| Authorised representative: authority and power of attorney, no "later" | Automated (`outreach-org`) |
| Owners builder: percentage total, above 100 % blocked, nested company owners, KvK match | Automated (`outreach-org`, `outreach-ubo`) |
| UBO calculation matches `05-demo-fixtures.json`; chart shows the UBO; control question | Automated (`outreach-ubo`: all five vectors) |
| Partnership wording; sole proprietorship skips the ownership document | Automated (`outreach-org-full`, AT 25) |
| Representative question; mismatch with the ID is flagged | Automated (`outreach-org-full`, AT 30) |
| Invitations queued until the representative's ID check (setting on); setting off sends at once | Automated (`outreach-parties`) |
| Related party flow from its own link updates tracker, open request and party status | Automated (`outreach-parties`, as data). **Manual: two browsers** |
| Source of wealth only at Medium and High; evidence at High | Automated (`outreach-org-full`) |
| Review groups; signature names the organisation; submission lists pending parties | Automated (`outreach-org-full`, AT 33) |
| Required documents block submission | Automated (`outreach-org-full`) |

### Backstage and audit

| Item | Status |
| --- | --- |
| Blocks table with the Active checkbox (ORG) and the state per block | Automated (`outreach-mirror`: backstage view). Manual: the sheet |
| Datapoints show source pills; AI and document values are distinguishable | Automated (`outreach-mirror`: source tones) |
| Audit trail contains every event type in spec section 12 | Automated (`outreach-mirror`: audit coverage). Known gaps: `kvk.zoeken` and `kvk.basisprofiel` (logged as OutreachAdapterCall rows with cost); `company.info.organisatieprofiel` (no second vendor, decision 2) |
| Chart and parties table for ORG | Automated (`outreach-mirror`). Manual: visual |
| AdapterCall rows with costs for KvK, Didit and document AI | KvK and Didit rows: automated (`outreach-registry`). Cost view: phase 10. Document AI calls are logged in AiAgentRun, not as OutreachAdapterCall rows. No second-source rows: there is no second vendor (decision 2) |

### Security

| Item | Status |
| --- | --- |
| A token cannot open another request; token attempts are rate limited | Automated (`outreach-hardening`, `outreach-token`) |
| Uploads private; links expire; virus scan result stored | Automated (`outreach-hardening`). There is no scanner: `virus_scan: 'not_scanned'` (decision 7) |
| Webhook signature verified and idempotent | Unchanged during this work: `diditWebhook` and `diditWebhookVerify.js` have no commits since 17 Nov. The only change to `diditSessionAuth.js` is the phase-4 token branch the plan allows (`outreach-didit-auth`) |

## 2. Save, resume and connection loss (plan section 6)

| Situation | Status |
| --- | --- |
| Browser closed between questions | Automated (`outreach-progress`: resume). **Manual: laptop and phone** |
| Closed while typing | Behaviour by design: only the unsent answer is lost. **Manual** |
| Connection drops while an answer is being sent | Automated (`outreach-engine`: the same `client_answer_id` is applied once; a stale step gets 409). Manual: offline switch, check "Not saved. Try again." |
| Laptop closed while the phone runs the Didit check | Automated (`outreach-idv`: `open` applies a stored decision). **Manual: Didit sandbox and the live webhook** |
| Phone loses connection during the Didit check | Automated (`outreach-idv`: the open session is reused). **Manual: flight mode** |

## 3. Hardening done in phase 11

- **Contrast:**
  - Dark mode had dark text on the dark default brand colour in buttons and avatars; it is now white.
  - A tenant brand colour now gets the more readable text colour (white or dark) instead of always white.
  - The focus ring uses the text colour, so it shows on any brand colour.
- **Keyboard:** the signature pad can be signed without a pointer ("Use my typed name as signature"). The canvas no longer scrolls the page on touch.
- **PII:** client names and file names moved out of audit notes into the payload in the server functions (spec section 13).
  - Not changed: the engine's `answer.edited` note keeps the old and new value, as in the transcripts.
- **Tests:** `tests/outreach-hardening.test.js` covers contrast in both themes, the brand text colour, focus, keyboard signing, the chart text alternative, adapter error paths, token scope and rate limits, private uploads, signed-URL lifetimes (10 minutes or less), the 25 MB limit and PII in notes.

## 4. Still open (manual, before the module counts as done)

1. Publish to a test environment with the flag on for the Demo tenant only.
2. Real-device pass (Dave):
   - iPhone Safari and Android Chrome: signature canvas, QR hand-off, safe areas, thread scrolling;
   - 360 px width.
3. A 25 MB PDF upload in the built app. The browser sends it as base64, about 33 MB of request body; if the platform refuses it, the page shows "File too large".
4. Every row of section 2 by hand, with the offline switch and flight mode.
5. The classic smoke check from plan section 8: classic outreach, `/portal/:token`, the Didit ID check from the classic portal, standalone outreach.
6. Flag checks from plan section 8 (flag off, flag on, flag switched off while a conversation is open).
7. Tick this file and `10-QA-checklist.txt` with the results.
