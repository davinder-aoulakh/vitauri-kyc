// Guided conversation outreach, phase 11: hardening checks that can run without the built app (spec section 13,
// accessibility, adapter error paths). The device and connection-loss passes are manual: docs/outreach/QA-result.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio, inkFor, brandStyle } from '../src/lib/outreachContrast.js';
import { kvkSearch, kvkProfile } from '../base44/shared/outreachAdapters/kvk.js';
import { diditSearch, diditSelect } from '../base44/shared/outreachAdapters/diditRegistry.js';

const read = (f) => readFileSync(f, 'utf8');
const css = read('src/lib/outreachConvTokens.css');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const light = tokens(css.slice(css.indexOf('.oc{'), css.indexOf('@media (prefers-color-scheme:dark)')));
const dark = { ...light, ...tokens(css.slice(css.indexOf('@media (prefers-color-scheme:dark)'), css.indexOf('.oc *{box-sizing'))) };

test('contrast: text and buttons meet WCAG AA (4.5:1) in the light and the dark theme', () => {
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of [['ink', 'bg'], ['ink', 'surface'], ['muted', 'surface'], ['brand-ink', 'brand'], ['ok', 'surface'], ['bad', 'surface'], ['ai', 'surface']]) {
      const r = contrastRatio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} = ${r}`);
    }
  }
});

test('contrast: the text colour on any tenant brand colour is the more readable one', () => {
  for (const brand of ['#13503f', '#018189', '#ffd200', '#e6f2ff', '#000000', '#ff5a00', '#6b7280']) {
    const ink = inkFor(brand);
    const other = ink === '#ffffff' ? '#0b1f18' : '#ffffff';
    assert.ok(contrastRatio(ink, brand) >= contrastRatio(other, brand), brand);
    assert.ok(contrastRatio(ink, brand) >= 4.5 || brand === '#ff5a00' || brand === '#6b7280', `${brand}: ${contrastRatio(ink, brand)}`);
  }
  assert.equal(brandStyle('not a colour'), undefined);
  assert.deepEqual(brandStyle('#ffd200'), { '--brand': '#ffd200', '--brand-ink': '#0b1f18', '--me-ink': '#0b1f18' });
  assert.ok(read('src/pages/OutreachConversation.jsx').includes('brandStyle(tenant?.brand_color)'));
});

test('accessibility: focus ring, reduced motion, live thread, keyboard signature, chart text alternative', () => {
  assert.match(css, /\.oc :focus-visible\{outline:2px solid var\(--ink\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.ok(read('src/pages/OutreachConversation.jsx').includes('aria-live="polite"'));
  const sign = read('src/components/outreachconv/widgets/Sign.jsx');
  assert.ok(sign.includes('typeSign') && sign.includes('OC.signWithName'), 'a keyboard user can sign with the typed name');
  assert.ok(read('src/components/outreachconv/widgets/StructureCard.jsx').includes('className="sr-only"'), 'the chart has a text alternative');
  // no click handlers on non-interactive elements in the client widgets
  for (const f of ['src/pages/OutreachConversation.jsx', 'src/components/outreachconv/SecondRound.jsx']) assert.ok(!/<(div|span|li)[^>]*onClick/.test(read(f)), f);
});

test('adapters fail soft: network error, 401 and 500 give { ok: false, error_code } and never throw', async () => {
  const fails = [
    async () => { throw new Error('ECONNRESET'); },
    async () => new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } }),
    async () => new Response('oops', { status: 500 }),
  ];
  for (const fetchFn of fails) {
    for (const call of [
      () => kvkSearch({ fetchFn, mode: 'test', apiKey: 'k', q: 'Clarke' }),
      () => kvkProfile({ fetchFn, mode: 'test', apiKey: 'k', kvk: '81234568' }),
      () => diditSearch({ fetchFn, apiKey: 'k', country_code: 'NL', name: 'Clarke' }),
      () => diditSelect({ fetchFn, apiKey: 'k', kyb_response_id: 'x' }),
    ]) {
      const r = await call();
      assert.equal(r.ok, false);
      assert.ok(r.error_code, JSON.stringify(r));
      assert.ok(!JSON.stringify(r).includes('"k"'), 'the key is never returned');
    }
  }
});

test('security (spec 13): token scope, rate limits, private files, short signed URLs, upload limits', () => {
  const portal = read('base44/functions/outreachPortal/entry.ts');
  const upload = read('base44/functions/outreachUpload/entry.ts');
  const registry = read('base44/functions/outreachRegistry/entry.ts');
  for (const [name, src] of [['portal', portal], ['upload', upload], ['registry', registry]]) {
    assert.ok(src.includes('token_hash'), `${name} finds the request by the token hash`);
    assert.ok(src.includes('createAttemptLimiter') && src.includes('429'), `${name} limits attempts`);
  }
  // every open request the client can touch is looked up within its own conversation
  for (const src of [portal, upload]) {
    for (const m of src.matchAll(/OutreachOpenRequest\.filter\(\{([^}]*)\}/g)) assert.ok(m[1].includes('conversation_id'), m[0]);
  }
  assert.ok(upload.includes('UploadPrivateFile') && !upload.includes('UploadFile('), 'uploads are private');
  assert.ok(upload.includes("virus_scan: 'not_scanned'"), 'scan result stored (decision 7)');
  assert.match(upload, /const MAX_MB = 25;/);
  assert.match(read('src/components/outreachconv/widgets/Upload.jsx'), /const MAX_MB = 25;/);
  const lifetimes = [...[portal, upload, read('base44/functions/manageOutreachConversation/entry.ts'), read('src/components/shared/DocumentViewer.jsx')].join('\n').matchAll(/expires_in: (\d+)|getSignedUrl\(fileUrl, (\d+)\)/g)].map((m) => Number(m[1] || m[2]));
  assert.ok(lifetimes.length >= 3 && lifetimes.every((s) => s <= 600), `signed URL lifetimes ${lifetimes}`);
  // the browser page talks to functions only
  for (const f of ['src/pages/OutreachConversation.jsx', 'src/components/outreachconv/SecondRound.jsx']) assert.ok(!/base44\.entities/.test(read(f)), f);
});

test('PII: client names and file names stay out of audit notes in the server functions', () => {
  const files = ['base44/functions/outreachPortal/entry.ts', 'base44/functions/outreachUpload/entry.ts', 'base44/functions/manageOutreachConversation/entry.ts', 'base44/shared/outreachChildRequest.js', 'base44/functions/outreachSweep/entry.ts'];
  for (const f of files) {
    for (const m of read(f).matchAll(/notes: `([^`]*)`/g)) {
      assert.ok(!/\$\{(conversation\.invited_name|party\.name|name|done\.join|inv\.)/.test(m[1]), `${f}: ${m[1]}`);
    }
  }
});

