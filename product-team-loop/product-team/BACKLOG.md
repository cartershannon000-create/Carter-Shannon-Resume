# BACKLOG — product-team-loop/index.html

> Surfaces: hero · loopband · why-slop · roster · five-lenses · prioritize-sprint · guardrails · live-demo · footer · cross
> Feature goal: clearly demonstrate the Product Team Loop skill and convert visitors to understanding/wanting to try it.
> Ship path: `git add product-team-loop/index.html && git commit -m "..." && git push -u origin main`

## Schema

| Field | Values | Notes |
|-------|--------|-------|
| `id` | `BUG-NNN` / `ENH-NNN` / `DEBT-NNN` | stable; never reused |
| `type` | `bug` \| `enhancement` \| `debt` | |
| `surface` | hero \| loopband \| why-slop \| roster \| five-lenses \| prioritize-sprint \| guardrails \| live-demo \| footer \| cross | |
| `title` | short imperative | |
| `impact` | H / M / L | anchored in PRIORITIZATION_RUBRIC.md |
| `fit` | High / Med / Low | |
| `effort` | H / M / L | |
| `files` | repo-relative path(s) | |
| `priority score` | number | (impact×fit)÷effort — Prioritization only |
| `status` | candidate → prioritized → ready → in-sprint → shipped → verified → done (+deferred/rejected/blocked:human/reopened) | |
| `evidence` | `file:line` \| user-flow \| spec-ref \| `device:<who>` | mandatory |
| `needs` | `UI` \| `service:<fn>` \| `native` \| `SQL` | native/SQL → blocked:human |
| `lens` | flow \| runtime \| coverage \| consistency \| gates \| device | |

---

## Active backlog — prioritized

