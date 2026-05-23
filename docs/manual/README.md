# Vautcher — Guide d'utilisation

PDF user manual covering the three roles (client, propriétaire, root).
Authored as HTML + print CSS, rendered to PDF with headless Chrome.

## Build

```
bash docs/manual/build.sh
```

Produces `docs/manual/vautcher-guide.pdf`.

## Files

- `index.html` — the document (cover, TOC, sections, annex).
- `style.css` — print-first stylesheet, A4 page size, brand-matched.
- `build.sh` — Chrome `--headless --print-to-pdf` invocation.
- `img/` — screenshots embedded in the document (one PNG per task).
- `vautcher-guide.pdf` — generated artifact, committed for convenience.

## Screenshots

Phase A ships with **placeholder** screenshots — each task page shows a
labelled phone frame indicating which capture belongs there.

Phase B (the screenshot pipeline) will swap them for real captures:

- Client section — diner app run locally without Supabase env, so it
  falls back to `DEMO_VOUCHER` / `DEMO_EVENTS` (no real customer data).
- Owner & root sections — a "Demo Pizzeria" restaurant seeded in the
  dev DB via the Admin tab, captured via Playwright.

To replace a placeholder, drop the PNG into `img/` and swap the
corresponding `<div class="phone-screen placeholder" data-label="...">`
for `<div class="phone-screen"><img src="img/<name>.png" /></div>`.

## Tone

- French, *tutoiement*, present tense.
- One task = one page = one big screenshot.
- Max 3 numbered steps per task.
