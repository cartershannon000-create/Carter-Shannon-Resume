# Equity-research deck generator — agentic build plan

A defined plan for an autonomous deck generator that produces an
equity-research / investor deck from a prompt, then improves it on a
twice-daily loop without drifting from **truth**, **story**, or **visual
clarity**.

This document covers: (1) the state machine, (2) how the two rubrics are
**built and calibrated**, (3) the **Initial-Output Rubric (R1)**, (4) the
**Loop Improvement Rubric (R2)**, (5) the accept/reject math that guarantees
monotonic improvement with no truth regression, (6) the skill/agent catalog
(deterministic tools vs. LLM agents), and (7) the persisted state schemas.

---

## 1. State machine

```mermaid
flowchart TD
    Prompt["Human prompt"] --> Scope["A1 — Scope Builder\n(brief: tickers, thesis, audience, sections)"]
    Scope --> RB["A2 — Rubric Builder\n(emits R1 + R2, versioned)"]
    RB --> Pull0["A3 — Deterministic data pull\nDoc parse · Analysis · SEC/EDGAR → fact store"]
    Pull0 --> Draft["First Build (Slide-create)"]
    Draft --> R1gate{"R1 — Initial-Output Rubric\nhard gates PASS + composite >= entry bar?"}
    R1gate -->|no| Draft
    R1gate -->|yes| Render

    subgraph Loop["G2 — improvement loop (cadence: 2x/day)"]
        direction TB
        Render["Render"] --> FactCheck["Deterministic fact-check\nevery claimed figure ↔ fact store"]
        FactCheck --> Score["A4 — Scorer (LLM judge)\nR2 per-dimension + evidence"]
        Score --> Gate{"Accept logic\n(hard gates hold AND\nno protected dim regresses AND\ncomposite improves)?"}
        Gate -->|accept| Persist["Update best-so-far\n+ score history + changelog"]
        Gate -->|reject| Rollback["Restore best-so-far\nlog rejected attempt + reason"]
        Persist --> Stop{"Stop?\nscore >= ship bar OR\nmargin < ε for N iters OR\nmax iters"}
        Rollback --> Stop
        Stop -->|keep going| Plan["A4 — Planner\n(reads Score's comments,\nwrites a work order:\ntarget dim + action type)"]
        Plan -->|action: refine numbers/analysis| Pull1["A3 — re-pull or re-run analysis\n→ fact store"] --> Build
        Plan -->|action: refine story / visual / traceability| Build["A4 — Reviser\n(executes the work order)"]
        Build --> Render
        Stop -->|ship bar hit| HumanGate["Human checkpoint"]
        Stop -->|plateau below bar| Stall["Escalate: loop stuck"]
    end

    HumanGate -->|approved| Deploy["Deploy (publish)"]
    HumanGate -->|changes| Plan
    Stall --> Human2["Human revises rubric/scope\nor accepts current best"]
```

Two rubrics do two different jobs:

- **R1 (Initial-Output Rubric)** is an *acceptance gate*. It answers: "is the
  first draft good enough to be worth iterating on?" It runs **once**, between
  the first build and loop entry. Absolute thresholds, no history.
- **R2 (Loop Improvement Rubric)** is a *delta/monotonicity rubric*. It answers
  every iteration: "is this revision strictly better, and did it break any
  invariant?" It compares against best-so-far, not an absolute bar.

**The loop as a review cycle.** The Score → Plan → Build sequence is an
automation of how a research desk actually revises a deck:

- **Score** is the **senior reviewer's markup** — a structured set of comments
  against the rubric ("the thesis slide doesn't land," "this chart buries the
  number," "the margin bridge is stale").
- **Plan** is **triaging those comments into a work order.** It doesn't just
  pick *which dimension* to improve next — it decides *what kind of work* is
  needed to address the comment: refresh a number / re-run an analysis,
  restructure the narrative, redesign a visual, or improve source labeling.
  This is the step that decides whether new data needs to be pulled — driven
  by what the deck needs, not by a fixed schedule.
- **Build (Reviser)** is the **analyst doing the rework** — executing exactly
  the work order Plan wrote, nothing more. If the work order calls for new or
  re-run data, Build first invokes A3's deterministic tools (re-pull EDGAR,
  re-run the analysis model) to get fresh facts into the fact store, then
  edits the deck against those facts.

So "data refresh" isn't a separate scheduled step — it's one of the actions
Plan can prescribe, exactly like a senior reviewer telling an analyst "pull
the latest 10-Q before you touch this slide again."

---

