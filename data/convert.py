#!/usr/bin/env python3
"""Convert cameras.csv into cameras.json for the static web app.

Analogous to the Home Assistant gen_dashboard.py. Reads data/cameras.csv,
writes data/cameras.json. stdlib-only, idempotent. Run from the repo root:

    python3 data/convert.py

render column -> output render + primary url:
    entity:* + type still_image -> image  (url = stream_url)
    entity:* + type hls_direct  -> hls    (url = stream_url)
    iframe                      -> iframe (url = page_url)
    iframe_stream               -> iframe (url = stream_url)
    link                        -> link   (url = page_url)
    skip                        -> excluded entirely
"""
import csv, json, os, sys
from datetime import datetime, timezone

VIEWS = [
    {"key": "streams", "title": "Streams"},
    {"key": "stills", "title": "Stills"},
]


def map_row(r):
    """Return a camera dict for row r, or None to exclude it."""
    render = r["render"].strip()
    ctype = r["type"].strip()
    page_url = r["page_url"].strip()
    stream_url = r["stream_url"].strip()

    if render == "skip":
        return None

    if render.startswith("entity:"):
        if ctype == "still_image":
            out_render, url = "image", stream_url
        elif ctype == "hls_direct":
            out_render, url = "hls", stream_url
        else:
            out_render, url = "image", stream_url
    elif render == "iframe":
        out_render, url = "iframe", page_url
    elif render == "iframe_stream":
        out_render, url = "iframe", stream_url
    elif render == "link":
        out_render, url = "link", page_url
    else:
        print(f"warning: unknown render '{render}' for {r['name'].strip()!r}; skipping",
              file=sys.stderr)
        return None

    return {
        "name": r["name"].strip(),
        "view": r["view"].strip(),
        "render": out_render,
        "url": url,
        "page_url": page_url,
        "status": r["status"].strip(),
        "notes": r["notes"].strip(),
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "cameras.csv")
    dst = os.path.join(here, "cameras.json")

    with open(src, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    cameras, skipped = [], 0
    for r in rows:
        cam = map_row(r)
        if cam is None:
            skipped += 1
            continue
        if not cam["url"]:
            print(f"warning: {cam['name']!r} (render={cam['render']}) has an empty url",
                  file=sys.stderr)
        cameras.append(cam)

    data = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "views": VIEWS,
        "cameras": cameras,
    }

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    counts = {}
    for c in cameras:
        counts[c["render"]] = counts.get(c["render"], 0) + 1
    print(f"wrote {dst}")
    print(f"total cameras: {len(cameras)}  skipped rows: {skipped}")
    for render in ("image", "hls", "iframe", "link"):
        print(f"  {render}: {counts.get(render, 0)}")


if __name__ == "__main__":
    main()
