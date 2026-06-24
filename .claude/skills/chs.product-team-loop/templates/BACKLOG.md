# BACKLOG — single source of truth for product-team work

> Schema + live backlog for the autonomous product-team loop. One row per item.
> Discovery appends `candidate`s; Prioritization scores + ranks; Product writes
> stories for the top `ready` items; sprints pull from `ready`. **Discovery agents
> do NOT set `priority score` — Prioritization owns priority score + status.**

## Schema

| Field | Values | Notes |
|-------|--------|-------|
| `id` | `BUG-NNN` / `ENH-NNN` / `DEBT-NNN` | stable; never reused |
| `type` | `bug` \| `enhancement` \| `debt` | broken / new-or-better / cleanup |
| `surface` | <project surfaces, e.g. screen or area names> \| `cross` | |
| `title` | short imperative | what changes |
| `impact` | H / M / L | anchored in PRIORITIZATION_RUBRIC.md — set by Prioritization |
| `fit` | High / Med / Low | strategic fit, maps to rubric 1.5 / 1.0 / 0.5 — set by Prioritization |
| `effort` | H / M / L | anchored in PRIORITIZATION_RUBRIC.md — set by Prioritization |
| `files` | repo-relative path(s) | explicit files the item owns; used for the disjoint-file overlap check; `TBD` if unknown |
| `priority score` | number | (impact×fit)÷effort per rubric — **Prioritization only** |
| `status` | candidate → prioritized → ready → in-sprint → shipped → verified → done (+ deferred / rejected / blocked:human / reopened) | a regressed verified/done item re-enters at `reopened`, EXEMPT from do-not-propose |
| `evidence` | `file:line` \| user-flow \| spec-ref \| `device:<who>` | **mandatory** — no anchor = rejected at intake |
| `needs` | `UI` \| `service:<fn>` \| `native` \| `SQL` | drives the human gate; native/SQL → `blocked:human` |
| `lens` | flow \| runtime \| coverage \| consistency \| gates \| device | which discovery lens raised it |

**Invariants:** `prioritized` requires a non-blank `priority score`; `ready` requires a
story file (`stories/<id>.md`) AND a non-empty `files` list.

**Intake rule (the slop filter):** a candidate is valid only if `evidence` names a
concrete anchor AND it describes a *defect* or a *missing/unusable capability* — not
"this could be nicer." Cosmetic-only is rejected unless a hard gate fails.

**Do-not-propose set:** discovery must not re-raise ANY existing backlog row of ANY
status EXCEPT `reopened`, plus the sprint log. Enforced by the Orchestrator running an
explicit dedup filter of discovery output against all existing rows BEFORE intake.

---

## Active backlog

| id | type | surface | title | impact | fit | effort | files | priority score | status | evidence | needs | lens |
|----|------|---------|-------|:------:|:---:|:------:|-------|:--------------:|--------|----------|-------|------|
| (seed or leave empty until first discovery run) | | | | | | | | | | | | |

## Laggard surfaces (rubric-gap discovery hints)
<list the weakest surfaces by the project's feature score; Prioritization weights
candidates that lift these.>

## Stories
Dev-ready stories for `ready` items live in `stories/<id>.md` (Definition of Ready: STORY_TEMPLATE.md).
