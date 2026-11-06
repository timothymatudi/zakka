"""Copy the starter category tree from supabase/seed/categories_starter.sql (owned by
Agent 1) into zakka_catalog/fixtures/categories.json, so mock/dev data uses the same
slugs and the same 10-locale names as the database.

Category ids in the fixture are uuid5("category:<slug>") (the DB uses random ids;
the catalog always maps categories by slug).

    python scripts/import_seed_categories.py [path/to/categories_starter.sql]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SEED = HERE.parents[2] / "supabase" / "seed" / "categories_starter.sql"
OUT = HERE.parent / "zakka_catalog" / "fixtures" / "categories.json"
COLUMNS = ("slug", "parent", "sort", "icon", "shopify", "en", "es", "fr", "pt", "ar", "zh", "hi", "sw", "de", "id")
LOCALES = COLUMNS[5:]


def parse_tuples(sql: str) -> list[tuple]:
    start = sql.index("values", sql.index("insert into zakka_category_seed"))
    end = sql.index(";", start)
    body = sql[start + len("values"):end]
    rows, row, i, depth = [], [], 0, 0
    token = ""
    while i < len(body):
        ch = body[i]
        if ch == "-" and body.startswith("--", i):  # comment to end of line
            i = body.index("\n", i)
            continue
        if ch == "'":
            j, buf = i + 1, []
            while True:
                if body[j] == "'" and j + 1 < len(body) and body[j + 1] == "'":
                    buf.append("'")
                    j += 2
                elif body[j] == "'":
                    break
                else:
                    buf.append(body[j])
                    j += 1
            row.append("".join(buf))
            i = j + 1
            continue
        if ch == "(":
            depth += 1
            row, token = [], ""
        elif ch in ",)" and depth:
            t = token.strip()
            if t:
                row.append(None if t.lower() == "null" else int(t))
            token = ""
            if ch == ")":
                depth -= 1
                rows.append(tuple(row))
        elif depth and not ch.isspace():
            token += ch
        i += 1
    return rows


def main(argv: list[str]) -> int:
    seed = Path(argv[1]) if len(argv) > 1 else DEFAULT_SEED
    rows = [dict(zip(COLUMNS, r)) for r in parse_tuples(seed.read_text(encoding="utf-8"))]
    bad = [r for r in rows if len(r) != len(COLUMNS)]
    if bad:
        raise SystemExit(f"unexpected row shape: {bad[:1]}")
    cats = [{"slug": r["slug"], "parent": r["parent"], "sort": r["sort"], "icon": r["icon"],
             "names": {loc: r[loc] for loc in LOCALES}} for r in rows]
    OUT.write_text(json.dumps({"_note": f"Generated from {seed.name} by scripts/import_seed_categories.py. "
                                        "Do not edit by hand.", "categories": cats},
                              indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(cats)} categories to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
