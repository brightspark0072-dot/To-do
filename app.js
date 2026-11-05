/* VYRON UI. All dynamic text is inserted with textContent / createTextNode (never innerHTML). */
(() => {
'use strict';
const C = window.VyronCore;
const K2 = 'vyron.v2', K1 = 'vyron.v1', KPREV = 'vyron.v2.prev', KBAD = 'vyron.corrupt';
const MOODS = ['', '😞', '😕', '😐', '🙂', '😄'];
const MOOD_NAMES = ['No mood recorded', 'Very low', 'Low', 'Okay', 'Good', 'Great'];
const QUOTES = [
  'Small wins, every day.',
  'Consistency beats intensity.',
  'A missed day is one day, not the end of the story.',
  'You are one decision away from a different day.',
  'Progress, not perfection.',
  'Come back as many times as it takes.'
];

const $ = s => document.querySelector(s);
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}

/* ---------- storage (every call guarded: it can throw in private mode / when blocked) ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  keys() { try { return Object.keys(localStorage).filter(k => k.startsWith('vyron.')); } catch (e) { return []; } }
};

/* ---------- state ---------- */
let todayKey = C.keyOf(new Date());
let viewKey = todayKey;
let calMonth = C.monthOf(todayKey);
let curTab = 'today';
let S, bootNotice = null, corruptRaw = null;

function boot() {
  const raw = store.get(K2);
  if (raw) {
    try {
      const r = C.validate(JSON.parse(raw), { todayKey });
      if (r.ok) { S = r.state; return; }
    } catch (e) { /* fall through */ }
    corruptRaw = raw; store.set(KBAD, raw);
    bootNotice = 'corrupt';
  } else {
    const old = store.get(K1);
    if (old) {
      try {
        const r = C.validate(JSON.parse(old), { todayKey });
        if (r.ok) { S = r.state; bootNotice = 'migrated'; return; }
      } catch (e) { /* fall through */ }
      bootNotice = 'v1failed';
    }
  }
  S = C.emptyState();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!store.set(K2, JSON.stringify(S))) toast('Could not save: browser storage is full or blocked');
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); }
function flush() { if (saveTimer) save(); }
function stashPrev() { return store.set(KPREV, JSON.stringify(S)); }

