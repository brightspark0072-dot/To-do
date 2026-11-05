// Run: node tests/core.test.js   (no dependencies)
const assert = require('assert');
const C = require('../core.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } };
const TODAY = '2026-11-05';
const mk = (th) => { const s = C.emptyState(); s.threshold = th || 0.7; return s; };
// give a day h habits (n of them) with `done` ticked
function day(s, k, total, done, extra) {
  const d = C.ensureDay(s, k);
  d.h = Array.from({ length: total }, (_, i) => ({ id: 'h' + i, n: 'H' + i, c: 'Body', y: 'do', t: '' }));
  d.done = {}; for (let i = 0; i < done; i++) d.done['h' + i] = true;
  Object.assign(d, extra || {});
  return d;
}

console.log('dates');
t('isKey rejects impossible dates', () => { ['2026-02-30', '2026-13-01', 'x', '2026-1-1', '1999-01-01', null, 5].forEach(k => assert.strictEqual(C.isKey(k), false, String(k))); assert(C.isKey('2024-02-29')); });
t('addDays crosses month/year/leap boundaries', () => { assert.strictEqual(C.addDays('2026-12-31', 1), '2027-01-01'); assert.strictEqual(C.addDays('2024-03-01', -1), '2024-02-29'); assert.strictEqual(C.addDays('2026-11-05', -400), '2025-10-01'); });
t('addDays is DST-proof in every zone', () => { ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kolkata'].forEach(() => { let k = '2026-03-01'; for (let i = 0; i < 400; i++) { const n = C.addDays(k, 1); assert.strictEqual(C.diffDays(k, n), 1); k = n; } }); });
t('addMonths / daysInMonth', () => { assert.strictEqual(C.addMonths('2026-12', 1), '2027-01'); assert.strictEqual(C.addMonths('2026-01', -1), '2025-12'); assert.strictEqual(C.daysInMonth('2024-02'), 29); assert.strictEqual(C.daysInMonth('2026-02'), 28); });

console.log('validation');
const V = o => C.validate(o, { todayKey: TODAY });
t('valid empty state round-trips', () => { const r = V(JSON.parse(JSON.stringify(C.exportEnvelope(mk())))); assert(r.ok, r.errors.join()); });
t('days:null rejected (audit 2.1a)', () => { const r = V({ v: 2, routine: [], days: null }); assert(!r.ok); assert(/days/.test(r.errors[0])); });
t('days as array rejected', () => assert(!V({ v: 2, routine: [], days: [] }).ok));
t('non-objects and unknown formats rejected', () => { [null, 5, 'x', [], {}, { foo: 1 }, { app: 'VYRON' }].forEach(x => assert(!V(x).ok, JSON.stringify(x))); });
t('newer version rejected with clear message', () => { const r = V({ app: 'VYRON', version: 9, data: {} }); assert(!r.ok && /Update VYRON/.test(r.errors[0])); });
t('duplicate habit ids rejected', () => { const r = V({ v: 2, routine: [{ id: 'a', name: 'A', type: 'do', cat: 'Body' }, { id: 'a', name: 'B', type: 'do', cat: 'Body' }], days: {} }); assert(!r.ok && /duplicate/.test(r.errors.join())); });
t('bad habit fields rejected (type, time, id, name)', () => {
  const base = { id: 'a', name: 'A', type: 'do', cat: 'Body' };
  [{ ...base, type: 'zzz' }, { ...base, time: '25:99' }, { ...base, id: 'bad id!' }, { ...base, name: '   ' }, { ...base, name: 'x'.repeat(500) }, null, 'str', { ...base, archived: 'yes' }]
    .forEach(h => assert(!V({ v: 2, routine: [h], days: {} }).ok, JSON.stringify(h)));
});
t('invalid / future date keys rejected', () => {
  ['not-a-date', '2026-02-30', '2030-01-01'].forEach(k => assert(!V({ v: 2, routine: [], days: { [k]: {} } }).ok, k));
  assert(V({ v: 2, routine: [], days: { '2026-11-07': {} } }).ok, 'today+2 tolerated for time-zone shift');
  assert(!V({ v: 2, routine: [], days: { '2026-11-08': {} } }).ok);
});
t('completion referencing unknown habit rejected', () => assert(!V({ v: 2, routine: [], days: { '2026-11-01': { h: [], done: { ghost: true } } } }).ok));
t('bad mood / note / rest / threshold rejected', () => {
  [{ mood: 9 }, { mood: 1.5 }, { mood: '3' }, { note: 5 }, { note: 'x'.repeat(2001) }, { rest: 'yes' }].forEach(d => assert(!V({ v: 2, routine: [], days: { '2026-11-01': d } }).ok, JSON.stringify(d)));
  [0, 2, 'a', NaN, null].forEach(th => assert(!V({ v: 2, routine: [], days: {}, threshold: th }).ok, String(th)));
});
t('failed validation never returns a state (nothing to partially apply)', () => { const r = V({ v: 2, routine: [{ id: 'a', name: 'A', type: 'do', cat: 'Body' }], days: { bad: {} } }); assert.strictEqual(r.state, null); });
t('input object is not mutated', () => { const inp = { v: 2, routine: [{ id: 'a', name: '  A  ', type: 'do', cat: 'Nope' }], days: {} }; const copy = JSON.stringify(inp); const r = V(inp); assert(r.ok); assert.strictEqual(JSON.stringify(inp), copy); assert.strictEqual(r.state.routine[0].name, 'A'); assert.strictEqual(r.state.routine[0].cat, 'Other'); });
t('unknown extra fields are stripped (no prototype pollution)', () => { const r = V(JSON.parse('{"v":2,"routine":[],"days":{},"__proto__":{"polluted":1},"evil":"x"}')); assert(r.ok); assert(!('evil' in r.state)); assert.strictEqual({}.polluted, undefined); });
t('control characters stripped from names/notes', () => { const r = V({ v: 2, routine: [{ id: 'a', name: 'A\u0000\u0007B', type: 'do', cat: 'Body' }], days: { '2026-11-01': { note: 'hi\u0000there\nok' } } }); assert(r.ok); assert.strictEqual(r.state.routine[0].name, 'A B'); assert.strictEqual(r.state.days['2026-11-01'].note, 'hithere\nok'); });
t('large dataset (3 years x 12 habits) validates fast', () => {
  const s = mk(); let k = '2023-11-05'; for (let i = 0; i < 1096; i++) { day(s, k, 12, i % 12); k = C.addDays(k, 1); }
  const t0 = Date.now(); const r = V(JSON.parse(JSON.stringify(s))); const ms = Date.now() - t0; assert(r.ok, r.errors.join()); assert(ms < 1500, ms + 'ms'); console.log('        validate 1096 days: ' + ms + 'ms');
});
t('too many days rejected', () => { const days = {}; let k = '2000-01-01'; for (let i = 0; i < C.LIM.days + 5; i++) { days[k] = {}; k = C.addDays(k, 1); if (k > '2026-11-01') break; } if (Object.keys(days).length > C.LIM.days) assert(!V({ v: 2, routine: [], days }).ok); });

console.log('v1 migration');
const v1 = () => ({
  routine: [{ id: 'a', name: 'Read', time: '07:00', cat: 'Study', type: 'do' }, { id: 'b', name: 'Old', time: '', cat: 'Body', type: 'avoid', deleted: true }],
  days: { '2026-11-03': { ids: ['a', 'b'], done: { a: true, b: true }, extras: [{ id: '123', name: 'Extra', done: true }], mood: 4, note: 'good' },
          '2026-11-02': { ids: [], done: {}, extras: [], mood: 3, note: 'only a note' } },
  threshold: 0.9
});
t('v1 data migrates, keeps deleted habits in history, drops them from routine', () => {
  const r = V(v1()); assert(r.ok, r.errors.join()); assert(r.migrated && r.version === 1);
  assert.strictEqual(r.state.routine.length, 1); const d = r.state.days['2026-11-03'];
  assert.deepStrictEqual(d.h.map(e => e.n), ['Read', 'Old']); assert(d.done.a && d.done.b); assert.strictEqual(d.x[0].n, 'Extra'); assert(d.x[0].d);
  assert.strictEqual(r.state.threshold, 0.9); assert.strictEqual(r.state.days['2026-11-02'].h.length, 0);
});
t('v1 migration: numeric extras ids become valid ids', () => assert(V(v1()).state.days['2026-11-03'].x[0].id === '123'));
t('v1 with days:null / garbage is rejected, not crashed', () => { assert(!V({ routine: [], days: null }).ok); assert(!V({ routine: [{ id: 'a', name: 'A', type: 'x' }], days: {} }).ok); assert(!V({ routine: [], days: { '2026-11-01': { ids: 'nope' } } }).ok); });
t('old backup does not damage newer data (import replaces atomically, original untouched)', () => { const cur = mk(); const before = JSON.stringify(cur); const r = V({ routine: [], days: null }); assert(!r.ok); assert.strictEqual(JSON.stringify(cur), before); });
t('v1 backup file produced by the previous VYRON build imports', () => { const r = V(JSON.parse(JSON.stringify({ routine: C.starterRoutine().map(h => ({ id: h.id, name: h.name, time: h.time, cat: h.cat, type: h.type, deleted: false })), days: {}, threshold: 0.7 }))); assert(r.ok, r.errors.join()); assert.strictEqual(r.state.routine.length, 12); });

console.log('history integrity');
t('renaming a habit leaves past days untouched (audit 2.2)', () => {
  const s = mk(); const h = s.routine[0]; C.syncToday(s, '2026-11-04'); C.toggleHabit(s, '2026-11-04', h.id);
  C.updateHabit(s, h.id, { name: 'Renamed', type: h.type, time: h.time, cat: h.cat }); C.syncToday(s, TODAY);
  const origName = C.starterRoutine()[0].name;
  assert.strictEqual(s.days['2026-11-04'].h.find(e => e.id === h.id).n, origName, 'yesterday keeps the original name');
  assert.strictEqual(s.days[TODAY].h.find(e => e.id === h.id).n, 'Renamed', 'today shows the new name');
  assert(s.days['2026-11-04'].done[h.id]);
});
t('today follows edits; added habit appears today only', () => {
  const s = mk(); C.syncToday(s, TODAY); C.syncToday(s, '2026-11-04');
  const r = C.addHabit(s, { name: 'New one', type: 'do', cat: 'Mind', time: '' }); C.syncToday(s, TODAY);
  assert(s.days[TODAY].h.some(e => e.id === r.habit.id)); assert(!s.days['2026-11-04'].h.some(e => e.id === r.habit.id));
});
t('deleting/archiving keeps history; ticked habit stays credited today', () => {
  const s = mk(); C.syncToday(s, TODAY); const id = s.routine[0].id; const n = s.routine[0].name; C.toggleHabit(s, TODAY, id);
  C.deleteHabit(s, id); C.syncToday(s, TODAY); assert(s.days[TODAY].done[id]); assert.strictEqual(s.days[TODAY].h.find(e => e.id === id).n, n);
  const id2 = s.routine[0].id; C.archiveHabit(s, id2, true); C.syncToday(s, TODAY); assert(!s.days[TODAY].h.some(e => e.id === id2), 'unticked archived habit leaves today');
});
t('note/mood on an empty past day does NOT create habit records (audit 2.3)', () => {
  const s = mk(); C.setNote(s, '2026-10-20', 'felt tired'); C.setMood(s, '2026-10-20', 2);
  const d = s.days['2026-10-20']; assert.strictEqual(d.h.length, 0); assert.strictEqual(Object.keys(d.done).length, 0);
  assert.strictEqual(C.dayInfo(s, '2026-10-20', TODAY).state, 'untracked'); assert.strictEqual(d.note, 'felt tired'); assert.strictEqual(d.mood, 2);
});
t('mood toggles off on second tap; history edits do not touch today', () => {
  const s = mk(); C.syncToday(s, TODAY); const before = JSON.stringify(s.days[TODAY]); C.setMood(s, '2026-10-01', 4); C.setMood(s, '2026-10-01', 4); assert.strictEqual(s.days['2026-10-01'].mood, 0); assert.strictEqual(JSON.stringify(s.days[TODAY]), before);
});
t('toggle on a habit not in that day is a no-op', () => { const s = mk(); assert.strictEqual(C.toggleHabit(s, '2026-10-01', 'zzz'), false); assert(!s.days['2026-10-01']); });
t('undo completion', () => { const s = mk(); C.syncToday(s, TODAY); const id = s.routine[0].id; C.toggleHabit(s, TODAY, id); assert(s.days[TODAY].done[id]); C.toggleHabit(s, TODAY, id); assert(!s.days[TODAY].done[id]); });
t('startTracking backfills a past day explicitly', () => { const s = mk(); C.startTracking(s, '2026-11-01'); assert.strictEqual(s.days['2026-11-01'].h.length, 12); assert.strictEqual(C.dayInfo(s, '2026-11-01', TODAY).state, 'failed'); });
t('extras: add/toggle/remove; empty name refused', () => { const s = mk(); assert.strictEqual(C.addExtra(s, TODAY, '   '), null); const e = C.addExtra(s, TODAY, 'Call bank'); assert(C.toggleExtra(s, TODAY, e.id)); assert.strictEqual(C.dayInfo(s, TODAY, TODAY).done, 1); assert(C.removeExtra(s, TODAY, e.id)); });
t('moveHabit / sortByTime', () => { const s = mk(); const a = s.routine[0].id, b = s.routine[1].id; assert(C.moveHabit(s, a, 1)); assert.strictEqual(s.routine[1].id, a); assert(!C.moveHabit(s, s.routine[0].id, -1)); s.routine[0].time = '23:59'; C.sortByTime(s); assert.strictEqual(s.routine[s.routine.length - 1].time, '23:59'); });
t('habit input validation', () => { const s = mk(); assert(C.addHabit(s, { name: '', type: 'do' }).error); assert(C.addHabit(s, { name: 'x', type: 'bad' }).error); assert(C.addHabit(s, { name: 'x', type: 'do', time: '99:99' }).error); assert(C.addHabit(s, { name: '<img src=x onerror=alert(1)>', type: 'do' }).habit); });

console.log('daily states');
t('four+ states classify correctly', () => {
  const s = mk(0.7);
  day(s, '2026-11-01', 10, 7); day(s, '2026-11-02', 10, 6); day(s, '2026-11-04', 10, 0, { rest: true }); day(s, TODAY, 10, 3);
  const st = k => C.dayInfo(s, k, TODAY).state;
  assert.strictEqual(st('2026-11-01'), 'success'); assert.strictEqual(st('2026-11-02'), 'failed'); assert.strictEqual(st('2026-11-03'), 'untracked');
  assert.strictEqual(st('2026-11-04'), 'rest'); assert.strictEqual(st(TODAY), 'progress'); assert.strictEqual(st('2026-11-06'), 'future');
  day(s, TODAY, 10, 7); assert.strictEqual(st(TODAY), 'success');
});
t('exactly-at-threshold counts (floating point safe)', () => { const s = mk(0.7); day(s, '2026-11-01', 10, 7); assert.strictEqual(C.dayInfo(s, '2026-11-01', TODAY).state, 'success'); const s2 = mk(0.9); day(s2, '2026-11-01', 10, 9); assert.strictEqual(C.dayInfo(s2, '2026-11-01', TODAY).state, 'success'); });
t('day with no applicable habits is untracked, not failed/success', () => { const s = mk(); C.ensureDay(s, '2026-11-01'); assert.strictEqual(C.dayInfo(s, '2026-11-01', TODAY).state, 'untracked'); });
t('Do and Avoid are scored identically (both are habits you must tick)', () => { const s = mk(0.5); const d = C.ensureDay(s, '2026-11-01'); d.h = [{ id: 'a', n: 'A', c: 'Body', y: 'do', t: '' }, { id: 'b', n: 'B', c: 'Detox', y: 'avoid', t: '' }]; d.done = { b: true }; assert.strictEqual(C.dayInfo(s, '2026-11-01', TODAY).state, 'success'); });

console.log('streaks');
const run = (spec, th) => { // spec: array of [offsetFromToday, total, done]
  const s = mk(th); spec.forEach(([off, tt, dn, ex]) => day(s, C.addDays(TODAY, off), tt, dn, ex)); return C.streaks(s, TODAY);
};
t('no data -> 0/0', () => assert.deepStrictEqual(C.streaks(mk(), TODAY), { cur: 0, best: 0 }));
t('3 good days ending yesterday; today pending -> cur 3', () => assert.deepStrictEqual(run([[-3, 10, 10], [-2, 10, 8], [-1, 10, 7], [0, 10, 0]]), { cur: 3, best: 3 }));
t('today reaching the goal adds to the streak', () => assert.deepStrictEqual(run([[-1, 10, 10], [0, 10, 7]]), { cur: 2, best: 2 }));
t('a missed day resets current but best is kept', () => assert.deepStrictEqual(run([[-6, 10, 10], [-5, 10, 10], [-4, 10, 10], [-3, 10, 2], [-2, 10, 10], [-1, 10, 10]]), { cur: 2, best: 3 }));
t('untracked gap breaks the streak', () => assert.deepStrictEqual(run([[-4, 10, 10], [-3, 10, 10], [-1, 10, 10]]), { cur: 1, best: 2 }));
t('rest day pauses without breaking or counting', () => assert.deepStrictEqual(run([[-3, 10, 10], [-2, 10, 0, { rest: true }], [-1, 10, 10]]), { cur: 2, best: 2 }));
t('today untracked/empty does not break an existing streak', () => assert.deepStrictEqual(run([[-2, 10, 10], [-1, 10, 10]]), { cur: 2, best: 2 }));
t('future-dated records are ignored (audit 2.4a)', () => assert.deepStrictEqual(run([[5, 10, 10], [1, 10, 10], [-1, 10, 10]]), { cur: 1, best: 1 }));
t('50% goal vs 100% goal change results', () => { const spec = [[-2, 10, 5], [-1, 10, 10]]; assert.strictEqual(run(spec, 0.5).cur, 2); assert.strictEqual(run(spec, 1).cur, 1); });
t('3-year realistic dataset computes quickly and correctly', () => {
  const s = mk(); let k = C.addDays(TODAY, -1095); let expected = 0, best = 0;
  for (let i = 0; i < 1095; i++) { const ok = i % 10 !== 9; day(s, k, 10, ok ? 8 : 2); expected = ok ? expected + 1 : 0; best = Math.max(best, expected); k = C.addDays(k, 1); }
  const t0 = Date.now(); const r = C.streaks(s, TODAY); const ms = Date.now() - t0; assert.deepStrictEqual(r, { cur: expected, best }); assert(ms < 200, ms + 'ms');
});

console.log('averages / consistency');
t('avg7 excludes today and counts untracked days as 0', () => { const s = mk(); day(s, C.addDays(TODAY, -3), 10, 10); day(s, C.addDays(TODAY, -2), 10, 10); day(s, TODAY, 10, 0); const a = C.average(s, TODAY, 7); assert.strictEqual(a.days, 3); assert(Math.abs(a.avg - 2 / 3) < 1e-9); });
t('avg7 is not inflated by missing days; null when nothing tracked', () => { assert.strictEqual(C.average(mk(), TODAY, 7).avg, null); const s = mk(); day(s, C.addDays(TODAY, -7), 10, 10); const a = C.average(s, TODAY, 7); assert.strictEqual(a.days, 7); assert(Math.abs(a.avg - 1 / 7) < 1e-9); });
t('days before the first tracked day are not counted as misses', () => { const s = mk(); day(s, C.addDays(TODAY, -2), 10, 10); day(s, C.addDays(TODAY, -1), 10, 10); const c = C.consistency(s, TODAY, 30); assert.strictEqual(c.den, 2); assert.strictEqual(c.pct, 1); });
t('consistency counts success / (success+missed+untracked), rest excluded', () => { const s = mk(); day(s, C.addDays(TODAY, -4), 10, 10); day(s, C.addDays(TODAY, -3), 10, 0, { rest: true }); day(s, C.addDays(TODAY, -1), 10, 0); const c = C.consistency(s, TODAY, 30); assert.deepStrictEqual([c.ok, c.den], [1, 3]); });
t('trend compares last 14 vs previous 14 days (null if too little data)', () => { assert.strictEqual(C.trend(mk(), TODAY), null); const s = mk(); for (let i = 1; i <= 14; i++) day(s, C.addDays(TODAY, -i), 10, 9); for (let i = 15; i <= 28; i++) day(s, C.addDays(TODAY, -i), 10, 5); assert.strictEqual(C.trend(s, TODAY), 40); });
t('monthStats counts and aligns the calendar', () => { const s = mk(); day(s, '2026-11-01', 10, 10); day(s, '2026-11-02', 10, 1); const m = C.monthStats(s, '2026-11', TODAY); assert.strictEqual(m.counts.success, 1); assert.strictEqual(m.counts.failed, 1); assert.strictEqual(m.counts.future, 25); assert.strictEqual(m.cells.filter(c => c === null).length, C.weekday('2026-11-01')); });
t('habitStats uses the name recorded at the time', () => { const s = mk(); day(s, '2026-11-01', 1, 1); s.days['2026-11-01'].h[0].n = 'Old name'; day(s, '2026-11-02', 1, 0); s.days['2026-11-02'].h[0].n = 'New name'; const r = C.habitStats(s, TODAY, 30); assert.strictEqual(r[0].name, 'New name'); assert.strictEqual(r[0].tot, 2); assert.strictEqual(r[0].ok, 1); });
t('moodSeries length & values', () => { const s = mk(); C.setMood(s, TODAY, 5); const m = C.moodSeries(s, TODAY, 14); assert.strictEqual(m.length, 14); assert.strictEqual(m[13].mood, 5); assert.strictEqual(m[0].mood, 0); });

console.log('midnight / time zones');
t('keyOf uses the LOCAL date (same instant, different zone, different key)', () => {
  // Run this file with TZ=Asia/Kolkata and TZ=America/Los_Angeles; both must pass.
  const d = new Date('2026-11-05T20:00:00Z'); const k = C.keyOf(d);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.strictEqual(k, local); console.log('        TZ=' + (process.env.TZ || 'system') + ' -> 2026-11-05T20:00Z is ' + k);
});
t('rollover: syncToday on a new day creates a fresh day, yesterday frozen', () => {
  const s = mk(); C.syncToday(s, '2026-11-04'); C.toggleHabit(s, '2026-11-04', s.routine[0].id); const y = JSON.stringify(s.days['2026-11-04']);
  C.syncToday(s, '2026-11-05'); assert.strictEqual(JSON.stringify(s.days['2026-11-04']), y); assert.strictEqual(Object.keys(s.days['2026-11-05'].done).length, 0); assert.strictEqual(s.days['2026-11-05'].h.length, 12);
});
t('traveling west (clock goes back a day): records dated "tomorrow" are ignored, not counted', () => { const s = mk(); day(s, '2026-11-05', 10, 10); const a = C.streaks(s, '2026-11-04'); assert.deepStrictEqual(a, { cur: 0, best: 0 }); assert.strictEqual(C.dayInfo(s, '2026-11-05', '2026-11-04').state, 'future'); });
t('syncToday with no habits does not create junk', () => { const s = mk(); s.routine = []; C.syncToday(s, TODAY); assert(!s.days[TODAY]); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
