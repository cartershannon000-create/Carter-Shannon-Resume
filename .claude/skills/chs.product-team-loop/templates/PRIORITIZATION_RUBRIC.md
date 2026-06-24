# PRIORITIZATION RUBRIC — anchored scoring (loop step 2)

> Run by ONE Prioritization agent over the filtered union of lens candidates. It
> dedupes, assigns `id`, sets `impact`/`fit`/`effort`/`priority score`, tags type,
> ranks → writes `prioritized` rows to BACKLOG.md. Anchored so two runs match.
>
> **Dispatch:** Prioritization WRITES to BACKLOG → run it write-capable
> (`general-purpose`), never read-only `Plan`. Read-only roles use `Plan`.

## priority score formula
```
priority score = (impact_pts × fit_pts) / effort_pts
```
Higher = do sooner. Compute to 1 decimal.

> **Two scores, never confused.** `priority score` is the ranking number Prioritization
> owns. It is NOT the acceptance score the Orchestrator computes at accept time. Never
> write a bare "score".

## Impact (impact_pts)
| | pts | Means (anchor concretely per project) |
|---|---|---|
| **H** | 3 | fixes a crash/dead-end OR unlocks a core job OR lifts a laggard surface measurably |
| **M** | 2 | improves an existing flow's usability/completeness; noticeable but not blocking |
| **L** | 1 | cleanup/consistency/nicety with little flow impact |

## Fit — alignment with the feature goal (fit_pts)
The goal: <state the feature's goal in one line>.
| | pts | Means |
|---|---|---|
| **High** | 1.5 | directly serves the goal |
| **Med** | 1.0 | supports the experience but tangential |
| **Low** | 0.5 | internal/debt with no direct user-job tie |

> **Fit is persisted** in the BACKLOG `fit` column and read back, never re-eyeballed.

## Effort (effort_pts)
| | pts | Means |
|---|---|---|
| **L** | 1 | single file, copy an existing pattern |
| **M** | 2 | 2–3 files OR wires an existing service OR new component |
| **H** | 4 | new service/SQL/native OR touches a large file OR multi-surface |

## id allocation
Next id = PREFIX-(max existing numeric suffix for that prefix + 1), zero-padded 3;
never reused even after reject/delete.

## Tie-break
Equal priority score → higher `impact` → lower `effort` → lower `id`.

## Ranking + sprint mix
1. **Safety override:** any new P1 / regression / device-reported bug ranks first,
   drain-first, overriding the ratio.
2. Otherwise sort by `priority score` desc, tie-break as above.
3. **Mix = 85/15** (enhancement/bug) by item count, ± one per sprint, WIP-limited to
   disjoint files.
4. **Small-sprint rounding:** round bug count to nearest whole; on 0, carry a
   cross-sprint bug-debt counter (+1/skip), force-pull a bug at 2, reset.
5. **No-bug branch:** no open non-P1 bugs → 100% enhancements.

## Reconciliation + reject log
Every input candidate = exactly one of {scored row, merged-into <id>, rejected(reason),
deferred(reason)}. `input = scored + merged + rejected + deferred`. No silent drops.

## No self-score enforcement
If a candidate arrives with impact/fit/effort/priority-score filled, DISCARD those,
re-derive from this rubric, and note the violation in the reject log.

## Gates
- **Dedup:** merge same-defect candidates; keep the strongest anchor; log the loser.
- **Reject:** cosmetic-only with no failing hard gate; no anchor; already do-not-propose.
- **blocked:human:** anything `needs` = native/SQL — keep, do not auto-sprint.
- **needs-visual-confirm:** keep ranked, flag for a human check before `done`.
