---
name: chs.product-team-loop
description: >
  Stand up a full product team out of agents and run it as a loop: Discovery
  finds work, Prioritization ranks it, Product writes dev-ready stories, and the
  Builder->Reviewer->Reviser pipeline ships them — as sprints with a fixed
  bug/enhancement mix, looping until the backlog drains, then re-running discovery
  to refill it. YOU are the scrum-master/orchestrator and never write code. Trigger
  when the user wants to autonomously discover + prioritize + build a backlog for a
  feature ("find enhancements and bugs and build them", "run the product team on
  X", "fill the backlog and ship the top items", "keep improving feature Y"), or
  invokes /chs.product-team-loop. This is the macro layer ABOVE the build loop:
  /chs.feature_design_build builds one designed slice; this discovers, prioritizes,
  and runs many sprints.
---

# chs.product-team-loop

Run a feature like a product team: **Discover -> Prioritize -> Write stories ->
Sprint (Builder/Reviewer/Reviser) -> Replenish.** You orchestrate; agents do the
work. The whole value is in *purposeful, evidence-grounded discovery* — not an idea
generator. The default failure mode of agentic discovery is plausible-sounding slop;
this skill's job is to make discovery a strict intake filter and the build a
self-checking pipeline.

**You are the orchestrator. You never write feature code — not one line.** You slice
work, write tight briefs, route between agents, score, accept, and keep the
artifacts. (Same prime directive as `chs.feature_design_build`; this is its macro
companion.)

## The prime directive: protect your own context

You stay sharp across many agents only if you stay lean.
- **Never paste file contents into your context.** Pass *pointers* — file paths,
  doc section numbers, contract-symbol names. Agents read; you don't.
- **Demand terse returns.** Every agent returns a short table/manifest (≤18 lines),
  never code or file dumps. Put that in every brief.
- **Do recon cheaply.** Small `grep`/`ls` to confirm paths and symbols.

## Pre-flight: scaffold the harness

On first run for a project, create a `product-team/` harness (next to the feature's
design docs) by copying this skill's `templates/` and filling the project specifics:

- `BACKLOG.md` — single source of truth (schema + the live backlog).
- `DISCOVERY_BRIEF.md` — the 5-lens discovery contract.
- `PRIORITIZATION_RUBRIC.md` — anchored `(impact x fit) / effort` scoring.
- `DEVICE_REPORT.md` — structured human intake for what you can't see (renders/runtime).
- `stories/STORY_TEMPLATE.md` — Definition of Ready + the grep-verification procedure.

Fill in: the feature's **surfaces** (the screens/areas you'll sweep), the **fit
definition** (what "serves the goal" means for this feature), the **ship path**
(commit/push/deploy command), and the **notify path** (how to report a closed sprint).
If a `product-team/` already exists, read it and continue from its state.

## The team (roles + how to dispatch)

| Role | Model | Dispatch | Job |
|------|-------|----------|-----|
| Orchestrator / scrum-master | you (Opus) | — | lifecycle, briefs, scoring, accept, ship, bookkeeping |
| Discovery (N lenses, parallel) | Sonnet, read-only | `Plan` | each owns one lens; surfaces candidates WITH evidence |
| Prioritization | Sonnet, **write** | `general-purpose` | dedupe, score, rank, assign ids, write backlog |
| Product (story-writer) | Sonnet, read-only | `Plan` | top items -> dev-ready stories (DoR-complete) |
| Builder | Sonnet | `general-purpose` | implement one story, one file set |
| Diff Reviewer | Sonnet, read-only | `Plan` | runtime-correctness audit -> P1/P2/P3 |
| Reviser | Sonnet | `general-purpose` | fix P1/P2 — usually the original Builder resumed (SendMessage) |

**Parallelism rule:** agents that run together must touch **disjoint files**.
Read-only agents always parallelize. Builders parallelize only across
disjoint-file stories — verify each story's recorded `files` set is pairwise
disjoint before batching. If two stories touch the same file, **sequence them.**

## Phase 1 — DISCOVER (the part that must not produce slop)

Run **5 read-only lens agents in parallel**, each owning ONE lens and sweeping ALL
surfaces through it. Lenses (re-point per project; these are the defaults):

| Lens | Hunts for |
|------|-----------|
| **flow** | dead ends, missing CTAs, multi-tap core jobs, states with no exit |
| **runtime** | stale state/closures, wrong-state conditionals, broken CRUD wiring, off-by-one, null/NaN, empty/loading/error paths |
| **coverage** | specced-or-listed-but-not-built/usable; real capability gaps |
| **consistency** | house-style/pattern drift across surfaces; cross-doc conflicts |
| **gates** | brand/token, a11y (labels + hit targets), AI-tells, other hard-gate violations |

**The intake slop-filter (enforce in every brief):**
1. **Evidence anchor required** — every candidate cites `file:line`, a concrete
   user flow, or a spec section it violates. No anchor -> dropped.