test('race (20 Nov): overlapping ID-check pulls cannot move the conversation back; stale writes are refused', () => {
  const portal = read('base44/functions/outreachPortal/entry.ts');
  assert.match(portal, /if \(\(await freshRev\(\)\) !== rev\) \{ pendingMsgs\.length = 0; throw httpError\(409/, 'persist checks the stored revision');
  assert.match(portal, /pending_step: \{ engine, step, test_data: testData, rev \}/);
  assert.match(portal, /applyIdvDecision = async[\s\S]{0,200}freshRev\(\)\) !== rev\) return \[\]/, 'the Didit decision is applied only on the current state');
  for (const f of ['base44/shared/outreachThread.js', 'base44/functions/outreachRegistry/entry.ts']) assert.match(read(f), /rev: Number\(/, `${f} bumps the revision`);
  const idv = read('src/components/outreachconv/widgets/Idv.jsx');
  assert.ok(!idv.includes('setInterval('), 'no fixed-interval pulling');
  assert.ok(idv.includes('inFlight'), 'one pull at a time');
  const page = read('src/pages/OutreachConversation.jsx');
  assert.ok(page.includes("stepRef.current?.widget !== 'idv'") && page.includes('lastSeqRef.current'), 'late answers never take the page back');
  assert.ok(portal.includes("messages.filter((m) => m.status !== 'superseded')"));
});

test('address country: every country with its flag, searchable, common countries first', async () => {
  const { COUNTRY_META } = await import('../src/lib/countries.js');
  assert.ok(COUNTRY_META.length >= 195, `${COUNTRY_META.length} countries`);
  assert.ok(COUNTRY_META.some((c) => c.iso2 === 'CW') && COUNTRY_META.some((c) => c.iso2 === 'NL'));
  const picker = read('src/components/outreachconv/widgets/CountryPicker.jsx');
  assert.ok(picker.includes('COUNTRY_META') && picker.includes('<Flag') && picker.includes('role="listbox"') && picker.includes('ArrowDown'));
  assert.ok(!/https?:\/\//.test(picker), 'no external resources');
  assert.ok(read('src/components/outreachconv/widgets/Address.jsx').includes('<CountryPicker'));
  const phone = read('src/components/outreachconv/widgets/Phone.jsx');
  assert.ok(phone.includes('<CountryPicker') && phone.includes('mode="dial"') && phone.includes('code: code.dial'), 'phone code uses the same flag list; the answer keeps { code, number }');
  assert.ok(picker.includes("mode === 'dial'") && picker.includes('digits(c.dial).startsWith(d)'), 'search by dial code');
});
