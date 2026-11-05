// Run: node tests/e2e.js   (needs `playwright` + a Chromium build; see README)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const C = require('../core.js');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '';
const overrides = new Map(); // url path -> {body}
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json', json: 'application/json' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0]; const rel = u === '/' ? '/index.html' : u;
  if (overrides.has(rel)) { r.setHeader('content-type', MIME[rel.split('.').pop()] || 'text/plain'); return r.end(overrides.get(rel)); }
  try { const f = path.join(ROOT, rel); if (!f.startsWith(ROOT)) throw 0; const b = fs.readFileSync(f); r.setHeader('content-type', MIME[rel.split('.').pop()] || 'application/octet-stream'); r.setHeader('cache-control', 'max-age=600'); r.end(b); }
  catch (e) { r.statusCode = 404; r.end('nf'); }
});

let pass = 0, fail = 0; const failures = [];
async function T(name, fn) { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; failures.push(name); console.log('FAIL  ' + name + '\n      ' + (e.message || e).split('\n')[0]); } }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'eq'}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const URL_ = () => 'http://localhost:' + server.address().port + '/';

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();
  const opts = { viewport: { width: 390, height: 800 }, timezoneId: 'Asia/Kolkata', locale: 'en-GB', acceptDownloads: true };
  async function open(extra, init) {
    const ctx = await browser.newContext({ ...opts, ...(extra || {}) });
    const p = await ctx.newPage(); p.errs = []; ctx.setDefaultTimeout(6000);
    p.on('pageerror', e => p.errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') p.errs.push('console: ' + m.text()); });
    if (init) await p.addInitScript(init);
    await p.goto(URL_()); await p.waitForSelector('#todayList');
    return p;
  }
  const st = p => p.evaluate(() => JSON.parse(localStorage.getItem('vyron.v2')));
  const raw = p => p.evaluate(() => localStorage.getItem('vyron.v2'));
  const today = p => p.evaluate(() => window.__vyron.todayKey);
  const tab = (p, n) => p.click('#nav-' + n);
  const tasks = p => p.locator('#todayList .task');
  async function importObj(p, obj, accept = true) {
    await p.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
    await p.waitForSelector('#msg[open]');
    const title = await p.textContent('#msgTitle'); const list = await p.locator('#msgList li').allTextContents();
    if (accept && title.startsWith('Replace')) await p.click('#msgOk'); else await p.click(await p.locator('#msgCancel').isVisible() && !accept ? '#msgCancel' : '#msgOk');
    await p.waitForFunction(() => !document.getElementById('msg').open); await p.waitForTimeout(150);
    return { title, list };
  }
  const TODAY_FOR_SEED = '2026-11-05';
  function seedEnvelope(n) { // n days of history ending yesterday relative to real "today" of the test page
    const s = C.emptyState(); const t = C.keyOf(new Date());
    for (let i = n; i >= 1; i--) { const k = C.addDays(t, -i); const d = C.ensureDay(s, k); d.h = C.snapshotRoutine(s.routine); s.routine.forEach((h, j) => { if ((i + j) % 4) d.done[h.id] = true; }); d.mood = (i % 5) + 1; }
    return C.exportEnvelope(s);
  }

  console.log('\nFUNCTIONAL');
  let p = await open();
  await T('fresh start: no console errors / CSP violations, 12 starter habits, 0%', async () => { eq(await tasks(p).count(), 12); eq(await p.textContent('#ringPct'), '0%'); eq(p.errs, []); });
  await T('complete a habit, ring and counts update, undo restores', async () => {
    await p.locator('#todayList .main').first().click(); eq(await p.locator('#todayList .main').first().getAttribute('aria-pressed'), 'true'); eq(await p.textContent('#ringPct'), '8%');
    await p.locator('#todayList .main').first().click(); eq(await p.textContent('#ringPct'), '0%');
  });
  await T('keyboard: Tab to a habit and Space toggles it, focus is kept', async () => {
    await p.locator('#todayList .main').nth(1).focus(); await p.keyboard.press('Space');
    eq(await p.locator('#todayList .main').nth(1).getAttribute('aria-pressed'), 'true');
    ok(await p.evaluate(() => document.activeElement.classList.contains('main')), 'focus lost after toggle');
    await p.keyboard.press('Space'); eq(await p.textContent('#ringPct'), '0%');
  });
  await T('create a Do habit', async () => {
    await tab(p, 'routine'); await p.click('#newTask'); await p.fill('#fName', 'Read 10 pages'); await p.fill('#fTime', '20:30'); await p.selectOption('#fCat', 'Mind'); await p.click('#fSave');
    ok((await p.locator('#routineList .task .name').allTextContents()).includes('Read 10 pages')); await tab(p, 'today'); eq(await tasks(p).count(), 13);
  });
  await T('create an Avoid habit (shows Avoid tag, circular check)', async () => {
    await tab(p, 'routine'); await p.click('#newTask'); await p.fill('#fName', 'No reels at night'); await p.click('.seg label:last-child span'); await p.click('#fSave');
    await tab(p, 'today'); const row = p.locator('#todayList .task', { hasText: 'No reels at night' }); ok(await row.evaluate(e => e.classList.contains('avoid'))); ok((await row.textContent()).includes('Avoid'));
  });
  await T('empty / invalid habit name shows an error and saves nothing', async () => {
    await tab(p, 'routine'); const n = await p.locator('#routineList .task').count(); await p.click('#newTask'); await p.fill('#fName', '   '); await p.click('#fSave');
    ok(await p.locator('#fError').isVisible()); await p.click('#fCancel'); eq(await p.locator('#routineList .task').count(), n);
  });
  await T('edit a habit (name, time)', async () => {
    await p.locator('#routineList .main', { hasText: 'Read 10 pages' }).click(); await p.fill('#fName', 'Read 20 pages'); await p.fill('#fTime', '21:00'); await p.click('#fSave');
    ok((await p.locator('#routineList .task .name').allTextContents()).includes('Read 20 pages'));
  });
  await T('reorder with ▲▼ keeps focus on the moved row control', async () => {
    const before = await p.locator('#routineList .task .name').allTextContents(); await p.locator('#routineList .down').first().click();
    const after = await p.locator('#routineList .task .name').allTextContents(); eq(after[1], before[0]); ok(await p.evaluate(() => document.activeElement.classList.contains('iconbtn')));
  });
  await T('archive hides it from Today and keeps it listed; restore brings it back', async () => {
    await p.locator('#routineList .main', { hasText: 'Read 20 pages' }).click(); await p.click('#fArchive');
    eq(await p.locator('#archivedCount').textContent(), '1'); await tab(p, 'today'); ok(!(await p.locator('#todayList').textContent()).includes('Read 20 pages'));
    await tab(p, 'routine'); await p.locator('#archivedBox summary').click(); await p.locator('#archivedList .iconbtn').first().click(); await tab(p, 'today'); ok((await p.locator('#todayList').textContent()).includes('Read 20 pages'));
  });
  await T('delete (with confirmation) removes the habit', async () => {
    await tab(p, 'routine'); await p.locator('#routineList .main', { hasText: 'No reels at night' }).click(); await p.click('#fDelete'); await p.waitForSelector('#msg[open]'); await p.click('#msgOk');
    await p.waitForFunction(() => !document.getElementById('msg').open); await p.waitForTimeout(150); ok(!(await p.locator('#routineList').textContent()).includes('No reels at night'));
  });
  await T('one-time task: add, tick, remove', async () => {
    await tab(p, 'today'); await p.fill('#extraInput', 'Call bank'); await p.press('#extraInput', 'Enter'); const r = p.locator('#todayList .task', { hasText: 'Call bank' }); eq(await r.count(), 1);
    await r.locator('.main').click(); eq(await r.getAttribute('data-done'), 'true'); await r.locator('.iconbtn').click(); eq(await p.locator('#todayList .task', { hasText: 'Call bank' }).count(), 0);
  });
  await T('mood toggles on/off and persists; note persists after reload', async () => {
    await p.click('#moods button:nth-child(4)'); eq(await p.getAttribute('#moods button:nth-child(4)', 'aria-pressed'), 'true');
    await p.click('#moods button:nth-child(4)'); eq(await p.getAttribute('#moods button:nth-child(4)', 'aria-pressed'), 'false');
    await p.click('#moods button:nth-child(5)'); await p.fill('#note', 'steady day'); await p.click('#restToggle'); await p.click('#restToggle'); // blur flushes
    await p.reload(); await p.waitForSelector('#todayList'); eq(await p.inputValue('#note'), 'steady day'); eq(await p.getAttribute('#moods button:nth-child(5)', 'aria-pressed'), 'true');
  });
  await T('state survives refresh (completed habit still ticked)', async () => {
    await p.locator('#todayList .main').first().click(); await p.reload(); await p.waitForSelector('#todayList'); eq(await p.locator('#todayList .main').first().getAttribute('aria-pressed'), 'true');
  });
  await T('change daily goal updates the rule text and persists', async () => {
    await tab(p, 'more'); await p.selectOption('#threshold', '0.9'); eq((await st(p)).threshold, 0.9); await tab(p, 'today'); eq(await p.textContent('#ruleTh'), '90%'); await tab(p, 'more'); await p.selectOption('#threshold', '0.7');
  });
  await T('navigate historical dates; next disabled on today; jump back', async () => {
    await tab(p, 'today'); ok(await p.isDisabled('#nextDay')); await p.click('#prevDay'); await p.click('#prevDay'); eq(await p.isVisible('#jumpToday'), true); await p.click('#nextDay'); await p.click('#nextDay'); ok(await p.isDisabled('#nextDay'));
  });
  await T('export downloads a v2 envelope; importing it back works', async () => {
    await tab(p, 'more'); const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
    const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); eq([data.app, data.version, typeof data.exportedAt], ['VYRON', 2, 'string']); ok(Array.isArray(data.data.routine));
    ok(/vyron-backup-\d{4}-\d{2}-\d{2}\.json/.test(dl.suggestedFilename()));
    const r = await importObj(p, data); eq(r.title.startsWith('Replace'), true); eq(await p.locator('#toast').textContent(), 'Backup restored');
    p.exportedBackup = data;
  });
  await T('no console errors during the whole functional run', async () => eq(p.errs, []));
  await p.context().close();

  console.log('\nDATA INTEGRITY');
  p = await open();
  const base = await raw(p);
  const rejected = async (name, obj) => T('rejected, data untouched: ' + name, async () => {
    const r = await importObj(p, obj, false); eq(r.title, 'Backup not imported'); ok(r.list.length > 0 || typeof obj === 'string', 'expected a reason'); eq(await raw(p), base, 'storage changed'); eq(p.errs, []);
  });
  await tab(p, 'more');
  await rejected('malformed JSON', '{"v":2,"routine":[');
  await rejected('not a backup at all', { hello: 'world' });
  await rejected('days:null (the v1 crash)', { v: 2, routine: [], days: null });
  await rejected('old-format days:null', { routine: [], days: null });
  await rejected('duplicate habit ids', { v: 2, routine: [{ id: 'a', name: 'A', type: 'do', cat: 'Body' }, { id: 'a', name: 'B', type: 'do', cat: 'Body' }], days: {} });
  await rejected('invalid date keys', { v: 2, routine: [], days: { '2026-02-30': {}, nope: {} } });
  await rejected('future-dated record', { v: 2, routine: [], days: { '2099-01-01': {} } });
  await rejected('bad habit type', { v: 2, routine: [{ id: 'a', name: 'A', type: 'zzz', cat: 'Body' }], days: {} });
  await rejected('completion of unknown habit', { v: 2, routine: [], days: { '2026-11-01': { h: [], done: { ghost: true } } } });
  await rejected('mood out of range / note wrong type', { v: 2, routine: [], days: { '2026-11-01': { mood: 99, note: 5 } } });
  await rejected('backup from a newer app version', { app: 'VYRON', version: 9, data: {} });
  await rejected('script in habit id', { v: 2, routine: [{ id: '<img src=x onerror=alert(1)>', name: 'A', type: 'do', cat: 'Body' }], days: {} });
  await T('oversized file rejected without parsing', async () => {
    await p.setInputFiles('#importFile', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 32) }); await p.waitForSelector('#msg[open]');
    ok((await p.textContent('#msgText')).includes('5 MB')); await p.click('#msgOk'); eq(await raw(p), base);
  });
  await T('HTML in names/notes is rendered as text, never executed', async () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    const env = { v: 2, routine: [{ id: 'x1', name: evil, type: 'do', cat: 'Body', time: '' }], days: {}, threshold: 0.7 };
    await importObj(p, env); await tab(p, 'today'); await p.fill('#note', evil); await p.fill('#extraInput', evil); await p.click('#extraAdd');
    eq(await p.evaluate(() => window.__xss), undefined); eq(await p.locator('#todayList img').count(), 0); ok((await p.locator('#todayList').textContent()).includes('<img'));
  });
  await T('failed import leaves the app fully usable (no crash on reload)', async () => { await p.reload(); await p.waitForSelector('#todayList'); ok(await tasks(p).count() >= 1); eq(p.errs, []); });
  await T('importing replaces data, "Restore previous data" brings the old data back (rollback)', async () => {
    await tab(p, 'more'); const before = JSON.stringify((await st(p)).routine);
    await importObj(p, { v: 2, routine: [{ id: 'only', name: 'Only habit', type: 'do', cat: 'Body' }], days: {}, threshold: 0.7 });
    eq((await st(p)).routine.length, 1); ok(await p.isVisible('#undoImport')); await p.click('#undoImport'); await p.waitForSelector('#msg[open]'); await p.click('#msgOk'); await p.waitForFunction(() => !document.getElementById('msg').open); await p.waitForTimeout(150);
    eq(JSON.stringify((await st(p)).routine), before);
  });
  await T('cancelling the import confirmation changes nothing', async () => { const b = await raw(p); await importObj(p, { v: 2, routine: [], days: {}, threshold: 0.7 }, false); eq(await raw(p), b); });
  await T('old v1 backup file imports and upgrades; deleted habits kept in history only', async () => {
    const t = await today(p), y = C.addDays(t, -1);
    const v1 = { routine: [{ id: 'a', name: 'Read', time: '07:00', cat: 'Study', type: 'do' }, { id: 'b', name: 'Old gone', time: '', cat: 'Body', type: 'avoid', deleted: true }], days: { [y]: { ids: ['a', 'b'], done: { a: true, b: true }, extras: [{ id: '17', name: 'Extra', done: true }], mood: 4, note: 'v1 note' } }, threshold: 0.7 };
    const r = await importObj(p, v1); ok(r.list.some(l => /Older format/.test(l)));
    const s = await st(p); eq(s.routine.map(x => x.name), ['Read']); eq(s.v, 2); eq(s.days[y].h.map(e => e.n), ['Read', 'Old gone']); eq(s.days[y].note, 'v1 note');
    await tab(p, 'today'); await p.click('#prevDay'); eq(await tasks(p).count(), 3); ok((await p.locator('#todayList').textContent()).includes('Old gone'));
  });
  await T('empty dataset (no habits, no days) works everywhere', async () => {
    await tab(p, 'more'); await importObj(p, { v: 2, routine: [], days: {}, threshold: 0.7 });
    for (const n of ['today', 'routine', 'progress', 'more']) { await tab(p, n); await p.waitForTimeout(50); }
    await tab(p, 'today'); ok((await p.textContent('#todayList')).includes('routine is empty')); eq(await p.textContent('#stStreak'), '0'); eq(p.errs, []);
  });
  await T('large dataset (3 years x 12 habits ~ 1,095 days): import, render all tabs, interact', async () => {
    const env = seedEnvelope(1095); const bytes = JSON.stringify(env).length; await tab(p, 'more');
    const t0 = Date.now(); await importObj(p, env); const tImport = Date.now() - t0;
    const t1 = Date.now(); await tab(p, 'progress'); await p.waitForSelector('#cal button'); const tProg = Date.now() - t1;
    await tab(p, 'today'); const t2 = Date.now(); await p.locator('#todayList .main').first().click(); await p.waitForFunction(() => document.querySelector('#todayList .main')); const tTap = Date.now() - t2;
    console.log(`        ${Math.round(bytes / 1024)} KB backup: import ${tImport}ms, Progress tab ${tProg}ms, tap ${tTap}ms`);
    ok(tProg < 1500 && tTap < 500, 'too slow'); eq(p.errs, []);
  });
  await T('rename keeps history: past day shows original name, today shows the new one', async () => {
    const env = seedEnvelope(5); const hid = env.data.routine[0].id, orig = env.data.routine[0].name; await tab(p, 'more'); await importObj(p, env);
    await tab(p, 'routine'); await p.locator('#routineList .main').first().click(); await p.fill('#fName', 'Renamed habit'); await p.click('#fSave');
    await tab(p, 'today'); ok((await p.locator('#todayList').textContent()).includes('Renamed habit')); await p.click('#prevDay');
    const txt = await p.locator('#todayList').textContent(); ok(txt.includes(orig) && !txt.includes('Renamed habit'), 'yesterday should keep "' + orig + '"');
  });
  await T('note/mood on an old empty day creates NO habit records and does not fail the day', async () => {
    const t = await today(p); const far = C.addDays(t, -400); await tab(p, 'today'); if (await p.isVisible('#jumpToday')) await p.click('#jumpToday');
    for (let i = 0; i < 400; i++) await p.click('#prevDay');
    await p.fill('#note', 'looking back'); await p.click('#moods button:nth-child(2)'); await p.waitForTimeout(700);
    const d = (await st(p)).days[far]; eq([d.h.length, Object.keys(d.done).length, d.note, d.mood], [0, 0, 'looking back', 2]); ok((await p.textContent('#dayStatus')).includes('not tracked'));
    await p.click('#dayStatus .btn'); eq(await tasks(p).count() > 0, true); // explicit opt-in to track that day
  });
  await T('corrupted saved data: app starts, keeps a copy, shows banner', async () => {
    const q = await open({}, () => { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', '1'); localStorage.setItem('vyron.v2', '{"v":2,"routine":[],"days":null}'); } });
    ok(await q.isVisible('#banner')); ok((await q.evaluate(() => localStorage.getItem('vyron.corrupt'))).includes('"days":null')); eq(await tasks(q).count(), 12); eq(q.errs, []); await q.context().close();
  });
  await T('v1 -> v2 automatic upgrade of data saved by the previous VYRON build', async () => {
    const t = C.keyOf(new Date()); const y = C.addDays(t, -1);
    const v1 = { routine: [{ id: 'k1', name: 'Walk', time: '17:00', cat: 'Body', type: 'do', deleted: false }, { id: 'k2', name: 'Gone', time: '', cat: 'Other', type: 'do', deleted: true }], days: { [y]: { ids: ['k1', 'k2'], done: { k1: true }, extras: [], mood: 3, note: 'old' } }, threshold: 0.9 };
    const q = await open({}, `if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('vyron.v1', ${JSON.stringify(JSON.stringify(v1))});}`);
    const s = await st(q); eq(s.routine.map(x => x.name), ['Walk']); eq(s.threshold, 0.9); eq(s.days[y].h.length, 2); eq(await q.evaluate(() => !!localStorage.getItem('vyron.v1')), true, 'v1 key must be kept as a safety copy'); ok(await q.isVisible('#banner')); eq(q.errs, []);
    await q.context().close();
  });
  await T('v1 data that was damaged by the old validation bug (days:null) does not crash', async () => {
    const q = await open({}, `if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('vyron.v1','{"routine":[],"days":null}');}`);
    eq(await tasks(q).count(), 12); ok(await q.isVisible('#banner')); eq(q.errs, []); await q.context().close();
  });
  await T('multi-tab: a change in one tab appears in the other instead of being overwritten', async () => {
    const ctx = p.context(); const p2 = await ctx.newPage(); p2.errs = []; await p2.goto(URL_()); await p2.waitForSelector('#todayList');
    await tab(p, 'today'); if (await p.isVisible('#jumpToday')) await p.click('#jumpToday'); const before = await p.locator('#todayList .main[aria-pressed=true]').count(); await p2.locator('#todayList .main[aria-pressed=false]').first().click();
    await p.waitForFunction(n => document.querySelectorAll('#todayList .main[aria-pressed=true]').length === n + 1, before, { timeout: 3000 });
  });
  await p.context().close();

  console.log('\nDATES, MIDNIGHT, TIME ZONES, PERFORMANCE');
  await T('midnight rollover: new day appears, yesterday frozen, view follows, streak logic intact', async () => {
    const ctx = await browser.newContext({ ...opts }); const q = await ctx.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message));
    await q.clock.install({ time: new Date('2026-11-05T23:59:20+05:30') }); await q.goto(URL_()); await q.waitForSelector('#todayList');
    eq(await today(q), '2026-11-05'); for (let i = 0; i < 9; i++) await q.locator('#todayList .main').nth(i).click(); // 9/12 = 75% >= 70%
    eq(await q.textContent('#stStreak'), '1');
    await q.clock.runFor(60 * 1000); await q.waitForTimeout(50);
    eq(await today(q), '2026-11-06'); eq(await q.textContent('#dayTitle'), 'Today'); eq(await q.textContent('#ringPct'), '0%'); eq(await q.textContent('#stStreak'), '1', 'yesterday succeeded, today pending');
    const s = await st(q); eq(Object.keys(s.days[ '2026-11-05'].done).length, 9); eq(Object.keys(s.days['2026-11-06'].done).length, 0);
    await q.clock.runFor(24 * 3600 * 1000); eq(await today(q), '2026-11-07'); eq(await q.textContent('#stStreak'), '0', 'a skipped day ends the streak'); eq(await q.textContent('#stBest'), '1');
    eq(q.errs, []); await ctx.close();
  });
  await T('idle for 5 simulated minutes: zero storage writes and zero DOM changes (was 5 writes / 480 mutations)', async () => {
    const ctx = await browser.newContext({ ...opts }); const q = await ctx.newPage(); await q.clock.install(); await q.goto(URL_()); await q.waitForSelector('#todayList');
    await q.evaluate(() => { window.__w = 0; window.__m = 0; const o = Storage.prototype.setItem; Storage.prototype.setItem = function () { window.__w++; return o.apply(this, arguments); }; new MutationObserver(r => window.__m += r.length).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true }); });
    await q.clock.runFor(5 * 60 * 1000); await q.waitForTimeout(50); eq(await q.evaluate(() => [window.__w, window.__m]), [0, 0]); await ctx.close();
  });
  for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Pago_Pago']) {
    await T('time zone ' + tz + ': app date matches local calendar date', async () => {
      const ctx = await browser.newContext({ ...opts, timezoneId: tz }); const q = await ctx.newPage(); await q.goto(URL_()); await q.waitForSelector('#todayList');
      const expect = await q.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }); eq(await today(q), expect); await ctx.close();
    });
  }
  await T('time-zone change on a phone (travel west): records stay, "future" days are ignored, nothing crashes', async () => {
    const ctx = await browser.newContext({ ...opts, timezoneId: 'Pacific/Kiritimati' }); const q = await ctx.newPage(); q.errs = []; q.on('pageerror', e => q.errs.push(e.message)); await q.goto(URL_()); await q.waitForSelector('#todayList');
    const kir = await today(q); await q.locator('#todayList .main').first().click();
    const data = await raw(q); const ctx2 = await browser.newContext({ ...opts, timezoneId: 'Pacific/Pago_Pago' }); const q2 = await ctx2.newPage(); q2.errs = []; q2.on('pageerror', e => q2.errs.push(e.message));
    await q2.addInitScript(`if(!localStorage.getItem('__s')){localStorage.setItem('__s','1');localStorage.setItem('vyron.v2', ${JSON.stringify(data)});}`); await q2.goto(URL_()); await q2.waitForSelector('#todayList');
    const ps = await today(q2); ok(ps <= kir, 'Pago Pago is behind Kiritimati'); eq(q2.errs, []); eq(await q2.textContent('#stBest'), '0'); await ctx.close(); await ctx2.close();
  });

  console.log('\nPWA / OFFLINE');
  p = await open();
  await T('manifest: valid fields, icons exist at declared sizes, maskable icon present', async () => {
    const m = await p.evaluate(async () => (await fetch('manifest.webmanifest')).json());
    eq([m.display, m.scope, m.start_url, m.theme_color], ['standalone', './', './index.html', '#1a1a1a']); ok(m.icons.some(i => i.purpose === 'maskable'));
    for (const i of m.icons) { const dim = await p.evaluate(src => new Promise(r => { const im = new Image(); im.onload = () => r([im.naturalWidth, im.naturalHeight]); im.onerror = () => r(null); im.src = src; }), i.src); eq(dim, i.sizes.split('x').map(Number), i.src); }
  });
  await T('service worker registers, activates and controls the page', async () => {
    await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('#todayList'); ok(await p.evaluate(() => !!navigator.serviceWorker.controller));
    const names = await p.evaluate(() => caches.keys()); ok(names.some(n => n.startsWith('vyron-')), names.join());
    const cached = await p.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('vyron-'))); return (await c.keys()).map(r => new URL(r.url).pathname.split('/').pop() || './'); });
    for (const f of ['index.html', 'app.js', 'core.js', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'icon-maskable-512.png']) ok(cached.includes(f), 'not precached: ' + f);
  });
  await T('OFFLINE: relaunch loads and works fully, data intact, all tabs usable', async () => {
    await p.locator('#todayList .main').first().click(); await p.context().setOffline(true);
    await p.reload(); await p.waitForSelector('#todayList'); eq(await tasks(p).count() > 0, true); eq(await p.locator('#todayList .main').first().getAttribute('aria-pressed'), 'true');
    for (const n of ['routine', 'progress', 'more', 'today']) await tab(p, n); await p.locator('#todayList .main').nth(2).click(); eq(p.errs, []);
  });
  await T('OFFLINE: a failed non-page request fails (does NOT return index.html)', async () => {
    const r = await p.evaluate(async () => { try { const x = await fetch('missing-image.png'); return 'resolved:' + x.status + ':' + (await x.text()).slice(0, 15); } catch (e) { return 'rejected'; } }); eq(r, 'rejected');
  });
  await T('OFFLINE: other origins are not intercepted', async () => { const r = await p.evaluate(async () => { try { await fetch('https://example.com/x'); return 'ok'; } catch (e) { return 'rejected'; } }); eq(r, 'rejected'); });
  await p.context().setOffline(false);
  await T('UPDATE + CACHE CLEANUP: new version replaces old vyron cache; other apps\' caches survive', async () => {
    await p.evaluate(async () => { await caches.open('other-app-v1'); await caches.open('lma-site-cache'); await caches.open('vyron-1.0.0-obsolete'); });
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace("VERSION = '2.0.0'", "VERSION = '2.0.1'");
    overrides.set('/sw.js', sw); overrides.set('/app.js', fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + '\nwindow.__marker="new-build";');
    await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return true; await p.waitForTimeout(100); } return false; };
    ok(await until(async () => (await caches.keys()).includes('vyron-2.0.1')), 'new cache never created');
    ok(await until(async () => { const k = await caches.keys(); return !k.includes('vyron-2.0.0') && !k.includes('vyron-1.0.0-obsolete'); }), 'old vyron caches were not cleaned up: ' + (await p.evaluate(() => caches.keys())).join());
    const keys = await p.evaluate(() => caches.keys()); ok(keys.includes('other-app-v1') && keys.includes('lma-site-cache'), 'foreign caches deleted! ' + keys.join()); ok(!keys.includes('vyron-1.0.0-obsolete'), 'obsolete vyron cache kept');
    await p.reload(); await p.waitForSelector('#todayList'); eq(await p.evaluate(() => window.__marker), 'new-build'); overrides.clear();
  });
  await T('UPDATE: user data untouched by an app update', async () => { const s = await st(p); ok(Object.keys(s.days[await today(p)].done).length >= 1); });
  await p.context().close();
  await T('fresh install in a clean profile + reinstall flow: restore from an exported backup', async () => {
    const q = await open(); const env = seedEnvelope(10); await tab(q, 'more'); await importObj(q, env); eq(Object.keys((await st(q)).days).length >= 10, true);
    await q.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); localStorage.clear(); });
    await q.reload(); await q.waitForSelector('#todayList'); eq(Object.keys((await st(q)).days).length, 1, 'clean slate after "uninstall"');
    await tab(q, 'more'); await importObj(q, env); eq(Object.keys((await st(q)).days).length >= 10, true); eq(q.errs, []); await q.context().close();
  });

  console.log('\nRESPONSIVE');
  const sizes = [['small phone 320x568', 320, 568], ['phone 360x640', 360, 640], ['phone 390x844', 390, 844], ['tablet 768x1024', 768, 1024], ['desktop 1280x800', 1280, 800]];
  for (const [name, w, hgt] of sizes) {
    await T('layout ' + name + ': no horizontal overflow on any tab, nav usable', async () => {
      const q = await open({ viewport: { width: w, height: hgt } }); const env = seedEnvelope(40); await tab(q, 'more'); await importObj(q, env);
      for (const n of ['today', 'routine', 'progress', 'more']) { await tab(q, n); await q.waitForTimeout(60); const o = await q.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, main: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth })); ok(o.sw <= o.cw + 1 && o.main <= 1, `${n}: overflow ${JSON.stringify(o)}`);
        if (SHOTS) await q.screenshot({ path: path.join(SHOTS, `${name.split(' ')[0]}-${w}-${n}.png`) }); }
      const navBox = await q.locator('nav').boundingBox(); ok(navBox.y + navBox.height <= hgt + 1, 'nav off-screen'); eq(q.errs, []); await q.context().close();
    });
  }
  await T('touch targets: interactive controls are at least 40px tall', async () => {
    const q = await open({ viewport: { width: 360, height: 640 } }); const small = await q.evaluate(() => [...document.querySelectorAll('button:not([hidden]), label.check')].filter(e => e.offsetParent && !e.closest('dialog') && !e.closest('details:not([open])')).map(e => [e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)]).filter(([, hh, ww]) => hh < 36 || ww < 36)); eq(small, []); await q.context().close();
  });

  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`); if (fail) console.log('Failures:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
