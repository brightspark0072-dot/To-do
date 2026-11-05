# VYRON audit report (v1 -> v2)

Every finding in the review brief was reproduced against the code that was actually live (v1, commit `d9bf709`) **before** anything was changed. Reproduction scripts drove real Chromium; results below are measured, not assumed.

## 1. Verified findings

| # | Claim in the brief | Verdict | Evidence from the live v1 code |
|---|---|---|---|
| 2.1 | Import validation insufficient | **Confirmed, worse than described** | `{"routine":[],"days":null}` passes (`typeof null === 'object'`), is written to storage, and the app then throws on **every launch** ("Cannot read properties of null"). Duplicate habit ids, habits of type `"zzz"`, `null` habits and a day keyed `"not-a-date"` were all accepted and stored. |
| 2.2 | Renaming rewrites history | **Confirmed** | Yesterday displayed "Wake up by 7:30…"; after renaming the habit it displayed "RENAMED HABIT". History stored only habit ids and looked names up live. |
| 2.3 | `ensureDay()` fabricates snapshots | **Confirmed** | Typing a note on a day with no record created a day holding all 12 habits with 0 done: a fake 0% **failed** day that dragged down averages and broke streaks. |
| 2.4 | Streak/average problems | **Confirmed (3 sub-issues)** | (a) A record dated 5 days in the future produced "Best streak 1". (b) `weekAvg()` pulled in the unfinished current day and silently skipped days with no record, so the average could only be inflated by not logging. (c) Days with no habits were indistinguishable from failed days. |
| 3.1 | SW deletes other apps' caches | **Confirmed** | Running the real `sw.js` activate handler against a fake cache store deleted `lma-site-cache` and `other-app-v3`. All your GitHub Pages projects share the origin `brightspark0072-dot.github.io`. |
| 3.2a | Cache writes not awaited | **Confirmed** | `cache.put` ran inside a `.then` chain with no `waitUntil`; the worker may be stopped before it completes. |
| 3.2b | Offline fallback returns index.html for everything | **Confirmed** | Any failed GET (image, JSON…) resolved to the HTML page. |
| 4 | `rollover()` every minute is wasteful | **Confirmed** | 5 simulated idle minutes = **5 localStorage writes and 480 DOM mutations** with nothing changed. |

Additional problems found during the audit (not in the brief):

