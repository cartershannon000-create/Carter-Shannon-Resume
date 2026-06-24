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
| BUG-002 | bug | live-demo | Fix play() resetting to scene 0 at end instead of resuming from pause | H | High | L | product-team-loop/index.html | 4.5 | in-sprint | index.html:1108 | UI | runtime |
| BUG-003 | bug | live-demo | Fix Next/Back buttons: no disabled state at boundaries; silent no-op confuses users | H | High | L | product-team-loop/index.html | 4.5 | in-sprint (merged into BUG-002 story) | index.html:1110-1111 | UI | runtime |
| ENH-002 | enhancement | loopband | Add role="tab" and aria-selected to prodbar tab buttons | H | High | L | product-team-loop/index.html | 4.5 | in-sprint | index.html:403-405 | UI | gates |
| BUG-006 | bug | loopband | Fix mpath href="#orbit" to xlink:href for SVG spec compliance | M | High | L | product-team-loop/index.html | 3.0 | prioritized | index.html:451-452 | UI | runtime |
| ENH-003 | enhancement | loopband | Increase retchip hit target from ~22px to 44px minimum | M | High | L | product-team-loop/index.html | 3.0 | in-sprint | index.html:125 | UI | gates |
| ENH-004 | enhancement | footer | Increase footer copyright text contrast from 28% opacity | M | High | L | product-team-loop/index.html | 3.0 | prioritized | index.html:352 | UI | gates |
| ENH-005 | enhancement | live-demo | Make timeline dt-item visually discoverable as clickable (cursor + hover state) | M | High | L | product-team-loop/index.html | 3.0 | prioritized | index.html:978-987 | UI | flow |
| ENH-009 | enhancement | cross | Add og:title, og:description, og:image, twitter:card meta tags | M | High | L | product-team-loop/index.html | 3.0 | in-sprint | index.html:1-31 | UI | coverage |
| ENH-010 | enhancement | hero | Mention Replenish step in hero lead copy so key differentiator is visible above the fold | M | High | L | product-team-loop/index.html | 3.0 | in-sprint | index.html:417-425 | UI | coverage |
| BUG-001 | bug | live-demo | Fix scheduleAuto closure capturing global di; causes double-advance on rapid nav | H | High | M | product-team-loop/index.html | 2.3 | prioritized | index.html:1100-1106 | UI | runtime |
| BUG-004 | bug | live-demo | Fix timeline click listeners not cleaned before DOM rebuild on restart | H | High | M | product-team-loop/index.html | 2.3 | prioritized | index.html:979-984 | UI | runtime |
| BUG-005 | bug | live-demo | Fix demo tab-switch: guard autoplay race and clear orphaned timer within 400ms window | H | High | M | product-team-loop/index.html | 2.3 | prioritized | index.html:920 | UI | runtime |
| ENH-001 | enhancement | loopband | Add aria-label to ring node buttons and aria-hidden to decorative SVG icons | H | High | M | product-team-loop/index.html | 2.3 | prioritized | index.html:461-482 | UI | gates |
| ENH-006 | enhancement | live-demo | Add forward CTA after demo scene 8 ends; prevent visitor dead end | H | High | M | product-team-loop/index.html | 2.3 | prioritized | index.html:867-901 | UI | flow |
| BUG-007 | bug | live-demo | Fix speed control mid-animation not rescheduling typePrompt interval | M | High | M | product-team-loop/index.html | 1.5 | prioritized | index.html:1119-1122 | UI | runtime |
| ENH-007 | enhancement | prioritize-sprint | Rename orphaned Phase 2 / Phase 4 labels to consistent Stage 02 / Stage 03 naming | L | Med | L | product-team-loop/index.html | 1.0 | prioritized | index.html:638,646 | UI | consistency |
| ENH-008 | enhancement | loopband | Add partial-sprint guarantee to Sprint hover callout in calloutInfo JS | L | Med | L | product-team-loop/index.html | 1.0 | prioritized | index.html:931-932 vs 525 | UI | consistency |
| DEBT-001 | debt | cross | Replace hardcoded hex colors (#294323 #243f52 #7a5424 #d8e1cd etc.) with CSS variables | L | Low | H | product-team-loop/index.html | 0.1 | prioritized | index.html:73,76,122,127 | UI | consistency |

## Sprint log
(none yet)

## Do-not-propose set
All backlog rows of any status except `reopened` + sprint log entries above.