2. It must name a **defect** or a **missing/unusable capability** — never "this
   could be nicer." Cosmetic-only is rejected unless it fails a hard gate.
3. **Read the do-not-propose set first** — all existing backlog rows (any status
   except `reopened`) + the sprint log. YOU then run an independent dedup filter on
   the union; the agent's read is best-effort, your filter is the real gate.
4. **Agents never self-score** — no impact/fit/effort/priority-score. Strip those
   columns from their output template entirely.

Lens lessons (why this beats "suggest improvements"): the highest-signal findings
are human device reports and runtime-correctness audits; the noise is generic
best-practice suggestions. Convergence across lenses on one gap = high confidence.

## Phase 2 — PRIORITIZE (deterministic, auditable)

ONE write-capable Prioritization agent over the filtered union. It dedupes, assigns
ids, sets impact/fit/effort, computes `priority score = (impact x fit) / effort`,
tags type, ranks, and writes `prioritized` rows. Anchored so two runs match (see
the rubric template). Required guards:
- **Persist fit** in the backlog so it's reproducible; **id rule** = PREFIX-(max+1),
  never reused; **tie-break** = impact -> effort -> id.
- **Reconciliation**: every input candidate ends as scored / merged-into / rejected
  (reason) / deferred (reason). `input = scored + merged + rejected + deferred` — no
  silent drops.
- **No-self-score enforcement**: discard any pre-filled scores, re-derive, note it.
- Native/SQL/anything needing the human -> `blocked:carter`, not auto-sprinted.

Keep the priority score (ranking) distinct from any acceptance score (a separate
quality rubric the orchestrator computes at accept time). Never write a bare "score".

## Phase 3 — WRITE STORIES (Definition of Ready)

Product agent turns top `prioritized` items into stories via `stories/STORY_TEMPLATE.md`.
A story is `ready` only with: user value, testable acceptance criteria, the explicit
**disjoint files it owns**, **contract symbols verified to exist** (you confirm via
`rg -n "<symbol>" <path>` — a real definition match, recorded on the story; MISSING
-> story `blocked`), reuse pointers, constraints (brand/a11y/hard gates), scope tag.

## Phase 4 — SPRINT LOOP

Pull a batch of disjoint-file `ready` stories (default 3–5). Composition: **85%
enhancement / 15% bug** by item count (± one); on a small sprint that rounds bugs to
0, carry a cross-sprint bug-debt counter and force-pull a bug every other sprint; if
no open non-P1 bugs, 100% enhancements. **Any P1 / regression / device-reported bug
is drain-first and overrides the ratio.**

Per story: Builder builds -> Diff Reviewer audits runtime correctness -> Reviser
(usually the original Builder resumed) fixes P1/P2. **Max 2 reviser rounds**; if P1/P2
remain, mark `deferred` + escalate (never ping-pong forever). **Partial sprint**: ship
what passes (commit only its files); un-passed stories return to `ready`.

**Definition of Done**: hard gates pass; typecheck clean; P1/P2 cleared; acceptance
score rises past threshold with an honest self-critique. Then ship per the project's
ship path and update the backlog (`shipped`; `verified`/`done` after human confirm
where visual/runtime confirmation matters).

## Phase 5 — REPLENISH

At each sprint close, count `ready`. Below the low-water mark (default < 3) -> jump
back to DISCOVER. If a sweep returns **zero** valid candidates and the completion
condition isn't met, **pause and notify the human** — do not spin. To control cost,
rotate one lens-domain per replenish unless a full sweep is warranted.

## Runner, stop, and safety (project-configurable knobs)

- **Runner**: you self-pace with `ScheduleWakeup` (delay measured from each sprint
  close). Confirm cadence/autonomy with the user.
- **Autonomy**: ship under standing authorization with no per-sprint checkpoint, OR
  pause for approval before each ship — the user's call. Human gates always remain:
  native builds, SQL/migrations, and anything the grader can't see in source.
- **Completion**: stop on the project's condition (e.g. feature-score >= target AND
  no High-impact items remain) + a hard iteration cap as a safety stop.
- **Safety rails**: a regressed shipped item -> `reopened` (exempt from
  do-not-propose); on a bad ship / P1 crash, revert the deploy before fixing forward;
  cap human-report queue-jumps per sprint (P1 crashes exempt); a P1 crash preempts the
  running sprint as a solo hotfix, then resume.

## Closing a sprint

Commit feature files + the harness docs only — **never** build artifacts, lockfiles,
or DB seeds/migrations (those go through the human gate). Push, deploy via the
project's OTA-safe path, then send the user a short bulleted summary. Append a sprint
entry to the log.

## Anti-patterns (the dogfood taught these)

- A confident, well-formatted finding can still be **false** — the Reviewer exists to
  cross-check claims against ground truth. Don't trust prose; verify.
- The anchored rubric must **resist impact-inflation** — a gut "high-impact" call
  still has to satisfy a concrete impact clause, or it isn't High.
- Don't parallelize builders whose file sets overlap, even slightly. Sequence instead.