/* ---------- small UI helpers ---------- */
let toastTimer;
function toast(msg, action) {
  const t = $('#toast'); t.replaceChildren(msg);
  if (action) t.append(h('button', { type: 'button', onclick: action.fn }, action.label));
  t.classList.add('show'); clearTimeout(toastTimer);
  if (!action || !action.sticky) toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function ask(o) {
  return new Promise(res => {
    const d = $('#msg');
    $('#msgTitle').textContent = o.title; $('#msgText').textContent = o.text || '';
    const ul = $('#msgList'); ul.replaceChildren(...(o.list || []).map(t => h('li', null, t)));
    ul.hidden = !(o.list && o.list.length); ul.classList.toggle('ok', !!o.softList);
    const ok = $('#msgOk'), cancel = $('#msgCancel');
    ok.textContent = o.ok || 'OK'; ok.classList.toggle('danger', !!o.danger); ok.classList.toggle('ghost', !!o.danger);
    cancel.hidden = o.cancel === false; cancel.textContent = typeof o.cancel === 'string' ? o.cancel : 'Cancel';
    d.returnValue = '';
    d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}
$('#msgOk').addEventListener('click', () => $('#msg').close('ok'));
$('#msgCancel').addEventListener('click', () => $('#msg').close('cancel'));

const fmtLong = k => C.parse(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = t => { if (!t) return ''; const [hh, mm] = t.split(':').map(Number); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
const pct = v => v == null ? '–' : Math.round(v * 100) + '%';
function focusAfter(fn, selector) { fn(); const e = selector && document.querySelector(selector); if (e && !e.disabled) e.focus(); }

/* ---------- Today ---------- */
function renderToday() {
  const k = viewKey, isToday = k === todayKey, d = S.days[k];
  const info = C.dayInfo(S, k, todayKey);
  $('#dayTitle').textContent = isToday ? 'Today' : k === C.addDays(todayKey, -1) ? 'Yesterday' : C.parse(k).toLocaleDateString(undefined, { weekday: 'long' });
  $('#daySub').textContent = C.parse(k).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  $('#nextDay').disabled = k >= todayKey;
  $('#jumpToday').hidden = isToday;

  const p = info.pct == null ? 0 : Math.round(info.pct * 100);
  $('#ringPct').textContent = p + '%';
  $('#ringFg').style.strokeDashoffset = 276.46 * (1 - p / 100);
  $('#ring').setAttribute('aria-label', `${p}% complete, ${info.done} of ${info.total} done. ${C.STATE_LABEL[info.state]}`);

  const sm = C.summary(S, todayKey);
  $('#stStreak').textContent = sm.cur; $('#stBest').textContent = sm.best;
  $('#stCons').textContent = pct(sm.cons30.pct); $('#stAvg').textContent = pct(sm.avg7.avg);
  $('#ruleTh').textContent = Math.round(S.threshold * 100) + '%';
  $('#headline').textContent = sm.cur > 0
    ? `${sm.cur}-day streak. Keep going.`
    : sm.best > 0
      ? `Fresh start. Your best streak is ${sm.best} day${sm.best === 1 ? '' : 's'} and none of that progress is lost.`
      : 'Day one. Small wins count.';

  // status line
  const st = $('#dayStatus'); st.replaceChildren(); st.className = 'status'; st.hidden = false;
  const need = Math.max(0, Math.ceil(S.threshold * info.total - 1e-9) - info.done);
  if (info.state === 'rest') { st.classList.add('rest'); st.append(h('span', null, 'Rest day. Your streak is paused, not broken.')); }
  else if (info.state === 'untracked') {
    if (isToday) st.append(h('span', null, 'No habits yet. Add some in the Routine tab, or add a one-time task below.'));
    else st.append(h('span', null, 'Habits were not tracked on this day. You can still add a mood or note.'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { C.startTracking(S, k); save(); renderToday(); } }, 'Track this day'));
  }
  else if (info.state === 'progress') st.append(h('span', null, need ? `${need} more to reach today's goal.` : 'On track.'));
  else if (info.state === 'success') st.append(h('span', null, 'Goal reached. Nice work.'));
  else if (info.state === 'failed') st.append(h('span', null, 'Goal missed. It happens; the next day is a fresh start.'));
  else st.hidden = true;

  // list
  const list = $('#todayList'); list.replaceChildren();
  const hs = d ? d.h : [], xs = d ? d.x : [];
  if (hs.length) {
    list.append(h('h2', { class: 'group-title' }, 'Daily plan'));
    hs.forEach(e => list.append(row({ kind: 'h', id: e.id, name: e.n, cat: e.c, type: e.y, time: e.t, done: !!d.done[e.id] })));
  }
  if (xs.length) {
    list.append(h('h2', { class: 'group-title' }, 'One-time tasks'));
    xs.forEach(e => list.append(row({ kind: 'x', id: e.id, name: e.n, type: 'do', done: e.d })));
  }
  if (!hs.length && !xs.length && isToday && !S.routine.some(t => !t.archived)) {
    list.append(h('div', { class: 'empty' }, 'Your routine is empty. Open the Routine tab to add your first habit.'));
  }

  document.querySelectorAll('#moods button').forEach((b, i) => b.setAttribute('aria-pressed', String((d ? d.mood : 0) === i + 1)));
  const note = $('#note'); if (document.activeElement !== note) note.value = d ? d.note : '';
  $('#restToggle').checked = !!(d && d.rest);
  $('#extraTitle').textContent = isToday ? 'One-time task for today' : 'One-time task for this day';
}

function row(it) {
  const isHabit = it.kind === 'h';
  const live = isHabit && viewKey === todayKey && S.routine.some(t => t.id === it.id && !t.archived);
  const key = it.kind + it.id;
  const meta = h('div', { class: 'meta' },
    it.type === 'avoid' ? h('span', { class: 'tag avoid' }, 'Avoid') : null,
    isHabit ? (it.cat ? h('span', { class: 'tag' }, it.cat) : null) : h('span', { class: 'tag' }, 'One-time'),
    it.time ? fmtTime(it.time) : null);
  const label = `${it.name}. ${it.type === 'avoid' ? 'Avoid habit, tick when you held strong' : 'Habit'}`;
  const main = h('button', { class: 'main', type: 'button', 'aria-pressed': String(it.done), 'aria-label': label, 'data-key': key, onclick: () => onToggle(it) },
    h('span', { class: 'chk', 'aria-hidden': 'true' }, it.done ? '✓' : ''),
    h('span', { class: 'body' }, h('div', { class: 'name' }, it.name), meta));
  const r = h('div', { class: 'task' + (it.type === 'avoid' ? ' avoid' : ''), 'data-done': String(it.done) }, main);
  if (!isHabit) r.append(h('button', { class: 'iconbtn', type: 'button', 'aria-label': `Remove ${it.name}`, onclick: () => { C.removeExtra(S, viewKey, it.id); save(); renderToday(); } }, '✕'));
  else if (live) r.append(h('button', { class: 'iconbtn', type: 'button', 'aria-label': `Edit ${it.name}`, onclick: () => openEditor(it.id) }, '✎'));
  return r;
}

function onToggle(it) {
  const before = C.dayInfo(S, viewKey, todayKey).pct;
  if (it.kind === 'h') C.toggleHabit(S, viewKey, it.id); else C.toggleExtra(S, viewKey, it.id);
  save(); renderToday();
  const b = document.querySelector(`#todayList [data-key="${it.kind}${it.id}"]`); if (b) b.focus();
  const after = C.dayInfo(S, viewKey, todayKey).pct;
  if (after === 1 && before !== 1) toast('Perfect day! 🔥');
}

function addExtra() {
  const inp = $('#extraInput'), e = C.addExtra(S, viewKey, inp.value);
  if (!e) { if (inp.value.trim()) toast('Could not add that task'); inp.focus(); return; }
  inp.value = ''; save(); renderToday(); inp.focus();
}
$('#extraAdd').addEventListener('click', addExtra);
$('#extraInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } });
$('#prevDay').addEventListener('click', () => { viewKey = C.addDays(viewKey, -1); renderToday(); });
$('#nextDay').addEventListener('click', () => { if (viewKey < todayKey) { viewKey = C.addDays(viewKey, 1); renderToday(); } });
$('#jumpToday').addEventListener('click', () => { viewKey = todayKey; renderToday(); });
$('#note').addEventListener('input', e => { C.setNote(S, viewKey, e.target.value); saveSoon(); });
$('#note').addEventListener('blur', flush);
$('#restToggle').addEventListener('change', e => { C.setRest(S, viewKey, e.target.checked); save(); renderToday(); });
MOODS.slice(1).forEach((m, i) => $('#moods').append(h('button', { type: 'button', 'aria-label': MOOD_NAMES[i + 1], 'aria-pressed': 'false', onclick: () => { C.setMood(S, viewKey, i + 1); save(); renderToday(); } }, m)));

/* ---------- Routine ---------- */
function renderRoutine() {
  const act = S.routine.filter(t => !t.archived), arch = S.routine.filter(t => t.archived);
  const list = $('#routineList'); list.replaceChildren();
  if (!act.length) list.append(h('div', { class: 'empty' }, 'No active habits yet. Tap "+ New habit" to create one.'));
  act.forEach((t, i) => {
    const meta = h('div', { class: 'meta' }, h('span', { class: 'tag' + (t.type === 'avoid' ? ' avoid' : '') }, t.type === 'avoid' ? 'Avoid' : 'Do'), h('span', { class: 'tag' }, t.cat), t.time ? fmtTime(t.time) : null);
    list.append(h('div', { class: 'task' + (t.type === 'avoid' ? ' avoid' : '') },
      h('button', { class: 'main', type: 'button', 'aria-label': `Edit ${t.name}`, onclick: () => openEditor(t.id) },
        h('span', { class: 'body' }, h('div', { class: 'name' }, t.name), meta)),
      h('button', { class: 'iconbtn up', type: 'button', 'aria-label': `Move ${t.name} up`, disabled: i === 0, 'data-id': t.id, onclick: () => move(t.id, -1) }, '▲'),
      h('button', { class: 'iconbtn down', type: 'button', 'aria-label': `Move ${t.name} down`, disabled: i === act.length - 1, 'data-id': t.id, onclick: () => move(t.id, 1) }, '▼')));
  });
  $('#archivedBox').hidden = !arch.length; $('#archivedCount').textContent = arch.length;
  const al = $('#archivedList'); al.replaceChildren();
  arch.forEach(t => al.append(h('div', { class: 'task' + (t.type === 'avoid' ? ' avoid' : '') },
    h('span', { class: 'main' }, h('span', { class: 'body' }, h('div', { class: 'name' }, t.name), h('div', { class: 'meta' }, t.cat))),
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': `Restore ${t.name}`, onclick: () => { C.archiveHabit(S, t.id, false); C.syncToday(S, todayKey); save(); renderRoutine(); toast('Habit restored'); } }, '↺'),
    h('button', { class: 'iconbtn', type: 'button', 'aria-label': `Delete ${t.name} permanently`, onclick: () => confirmDelete(t.id) }, '🗑'))));
}
function move(id, dir) {
  if (!C.moveHabit(S, id, dir)) return;
  C.syncToday(S, todayKey); save(); renderRoutine();
  const same = document.querySelector(`#routineList .${dir < 0 ? 'up' : 'down'}[data-id="${id}"]`);
  const other = document.querySelector(`#routineList .${dir < 0 ? 'down' : 'up'}[data-id="${id}"]`);
  (same && !same.disabled ? same : other).focus();
}
$('#sortTime').addEventListener('click', () => { C.sortByTime(S); C.syncToday(S, todayKey); save(); renderRoutine(); toast('Sorted by time'); });

const dlg = $('#dlg'); let editingId = null;
function openEditor(id) {
  editingId = id || null;
  const t = id ? S.routine.find(v => v.id === id) : null;
  $('#dlgTitle').textContent = t ? 'Edit habit' : 'New habit';
  $('#fName').value = t ? t.name : ''; $('#fTime').value = t ? t.time : ''; $('#fCat').value = t ? t.cat : 'Study';
  document.querySelector(`input[name=ftype][value=${t ? t.type : 'do'}]`).checked = true;
  $('#fArchive').hidden = !t; $('#fDelete').hidden = !t; $('#fError').hidden = true;
  dlg.showModal(); if (!t) $('#fName').focus();
}
$('#newTask').addEventListener('click', () => openEditor(null));
$('#fCancel').addEventListener('click', () => dlg.close());
$('#fSave').addEventListener('click', () => {
  const data = { name: $('#fName').value, time: $('#fTime').value, cat: $('#fCat').value, type: document.querySelector('input[name=ftype]:checked').value };
  const r = editingId ? C.updateHabit(S, editingId, data) : C.addHabit(S, data);
  if (r.error) { const e = $('#fError'); e.textContent = r.error; e.hidden = false; $('#fName').focus(); return; }
  C.syncToday(S, todayKey); save(); dlg.close(); render(); toast(editingId ? 'Habit updated' : 'Habit added');
});
$('#fName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#fSave').click(); } });
$('#fArchive').addEventListener('click', () => { C.archiveHabit(S, editingId, true); C.syncToday(S, todayKey); save(); dlg.close(); render(); toast('Archived. History is kept.'); });
$('#fDelete').addEventListener('click', () => { const id = editingId; dlg.close(); confirmDelete(id); });
async function confirmDelete(id) {
  const t = S.routine.find(v => v.id === id); if (!t) return;
  if (!await ask({ title: `Delete "${t.name}"?`, text: 'It is removed from your routine. Past days keep their history. Archive it instead if you might want it back.', ok: 'Delete', danger: true })) return;
  C.deleteHabit(S, id); C.syncToday(S, todayKey); save(); render(); toast('Habit deleted');
}

/* ---------- Progress ---------- */
const GLYPH = { success: '✓', failed: '✕', rest: '◦', progress: '…' };
function goTo(k) { viewKey = k; setTab('today'); }
function renderProgress() {
  const bars = $('#bars'); bars.replaceChildren();
  for (let i = 6; i >= 0; i--) {
    const k = C.addDays(todayKey, -i), info = C.dayInfo(S, k, todayKey);
    const bar = h('i'); bar.style.height = Math.max(4, (info.pct || 0) * 100) + '%';
    bars.append(h('button', { class: 'bar s-' + info.state, type: 'button', 'aria-label': `${fmtLong(k)}: ${C.STATE_LABEL[info.state]}${info.pct != null ? ', ' + pct(info.pct) : ''}`, onclick: () => goTo(k) },
      h('b', null, info.pct == null ? '' : pct(info.pct)), bar, h('small', null, C.parse(k).toLocaleDateString(undefined, { weekday: 'short' }))));
  }
  const tr = C.trend(S, todayKey);
  $('#trendText').textContent = tr == null ? 'Track a few more days to see your trend.'
    : tr === 0 ? 'Your average completion is the same as the 14 days before.'
    : `Average completion over the last 14 days is ${Math.abs(tr)} points ${tr > 0 ? 'higher' : 'lower'} than the 14 days before.`;

  // calendar
  const first = C.firstTracked(S, todayKey) || Object.keys(S.days).sort()[0] || todayKey;
  const m = C.monthStats(S, calMonth, todayKey);
  $('#calTitle').textContent = C.parse(calMonth + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#calPrev').disabled = calMonth <= C.monthOf(first); $('#calNext').disabled = calMonth >= C.monthOf(todayKey);
  const cal = $('#cal'); cal.replaceChildren();
  m.cells.forEach(c => {
    if (!c) return cal.append(h('div', { class: 'blank' }));
    const st = c.pre ? 'untracked' : c.info.state;
    cal.append(h('button', { type: 'button', class: `s-${st}${c.k === todayKey ? ' today' : ''}`, disabled: st === 'future', 'aria-label': `${fmtLong(c.k)}: ${c.pre ? 'before you started' : C.STATE_LABEL[st]}`, onclick: () => goTo(c.k) },
      String(c.day), h('small', { 'aria-hidden': 'true' }, GLYPH[st] || ' ')));
  });
  const n = m.counts, den = n.success + n.failed + n.untracked;
  $('#calStats').textContent = den + n.progress + n.rest === 0 ? 'Nothing tracked this month yet.'
    : `${n.success} of ${den} finished days reached the goal${den ? ' (' + Math.round(n.success / den * 100) + '%)' : ''}. ${n.failed} missed, ${n.untracked} not tracked${n.rest ? ', ' + n.rest + ' rest' : ''}.`;

  const mr = $('#moodRow'); mr.replaceChildren();
  C.moodSeries(S, todayKey, 14).forEach(({ k, mood }) => mr.append(h('button', { type: 'button', class: mood ? 'has' : '', 'aria-label': `${fmtLong(k)}: ${MOOD_NAMES[mood]}`, onclick: () => goTo(k) }, mood ? MOODS[mood] : '·')));

  const ranks = $('#ranks'); ranks.replaceChildren();
  const hs = C.habitStats(S, todayKey, 30);
  if (!hs.length) ranks.append(h('div', { class: 'empty' }, 'Finish a few days and your habit stats will appear here.'));
  hs.forEach(r => { const f = h('i'); f.style.width = Math.round(r.pct * 100) + '%'; ranks.append(h('div', { class: 'rank' }, h('div', { class: 'n' }, (r.type === 'avoid' ? '🛡 ' : '') + r.name), h('div', { class: 'track', 'aria-hidden': 'true' }, f), h('div', { class: 'v' }, `${r.ok}/${r.tot}`))); });
}
$('#calPrev').addEventListener('click', () => { calMonth = C.addMonths(calMonth, -1); renderProgress(); });
$('#calNext').addEventListener('click', () => { calMonth = C.addMonths(calMonth, 1); renderProgress(); });

/* ---------- More: backup, import, reset ---------- */
function renderMore() {
  const le = S.lastExport ? new Date(S.lastExport) : null;
  const days = le ? Math.floor((Date.now() - le) / 864e5) : null;
  $('#backupInfo').textContent = le
    ? `Last backup: ${le.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}${days > 30 ? '. It has been a while, consider exporting a new one.' : '.'}`
    : 'You have not exported a backup yet. Export one now so your progress survives a phone reset.';
  $('#threshold').value = String(S.threshold);
  $('#undoImport').hidden = !store.get(KPREV);
  const pi = $('#persistInfo');
  if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => { pi.textContent = p ? 'Your browser has marked this data as persistent.' : 'The browser may clear it if the device runs low on space.'; }).catch(() => {});
}
$('#threshold').addEventListener('change', e => { S.threshold = +e.target.value; save(); toast('Daily goal updated'); });

function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
$('#exportBtn').addEventListener('click', () => {
  S.lastExport = new Date().toISOString(); save();
  download(`vyron-backup-${todayKey}.json`, JSON.stringify(C.exportEnvelope(S), null, 2));
  renderMore(); toast('Backup exported');
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > C.LIM.file) return ask({ title: 'Backup not imported', text: 'That file is larger than 5 MB, which is far more than a VYRON backup. Your current data was not changed.', cancel: false });
  let obj;
  try { obj = JSON.parse(await f.text()); }
  catch (err) { return ask({ title: 'Backup not imported', text: 'This file is not valid JSON, so it cannot be a VYRON backup. Your current data was not changed.', cancel: false }); }
  const r = C.validate(obj, { todayKey });
  if (!r.ok) return ask({ title: 'Backup not imported', text: 'Your current data was NOT changed. Problems found in the file:', list: r.errors, cancel: false });
  const d = C.describe(r.state);
  const lines = [`${d.habits} habits${d.archived ? ` (+${d.archived} archived)` : ''}`, `${d.days} days of history${d.from ? ` (${d.from} to ${d.to})` : ''}`, r.migrated ? 'Older format (v1): it will be upgraded automatically.' : 'Format v2'].concat(r.warnings.slice(0, 5));
  if (!await ask({ title: 'Replace your data with this backup?', text: 'Your current data is kept as a safety copy, so you can undo this from the Backup section.', list: lines, softList: true, ok: 'Replace my data', danger: true })) return;
  stashPrev(); S = r.state; C.syncToday(S, todayKey); save(); viewKey = todayKey; calMonth = C.monthOf(todayKey); render(); toast('Backup restored');
});
$('#undoImport').addEventListener('click', async () => {
  const raw = store.get(KPREV); let r;
  try { r = C.validate(JSON.parse(raw), { todayKey }); } catch (e) { r = { ok: false }; }
  if (!r.ok) return ask({ title: 'Nothing to restore', text: 'The saved safety copy could not be read.', cancel: false });
  if (!await ask({ title: 'Restore the previous data?', text: 'This swaps your current data with the safety copy from before the last import or reset.', ok: 'Restore' })) return;
  stashPrev(); S = r.state; C.syncToday(S, todayKey); save(); render(); toast('Previous data restored');
});
$('#resetRoutine').addEventListener('click', async () => {
  if (!await ask({ title: 'Replace your routine with the starter routine?', text: 'Your current habits are archived-and-removed from the routine. Past days keep their history. You can undo this afterwards.', ok: 'Replace routine', danger: true })) return;
  stashPrev(); S.routine = C.starterRoutine(); C.syncToday(S, todayKey); save(); render(); toast('Starter routine restored');
});
$('#wipeAll').addEventListener('click', async () => {
  if (!await ask({ title: 'Erase ALL VYRON data on this device?', text: 'This deletes your habits, history, notes, safety copies and old-format data. It cannot be undone. Export a backup first if you want to keep anything.', ok: 'Erase everything', danger: true })) return;
  store.keys().forEach(store.del); S = C.emptyState(); C.syncToday(S, todayKey); save(); viewKey = todayKey; render(); toast('All data erased');
});

/* ---------- navigation & render ---------- */
function setTab(name) {
  curTab = name;
  document.querySelectorAll('nav button').forEach(b => { if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + name; });
  $('#main').scrollTop = 0; render();
}
function render() { ({ today: renderToday, routine: renderRoutine, progress: renderProgress, more: renderMore })[curTab](); }
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ---------- date rollover: event/timer driven (no polling) ---------- */
let midnightTimer;
function scheduleMidnight() {
  clearTimeout(midnightTimer);
  const n = new Date(), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
  midnightTimer = setTimeout(rollover, Math.min(next - n, 2 ** 31 - 1));
}
function rollover() {
  const k = C.keyOf(new Date());
  if (k !== todayKey) {
    const followed = viewKey === todayKey;
    todayKey = k; if (followed) viewKey = k; calMonth = C.monthOf(todayKey);
    C.syncToday(S, todayKey); save(); render();
  }
  scheduleMidnight();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else rollover(); });
