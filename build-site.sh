#!/usr/bin/env bash
# Stage the publishable site into dist/ for Cloudflare Workers Builds.
#
# Why this exists
# ---------------
# `assets.directory` used to be ".", which uploaded the entire repository —
# including .git. Workers rejects any single asset over 25 MiB, and once
# media/sckg-omnisupply-film.mp4 landed, a fresh CI clone's pack file crossed
# it:
#
#   ERROR Asset too large. We found a file
#   /opt/buildhome/repo/.git/objects/pack/pack-….pack with a size of 31.3 MiB.
#
# Every build from 891250a onward failed on that, so cs-ventures.us silently
# stopped updating while GitHub Pages kept building fine from the same commits.
# `.assetsignore` was tried first and wrangler 4.86 ignored it completely (file
# count went 1499 -> 1500, i.e. it only counted the ignore file itself), so the
# staging directory is the fix that actually holds.
#
# What gets published
# -------------------
# Exactly the git-tracked files, minus the directories below. Using `git
# ls-files` rather than a copy-and-delete means an untracked scratch file can
# never reach production by accident.
set -euo pipefail

OUT="dist"
# Infrastructure and source that has no business being on the web.
#
# `financials` holds the pipeline that builds the dashboard, not the dashboard
# itself. Publishing it would put build_financial_dashboard.py on the web, and
# CATEGORY_RULES in that file is a list of every merchant Carter shops at. The
# served artefact is dev/login/financials-frame.html, which is generated from it
# and carries no data.
EXCLUDE_RE='^(supabase|tests|docs|financials|\.claude|\.github|\.worktrees)/'

rm -rf "$OUT"
mkdir -p "$OUT"

count=0
skipped=0
while IFS= read -r -d '' f; do
  if [[ "$f" =~ $EXCLUDE_RE ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  mkdir -p "$OUT/$(dirname "$f")"
  cp "$f" "$OUT/$f"
  count=$((count + 1))
done < <(git ls-files -z)

# Guard the failure that caused all this: never ship an oversized asset again.
big=$(find "$OUT" -type f -size +25M -print)
if [[ -n "$big" ]]; then
  echo "ERROR: asset(s) over the Workers 25 MiB limit:" >&2
  echo "$big" | while read -r b; do echo "  $(du -h "$b")" >&2; done
  exit 1
fi

echo "staged $count files into $OUT/ ($skipped excluded), largest:"
find "$OUT" -type f -exec du -h {} + | sort -rh | head -3
