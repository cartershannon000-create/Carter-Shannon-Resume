"""Generate dev/login/financials-frame.html for the CS Ventures control plane.

The dashboard's rendering -- ~1,650 lines of charts, tables, and the monthly matrix --
is already written and validated in build_financial_dashboard.render_html(). Rather than
re-implement it inside app.js, this takes that exact output and rewires three things so
it can live in a same-origin iframe and be driven by Supabase:

  1. `const DATA = {...}` becomes an empty skeleton, and init() is deferred until the
     parent posts the real payload in. The page ships with no financial data embedded.
  2. The override backend gains a third mode, 'parent', alongside the existing 'local'
     (localStorage) and 'server' (serve_dashboard.py). It posts category changes out to
     the parent, which calls fin.api_set_category().
  3. The startup probe for serve_dashboard.py is dropped, since there is no such server
     behind the control plane.

Everything else is byte-for-byte what the local dashboard renders, so this cannot drift
from the version you have already checked by eye.

    python3 fin_build_frame.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import build_financial_dashboard as bfd

# This file now lives inside the site repo, so the frame is written to a sibling
# directory rather than an absolute path in the home folder.
OUT = Path(__file__).resolve().parent.parent / "dev" / "login" / "financials-frame.html"

# init() touches DATA.accounts and DATA.summary.months before any payload arrives, so the
# skeleton has to carry the same shape the RPC returns, just empty.
EMPTY = (
    "{transactions:[],"
    "summary:{overall:{},months:[],accounts:[],categories:[],recent_basis:[]},"
    "workbook_monthly:{months:[],rows:[]},"
    "insights:[],cashflow:{anchor:{},months:[]},accounts:[],generated_at:''}"
)

BOOTSTRAP = """    // Driven by the control plane: stay blank until the parent posts a payload, and
    // re-init on every later payload so a category override refreshes every tab.
    let finBooted = false;
    window.addEventListener('message', event => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || msg.type !== 'fin-payload' || !msg.payload) return;
      DATA = msg.payload;
      categoryOverrides = {};
      const restoreTab = finBooted ? activeTab : null;
      document.getElementById('tabs').innerHTML = '';
      init();
      if (restoreTab && DATA.accounts.includes(restoreTab)) { activeTab = restoreTab; render(); }
      finBooted = true;
      parent.postMessage({type: 'fin-height', height: document.documentElement.scrollHeight}, window.location.origin);
    });
    parent.postMessage({type: 'fin-ready'}, window.location.origin);
  </script>"""


def rewrite(html: str) -> str:
    subs = 0

    # 1. Strip the embedded payload.
    html, n = re.subn(r"const DATA = \{.*?\};\n", f"let DATA = {EMPTY};\n", html, count=1, flags=re.S)
    subs += n
    if n != 1:
        sys.exit("Could not find the embedded `const DATA = {...};` line.")

    # 2. Defer init() until a payload arrives.
    old_init = "    init();\n  </script>"
    if old_init not in html:
        sys.exit("Could not find the trailing `init();` call.")
    html = html.replace(old_init, BOOTSTRAP, 1)
    subs += 1

    # 3. No serve_dashboard.py behind the control plane; go straight to parent mode.
    old_probe = "      initOverrideBackend();"
    if old_probe not in html:
        sys.exit("Could not find the initOverrideBackend() call.")
    html = html.replace(old_probe, "      overrideBackend = 'parent';", 1)
    subs += 1

    # 4. Route category changes to the parent, which owns the Supabase client.
    old_branch = (
        "      if (!category || category === 'uncategorized') delete categoryOverrides[txId];\n"
        "      else categoryOverrides[txId] = category;\n"
        "      if (overrideBackend === 'server') {"
    )
    if old_branch not in html:
        sys.exit("Could not find the setCategoryOverride backend branch.")
    html = html.replace(
        old_branch,
        "      if (!category || category === 'uncategorized') delete categoryOverrides[txId];\n"
        "      else categoryOverrides[txId] = category;\n"
        "      if (overrideBackend === 'parent') {\n"
        "        parent.postMessage({type: 'fin-set-category', txId: txId, category: category || ''},"
        " window.location.origin);\n"
        "      } else if (overrideBackend === 'server') {",
        1,
    )
    subs += 1

    # 5. Say where overrides actually land now.
    old_note = ("      return overrideBackend === 'server' ? 'Saved to financials.sqlite' :"
                " 'Stored in this browser';")
    if old_note not in html:
        sys.exit("Could not find overrideStorageNote().")
    html = html.replace(
        old_note,
        "      return overrideBackend === 'parent' ? 'Saved to Supabase'\n"
        "        : overrideBackend === 'server' ? 'Saved to financials.sqlite'\n"
        "        : 'Stored in this browser';",
        1,
    )
    subs += 1

    # 6. Two captions describe where an edit lands, branching only on 'server' vs local.
    #    Under the control plane neither is true -- edits go to Supabase -- and telling
    #    someone their category change is browser-only when it is actually persisted is
    #    the kind of wrong that stops them trusting the tab.
    captions = [
        ("Remembered in this browser only.", "Saved to <strong>Supabase</strong>."),
        (
            "Remembered in this browser only &mdash; run <code>python3 serve_dashboard.py</code>"
            " to save edits to the database instead.",
            "Saved to <strong>Supabase</strong>, so it survives rebuilds and syncs.",
        ),
    ]
    for old, new in captions:
        if old not in html:
            sys.exit(f"Could not find caption: {old[:48]!r}")
        html = html.replace(old, new)
        subs += 1

    print(f"applied {subs} rewrites")
    return html


def main() -> None:
    # An empty payload keeps any real transaction out of the committed asset; the parent
    # supplies the data at runtime.
    empty = {
        "generated_at": "",
        "transactions": [],
        "summary": {"overall": {}, "months": [], "accounts": [], "categories": [], "recent_basis": []},
        "workbook_monthly": {"months": [], "rows": []},
        "insights": [],
        "cashflow": {"anchor": {}, "months": []},
        "accounts": ["Overview", "Monthly", "Cash Flow", "Analytics", "Review"],
    }
    html = rewrite(bfd.render_html(empty))

    if '"id"' in html or "Plaid:" in html:
        sys.exit("Refusing to write: the generated frame appears to contain transaction data.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
