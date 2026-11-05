# VYRON

A private, local-first habit and discipline tracker, installable as a PWA. Consistency over perfection.

- Daily checklist of **Do** and **Avoid** habits, mood and notes, one-time tasks, rest days
- Streaks, 30-day consistency and a 7-day average, with the rules explained in the app
- Calendar history, 7-day bars, mood strip, per-habit consistency
- Add, edit, reorder, archive and delete habits; history never changes when you do
- Works offline. No account, no server, no tracking. Data stays on your device
- Validated backup / restore with a safety copy and undo

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | App shell (no inline script or style; CSP enforced) |
| `core.js` | Pure logic: dates, validation, migration, streaks, stats, mutations |
| `app.js` | UI, storage, import/export, service-worker registration |
| `sw.js`, `manifest.webmanifest`, icons | PWA |
| `tests/core.test.js`, `tests/e2e.js` | Tests |
| `docs/AUDIT.md` | Audit report: findings, changes, test results, limitations |

## Develop

```
python3 -m http.server          # then open http://localhost:8000
node tests/core.test.js         # unit tests, no dependencies
node tests/e2e.js               # browser tests (needs: npm i playwright)
```

Bump `VERSION` in `sw.js` whenever you change an app file so installed copies update.
