# Ace775 Command Center — UI/UX Redesign (v4.0)

A full redesign of the **Ace775 Automation Control Center** frontend, rebuilt as a **multi-file
project** — every screen is its own HTML page, sharing one CSS/JS layer. It talks to the same
FastAPI backend (`/api/*`) as the original, so it is a drop-in replacement for the `static/`
folder.

- **Transformation mode:** Full Redesign (visual system + layout rebuilt; content, flows, business
  logic and API contracts preserved).
- **Design direction:** a *precision-instrument operations console* — graphite surfaces, a single
  signal-mint accent, hairline rules, mono numerals, and SVG line icons. Built to make
  **status readable at a glance**.

---

## 1. Multi-file structure (the core change)

Before: one `index.html` (~63 KB) contained all six screens and switched them with a client-side
router. Now each screen is a real file:

```
ace775-redesign/
├── index.html          # Overview
├── accounts.html       # Account management
├── terminal.html       # Live console
├── withdrawals.html    # Payout queue + auto-withdraw rules
├── history.html        # Audit history
├── settings.html       # Scheduler / Telegram / system
├── login.html          # Master-password lock screen
├── css/
│   ├── tokens.css      # design tokens: colour, type, spacing, radii, motion, density
│   ├── base.css        # reset, typography, primitives, scrollbars
│   ├── layout.css      # app shell, rail, topbar, grids, responsive rules
│   ├── components.css  # buttons, badges, panels, KPI, tables, forms, terminal, modals, toasts
│   └── pages.css       # settings / login / page-specific styles
├── js/
│   ├── icons.js        # inline SVG line-icon set (no icon font, no emoji)
│   ├── core.js         # utils, formatting, toast, modal manager, API client, preview fallback
│   ├── shell.js        # rail + topbar render, theme, active nav, live status, auth guard
│   ├── modals.js       # account editor, CSV import, withdrawal, history modals
│   ├── account-row.js  # shared account row renderer + actions
│   ├── terminal-stream.js  # shared SSE console engine (filter/search/pause)
│   ├── boot.js         # icon + link hydration
│   └── pages/          # one module per screen
│       ├── overview.js  accounts.js  terminal.js
│       └── withdrawals.js  history.js  settings.js  login.js
└── README.md
```

The sidebar, theme handling and live status live in **one** place (`shell.js`); each page only
declares its own content. Adding a screen = one HTML file + one page module.

---

## 2. Preview it

**A. Without the backend (what you can do right now)**
Open any of the HTML files directly in a browser. The frontend detects that no server is present
and switches to **preview mode**: a "sample data" strip appears and every screen renders with
representative data so the redesign is fully visible. (When opening as plain files, keep the
folder structure intact so `css/` and `js/` resolve.)

**B. Against the real app (recommended)**
Copy this folder over your project's `static/` directory, then serve the pages. Two options:

1. **Quick check** — from inside the folder run `python -m http.server 8081` and open
   `http://localhost:8081/index.html`. Pages render and navigate; API calls will fall back to
   preview mode because there's no backend on that port.
2. **Full app** — see integration below.

---

## 3. Integrating with the FastAPI backend

The API surface is unchanged (`/api/accounts`, `/api/stats`, `/api/logs/stream`, …), so only the
static-file routing needs updating.

**Step 1 — replace the static folder**

```bash
# back up first
mv task_ace/static task_ace/static.bak
# then copy this redesign in as the new static/
cp -r ace775-redesign task_ace/static
```

**Step 2 — map the clean routes to the new files**

In `app.py`, update the dashboard view so each route serves its own page:

