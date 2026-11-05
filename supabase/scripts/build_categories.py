#!/usr/bin/env python3
"""Convert Shopify's Standard Product Taxonomy into a Zakka categories seed.

Shopify Standard Product Taxonomy: https://github.com/Shopify/product-taxonomy
License: MIT. Keep its LICENSE notice with any generated file you commit.

This script never downloads anything. Fetch the taxonomy yourself, then point
the script at the local files. See supabase/README.md ("Full category tree").

Input formats (auto-detected by extension):
  * dist/<locale>/categories.json  (preferred; has levels and parents)
  * dist/<locale>/categories.txt   (lines "gid://shopify/TaxonomyCategory/aa-1 : A > B")

Output: idempotent SQL that upserts `categories` by slug and
`category_translations` by (category_id, locale). Stdlib only, Python 3.10+.

Examples:
  python supabase/scripts/build_categories.py vendor/product-taxonomy/dist/en/categories.json \
      --max-depth 3 \
      --translation es=vendor/product-taxonomy/dist/es/categories.json \
      --translation fr=vendor/product-taxonomy/dist/fr/categories.json \
      --out supabase/seed/categories_shopify.sql
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

PHASE1_LOCALES = ("en", "es", "fr", "pt", "ar", "zh", "hi", "sw", "de", "id")
GID_PREFIX = "gid://shopify/TaxonomyCategory/"
MAX_SLUG_LEN = 100
CHUNK = 500


@dataclass
class Node:
    tax_id: str              # short id, e.g. "aa-1-13"
    parent_id: str | None    # short id of parent, None for verticals
    level: int               # 0 = vertical (top level)
    name: str                # English name
    path: list[str]          # English names from root to this node
    order: int = 0           # position among siblings (input order)
    slug: str = ""


def short_id(raw: str) -> str:
    raw = raw.strip()
    return raw[len(GID_PREFIX):] if raw.startswith(GID_PREFIX) else raw


def parent_of(tax_id: str) -> str | None:
    return tax_id.rsplit("-", 1)[0] if "-" in tax_id else None


# --------------------------------------------------------------------------- parsing

def parse_json(path: Path) -> list[Node]:
    data = json.loads(path.read_text(encoding="utf-8"))
    raw: list[dict] = []
    if isinstance(data, dict) and "verticals" in data:
        for vertical in data["verticals"]:
            raw.extend(vertical.get("categories", []))
    elif isinstance(data, dict) and "categories" in data:
        raw = data["categories"]
    elif isinstance(data, list):
        raw = data
    else:
        raise ValueError(f"{path}: unrecognised taxonomy JSON layout")

    nodes: list[Node] = []
    for c in raw:
        tid = short_id(c["id"])
        parent = c.get("parent_id")
        parent = short_id(parent) if parent else parent_of(tid)
        full = c.get("full_name") or c["name"]
        path_names = [p.strip() for p in full.split(" > ")]
        level = c.get("level", len(path_names) - 1)
        nodes.append(Node(tid, parent, int(level), c["name"].strip(), path_names))
    return nodes


def parse_txt(path: Path) -> list[Node]:
    nodes: list[Node] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or " : " not in line:
            continue
        gid, full = line.split(" : ", 1)
        tid = short_id(gid)
        path_names = [p.strip() for p in full.split(" > ")]
        nodes.append(Node(tid, parent_of(tid), len(path_names) - 1, path_names[-1], path_names))
    return nodes


def parse(path: Path) -> list[Node]:
    if path.suffix.lower() == ".json":
        return parse_json(path)
    if path.suffix.lower() == ".txt":
        return parse_txt(path)
    raise ValueError(f"{path}: expected a .json or .txt taxonomy file")


# --------------------------------------------------------------------------- slugs

def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("&", " ").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def assign_slugs(nodes: list[Node]) -> None:
    """Slug = slugified path. Shortened with a stable hash if too long; unique."""
    seen: set[str] = set()
    for n in nodes:
        base = slugify("-".join(n.path)) or slugify(n.tax_id)
        if len(base) > MAX_SLUG_LEN:
            digest = hashlib.sha1(n.tax_id.encode()).hexdigest()[:8]
            base = base[: MAX_SLUG_LEN - 9].rstrip("-") + "-" + digest
        slug = base
        if slug in seen:
            slug = f"{base[: MAX_SLUG_LEN - len(n.tax_id) - 1]}-{slugify(n.tax_id)}"
        seen.add(slug)
        n.slug = slug


# --------------------------------------------------------------------------- sql

def q(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def chunks(items: list, size: int = CHUNK):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def build_sql(nodes: list[Node], translations: dict[str, dict[str, str]], source_note: str) -> str:
    by_id = {n.tax_id: n for n in nodes}
    out: list[str] = [
        "-- GENERATED by supabase/scripts/build_categories.py. Do not edit by hand.",
        f"-- Source: {source_note}",
        "-- Shopify Standard Product Taxonomy, MIT License, (c) Shopify Inc.",
        "-- https://github.com/Shopify/product-taxonomy",
        f"-- Categories: {len(nodes)}; locales: {', '.join(['en', *sorted(translations)])}",
        "",
        "begin;",
        "",
    ]

    for level in sorted({n.level for n in nodes}):
        rows = [n for n in nodes if n.level == level]
        for part in chunks(rows):
            values = ",\n".join(
                "  ({}, {}, {}, {}, {})".format(
                    q(n.slug),
                    q(by_id[n.parent_id].slug if n.parent_id in by_id else None),
                    q(n.order),
                    q(n.tax_id),
                    q(level == 0),
                )
                for n in part
            )
            out.append(
                "insert into categories (slug, parent_id, sort, is_top_level, shopify_taxonomy_id)\n"
                "select v.slug, p.id, v.sort, v.top, v.tax_id\n"
                "from (values\n"
                f"{values}\n"
                ") as v(slug, parent_slug, sort, tax_id, top)\n"
                "left join categories p on p.slug = v.parent_slug\n"
                "on conflict (slug) do update\n"
                "  set parent_id = excluded.parent_id,\n"
                "      sort = excluded.sort,\n"
                "      is_top_level = excluded.is_top_level,\n"
                "      shopify_taxonomy_id = excluded.shopify_taxonomy_id;\n"
            )

    all_names: list[tuple[str, str, str]] = [(n.slug, "en", n.name) for n in nodes]
    for locale in sorted(translations):
        names = translations[locale]
        all_names.extend((n.slug, locale, names[n.tax_id]) for n in nodes if names.get(n.tax_id))

    for part in chunks(all_names):
        values = ",\n".join(f"  ({q(s)}, {q(loc)}, {q(name)})" for s, loc, name in part)
        out.append(
            "insert into category_translations (category_id, locale, name)\n"
            "select c.id, v.locale, v.name\n"
            "from (values\n"
            f"{values}\n"
            ") as v(slug, locale, name)\n"
            "join categories c on c.slug = v.slug\n"
            "on conflict (category_id, locale) do update set name = excluded.name;\n"
        )

    out.append("commit;\n")
    return "\n".join(out)


# --------------------------------------------------------------------------- main

def select_nodes(nodes: list[Node], max_depth: int | None, verticals: set[str] | None) -> list[Node]:
    keep = [
        n for n in nodes
        if (max_depth is None or n.level < max_depth)
        and (not verticals or n.tax_id.split("-", 1)[0] in verticals)
    ]
    keep.sort(key=lambda n: (n.level, n.tax_id))
    ids = {n.tax_id for n in keep}
    # Drop orphans (parent filtered out) so every child can find its parent.
    keep = [n for n in keep if n.level == 0 or n.parent_id in ids]
    # Sibling order follows taxonomy order; sort = 10, 20, 30 ...
    counters: dict[str | None, int] = {}
    for n in keep:
        counters[n.parent_id] = counters.get(n.parent_id, 0) + 10
        n.order = counters[n.parent_id]
    return keep


def parse_translation_arg(arg: str) -> tuple[str, Path]:
    if "=" not in arg:
        raise argparse.ArgumentTypeError("use LOCALE=PATH, e.g. es=dist/es/categories.json")
    locale, path = arg.split("=", 1)
    locale = locale.strip()
    if locale not in PHASE1_LOCALES:
        raise argparse.ArgumentTypeError(f"locale must be one of {', '.join(PHASE1_LOCALES)}")
    if locale == "en":
        raise argparse.ArgumentTypeError("en comes from the main taxonomy file")
    return locale, Path(path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("taxonomy", type=Path, help="local English categories.json or categories.txt")
    ap.add_argument("--translation", action="append", default=[], type=parse_translation_arg,
                    metavar="LOCALE=PATH", help="localized categories file (repeatable)")
    ap.add_argument("--max-depth", type=int, default=3,
                    help="number of levels to keep (1 = verticals only). 0 = all. Default 3")
    ap.add_argument("--verticals", default="",
                    help="comma-separated vertical prefixes to keep, e.g. el,aa,hg")
    ap.add_argument("--out", type=Path, help="output .sql (default: stdout)")
    args = ap.parse_args(argv)

    nodes = parse(args.taxonomy)
    verticals = {v.strip() for v in args.verticals.split(",") if v.strip()} or None
    nodes = select_nodes(nodes, args.max_depth or None, verticals)
    if not nodes:
        print("no categories selected", file=sys.stderr)
        return 1
    assign_slugs(nodes)

    translations: dict[str, dict[str, str]] = {}
    for locale, path in args.translation:
        translations[locale] = {n.tax_id: n.name for n in parse(path)}

    sql = build_sql(nodes, translations, args.taxonomy.name)
    if args.out:
        args.out.write_text(sql, encoding="utf-8")
        print(f"wrote {len(nodes)} categories to {args.out}", file=sys.stderr)
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdout.write(sql)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
