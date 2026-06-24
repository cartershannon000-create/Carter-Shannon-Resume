# DISCOVERY BRIEF — lens-agent template (loop step 1)

> The reusable skeleton the Orchestrator fills per lens and dispatches as a
> **read-only Sonnet agent** (`subagent_type: Plan`). Run the lenses in parallel
> (all read-only → disjoint by construction). Each agent sweeps **all surfaces**
> through its one lens and returns candidates as BACKLOG rows.

## The contract every lens agent gets

```
ROLE: You are a read-only Discovery agent for <FEATURE>. You own ONE lens: <LENS>.
Sweep every surface (<list>) through that lens ONLY. You do not write code. You return
candidate backlog rows.

HARD INTAKE RULES (a candidate is REJECTED if it breaks any):
1. Evidence anchor required: cite file:line, a concrete reproducible user flow, or a
   spec section it violates. No anchor → drop it.
2. Must name a DEFECT or a MISSING/UNUSABLE capability — never "this could look nicer."
   Cosmetic-only is rejected UNLESS it fails a hard gate.
3. Do NOT re-raise anything in the do-not-propose set (all backlog rows of any status
   except `reopened` + the sprint log — read these FIRST and list which you checked).
   Your read is best-effort; the Orchestrator independently dedups every candidate
   against all existing rows before intake.
4. Do NOT assign score/impact/fit/effort — that's Prioritization. The OUTPUT template
   below has NO scoring columns; pre-scored candidates have those values discarded.

OUTPUT: one row per candidate (id blank — Prioritization assigns):
| | <type> | <surface> | <title> | <files> | <evidence> | <needs> | <lens> | candidate |
- files: the repo-relative path(s) this candidate would touch (best-effort).
- lens: the canonical lens name.
Plus a one-line "why it matters" under each row.

If a candidate depends on something only confirmable on a render/at runtime, raise it
and FLAG it `needs-visual-confirm` so it routes to the human (see DEVICE_REPORT.md).
```

## The five lenses

| Lens | Looks for |
|------|-----------|
| **flow** | dead ends, missing CTAs, multi-tap core jobs, states with no exit |
| **runtime** | stale state/closures, wrong-state conditionals, broken CRUD wiring, off-by-one, null/NaN, empty/loading/error paths |
| **coverage** | specced-or-listed-but-not-built/usable; capability gaps vs the design |
| **consistency** | house-style/pattern drift across surfaces; cross-doc conflicts |
| **gates** | brand/token, a11y (labels + hit targets), AI-tells, hard-gate violations |

## Orchestrator checklist per discovery cycle
1. Confirm the do-not-propose set is current (BACKLOG + sprint log).
2. Dispatch the 5 lens agents in parallel (read-only).
3. Run the do-not-propose dedup filter on the union — the real gate.
4. Confirm each surviving candidate has a `files` entry.
5. Hand the filtered union to Prioritization (dedupe + assign `priority score` + rank + ids/status).
6. Route any `needs-visual-confirm` items into a human device-report ask.
7. Top-ranked `prioritized` → Product writes stories → `ready`.

## Replenish
Trigger when `ready` < low-water mark (default 3). Re-run this brief; rotate one lens
per cycle to control cost unless a full sweep is warranted.