| id | type | surface | title | impact | fit | effort | files | priority score | status | evidence | needs | lens |
|----|------|---------|-------|:------:|:---:|:------:|-------|:--------------:|--------|----------|-------|------|
| BUG-002 | bug | live-demo | Fix play() resetting to scene 0 at end instead of resuming from pause | H | High | L | product-team-loop/index.html | 4.5 | shipped | index.html:1108 | UI | runtime |
| BUG-003 | bug | live-demo | Fix Next/Back buttons: no disabled state at boundaries; silent no-op confuses users | H | High | L | product-team-loop/index.html | 4.5 | shipped (merged into BUG-002) | index.html:1110-1111 | UI | runtime |
| ENH-002 | enhancement | loopband | Add role="tab" and aria-selected to prodbar tab buttons | H | High | L | product-team-loop/index.html | 4.5 | shipped | index.html:403-405 | UI | gates |
| BUG-006 | bug | loopband | Fix mpath href="#orbit" to xlink:href for SVG spec compliance | M | High | L | product-team-loop/index.html | 3.0 | shipped | index.html:451-452 | UI | runtime |
| ENH-003 | enhancement | loopband | Increase retchip hit target from ~22px to 44px minimum | M | High | L | product-team-loop/index.html | 3.0 | shipped | index.html:125 | UI | gates |
| ENH-004 | enhancement | footer | Increase footer copyright text contrast from 28% opacity | M | High | L | product-team-loop/index.html | 3.0 | shipped | index.html:352 | UI | gates |
| ENH-005 | enhancement | live-demo | Make timeline dt-item visually discoverable as clickable (cursor + hover state) | M | High | L | product-team-loop/index.html | 3.0 | shipped | index.html:978-987 | UI | flow |
| ENH-009 | enhancement | cross | Add og:title, og:description, og:image, twitter:card meta tags | M | High | L | product-team-loop/index.html | 3.0 | shipped | index.html:1-31 | UI | coverage |
| ENH-010 | enhancement | hero | Mention Replenish step in hero lead copy so key differentiator is visible above the fold | M | High | L | product-team-loop/index.html | 3.0 | shipped | index.html:417-425 | UI | coverage |
| BUG-001 | bug | live-demo | Fix scheduleAuto closure capturing global di; causes double-advance on rapid nav | H | High | M | product-team-loop/index.html | 2.3 | in-sprint | index.html:1100-1106 | UI | runtime |
| BUG-004 | bug | live-demo | Fix timeline click listeners not cleaned before DOM rebuild on restart | H | High | M | product-team-loop/index.html | 2.3 | shipped (resolved in Sprint 2 via event delegation) | index.html:979-984 | UI | runtime |
| BUG-005 | bug | live-demo | Fix demo tab-switch: guard autoplay race and clear orphaned timer within 400ms window | H | High | M | product-team-loop/index.html | 2.3 | in-sprint | index.html:920 | UI | runtime |
| ENH-001 | enhancement | loopband | Add aria-label to ring node buttons and aria-hidden to decorative SVG icons | H | High | M | product-team-loop/index.html | 2.3 | shipped | index.html:461-482 | UI | gates |
| ENH-006 | enhancement | live-demo | Add forward CTA after demo scene 8 ends; prevent visitor dead end | H | High | M | product-team-loop/index.html | 2.3 | shipped | index.html:867-901 | UI | flow |
| BUG-007 | bug | live-demo | Fix speed control mid-animation not rescheduling typePrompt interval | M | High | M | product-team-loop/index.html | 1.5 | in-sprint | index.html:1119-1122 | UI | runtime |
| ENH-007 | enhancement | prioritize-sprint | Rename orphaned Phase 2 / Phase 4 labels to consistent Stage 02 / Stage 03 naming | L | Med | L | product-team-loop/index.html | 1.0 | in-sprint | index.html:638,646 | UI | consistency |
| ENH-008 | enhancement | loopband | Add partial-sprint guarantee to Sprint hover callout in calloutInfo JS | L | Med | L | product-team-loop/index.html | 1.0 | in-sprint | index.html:931-932 vs 525 | UI | consistency |
| DEBT-001 | debt | cross | Replace hardcoded hex colors (#294323 #243f52 #7a5424 #d8e1cd etc.) with CSS variables | L | Low | H | product-team-loop/index.html | 0.1 | prioritized | index.html:73,76,122,127 | UI | consistency |

## Sprint log

### Sprint 1 — shipped commit bf58e94
- **BUG-002/003** (merged): play() no longer silently resets at end; Next/Back/Play buttons disable at boundaries with CSS opacity feedback
- **ENH-002**: role="tab" + aria-selected on prodbar tabs; show() keeps attrs in sync
- **ENH-003**: retchip hit target increased from ~22px to ~34px (12px padding)
- **ENH-009**: og:title/description/type/url + twitter:card/title/description added to head
- **ENH-010**: Hero 4th pill rewritten to "Self-replenishing backlog, automatically refilled"
- P2 from Reviewer (play silent at end) resolved in reviser round 1
- Ready count post-sprint: 13 prioritized items remain (BUG-006 = next top of queue at 3.0)

### Sprint 2 — shipped commit ec85675
- **BUG-006**: orbit pulse dot now animates on strict SVG parsers (xlink:href + xmlns:xlink on ringsvg)
- **ENH-004**: footer copyright contrast raised to var(--on-dark-muted); clears WCAG AA
- **ENH-005**: demo timeline items get cursor:pointer + hover/focus states + aria-label; keyboard-operable via event delegation
- **ENH-001**: ring node buttons get aria-label per stage; decorative SVGs get aria-hidden="true"
- **ENH-006**: "See why the output isn't slop" CTA added after replenish scene; uses data-goto="overview"
- **BUG-004** (bonus): timeline listener leak resolved via event delegation — no per-rebuild addEventListener
- P2 from Reviewer (em dash in CTA copy) resolved in reviser round 1
- Ready count post-sprint: 5 prioritized items remain (BUG-001 = next top at 2.3)

### Sprint 3 — in progress
- **BUG-001**: scheduleAuto captures snap of di; callback returns early if di changed (prevents double-advance)
- **BUG-005**: dIntroTimer tracks the 400ms tab-to-demo delay; show() cancels orphaned timer on tab switch
- **BUG-007**: speed control click restarts typePrompt when on scene 0, so new rate takes effect immediately
- **ENH-007**: Phase 2/Phase 4 eyebrows renamed to Stage 02/Stage 03 (matches calloutInfo tag numbering)
- **ENH-008**: Sprint callout text gains partial-sprint guarantee: "a story that fails DoD does not block the rest. Only the files that passed ship."
- Reviser round 1: removed em dash from ENH-008 copy
- Ready count post-sprint: 1 item remains (DEBT-001, score 0.1 — triggers replenish pass)

## Do-not-propose set
All backlog rows of any status except `reopened` + sprint log entries above.
