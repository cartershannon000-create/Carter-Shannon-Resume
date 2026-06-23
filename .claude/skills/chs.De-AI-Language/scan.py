#!/usr/bin/env python3
"""
ai-text-scrub scanner — find (and optionally mechanically fix) AI-tell text.

Detection is 100% deterministic (regex) so it costs ZERO LLM tokens, even across
a whole product. The LLM is only needed afterward to rewrite the flagged
*language* spans this script can't safely auto-fix.

Usage:
  scan.py PATH [PATH ...]            # scan files/dirs, print grouped report
  scan.py PATH --json               # machine-readable output (for orchestrator)
  scan.py PATH --json --out f.json  # write JSON to a file
  scan.py PATH --fix                # apply SAFE mechanical fixes in place
  scan.py PATH --fix --fix-dashes   # also naively replace em/en dashes
  scan.py --url https://site.com    # fetch + scan raw HTML (stdlib only)
  scan.py PATH --no-contractions    # don't flag contractions

Exit code: 0 = clean (no language-level hits), 1 = hits found.
"""
import argparse, json, os, re, sys, unicodedata, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

# Files worth scanning for human-facing text. Code files are included because UI
# strings / comments live there too; scope with explicit paths to stay tight.
TEXT_EXT = {
    ".md", ".mdx", ".markdown", ".txt", ".rst",
    ".html", ".htm", ".xml", ".json", ".yaml", ".yml",
    ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".java", ".swift",
    ".css", ".scss", ".vue", ".svelte",
}
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".next", "__pycache__",
             ".venv", "venv", "vendor", ".expo", "ios/Pods", "Pods"}

# Character-level tells that are SAFE to fix mechanically (no grammar judgment).
CHAR_FIXES = {
    "‘": "'", "’": "'",            # curly single quotes
    "“": '"', "”": '"',            # curly double quotes
    "…": "...",                          # ellipsis char
    " ": " ",                            # non-breaking space
    "​": "",                             # zero-width space
    "–": "-",                            # en dash (only when --fix-dashes)
    "—": "-",                            # em dash (only when --fix-dashes)
}

EMOJI_RE = re.compile(
    "[" "\U0001F300-\U0001FAFF" "\U00002600-\U000027BF"
    "\U0001F000-\U0001F0FF" "\U00002B00-\U00002BFF"
    "\U0001F1E6-\U0001F1FF" "\U0000FE00-\U0000FE0F" "\U00002190-\U000021FF" "]"
)

def load_phrases():
    path = os.path.join(HERE, "patterns", "ai_phrases.txt")
    out = []
    if os.path.exists(path):
        for ln in open(path, encoding="utf-8"):
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                out.append(ln)
    return out

def build_rules(contractions=True):
    phrases = load_phrases()
    rules = [
        ("em_dash",       re.compile(r"—")),
        ("en_dash",       re.compile(r"–")),
        ("curly_quote",   re.compile(r"[‘’“”]")),
        ("ellipsis_char", re.compile(r"…")),
        ("nbsp",          re.compile(r" ")),
        ("emoji",         EMOJI_RE),
        ("not_just_but",  re.compile(r"\bit['’]?s not (just|only)\b.*?\bit['’]?s\b", re.I)),
        ("not_only",      re.compile(r"\bnot only\b.{0,60}\bbut also\b", re.I)),
    ]
    if phrases:
        # one alternation rule for the editable cliché list
        alt = "|".join(re.escape(p) for p in phrases)
        rules.append(("ai_phrase", re.compile(r"\b(?:%s)\b" % alt, re.I)))
    if contractions:
        # word'word — catches don't, it's, you're (and possessives; reviser judges)
        rules.append(("contraction", re.compile(r"\b[A-Za-z]+['’][A-Za-z]+\b")))
    return rules

def iter_files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
        elif os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for f in files:
                    if os.path.splitext(f)[1].lower() in TEXT_EXT:
                        yield os.path.join(root, f)

def read_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return read_pdf(path)
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except Exception:
        return None

