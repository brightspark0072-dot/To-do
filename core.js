/* VYRON core: pure logic (no DOM, no storage). Runs in the browser and in Node for tests.
   Data model v2:
   state = { app:'VYRON', v:2, routine:[habit], days:{ 'YYYY-MM-DD': day }, threshold:0.7, lastExport:null|ISO }
   habit = { id, name, cat, type:'do'|'avoid', time:'HH:MM'|'', archived:bool }
   day   = { h:[{id,n,c,y,t}]  // snapshot of the habits that applied that day (history never changes when a habit is edited)
             done:{ id:true }, x:[{id,n,d}] // one-time tasks
             mood:0..5, note:'', rest:bool }
   A day with no h and no x is "untracked": it may still hold a mood and note. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VyronCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 2;
  const LIM = { name: 80, note: 2000, habits: 200, days: 20000, extras: 50, file: 5 * 1024 * 1024 };
  const CATS = ['Body', 'Mind', 'Study', 'Family', 'Detox', 'Other'];
  const TYPES = ['do', 'avoid'];
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const STATE_LABEL = { success: 'Goal reached', progress: 'In progress', failed: 'Missed', untracked: 'Not tracked', rest: 'Rest day', future: 'Upcoming' };

  const pad = n => String(n).padStart(2, '0');
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* ---------- dates (all day keys are LOCAL calendar dates; arithmetic is done in UTC so DST never shifts a day) ---------- */
  const toUTC = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmtUTC = ms => { const t = new Date(ms); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  function isKey(k) {
    if (typeof k !== 'string' || !KEY_RE.test(k)) return false;
    const [y, m, d] = k.split('-').map(Number);
    if (y < 2000 || y > 2200) return false;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => fmtUTC(toUTC(k) + n * 864e5);
  const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
  const weekday = k => new Date(toUTC(k)).getUTCDay();
  const monthOf = k => k.slice(0, 7);
  const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
  const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  /* ---------- defaults ---------- */
  function starterRoutine() {
    return [
      ['Wake up by 7:30, no phone for the first 30 min', '07:30', 'Body', 'do'],
      ['No scrolling in the morning', '08:00', 'Detox', 'avoid'],
      ["Pre-read today's class topic (15 min)", '09:30', 'Study', 'do'],
      ['Attend class with notes, phone in bag', '10:30', 'Study', 'do'],
      ['Revise class notes within 1 hour of getting home', '13:00', 'Study', 'do'],
      ['No movie / reels in the afternoon', '14:00', 'Detox', 'avoid'],
      ['Evening walk to the station', '17:00', 'Body', 'do'],
      ['Deep study on laptop (1 hour, phone away)', '19:00', 'Study', 'do'],
      ['Talk with mom', '21:30', 'Family', 'do'],
      ['No scrolling after dinner', '22:00', 'Detox', 'avoid'],
      ['Stayed strong against late-night urges', '23:00', 'Detox', 'avoid'],
      ['Phone away and in bed by 11:30', '23:30', 'Body', 'do']
    ].map(([name, time, cat, type]) => ({ id: uid(), name, time, cat, type, archived: false }));
  }
  const emptyState = () => ({ app: 'VYRON', v: VERSION, routine: starterRoutine(), days: {}, threshold: 0.7, lastExport: null });

  /* ---------- validation, sanitising and migration ---------- */
  const cleanName = s => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanNote = s => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

  function migrateV1(raw, err) {
    if (!Array.isArray(raw.routine)) { err('routine', 'must be a list'); return null; }
    if (!isObj(raw.days)) { err('days', 'must be an object keyed by date'); return null; }
    const meta = {};
    raw.routine.forEach((t, i) => {
      if (!isObj(t) || typeof t.id !== 'string') return;
      if (!(t.id in meta)) meta[t.id] = t;
    });
    const routine = raw.routine.filter(t => !(isObj(t) && t.deleted === true))
      .map(t => isObj(t) ? { id: t.id, name: t.name, cat: t.cat, type: t.type, time: t.time == null ? '' : t.time, archived: false } : t);
    const days = {};
    for (const k of Object.keys(raw.days)) {
      const d = raw.days[k];
      if (!isObj(d)) { days[k] = d; continue; }
      if (d.ids !== undefined && !Array.isArray(d.ids)) { err(`days.${k}.ids`, 'must be a list'); continue; }
      if (d.extras !== undefined && !Array.isArray(d.extras)) { err(`days.${k}.extras`, 'must be a list'); continue; }
      const h = [];
      (d.ids || []).forEach(id => {
        const m = meta[id];
        if (m && typeof m.name === 'string') h.push({ id, n: m.name, c: m.cat, y: m.type, t: m.time == null ? '' : m.time });
      });
      const hIds = new Set(h.map(e => e.id));
      const done = {};
      if (isObj(d.done)) for (const id of Object.keys(d.done)) if (d.done[id] && hIds.has(id)) done[id] = true;
      const x = (d.extras || []).map(e => isObj(e) ? { id: e.id, n: e.name, d: !!e.done } : e);
      days[k] = { h, done, x, mood: d.mood === undefined ? 0 : d.mood, note: d.note === undefined ? '' : d.note, rest: false };
    }
    return { v: 2, routine, days, threshold: raw.threshold === undefined ? 0.7 : raw.threshold, lastExport: null };
  }

  /* Returns { ok, state, errors[], warnings[], version, migrated }. Never mutates `input`. */
  function validate(input, ctx) {
    const today = (ctx && ctx.todayKey) || keyOf(new Date());
    const maxKey = addDays(today, 2); // tolerate a time-zone shift, reject anything further ahead
    const errors = [], warnings = [];
    let nErr = 0;
    const err = (p, m) => { nErr++; if (errors.length < 20) errors.push(`${p}: ${m}`); else if (errors.length === 20) errors.push('…and more problems not listed'); };
    const fail = () => ({ ok: false, errors, warnings, version: null, migrated: false });

    let raw = input, ver = null;
    if (isObj(raw) && raw.app === 'VYRON' && 'data' in raw) { ver = raw.version; raw = raw.data; if (!isObj(raw)) { err('data', 'is missing or not an object'); return fail(); } }
    else if (isObj(raw)) ver = raw.v !== undefined ? raw.v : (Array.isArray(raw.routine) && 'days' in raw ? 1 : null);
    else { err('file', 'is not a VYRON backup'); return fail(); }
    if (ver === null) { err('file', 'is not a VYRON backup (no recognisable data)'); return fail(); }
    if (typeof ver !== 'number' || !Number.isInteger(ver) || ver < 1) { err('version', `"${String(ver)}" is not a valid version`); return fail(); }
    if (ver > VERSION) { err('version', `backup is version ${ver}; this app understands up to ${VERSION}. Update VYRON first`); return fail(); }
    let migrated = false;
    if (ver === 1) { raw = migrateV1(raw, err); migrated = true; if (!raw) return fail(); }

    // routine
    const routine = [], ids = new Set();
    if (!Array.isArray(raw.routine)) err('routine', 'must be a list');
    else {
      if (raw.routine.length > LIM.habits) err('routine', `too many habits (max ${LIM.habits})`);
      raw.routine.slice(0, LIM.habits).forEach((t, i) => {
        const p = `routine[${i}]`;
        if (!isObj(t)) return err(p, 'is not a habit object');
        if (typeof t.id !== 'string' || !ID_RE.test(t.id)) return err(p + '.id', 'missing or invalid');
        if (ids.has(t.id)) return err(p + '.id', `duplicate id "${t.id}"`);
        ids.add(t.id);
        if (typeof t.name !== 'string' || !cleanName(t.name) || t.name.length > LIM.name * 2) return err(p + '.name', `must be 1-${LIM.name} characters`);
        const name = cleanName(t.name).slice(0, LIM.name);
        if (!TYPES.includes(t.type)) return err(p + '.type', 'must be "do" or "avoid"');
        let cat = t.cat;
        if (!CATS.includes(cat)) { warnings.push(`"${name}": unknown category replaced with Other`); cat = 'Other'; }
        const time = t.time === undefined || t.time === null ? '' : t.time;
        if (time !== '' && !(typeof time === 'string' && TIME_RE.test(time))) return err(p + '.time', 'must be HH:MM or empty');
        if (t.archived !== undefined && typeof t.archived !== 'boolean') return err(p + '.archived', 'must be true or false');
        routine.push({ id: t.id, name, cat, type: t.type, time, archived: !!t.archived });
      });
    }

    // days
    const days = {};
    if (!isObj(raw.days)) err('days', 'must be an object keyed by date (it is ' + (raw.days === null ? 'null' : Array.isArray(raw.days) ? 'a list' : typeof raw.days) + ')');
    else {
      const keys = Object.keys(raw.days);
      if (keys.length > LIM.days) err('days', `too many days (max ${LIM.days})`);
      keys.slice(0, LIM.days).forEach(k => {
        const p = `days["${k}"]`;
        if (!isKey(k)) return err(p, 'key is not a real date (YYYY-MM-DD)');
        if (k > maxKey) return err(p, 'is dated in the future');
        const d = raw.days[k];
        if (!isObj(d)) return err(p, 'is not an object');
        const hRaw = d.h === undefined ? [] : d.h;
        if (!Array.isArray(hRaw) || hRaw.length > LIM.habits) return err(p + '.h', 'must be a list of habits (max ' + LIM.habits + ')');
        const h = [], seen = new Set();
        let bad = false;
        hRaw.forEach((e, i) => {
          const q = `${p}.h[${i}]`;
          if (!isObj(e) || typeof e.id !== 'string' || !ID_RE.test(e.id)) { bad = true; return err(q, 'invalid habit entry'); }
          if (seen.has(e.id)) { bad = true; return err(q + '.id', `duplicate id "${e.id}"`); }
          seen.add(e.id);
          if (typeof e.n !== 'string' || !cleanName(e.n)) { bad = true; return err(q + '.n', 'name missing'); }
          if (!TYPES.includes(e.y)) { bad = true; return err(q + '.y', 'must be "do" or "avoid"'); }
          const t = e.t === undefined || e.t === null ? '' : e.t;
          if (t !== '' && !(typeof t === 'string' && TIME_RE.test(t))) { bad = true; return err(q + '.t', 'must be HH:MM or empty'); }
          h.push({ id: e.id, n: cleanName(e.n).slice(0, LIM.name), c: CATS.includes(e.c) ? e.c : 'Other', y: e.y, t });
        });
        const done = {};
        const dRaw = d.done === undefined ? {} : d.done;
        if (!isObj(dRaw)) err(p + '.done', 'must be an object');
        else for (const id of Object.keys(dRaw)) {
          if (!seen.has(id)) err(`${p}.done.${id}`, 'completion refers to a habit that is not part of that day');
          else if (dRaw[id] !== true) err(`${p}.done.${id}`, 'must be true');
          else done[id] = true;
        }
        const xRaw = d.x === undefined ? [] : d.x;
        const x = [];
        if (!Array.isArray(xRaw) || xRaw.length > LIM.extras) err(p + '.x', 'must be a list (max ' + LIM.extras + ')');
        else {
          const xs = new Set();
          xRaw.forEach((e, i) => {
            const q = `${p}.x[${i}]`;
            if (!isObj(e) || typeof e.id !== 'string' || !ID_RE.test(e.id) || xs.has(e.id)) return err(q, 'invalid or duplicate one-time task id');
            xs.add(e.id);
            if (typeof e.n !== 'string' || !cleanName(e.n)) return err(q + '.n', 'name missing');
            if (typeof e.d !== 'boolean') return err(q + '.d', 'must be true or false');
            x.push({ id: e.id, n: cleanName(e.n).slice(0, LIM.name), d: e.d });
          });
        }
        const mood = d.mood === undefined ? 0 : d.mood;
        if (!Number.isInteger(mood) || mood < 0 || mood > 5) err(p + '.mood', 'must be a whole number from 0 to 5');
        const note = d.note === undefined ? '' : d.note;
        if (typeof note !== 'string' || note.length > LIM.note) err(p + '.note', `must be text up to ${LIM.note} characters`);
        const rest = d.rest === undefined ? false : d.rest;
        if (typeof rest !== 'boolean') err(p + '.rest', 'must be true or false');
        if (!bad) days[k] = { h, done, x, mood, note: typeof note === 'string' ? cleanNote(note) : '', rest: rest === true };
      });
    }

    let threshold = raw.threshold === undefined ? 0.7 : raw.threshold;
    if (typeof threshold !== 'number' || !isFinite(threshold) || threshold < 0.1 || threshold > 1) err('threshold', 'must be a number between 0.1 and 1');
    let lastExport = raw.lastExport === undefined ? null : raw.lastExport;
    if (lastExport !== null && (typeof lastExport !== 'string' || isNaN(Date.parse(lastExport)))) { warnings.push('lastExport date ignored'); lastExport = null; }

    if (nErr) return { ok: false, state: null, errors, warnings, version: ver, migrated };
    return { ok: true, state: { app: 'VYRON', v: VERSION, routine, days, threshold, lastExport }, errors: [], warnings, version: ver, migrated };
  }

  const exportEnvelope = (state, now) => ({ app: 'VYRON', version: VERSION, exportedAt: (now || new Date()).toISOString(), data: state });
  function describe(state) {
    const ks = Object.keys(state.days).sort();
    return { habits: state.routine.filter(t => !t.archived).length, archived: state.routine.filter(t => t.archived).length, days: ks.length, from: ks[0] || null, to: ks[ks.length - 1] || null };
  }

  /* ---------- day classification & stats ---------- */
  const ensureDay = (s, k) => s.days[k] || (s.days[k] = { h: [], done: {}, x: [], mood: 0, note: '', rest: false });
  const total = d => d ? d.h.length + d.x.length : 0;
  const doneCount = d => d ? Object.keys(d.done).length + d.x.filter(e => e.d).length : 0;

  function dayInfo(s, k, today) {
    if (k > today) return { state: 'future', pct: null, done: 0, total: 0 };
    const d = s.days[k];
    const t = total(d), n = doneCount(d);
    if (d && d.rest) return { state: 'rest', pct: t ? n / t : null, done: n, total: t };
    if (!t) return { state: 'untracked', pct: null, done: 0, total: 0 };
    const pct = n / t;
    if (pct + 1e-9 >= s.threshold) return { state: 'success', pct, done: n, total: t };
    return { state: k === today ? 'progress' : 'failed', pct, done: n, total: t };
  }
  function firstTracked(s, today) {
    let first = null;
    for (const k of Object.keys(s.days)) {
      if (k > today) continue;
      const d = s.days[k];
      if ((total(d) > 0 || d.rest) && (first === null || k < first)) first = k;
    }
    return first;
  }
  /* current + best streak. success +1; rest pauses; missed/untracked past day resets; today never breaks it */
  function streaks(s, today) {
    const first = firstTracked(s, today);
    if (first === null) return { cur: 0, best: 0 };
    let run = 0, best = 0;
    for (let k = first, guard = 0; k <= today && guard < 40000; k = addDays(k, 1), guard++) {
      const st = dayInfo(s, k, today).state;
      if (st === 'success') { run++; if (run > best) best = run; }
      else if (st === 'rest') { /* pause */ }
      else if (k !== today) run = 0;
    }
    return { cur: run, best };
  }
  /* completed days (yesterday backwards), only from the first tracked day onward */
  function windowDays(s, today, n, offset) {
    const first = firstTracked(s, today), out = [];
    if (first === null) return out;
    for (let i = 1 + (offset || 0); i <= n + (offset || 0); i++) {
      const k = addDays(today, -i);
      if (k < first) break;
      out.push({ k, info: dayInfo(s, k, today) });
    }
    return out;
  }
  /* success / (success + missed + untracked). Rest days are excluded because the user chose them. */
  function consistency(s, today, n) {
    const w = windowDays(s, today, n || 30);
    let ok = 0, den = 0;
    w.forEach(({ info }) => { if (info.state === 'rest') return; den++; if (info.state === 'success') ok++; });
    return { ok, den, pct: den ? ok / den : null };
  }
  /* mean completion; untracked days count as 0 so the number can't be inflated by not logging */
  function average(s, today, n, offset) {
    const w = windowDays(s, today, n, offset).filter(e => e.info.state !== 'rest');
    if (!w.length) return { avg: null, days: 0 };
    return { avg: w.reduce((a, e) => a + (e.info.pct || 0), 0) / w.length, days: w.length };
  }
  function trend(s, today) {
    const a = average(s, today, 14, 0), b = average(s, today, 14, 14);
    if (a.days < 3 || b.days < 3) return null;
    return Math.round((a.avg - b.avg) * 100);
  }
  function monthStats(s, ym, today) {
    const c = { success: 0, failed: 0, progress: 0, untracked: 0, rest: 0, future: 0 };
    const cells = [];
    const first = ym + '-01';
    for (let i = 0; i < weekday(first); i++) cells.push(null);
    const first0 = firstTracked(s, today);
    for (let i = 1; i <= daysInMonth(ym); i++) {
      const k = `${ym}-${pad(i)}`;
      const info = dayInfo(s, k, today);
      // days before the very first tracked day are simply "before you started": not counted as misses
      const pre = first0 === null || k < first0;
      if (!(info.state === 'untracked' && pre)) c[info.state]++;
      cells.push({ k, day: i, info, pre: info.state === 'untracked' && pre });
    }
    return { counts: c, cells };
  }
  function habitStats(s, today, n) {
    const map = {};
    windowDays(s, today, n || 30).forEach(({ k }) => {
      const d = s.days[k];
      if (!d) return;
      d.h.forEach(e => {
        const r = map[e.id] || (map[e.id] = { id: e.id, name: e.n, type: e.y, tot: 0, ok: 0, lastKey: '' });
        r.tot++; if (d.done[e.id]) r.ok++;
        if (k > r.lastKey) { r.lastKey = k; r.name = e.n; r.type = e.y; }
      });
    });
    return Object.values(map).map(r => ({ ...r, pct: r.ok / r.tot })).sort((a, b) => b.pct - a.pct || b.tot - a.tot);
  }
  function moodSeries(s, today, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const k = addDays(today, -i); out.push({ k, mood: s.days[k] ? s.days[k].mood : 0 }); }
    return out;
  }
  const summary = (s, today) => ({ ...streaks(s, today), cons30: consistency(s, today, 30), avg7: average(s, today, 7), today: dayInfo(s, today, today) });

  /* ---------- mutations (pure on the state object; the app saves afterwards) ---------- */
  const snapshotRoutine = routine => routine.filter(t => !t.archived).map(t => ({ id: t.id, n: t.name, c: t.cat, y: t.type, t: t.time }));
  /* Today is the only "live" day: it follows routine edits. Past days are frozen. */
  function syncToday(s, today) {
    const fresh = snapshotRoutine(s.routine);
    const d = s.days[today];
    if (!d) { if (fresh.length) ensureDay(s, today).h = fresh; return; }
    if (!d.h.length && !fresh.length) return;
    const keep = d.h.filter(e => d.done[e.id] && !fresh.some(f => f.id === e.id)); // ticked habits stay credited even if later archived/deleted
    d.h = fresh.concat(keep);
    const ids = new Set(d.h.map(e => e.id));
    Object.keys(d.done).forEach(id => { if (!ids.has(id)) delete d.done[id]; });
  }
  function startTracking(s, k) { const d = ensureDay(s, k); if (!d.h.length) d.h = snapshotRoutine(s.routine); return d; }
  function toggleHabit(s, k, id) {
    const d = s.days[k];
    if (!d || !d.h.some(e => e.id === id)) return false;
    if (d.done[id]) delete d.done[id]; else d.done[id] = true;
    return true;
  }
  function addExtra(s, k, name) {
    const n = typeof name === 'string' ? cleanName(name).slice(0, LIM.name) : '';
    if (!n) return null;
    const d = ensureDay(s, k);
    if (d.x.length >= LIM.extras) return null;
    const e = { id: uid(), n, d: false }; d.x.push(e); return e;
  }
  function toggleExtra(s, k, id) { const d = s.days[k]; const e = d && d.x.find(v => v.id === id); if (!e) return false; e.d = !e.d; return true; }
  function removeExtra(s, k, id) { const d = s.days[k]; if (!d) return false; const n = d.x.length; d.x = d.x.filter(v => v.id !== id); return d.x.length !== n; }
  function setMood(s, k, m) { if (!Number.isInteger(m) || m < 0 || m > 5) return false; const d = ensureDay(s, k); d.mood = d.mood === m ? 0 : m; return true; }
  function setNote(s, k, text) { const d = ensureDay(s, k); d.note = cleanNote(String(text)).slice(0, LIM.note); }
  function setRest(s, k, on) { ensureDay(s, k).rest = !!on; }

  function checkHabitInput(data) {
    const name = typeof data.name === 'string' ? cleanName(data.name).slice(0, LIM.name) : '';
    if (!name) return { error: 'Give the habit a name.' };
    if (!TYPES.includes(data.type)) return { error: 'Choose Do or Avoid.' };
    const time = data.time || '';
    if (time && !TIME_RE.test(time)) return { error: 'Time must look like 07:30.' };
    return { value: { name, type: data.type, time, cat: CATS.includes(data.cat) ? data.cat : 'Other' } };
  }
  function addHabit(s, data) {
    const r = checkHabitInput(data); if (r.error) return r;
    if (s.routine.length >= LIM.habits) return { error: `Limit of ${LIM.habits} habits reached.` };
    const habit = { id: uid(), ...r.value, archived: false }; s.routine.push(habit); return { habit };
  }
  function updateHabit(s, id, data) {
    const t = s.routine.find(v => v.id === id); if (!t) return { error: 'Habit not found.' };
    const r = checkHabitInput(data); if (r.error) return r;
    Object.assign(t, r.value); return { habit: t };
  }
  function archiveHabit(s, id, on) { const t = s.routine.find(v => v.id === id); if (!t) return false; t.archived = !!on; return true; }
  function deleteHabit(s, id) { const n = s.routine.length; s.routine = s.routine.filter(v => v.id !== id); return s.routine.length !== n; }
  function moveHabit(s, id, dir) {
    const act = s.routine.filter(t => !t.archived);
    const i = act.findIndex(t => t.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= act.length) return false;
    const a = s.routine.indexOf(act[i]), b = s.routine.indexOf(act[j]);
    [s.routine[a], s.routine[b]] = [s.routine[b], s.routine[a]]; return true;
  }
  function sortByTime(s) {
    const act = s.routine.filter(t => !t.archived).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    s.routine = act.concat(s.routine.filter(t => t.archived));
  }

  return {
    VERSION, LIM, CATS, TYPES, STATE_LABEL,
    isKey, keyOf, parse, addDays, diffDays, weekday, monthOf, addMonths, daysInMonth, uid,
    starterRoutine, emptyState, validate, exportEnvelope, describe,
    dayInfo, firstTracked, streaks, consistency, average, trend, monthStats, habitStats, moodSeries, summary,
    ensureDay, snapshotRoutine, syncToday, startTracking, toggleHabit, addExtra, toggleExtra, removeExtra, setMood, setNote, setRest,
    addHabit, updateHabit, archiveHabit, deleteHabit, moveHabit, sortByTime
  };
});