## 2. How the rubrics are built (Rubric Builder, A2)

A rubric is only useful if its dimensions are **observable, anchored, and
calibrated**. The Rubric Builder produces both rubrics through the same
five-step method, then versions them so changes are auditable.

1. **Derive dimensions** from two sources:
   - the **brief (A1)** — audience, thesis, required sections → scope/coverage
     dimensions;
   - **domain invariants** — for finance, every number is sourced; no
     forward-looking claim without a basis. These become *hard gates*, not
     graded dimensions.
2. **Anchor each dimension** with concrete descriptors at each scale point
   (see R1/R2 tables). "Actionability = 5" must read as an observable test a
   judge can apply the same way twice, e.g. *"every section ends with a
   decision-relevant takeaway tied to the thesis."* Vague anchors are the #1
   cause of judge noise.
3. **Assign weights** reflecting the brief's priorities. Weights live in the
   rubric file, not in the judge prompt, so they can be tuned without touching
   agent code.
4. **Calibrate against gold examples.** Hand-score 3–5 reference decks
   (a strong one, a weak one, and 2–3 in between). Run the LLM judge on them
   and adjust anchors until judge scores land within ±1 point of human scores.
   This is the step that turns "LLM-as-judge" from a guess into a measurement.
5. **Validate & version.** Hold out one gold deck; require judge↔human
   agreement on it before the rubric is allowed to drive the loop. Stamp the
   rubric with a semantic version; the changelog (§7) records every rubric
   change so a score jump can be attributed to a rubric edit vs. a real deck
   improvement.

> Calibration is not optional. Without it, R2's "improvement" is just judge
> variance and the loop will happily climb noise.

---

## 3. R1 — Initial-Output Rubric (acceptance gate)

Purpose: keep junk first-drafts out of the loop. Two parts.

**3a. Hard gates (binary — all must PASS to enter the loop):**

| Gate | Pass condition |
|---|---|
| Source-of-truth | 100% of figures/claims in the draft resolve to a fact-store entry with a citation. Zero unsourced numbers. |
| Scope coverage | Every required section from the brief (A1) is present and non-empty. |
| Structural validity | Deck renders; no broken slides, no placeholder text, no TODOs. |

Any gate fail → not "low score," but **reject and rebuild**. The loop never
starts on a draft with an unsourced number.

**3b. Graded baseline (0–5 anchored; weighted composite must clear the entry bar):**

| Dimension | Weight | 0 | 3 | 5 |
|---|---|---|---|---|
| Thesis clarity | 0.30 | no discernible thesis | thesis stated, loosely supported | thesis stated up front, every section ladders to it |
| Coverage depth | 0.25 | headings only | key drivers present | drivers + risks + catalysts quantified |
| Narrative flow | 0.20 | slides unordered | logical order | story builds; each slide earns the next |
| Visual baseline | 0.15 | walls of text | readable | one idea per slide, charts where numbers belong |
| Actionability | 0.10 | descriptive only | some takeaways | clear, decision-relevant recommendation |

Entry bar: **composite ≥ 3.2 / 5** AND all hard gates PASS. Below that, the
first build is cheaper to redo than to iterate.

---

## 4. R2 — Loop Improvement Rubric (monotonic, per-iteration)

This is the rubric the user asked for: it guarantees we **increase** on the
things that matter while **never derivating from truth, the story, or the
visuals.** It splits dimensions into *protected invariants* and *improvement
targets.*

**4a. Protected invariants (must hold every iteration; regression = auto-reject):**

| Invariant | Measured by | Rule |
|---|---|---|
| **Truth / source-of-truth** | deterministic fact-check (not the LLM judge) | Every figure traces to the fact store with a matching value. Any mismatch → reject revision, roll back. Score floored to 0 on this dim. |
| **Scope adherence** | judge vs. brief (A1) | Required sections still present and on-brief. Drop in coverage below R1 level → reject. |
| **Story integrity** | judge, narrative-coherence check | The through-line from R1 must not break. A revision that improves one slide but severs the thesis chain is rejected. |
| **Visual integrity** | judge + render lint | No new walls of text, no overflow, no chart removed that carried a number. Visual score may not drop below its accepted best. |

These are *floors*, not climb targets. They can stay flat; they may never go
down. This is what enforces "do not derive from truth, story, or visuals."

**4b. Improvement targets (0–5 anchored; the loop hill-climbs the weighted composite):**