* Storage writes were never wrapped in `try/catch`: a full or blocked store silently lost data.
* Two open tabs overwrote each other (last writer wins, no `storage` listener).
* Deleting a habit removed progress already ticked today.
* Days before the user's first tracked day would have counted as misses in any consistency figure.
* "Erase all data" in a shared-origin site must never call `localStorage.clear()` (it would wipe your other projects' data); v2 removes only `vyron.*` keys.
* Found by my own layout test: the Export/Import buttons overflowed at 320 px and 360 px wide screens; the rest-day checkbox was only 22 px. Fixed.

## 2. Improvements implemented

**Data model (v2) and migration**
* Each day stores a **snapshot** of the habits that applied that day (`id, name, category, type, time`). Renaming, archiving or deleting a habit never changes a past day. Today is the only "live" day and follows edits.
* Mood and notes are independent of habit records. Writing them on an untracked day creates no habit data; the day stays *Not tracked* and offers an explicit "Track this day" button.
* v1 data upgrades automatically on first launch. The old `vyron.v1` key is **kept untouched** as a safety copy. Habits deleted in v1 are preserved in the history snapshots only.

**Validation and backups**
* `core.js` validates the whole file before anything changes: structure, types, unique ids, real calendar dates, no dates beyond today+2, completion records that reference habits in that same day, mood range, text length, size limit (5 MB), version check. Errors are listed in plain language; **nothing is written unless the entire file is valid**.
* Backups are versioned envelopes `{app:"VYRON", version:2, exportedAt, data}`. v1 backups and raw v1 data are accepted and migrated.
* Before any import, reset or undo, the current data is stashed. **"Restore data from before the last import/reset"** swaps it back.
* Damaged saved data is copied to `vyron.corrupt`, a banner explains, and a "Download it" button recovers the raw text.
* No validation library; about 150 lines.

**Daily states and streaks (rules shown in the app under "How streaks and scores work")**
* States: *Goal reached*, *Missed*, *In progress* (today only), *Not tracked*, plus a user-chosen *Rest day*, and future days are ignored.
* Today never breaks a streak. A missed or untracked past day ends the current streak; the best streak is kept.
* A **rest day** pauses a streak (neither breaks nor counts) and is excluded from scores, an explicit user choice rather than hidden exclusion.
* **30-day consistency** = successes ÷ (successes + missed + not-tracked) over finished days since the first tracked day. **7-day average** counts untracked days as 0%, so not logging can never inflate it.
* A "fresh start" message appears after a broken streak: *your best streak and history are not lost*.

**PWA and performance**
* Service worker: only obsolete `vyron-*` caches are deleted; foreign caches are never touched; cache writes are awaited via `waitUntil`; precache bypasses the HTTP cache; page loads are network-first with a cached-shell fallback **for navigations only**; other failed requests stay failed; other origins are never intercepted. An "update ready, Reload" prompt appears when a new version installs.
* Polling removed. The date rollover is a timer set for the next local midnight plus `visibilitychange`/`pageshow`. **Idle for 5 minutes: 0 writes and 0 DOM mutations** (was 5 and 480). Notes save debounced (500 ms) and flush on blur/hide.
* Separate maskable icon (glyph within the 80 % safe zone, farthest corner at 0.249 of the icon vs the 0.40 limit).

**Security and privacy**
* Strict Content-Security-Policy meta tag (`script-src 'self'; style-src 'self'; default-src 'none'`): no inline script or style, no external resources. All user text is inserted with `textContent`; HTML/script payloads in names, notes and backups were tested and render as inert text.
* In-app notice that local storage is **not encrypted** and can be lost; persistent-storage is requested; a stale-backup reminder is shown.
* Multi-tab safety via the `storage` event. Storage errors surface as a message.

**UI/UX and accessibility**
* Calendar history (month view, tap a day to open it), 7-day bars coloured by state, month summary, 14-day average trend, 14-day mood strip, per-habit 30-day consistency.
* Habit management: edit, **archive/restore**, delete (confirmed), reorder with ▲▼ (keyboard-friendly), sort by time.
* Do/Avoid distinction by shape (square vs circle), a coloured edge, an "Avoid" label and a clear screen-reader label, never colour alone. Calendar states carry glyphs (✓ ✕ ◦ …) and a legend.
* Native `<dialog>` for confirmations (focus trap, Esc closes, focus returns); toggles are real buttons with `aria-pressed`; progress ring has a text alternative; skip link; visible 3 px focus ring; 44 px minimum targets; reduced-motion support; zoom is not disabled.

## 3. Recommendations deliberately rejected

| Suggestion | Decision and reason |
|---|---|
| Validation library | Rejected. A small hand-written schema is easier to audit and adds no dependency. |
| Framework migration | Rejected (as the brief said). The app is ~1,250 lines of dependency-free code and works offline. |
| Encrypted backups | **Not implemented.** A forgotten password would make a backup permanently unreadable, which is a worse failure for a habit app than the threat it addresses. The privacy notice tells users to store backups privately. Can be added later as an opt-in using WebCrypto (AES-GCM + PBKDF2). |
| Silently repairing invalid imports | Rejected. Repairing guesses at the user's data; the whole file is refused with a reason instead. |
| Streak "freeze tokens" / forgiveness points | Rejected: adds game mechanics that can be farmed. Rest days + consistency percentage + fresh-start messaging serve the "recovery" goal more honestly. |
| Drag-and-drop reordering | Rejected in favour of ▲▼ buttons: lighter and accessible by keyboard and screen reader. |
| Multi-version backup history | Rejected: one safety copy is enough and keeps storage small. |
| Analytics / accounts / cloud sync | Rejected to preserve the local-first, private design. |

## 4. Backup and migration notes

* **Automatic:** on first launch of v2, `vyron.v1` data is validated and converted to `vyron.v2`. `vyron.v1` is left in place. If conversion fails, nothing is deleted and a banner says so.
* **Limitation:** v1 never recorded names per day, so migrated history uses the habit names as they were at migration time. From v2 onward history is exact.
* Export creates `vyron-backup-YYYY-MM-DD.json` (v2 envelope). Import accepts v2 envelopes, raw v2 data, v1 raw exports.
* Import flow: choose file -> full validation -> summary and confirmation -> safety copy -> replace. A failed validation leaves data byte-for-byte unchanged (asserted in tests).

## 5. Testing results

Run with `node tests/core.test.js` (no dependencies) and `node tests/e2e.js` (needs Playwright).

| Suite | Result |
|---|---|
| Core unit tests (62), run under 4 time zones (Asia/Kolkata, America/Los_Angeles, Pacific/Kiritimati, UTC) | **62/62 pass in each** |
| End-to-end in Chromium (64) | **64/64 pass** |
| Contrast (14 colour pairs) | all pass WCAG AA; lowest is 6.02:1 |
| Accessible names / landmarks / headings / focus ring / dialog focus | pass (scripted check on all four tabs) |

Covered: create / edit / archive / restore / delete / reorder habits; Do and Avoid; complete and undo (mouse and keyboard); one-time tasks; mood; notes; date navigation; goal change; export + re-import; reload persistence; 14 malformed-import cases each proven to leave storage untouched; v1 backup import; v1 localStorage auto-upgrade; v1 data damaged by the old `days:null` bug; corrupt-data recovery; HTML injection; rename-keeps-history; note-on-empty-day; rollback; 1,095-day dataset (1.4 MB: import ~0.4 s, Progress tab ~60 ms, tap ~85 ms); midnight rollover under a fake clock (incl. streak behaviour across a skipped day); idle churn; four time zones; moving west across time zones; manifest and icon dimensions; SW install and control; **offline relaunch and full use offline**; failed requests not turned into HTML; update flow with cache cleanup while foreign caches survive; clean-profile reinstall + restore; layouts at 320, 360, 390, 768 and 1280 px (no horizontal overflow on any tab); touch-target size.

## 6. Not tested / known limitations (stated honestly)

* **Not tested on a real Android phone.** Real "Add to Home screen", install prompt, the maskable icon crop on a launcher, and low-end device performance could not be run here. Chromium offline mode was used to simulate offline use. Please do one install-and-airplane-mode check on your phone.
* **Automated axe-core scan could not be run** (no package access from this environment). I substituted the scripted checks above. **No screen-reader (TalkBack/VoiceOver) session** was possible.
* iOS/Safari and Firefox were not tested. Safari may evict site data for sites not added to the Home Screen: install it and keep backups.
* Time-zone *changes while the app is open* were simulated with separate browser profiles; real device behaviour was not observed.
* Browser storage is ~5 MB. At roughly 1.3 KB per day this is many years of data, but there is no automatic archiving.
* Rest days are unlimited by design (it is a personal tool). Nothing is enforced.
* No reminders or notifications: reliable background alerts on a static, server-less PWA are not possible.
* Dates are the device's local calendar. If you travel, "today" follows the phone.

## 7. Deployment (GitHub Pages)

1. Settings -> Pages -> Deploy from branch -> `main` / root.
2. Push the files (`index.html`, `styles.css`, `core.js`, `app.js`, `sw.js`, `manifest.webmanifest`, icons).
3. **When you change any app file, bump `VERSION` in `sw.js`.** Installed copies then fetch the new files and show "A new version is ready · Reload".
4. Local test: `python3 -m http.server` and open `http://localhost:8000`.
