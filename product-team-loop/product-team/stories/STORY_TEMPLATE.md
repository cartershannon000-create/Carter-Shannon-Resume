# <id> — <short title>

> A story a dev agent can build COLD. Carries the backlog `id` + `priority score`.
> The `priority score` = (impact×fit)÷effort from the backlog; the acceptance score
> is separate and measured at Done by the Orchestrator — never set here.

**Meta:** id `<id>` · type `<bug|enhancement|debt>` · surface `<surface>` ·
priority score `<n>` · scope `<UI-only | service:<fn> | native | SQL>` ·
files `<repo-relative paths>`

## User value
As a <user>, I want <x>, so that <y>.

## Acceptance criteria
- [ ] <testable bullet>
- [ ] <empty / loading / error state covered>
- [ ] <no regression to sibling behavior>

## Files it owns
- `<path>` — <what changes>

Must be **disjoint** from sibling stories in the same sprint. Overlap → cannot run in
parallel; sequence instead.

## Contract symbols verified
| symbol | kind (service fn / prop / type) | grep command | result |
|--------|--------------------------------|--------------|--------|
| `<symbol>` | <kind> | `rg -n "<symbol>" <path>` | found at `<file:line>` \| MISSING |

### Grep verification procedure
For EACH symbol the story depends on: run `rg -n "<symbol>" <expected path or dir>`.
PASS = at least one real *definition* match at a concrete `file:line`, recorded above
(a bare reference does not count). Any MISSING → the story is `blocked` and must NOT go
to a builder. The Orchestrator runs this before the story reaches `ready`; the proof
lives in the table above.

## Reuse pointers
- <existing pattern/component to copy, cited file:line>

## Constraints
- Brand tokens only (no hardcoded values); approved font families (no raw weights).
- No emojis. A11y: labels + adequate hit targets. Project hard gates: <list>.

## Scope tag
`<UI-only | service:<fn> | native | SQL>` — native/SQL ⇒ `blocked:human`, not auto-sprinted.

## Definition of Ready checklist
- [ ] user value + testable acceptance criteria
- [ ] disjoint files listed
- [ ] all contract symbols verified-found (table populated)
- [ ] reuse pointers + constraints + scope tag present
