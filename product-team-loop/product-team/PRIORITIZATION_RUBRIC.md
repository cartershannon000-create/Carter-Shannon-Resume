# PRIORITIZATION RUBRIC — product-team-loop/index.html

> priority score = (impact_pts × fit_pts) / effort_pts  Higher = do sooner.

**Feature goal (fit anchor):** clearly demonstrate the Product Team Loop skill and convert visitors to understanding/wanting to try it.

## Impact (impact_pts)
| | pts | Anchor for this page |
|---|---|---|
| **H** | 3 | fixes a broken interaction / dead end / crash OR fixes content that directly misleads a visitor about what the skill does |
| **M** | 2 | improves comprehension, scannability, or conversion for a real visitor path |
| **L** | 1 | cleanup/consistency with little comprehension or conversion impact |

## Fit (fit_pts)
| | pts | Anchor |
|---|---|---|
| **High** | 1.5 | directly helps a visitor understand or want the skill |
| **Med** | 1.0 | supports the experience, tangential to the primary explanation |
| **Low** | 0.5 | internal debt / housekeeping with no direct visitor-job tie |

## Effort (effort_pts)
| | pts | Anchor |
|---|---|---|
| **L** | 1 | single file, ≤ 10 lines, copy an existing pattern |
| **M** | 2 | 2–3 files OR wires a new CSS rule + HTML block |
| **H** | 4 | large structural change, new section, multi-file |

## id allocation
Next id = PREFIX-(max existing numeric suffix + 1), zero-padded 3; never reused.
Bug prefix: BUG. Enhancement: ENH. Debt: DEBT.

## Tie-break
Equal priority score → higher impact → lower effort → lower id.

## Reconciliation
Every input candidate = scored | merged-into <id> | rejected(reason) | deferred(reason).
input = scored + merged + rejected + deferred — no silent drops.