```python
PAGE_FILES = {
    "/": "index.html",
    "/accounts": "accounts.html",
    "/terminal": "terminal.html",
    "/history": "history.html",
    "/withdrawals": "withdrawals.html",
    "/settings": "settings.html",
}

@app.get("/", response_class=HTMLResponse)
@app.get("/accounts", response_class=HTMLResponse)
@app.get("/terminal", response_class=HTMLResponse)
@app.get("/history", response_class=HTMLResponse)
@app.get("/withdrawals", response_class=HTMLResponse)
@app.get("/settings", response_class=HTMLResponse)
def dashboard_view(request: Request):
    if not is_authenticated(request):
        return RedirectResponse(url="/login", status_code=302)
    page = PAGE_FILES.get(request.url.path, "index.html")
    path = os.path.join(STATIC_DIR, page)
    return FileResponse(path) if os.path.exists(path) else HTMLResponse("<h1>Page missing</h1>")
```

`/login` already serves `login.html`; keep it as-is.

Pages choose their links automatically: served at clean routes they link to `/accounts` etc.;
opened as files they link to `accounts.html`. No config needed.

**Step 3 — one backend note worth fixing**

The original frontend called `POST /api/accounts/import` for CSV import, but the backend route is
`POST /api/accounts/import-csv`. This redesign uses the correct `-csv` route, so batch import now
works.

---

## 4. What changed

**Visual system**
- Replaced emoji-as-icons everywhere with an inline **SVG line-icon set** (consistent 1.6 px
  stroke, `currentColor`).
- New type stack: **Sora** (display/UI) + **IBM Plex Sans** (body) + **IBM Plex Mono** (numerals,
  terminal, IDs) — replaces the generic Inter/JetBrains pairing. All figures use tabular numerals.
- One deliberate accent (signal mint) with reserved semantic colours for ok / warn / error / info;
  removed the purple/cyan glow-gradient treatment.
- Graphite surfaces with hairline borders, a faint instrument grid, and flat (non-glowing) status
  colours.

**Information architecture**
- A persistent **operations rail** (live window card, grouped nav, appearance controls) plus a
  **top status bar** (operational state, connection, GMT clock).
- Overview leads with a status strip, then four KPIs, the 7-day trend, then rotation + live console.
- Accounts is a dense, scannable **row layout** (identity → four metrics → action cluster) instead
  of large stacked cards.
- Tables (queue, history, payout config) use sticky headers, right-aligned numerals and semantic
  status badges.

**Interaction & states**
- One toast system (4 tones), one modal system, consistent button states
  (`default / hover / focus-visible / disabled / busy`).
- Explicit **loading, empty and error** states on every data surface; a labelled preview mode for
  offline viewing.
- Dark / light / high-contrast themes and a compact/roomy density switch, persisted locally.
- Responsive from desktop down to phone: the rail becomes an off-canvas drawer, grids collapse,
  account rows re-stack, tables scroll horizontally, dialogs go full-width.

---

## 5. Customising

| To change… | Edit |
|---|---|
| Colours, fonts, spacing, radii, shadows, density | `css/tokens.css` (the only place raw values live) |
| shell chrome, nav items, breakpoints | `css/layout.css`, `js/shell.js` |
| component look & feel | `css/components.css` |
| a screen's layout | that screen's `.html` + `js/pages/<screen>.js` |
| icons | `js/icons.js` (add a path, reference by name) |
| sample/offline data | the `DEMO` object in `js/core.js` |
| API endpoints | `js/core.js` (`Ace.api`) and the individual page modules |

Prefer editing `tokens.css` over hard-coding values — a brand re-skin is largely a token change.

---

## 6. Verification

- All 14 JS modules pass `node --check` (syntax).
- Every element ID referenced by a page module was cross-checked against its HTML (and the shared
  modals).
- Responsive rules are implemented for desktop, tablet and phone widths; the login and app shells
  were reviewed for overflow, focus and empty/loading/error coverage.
- No screenshot-based visual pass was run in this environment — open the files to eyeball the
  rendered result.

**Known limits**
- The frontend is a faithful redesign of the interface; it does not modify backend logic, routes or
  the database.
- Live data requires the FastAPI app (as above). Opened as plain files, pages show clearly-labelled
  sample data.