| Dimension | Weight | What "5" looks like (anchor) |
|---|---|---|
| **Actionability** | 0.30 | Every section ends in a decision-relevant takeaway tied to the thesis; reader knows what to *do*, not just what *is*. |
| **Visual digestibility** | 0.25 | Each slide graspable in <10s: one idea, the right chart type, hierarchy guides the eye, minimal text. |
| **Clean & concise story** | 0.25 | Tight through-line, no redundant slides, each builds on the last; could be read aloud as a coherent argument. |
| **Metric traceability quality** | 0.20 | Beyond merely *passing* the truth gate: every metric is *labeled* with its source, period, and units inline, so the reader can self-verify. |

> Note the split on numbers: the **truth invariant (4a)** is a binary
> deterministic gate — "does this number exist in the fact store?" The
> **traceability dimension (4b)** is a graded quality target — "is the number
> *presented* so a reader can trace it?" The first prevents fabrication; the
> second is a thing we actively get better at.

**Composite:** `R2 = 0.30·Action + 0.25·Visual + 0.25·Story + 0.20·Trace`,
on the [0,5] scale, computed **only when all 4a invariants hold.**

---

## 5. Accept / reject math (the monotonicity guarantee)

Let `b` = best-so-far snapshot, `c` = candidate revision. Per-dimension scores
from R2's improvement targets are `s_d`; invariant flags from 4a are booleans.

**Accept `c` iff ALL of:**

1. **Invariants hold:** every 4a check on `c` PASSes (truth, scope, story,
   visual integrity). One fail → reject.
2. **No protected regression:** for each invariant dimension that carries a
   score (story, visual), `s_d(c) ≥ s_d(b) − τ`, with tolerance `τ = 0`
   for truth/scope and a small `τ = 0.1` for story/visual to allow lossless
   restructuring.
3. **Strict improvement:** `R2(c) ≥ R2(b) + δ` where `δ` is the minimum
   meaningful margin (e.g. `δ = 0.15`), so we don't accept judge noise.

Otherwise **roll back to `b`** and log the rejected attempt + reason. This is
hill-climbing with rollback: the composite is monotonically non-decreasing
across accepted iterations, and the invariants are monotonically protected.

**Stop conditions (any one):**

- **Ship:** `R2(b) ≥ ship_bar` (e.g. 4.3) AND all invariants PASS → human gate.
- **Plateau:** no accepted revision for `N` consecutive iterations
  (margin < δ) → escalate as stalled.
- **Budget:** `max_iters` reached → ship best-so-far to human gate.

Because every accepted step strictly increases the composite while holding the
floors, "the loop improves actionability / visual / story / traceability and
never sacrifices truth or coherence" is now a property the math enforces, not
a hope.

---

## 6. Skill / agent catalog

The system is a small set of **single-responsibility skills, each its own
agent.** They fall into two classes, and the split is deliberate:

- **Deterministic tools** are plain code (e.g. Python). Same input → same
  output, no LLM in the path. These own anything that must be **reproducible
  and trustworthy** — pulling numbers, computing analysis, verifying figures,
  rendering, and the scoring arithmetic. They are the **source of truth.**
- **LLM agents** are where **judgment** is required — writing prose, deciding
  what's weak, refining a story. They never produce a raw number that wasn't
  handed to them by a deterministic tool, and they never get the final say on
  factual accuracy.

Each skill is invoked as a separate agent with explicit inputs/outputs so it
can be built, tested, swapped, and reasoned about in isolation.

### 6a. Deterministic tools (code — the source of truth)

| Skill | Responsibility | Input → Output |
|---|---|---|
| **T1 EDGAR/SEC fetcher** | Pull filings (10-K, 10-Q, 8-K) by ticker/CIK; cache raw | ticker/CIK, form types → raw filing docs |
| **T2 Document parser** | Extract tables & text from filings and uploaded docs | raw docs → structured rows/figures |
| **T3 Analysis engine** | Compute ratios, growth, margins, bridges from parsed figures | parsed figures → derived metrics |
| **T4 Fact-store writer** | Normalize every figure into a traceable record | metrics → `fact_store{id, metric, value, unit, period, source_url, retrieved_at}` |
| **T5 Fact-check / number-tracer** | Confirm every `fact_id`-tagged figure in the deck equals its fact-store value | deck + fact_store → pass/fail per figure |
| **T6 Renderer** | Turn the deck spec into rendered slides | deck spec → rendered deck |
| **T7 Render lint** | Detect overflow, walls of text, broken/empty slides | rendered deck → visual-integrity flags |
| **T8 Score aggregator** | Apply rubric weights, compute composite, run the accept/reject math (§5) | per-dim scores + invariant flags → composite + accept/reject decision |