window.addEventListener('pagehide', flush);
window.addEventListener('pageshow', rollover);
// another tab/window changed the data: pick it up instead of overwriting it later
window.addEventListener('storage', e => {
  if (e.key !== K2 || !e.newValue) return;
  try { const r = C.validate(JSON.parse(e.newValue), { todayKey }); if (r.ok) { S = r.state; render(); } } catch (err) { /* ignore */ }
});

/* ---------- startup ---------- */
boot();
C.syncToday(S, todayKey);
save(); // for corrupt data a copy was already stashed under KBAD above
$('#quote').textContent = QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length];
if (bootNotice) {
  const b = $('#banner'); b.hidden = false;
  if (bootNotice === 'migrated') { b.append(h('span', null, 'Your data was upgraded to the new VYRON format. Your old data is still stored on this device as a safety copy.'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { b.hidden = true; } }, 'OK')); }
  else if (bootNotice === 'v1failed') { b.append(h('span', null, 'Your older VYRON data could not be upgraded automatically (it was left untouched). Starting with a fresh routine.'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => { b.hidden = true; } }, 'OK')); }
  else { b.append(h('span', null, 'Saved data could not be read, so VYRON started fresh. A copy of the damaged data was kept.'), h('button', { class: 'btn ghost small', type: 'button', onclick: () => download('vyron-damaged-data.json', corruptRaw || '') }, 'Download it')); }
}
setTab('today');
scheduleMidnight();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready', { label: 'Reload', sticky: true, fn: () => location.reload() }); });
      });
    }).catch(() => {});
  });
}
window.__vyron = { get state() { return S; }, get todayKey() { return todayKey; } }; // read-only handle for tests/debugging
})();
