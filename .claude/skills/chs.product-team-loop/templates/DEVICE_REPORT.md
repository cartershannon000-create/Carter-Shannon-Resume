# DEVICE / RUNTIME REPORT — human intake (closes the blind-spot)

> The orchestrator grades from source and **cannot see what only appears at runtime**
> (renders, motion, "feels unfinished", real-device behavior). Historically the
> highest-signal findings come from a human using the build. This makes that a
> first-class discovery source instead of out-of-band chatter.

## How to file (one block per issue)
```
SURFACE: <screen / area>
WHAT I SAW: <one line>
EXPECTED: <one line>
SEVERITY: bug | rough | nice-to-have
REPRO (if bug): <steps>
```

## What to look for (the things source-reading misses)
- Proportion/density: cramped or floating; bare text/icon acting as a button.
- Overlap/clipping: badges, pills, text colliding.
- Wrong-state graphics: does each lifecycle/conditional state show the right CTA + label?
- Dead ends: can't do the obvious next thing.
- Motion/feel: janky transitions, missing tap feedback, gestures that don't grab.

## Lifecycle of a report
1. Human files. 2. Orchestrator → `candidate` row (`evidence: device:<who>`, `lens: device`).
3. Type mapping: `bug`→bug; `rough`→bug if a functional defect else enhancement;
   `nice-to-have`→enhancement. 4. Bugs → safety-override rank (queue-jump, subject to the
   cap below). 5. Regression check: a regression of a shipped/`verified`/`done` item moves
   that item to `reopened` (exempt from do-not-propose). 6. After the fix ships, it can
   only reach `verified`/`done` once the human re-confirms (these are `needs-visual-confirm`).

## Limits & preemption
- **Queue-jump cap:** ~2 per sprint; additional non-critical reports wait for next
  planning. Multiple P1 crashes are exempt.
- **Mid-sprint preemption:** a P1 crash preempts the running sprint (finish/abort
  in-flight builders → solo hotfix sprint → resume). Non-P1/non-crash reports wait —
  the running sprint's disjoint-file batch is locked.
- **Regression + revert:** reopen the shipped item; for a P1 crash, revert the prior
  deploy first, then fix forward.
