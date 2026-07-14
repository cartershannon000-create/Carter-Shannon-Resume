# CS Ventures Control-Plane Dashboard (`/dev/login`)

Private, single-operator operating console for CS Ventures. Static front end
(`index.html` + `app.js` + `dashboard.css` + `metrics.css`) backed entirely by
Supabase. `noindex,nofollow` — not meant to be discoverable. This doc describes
how the pieces fit together; it is derived from `app.js` and `index.html`, so
keep it in sync when those change.

## Auth flow (Supabase Auth)

- `app.js` creates a Supabase client against the `cos` schema using the project
  URL and the **publishable** (anon) key — no service key ships to the browser.
- On load it calls `sb.auth.getSession()`: an existing session shows the app,
  otherwise the login card (`#login`) is shown.
- The login form calls `sb.auth.signInWithPassword({email, password})`. Success
  swaps `#login` for `#app` and stamps the account email into `#who`; failure
  shows a generic "Invalid email or password." message.
- `#signout` calls `sb.auth.signOut()` and returns to the login card.

## Data contract: `cos.api_dashboard_state()`

Everything on screen comes from one owner-gated RPC. `load()` calls
`sb.rpc('api_dashboard_state')` (no args) and assigns the result to the module
`state`. The RPC is gated to the owner account, so RLS/ownership is enforced
server-side, not in the client. The v3 payload has these top-level sections:

- **`overview`** — headline KPIs: `active_work`, `pending_review`,
  `pending_approvals`, `est_cost_7d`, `est_cost_total`, `captured_tokens`,
  `verified_outcomes`.
- **`freshness`** — `providers[]` of `{provider, last_event_at}` for the "data
  through …" line; >48h old drives the "refresh audit data" attention item.
- **`audit`** — the AI Work Audit rollups:
  - `providers[]` — per-provider (claude/codex) events, sessions, `est_cost`,
    `est_cost_7d`, `cost_is_estimate`, token breakdown (`tokens_in`,
    `tokens_out`, `tokens_cache_read`, `tokens_cache_write`, `tokens_total`),
    and `token_coverage`.
  - `models[]` / `model_weekly[]` — per-model totals and weekly trend.
  - `weekly[]` — per-provider weekly `est_cost`/`tokens`/`events`.
  - `projects[]` — per-workspace cost, tokens, and claude/codex split.
  - `sessions_recent[]` — highest-cost sessions in the last 14 days.
  - `recommendations[]`, `outcomes{}` — review queue and outcome counts.
- **`metrics`** — tracker cards: `key`, `label`, `domain`, `available`,
  `status`, `unit`, `value`, `target`, `direction`, `numerator`, `denominator`,
  `source`/`reason`. Unavailable metrics render as "—", never zero.
- **`operations`** — control-plane execution ledger: `work[]`, `approvals[]`
  (with `payload_hash`), `runners[]`, `events[]`. Plus `control_plane.local_runner`
  and `continuity.{tasks, evidence, checkpoint_weekly}`.

Execution approvals are decided through
`api_decide_approval(p_approval_id, p_approved, p_note, p_start_provider)`, then
the dashboard reloads. Work in `READY_FOR_RELEASE_APPROVAL` is surfaced as a
separate release gate. After reviewing the run log and confirming any required
merge or delivery happened, **Approve release** calls
`api_release(p_work_id, p_note)` and marks the ledger item `COMPLETED`. The RPC
does not rerun an agent, merge a pull request, or deploy code.

## Agent failure recovery

Dashboard-approved shipping work uses a bounded, human-selected provider chain.
The approval row lets Carter start with Claude (the default) or Codex. Only a
provider quota or usage-window exhaustion hands the same approved attempt to
the other model.
Process timeouts, build/test failures, configuration errors, and runner errors do
not trigger provider fallback. They stop the job, write a durable notification,
clone the approved plan to a new version with recovery context, and create a
`recovery` approval. If the second model also reports provider exhaustion, the work records
a paused transition before returning to `PENDING_PLAN_APPROVAL`. Approving the
recovery gate creates exactly one new job using the newly selected start model.

## Drill-down UI pattern (`app.js`)

Tabs are static panels (`[data-panel]`); `activate()` toggles the active one.
Interactivity is delegated in `bindNavigation()` via `data-*` attributes:
`data-provider`, `data-model`, `data-project`, `data-week`, `data-metric`, and
`data-drill` (cost/tokens/tab jumps). Each maps to a `drill*()` builder that
reads from `state` and calls `openDrill({title, subtitle, stats, chart, rows,
note})`, which renders into the `#drill` aside over a `#drill-backdrop`. Close on
✕, backdrop click, or Escape. After any re-render, `bindNavigation()` must run
again to re-wire the fresh DOM.

## Deploy path

These are static assets. Deploy by pushing to `main`; Cloudflare Pages builds
from the repo and publishes automatically. There is no build step for this
folder — edits to `index.html`/`app.js`/CSS go live on the next push to `main`.
Validate JS before committing: `node --check dev/login/app.js`.