def read_pdf(path):
    import subprocess, shutil
    if shutil.which("pdftotext"):
        try:
            return subprocess.run(["pdftotext", "-layout", path, "-"],
                                  capture_output=True, text=True).stdout
        except Exception:
            pass
    try:
        from pypdf import PdfReader  # type: ignore
        return "\n".join((pg.extract_text() or "") for pg in PdfReader(path).pages)
    except Exception:
        sys.stderr.write("warn: cannot extract %s (need pdftotext or pypdf)\n" % path)
        return None

# rules that need LLM judgment to rewrite (everything that isn't a pure char swap)
LANGUAGE_RULES = {"ai_phrase", "not_just_but", "not_only", "contraction",
                  "em_dash", "en_dash"}

def scan_text(text, rules):
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        for name, rx in rules:
            for m in rx.finditer(line):
                hits.append({
                    "line": i, "col": m.start() + 1, "rule": name,
                    "match": m.group(0)[:40],
                    "snippet": line.strip()[:160],
                })
    return hits

def mechanical_fix(text, fix_dashes):
    n = 0
    for ch, rep in CHAR_FIXES.items():
        if ch in ("–", "—") and not fix_dashes:
            continue
        c = text.count(ch)
        if c:
            text = text.replace(ch, rep)
            n += c
    new = EMOJI_RE.sub("", text)
    n += sum(1 for _ in EMOJI_RE.finditer(text))
    return new, n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--url")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--fix", action="store_true", help="apply safe mechanical fixes in place")
    ap.add_argument("--fix-dashes", action="store_true", help="also replace em/en dashes mechanically")
    ap.add_argument("--no-contractions", action="store_true")
    args = ap.parse_args()

    rules = build_rules(contractions=not args.no_contractions)

    # --url: fetch raw HTML, scan only (no fix target on disk)
    if args.url:
        req = urllib.request.Request(args.url, headers={"User-Agent": "ai-text-scrub"})
        text = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
        sources = [(args.url, text)]
    else:
        if not args.paths:
            ap.error("provide PATH(s) or --url")
        sources = [(f, read_text(f)) for f in iter_files(args.paths)]
        sources = [(f, t) for f, t in sources if t is not None]

    report = {"files": [], "by_rule": {}, "files_scanned": len(sources),
              "files_with_hits": 0, "total_hits": 0, "language_hits": 0,
              "mechanical_fixed": 0}

    for path, text in sources:
        if args.fix and not args.url and not path.lower().endswith(".pdf"):
            new, n = mechanical_fix(text, args.fix_dashes)
            if n:
                open(path, "w", encoding="utf-8").write(new)
                report["mechanical_fixed"] += n
                text = new  # re-scan the fixed text for remaining language hits

        hits = scan_text(text, rules)
        if not hits:
            continue
        report["files_with_hits"] += 1
        report["total_hits"] += len(hits)
        for h in hits:
            report["by_rule"][h["rule"]] = report["by_rule"].get(h["rule"], 0) + 1
            if h["rule"] in LANGUAGE_RULES:
                report["language_hits"] += 1
        report["files"].append({"path": path, "hits": hits})

    if args.json:
        out = json.dumps(report, indent=2)
        if args.out:
            open(args.out, "w").write(out)
            print("wrote %s" % args.out)
        else:
            print(out)
    else:
        print_report(report, args.fix)

    return 1 if report["language_hits"] else 0

def print_report(r, fixed):
    if fixed and r["mechanical_fixed"]:
        print("mechanically fixed: %d char-level tells (quotes/emoji/ellipsis%s)\n"
              % (r["mechanical_fixed"], "/dashes" if True else ""))
    print("scanned %d files | %d with hits | %d total hits | %d need LLM rewrite\n"
          % (r["files_scanned"], r["files_with_hits"], r["total_hits"], r["language_hits"]))
    if r["by_rule"]:
        print("by rule:")
        for k, v in sorted(r["by_rule"].items(), key=lambda x: -x[1]):
            print("  %-14s %d" % (k, v))
        print()
    for f in r["files"]:
        print(f["path"])
        for h in f["hits"][:50]:
            print("  %d:%d  [%s]  %s" % (h["line"], h["col"], h["rule"], h["snippet"]))
        if len(f["hits"]) > 50:
            print("  ... +%d more" % (len(f["hits"]) - 50))
        print()

if __name__ == "__main__":
    sys.exit(main())
