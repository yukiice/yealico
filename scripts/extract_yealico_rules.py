#!/usr/bin/env python3
"""Extract Yealico site rules from the local macOS app SQLite database.

Read-only. Only rule/metadata columns are selected. Cookies, users, favorites,
history and other personal tables are never queried.

Usage:
  python3 scripts/extract_yealico_rules.py
  python3 scripts/extract_yealico_rules.py --site-pk 1
  python3 scripts/extract_yealico_rules.py --out artifacts/yealico-rules
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

DEFAULT_DB = Path.home() / (
    "Library/Containers/work.cmbook.ComiGa/Data/Library/"
    "Application Support/ComiGa/ComiGa.sqlite"
)
DEFAULT_OUT = Path("artifacts/yealico-rules")

SITE_COLUMNS = [
    "Z_PK",
    "ZNAME",
    "ZDOMAIN",
    "ZVERSION",
    "ZAUTHOR",
    "ZDISPLAYMODE",
    "ZINDEXURLPATTERN",
    "ZDETAILURLPATTERN",
    "ZGALLERYURLPATTERN",
    "ZSEARCHURLPATTERN",
    "ZLOGINURL",
    "ZFLAGS",
    "ZHTTPHEADERS",
    "ZINDEXHTTPHEADERS",
    "ZDETAILHTTPHEADERS",
    "ZGALLERYHTTPHEADERS",
    "ZSEARCHHTTPHEADERS",
    "ZSERIESHTTPHEADERS",
    "ZTAGHTTPHEADERS",
    "ZIMAGEHTTPHEADERS",
    "ZINDEXRULEJSON",
    "ZDETAILRULEJSON",
    "ZGALLERYRULEJSON",
    "ZSERIESRULEJSON",
    "ZSEARCHRULEJSON",
    "ZTAGSEARCHRULEJSON",
    "ZEXTRARULEJSON",
]

NAMED_RULE_TABLES = {
    "list": "ZSITELISTRULE",
    "detail": "ZSITEDETAILRULE",
    "gallery": "ZSITEGALLERYRULE",
    "series": "ZSITESERIESRULE",
}

PAGE_COLUMNS = [
    "Z_PK",
    "ZNAME",
    "ZLISTURLPATTERN",
    "ZDETAILURLPATTERN",
    "ZGALLERYURLPATTERN",
    "ZDISPLAYMODE",
    "ZFLAGS",
    "ZLISTRULE",
    "ZDETAILRULE",
    "ZGALLERYRULE",
    "ZSERIESRULE",
]


def parse_json(value: object) -> object:
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return {"_unparsed": str(value)}


def slugify(text: str) -> str:
    text = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", text).strip("-")
    return text[:60] or "site"


def open_readonly(path: Path) -> sqlite3.Connection:
    uri = f"file:{quote(str(path))}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def extract_named_rules(conn: sqlite3.Connection, site_pk: int) -> dict:
    result: dict[str, list[dict]] = {}
    for kind, table in NAMED_RULE_TABLES.items():
        rows = conn.execute(
            f"SELECT Z_PK, ZNAME, ZJSONSTRING FROM {table} WHERE ZSITE = ? ORDER BY Z_PK",
            (site_pk,),
        ).fetchall()
        result[kind] = [
            {
                "pk": row["Z_PK"],
                "name": row["ZNAME"],
                "rule": parse_json(row["ZJSONSTRING"]),
            }
            for row in rows
        ]
    return result


def extract_pages(conn: sqlite3.Connection, site_pk: int, named: dict) -> list[dict]:
    lookups = {
        "list": {item["pk"]: item for item in named["list"]},
        "detail": {item["pk"]: item for item in named["detail"]},
        "gallery": {item["pk"]: item for item in named["gallery"]},
        "series": {item["pk"]: item for item in named["series"]},
    }
    rows = conn.execute(
        f"SELECT {', '.join(PAGE_COLUMNS)} FROM ZSITEPAGE WHERE ZSITE = ? ORDER BY Z_PK",
        (site_pk,),
    ).fetchall()

    pages = []
    for row in rows:
        page = {
            "pk": row["Z_PK"],
            "name": row["ZNAME"],
            "listUrl": row["ZLISTURLPATTERN"],
            "detailUrl": row["ZDETAILURLPATTERN"],
            "galleryUrl": row["ZGALLERYURLPATTERN"],
            "displayMode": row["ZDISPLAYMODE"],
            "flags": row["ZFLAGS"],
        }
        for kind in ("list", "detail", "gallery", "series"):
            ref_column = f"Z{kind.upper()}RULE"
            ref_pk = row[ref_column]
            page[f"{kind}RulePk"] = ref_pk
            page[f"{kind}Rule"] = lookups[kind].get(ref_pk, {}).get("rule")
        pages.append(page)
    return pages


def extract_site(conn: sqlite3.Connection, site_pk: int) -> dict:
    row = conn.execute(
        f"SELECT {', '.join(SITE_COLUMNS)} FROM ZSITE WHERE Z_PK = ?",
        (site_pk,),
    ).fetchone()
    if row is None:
        raise SystemExit(f"site not found: {site_pk}")

    named = extract_named_rules(conn, site_pk)
    pages = extract_pages(conn, site_pk, named)
    return {
        "meta": {
            "bundleId": "work.cmbook.ComiGa",
            "sitePk": site_pk,
            "name": row["ZNAME"],
            "domain": row["ZDOMAIN"],
            "version": row["ZVERSION"],
            "author": row["ZAUTHOR"],
            "displayMode": row["ZDISPLAYMODE"],
            "flags": row["ZFLAGS"],
        },
        "urls": {
            "index": row["ZINDEXURLPATTERN"],
            "detail": row["ZDETAILURLPATTERN"],
            "gallery": row["ZGALLERYURLPATTERN"],
            "search": row["ZSEARCHURLPATTERN"],
        },
        "loginUrl": row["ZLOGINURL"],
        "headers": {
            "site": row["ZHTTPHEADERS"],
            "index": row["ZINDEXHTTPHEADERS"],
            "detail": row["ZDETAILHTTPHEADERS"],
            "gallery": row["ZGALLERYHTTPHEADERS"],
            "search": row["ZSEARCHHTTPHEADERS"],
            "series": row["ZSERIESHTTPHEADERS"],
            "tag": row["ZTAGHTTPHEADERS"],
            "image": row["ZIMAGEHTTPHEADERS"],
        },
        "rules": {
            "index": parse_json(row["ZINDEXRULEJSON"]),
            "detail": parse_json(row["ZDETAILRULEJSON"]),
            "gallery": parse_json(row["ZGALLERYRULEJSON"]),
            "series": parse_json(row["ZSERIESRULEJSON"]),
            "search": parse_json(row["ZSEARCHRULEJSON"]),
            "tagSearch": parse_json(row["ZTAGSEARCHRULEJSON"]),
            "extra": parse_json(row["ZEXTRARULEJSON"]),
        },
        "namedRules": named,
        "pages": pages,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--site-pk", type=int, action="append")
    args = parser.parse_args()

    if not args.db.exists():
        raise SystemExit(f"database not found: {args.db}")

    args.out.mkdir(parents=True, exist_ok=True)
    conn = open_readonly(args.db)
    try:
        if args.site_pk:
            site_pks = args.site_pk
        else:
            site_pks = [
                row["Z_PK"]
                for row in conn.execute("SELECT Z_PK FROM ZSITE ORDER BY Z_PK")
            ]

        extracted_at = datetime.now(timezone.utc).isoformat()
        for pk in site_pks:
            data = extract_site(conn, pk)
            data["meta"]["extractedAt"] = extracted_at
            name = data["meta"]["name"] or f"site-{pk}"
            domain = data["meta"]["domain"] or ""
            filename = f"site-{pk}-{slugify(name)}-{slugify(domain)}.json"
            path = args.out / filename
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(
                f"{filename}: rules index={bool(data['rules']['index'])} "
                f"detail={bool(data['rules']['detail'])} "
                f"gallery={bool(data['rules']['gallery'])} "
                f"pages={len(data['pages'])} "
                f"namedList={len(data['namedRules']['list'])}"
            )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
