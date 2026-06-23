---
name: chs.De-AI-Language
description: >
  Find and remove "AI tells" from any body of text — a website, app, codebase,
  marketing copy, PDF, or doc. A deterministic scanner flags em/en dashes, curly
  quotes, emoji, contractions, and a list of generic AI cliché words/phrases at
  ZERO token cost; safe character-level tells are auto-fixed mechanically; then
  fresh Sonnet subagents rewrite only the flagged language so it reads like a
  human wrote it. Trigger when the user says "make this not sound like AI",
  "de-AI this", "scrub AI text", "remove em dashes / AI phrases", "humanize this
  copy", or wants an entire product reviewed for AI-sounding language.
---

# chs.De-AI-Language

Strip the tells that make text read as AI-generated, across a whole product if
needed, without burning tokens. **You are the orchestrator.** Detection and the
trivial fixes are mechanical (a Python script, no LLM). You only spend model
tokens on the judgment part: rewriting flagged *language*. Use **Sonnet** for the
rewrite subagents — it is plenty for this and keeps it fast/cheap.

## The optimization contract (why this is cheap)

1. **Detection is free.** `scan.py` finds every tell with regex — zero tokens,
   scales to an entire repo/site/PDF.
2. **Trivial fixes are free.** `scan.py --fix` mechanically normalizes curly
   quotes, emoji, ellipsis chars, non-breaking spaces (and dashes with
   `--fix-dashes`). No model needed.
3. **You never read whole files.** For the remaining *language* hits, you pass a
   subagent only the file path + the flagged line numbers/snippets. The agent
   reads and edits; you stay lean.
4. **Batch by file, fresh agent per batch.** One Sonnet agent per file (or a
   small group of files), each returning a ≤12-line changelog — never the file.

## What counts as an "AI tell"

- **Punctuation:** em dash `—`, en dash `–`, curly quotes, `…`, non-breaking space.
- **Emoji** (also matches the user's no-emoji brand rule).
- **Contractions** (flagged by default; `--no-contractions` to skip).
- **Generic AI language:** the cliché word/phrase list in
  `patterns/ai_phrases.txt` — *edit that file to tune what gets flagged.*
- **Constructions:** "it's not just X, it's Y", "not only … but also".

## Workflow

### 1. Scope it (cheap)
Confirm what to scan and whether files can be edited in place. Targets:
- **Code/docs/site source** → a path or globs. Pass tight paths (e.g. the copy
  dir, `*.md`, the components folder) rather than the whole repo to stay focused.
- **Live website** → `python3 scan.py --url https://…` (scans raw HTML; produce a
  cleaned copy rather than editing, since there's no local file).
- **PDF** → scanned via `pdftotext`/`pypdf` if available; PDFs are detect-only —
  output a cleaned `.md`/`.txt`, don't try to rewrite the binary.

### 2. Inventory (free)
Run the scanner for a machine-readable map. Resolve the script path from this
skill's directory:
```
python3 <skill>/scan.py <paths> --json --out /tmp/aiscrub.json
```
Read the JSON `by_rule` / `language_hits` summary — not every snippet. If hits
are huge, report counts and confirm scope before rewriting.

### 3. Mechanical pass (free)
Clear the safe character-level tells in place:
```
python3 <skill>/scan.py <paths> --fix          # quotes, emoji, ellipsis, nbsp
python3 <skill>/scan.py <paths> --fix --fix-dashes   # + naive dash→hyphen
```
Use `--fix-dashes` only if naive `—`→`-` is acceptable; otherwise leave dashes
for the rewrite agent (better grammar). Re-running `--fix` re-scans, so the JSON
you read next reflects only what still needs a human-style rewrite.

### 4. Rewrite pass (Sonnet subagents — the only token spend)
Re-scan to get the remaining `language` hits grouped by file. For each file (or
a small batch), spawn **one fresh Sonnet agent** with a brief like:

> Rewrite the flagged spans in `<path>` so the text no longer reads as
> AI-generated. Flagged lines: `<line:rule:snippet list>`. Rules: remove em/en
> dashes (restructure the sentence — don't just swap punctuation), replace the
> cliché words/phrases with plain specific wording, and recast contractions per
> the user's preference. **Preserve meaning, facts, formatting, and the author's
> voice. Change only what's flagged or directly adjacent.** Edit the file in
> place. Return a ≤12-line changelog of what you changed — no file contents.

Run independent file-agents in parallel. Never paste file bodies into your own
context; the agent reads and edits.

### 5. Verify
Re-run `scan.py <paths>` (no `--fix`). Exit code `0` and `language_hits: 0` means
clean. Report a short summary: files touched, tells removed by rule, anything you
deliberately left (e.g. contractions the user wanted kept, possessive `'s` that
the contraction rule false-flagged).

## Tuning

- **What's "AI language"** lives entirely in `patterns/ai_phrases.txt` — add the
  user's pet-peeve words, remove ones they like.
- **Contractions:** the rule also matches possessives (`John's`). The rewrite
  agent should keep legitimate possessives; only flag-driven cleanup, not blind
  deletion. If the user actually *wants* contractions (natural human voice), run
  with `--no-contractions`.
- **False positives** in code (e.g. `—` inside a regex, emoji in test data) — scope
  paths to content files, or have the agent skip non-prose matches.