> Why deterministic: numbers, verification, and the accept/reject decision must
> be **reproducible and auditable.** If an LLM did the arithmetic or the
> figure-matching, "the loop never sacrifices truth" couldn't be guaranteed.

### 6b. LLM agents (judgment)

| Skill | Responsibility | Input → Output |
|---|---|---|
| **L1 Scope Builder (A1)** | Interpret the prompt into a frozen brief | prompt → `brief{tickers, thesis, audience, required_sections[], tone}` |
| **L2 Rubric Builder (A2)** | Author + calibrate R1/R2 (§2) | brief → versioned `R1`, `R2` (weights + anchors) |
| **L3 Drafter / Slide-create** | Write the deck from the brief and fact store; tag every figure with its `fact_id` | brief + fact_store → `deck{slides[]}` |
| **L4 Reviewer / Scorer** | **Review the deck and produce a ranked list of its weakest parts** — per-dimension scores against R2, plus specific comments pointing at the slide/element and why it's weak | deck + R2 + fact_store → `review{per_dim_scores, weakest_parts[ranked], comments}` |
| **L5 Planner** | Triage the reviewer's weakest-parts list into one focused **work order** | review → `work_order{target_dim, action_type, instructions}`, `action_type ∈ {refresh_data, refine_analysis, refine_story, refine_visual, refine_traceability}` |
| **L6 Reviser** | **Execute the work order** — fix/refine exactly the parts called out, nothing more | deck + work_order + fact_store → revised deck (figures still `fact_id`-tagged) |

### 6c. The two rules that hold it together

1. **Reviewer ≠ Reviser.** The agent that *finds* the weakest parts (L4) is a
   different agent from the one that *fixes* them (L6). A critic grading its own
   rework drifts toward self-justification; separating them keeps the diagnosis
   honest and gives the loop a clean diff between "what was flagged" and "what
   was changed." L4 only describes problems; L6 only fixes the assigned one.

2. **LLMs never own a number.** Every figure originates in a deterministic tool
   (T1–T4), is verified by another (T5), and is only ever *arranged* by an LLM.
   When the Planner asks for fresh data, the Reviser calls the same T1–T4 tools
   the cold start used — it does not invent values to fill the gap.

---

## 7. Persisted state (loop memory)

```jsonc
// best_so_far.json — the current champion
{ "deck": { /* slides with fact_id tags */ },
  "r2": { "action": 4.1, "visual": 3.8, "story": 4.0, "trace": 3.9,
          "composite": 3.98, "invariants": {"truth": true, "scope": true,
          "story_integrity": true, "visual_integrity": true} },
  "rubric_version": "r2-1.2.0", "iter": 7 }

// score_history.jsonl — one line per iteration (accepted or rejected)
{ "iter": 8, "ts": "...", "accepted": false, "reason": "trace 3.9→3.7 regression",
  "candidate_r2": {...}, "target_dim": "trace" }

// changelog.jsonl — what each accepted revision changed and why
{ "iter": 7, "target_dim": "visual", "action_type": "refine_visual",
  "change": "split text slide 4 into chart + callout",
  "composite": "3.83→3.98", "rubric_version": "r2-1.2.0" }

// data_refresh_log.jsonl — every time the Planner triggered new/re-run data
{ "iter": 12, "action_type": "refresh_data", "reason": "trace score flagged stale margin bridge",
  "facts_updated": ["fact_0231", "fact_0245"], "source": "EDGAR 10-Q 2026Q1" }
```

Score history lets us tell improvement from noise and roll back; the changelog
explains *why* the deck looks the way it does after dozens of twice-daily runs;
stamping `rubric_version` on every row means a score jump caused by a rubric
edit is never mistaken for a real deck improvement.

---

## 8. Open decisions to confirm before building

- **Thresholds:** entry bar (3.2), ship bar (4.3), margin δ (0.15), plateau N,
  max_iters — these are starting guesses; calibrate on the first few real runs.
- **Weights:** R2 weights (0.30/0.25/0.25/0.20) reflect "actionability first";
  adjust to the audience.
- **Planner action taxonomy:** the four `action_type`s (refresh_data,
  refine_analysis, refine_story, refine_visual, refine_traceability) are a
  starting set — confirm they cover the kinds of comments a senior reviewer
  actually gives, and that each maps cleanly to a tool the Reviser/A3 can run.
- **Judge model & determinism:** fix temperature low and pin the model so
  score history is comparable across iterations.
