#!/usr/bin/env python3
"""Convert cameras.csv (+ optional locations.csv) into cameras.json.

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

Geo / map (data/locations.csv, optional):
    columns: name,lat,lon,left,right,azimuth,fov,elev_m,ground_m,
             render,url,page_url,notes
    A row whose `name` matches a camera attaches a `geo` block to it, so it
    appears on the Map view. A row whose `name` matches nothing but has
    render+url becomes a standalone map-only marker (view "map").
    Direction is optional: give left/right FOV-edge headings (preferred) or
    azimuth/fov directly; with either present the app draws an FOV wedge,
    otherwise a plain pin. See parse_geo for the left/right -> azimuth/fov
    math and the elev_m/ground_m (viewshed) fields.
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


def _num(s):
    """Parse a possibly-empty numeric cell to float, or None."""
    s = (s or "").strip()
    return float(s) if s else None


def parse_geo(r):
    """Return a geo dict from a locations.csv row, or None if lat/lon missing.

    Direction may be given two ways:
      * left/right  -- compass headings of the FOV's left and right edges;
                       the view sweeps clockwise (increasing heading) from
                       left through the centre to right. Preferred input.
      * azimuth/fov -- centreline heading and total width, given directly.
    left/right win when both are present. Both edges/az+fov are optional
    (a row with lat/lon only drops a plain pin, no wedge).

    Elevation (elev_m = camera height ASL incl. building; ground_m = ground
    ASL at the camera base) is carried through for a future viewshed feature
    and does not affect the map today.
    """
    lat, lon = _num(r.get("lat")), _num(r.get("lon"))
    if lat is None or lon is None:
        return None
    geo = {"lat": lat, "lon": lon}

    left, right = _num(r.get("left")), _num(r.get("right"))
    az, fov = _num(r.get("azimuth")), _num(r.get("fov"))
    if left is not None and right is not None:
        fov = (right - left) % 360 or 360.0   # 0 width -> treat as full circle
        az = (left + fov / 2) % 360
    if az is not None and fov is not None:
        geo["azimuth"] = round(az, 2)
        geo["fov"] = round(fov, 2)

    elev, ground = _num(r.get("elev_m")), _num(r.get("ground_m"))
    if elev is not None:
        geo["elev_m"] = elev
    if ground is not None:
        geo["ground_m"] = ground
    return geo


def apply_locations(cameras, path):
    """Attach geo to matching cameras by name; append standalone map markers."""
    if not os.path.exists(path):
        return 0, 0
    by_name = {c["name"]: c for c in cameras}
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    attached, standalone = 0, 0
    for r in rows:
        name = (r.get("name") or "").strip()
        geo = parse_geo(r)
        if geo is None:
            print(f"warning: location row {name!r} missing lat/lon; skipping",
                  file=sys.stderr)
            continue
        if name in by_name:
            by_name[name]["geo"] = geo
            attached += 1
            continue
        # No matching camera: needs render+url to be a clickable marker.
        render = (r.get("render") or "").strip()
        url = (r.get("url") or "").strip()
        if not (render and url):
            print(f"warning: location {name!r} matches no camera and has no "
                  f"render+url; skipping", file=sys.stderr)
            continue
        cameras.append({
            "name": name,
            "view": "map",  # map-only: never appears in Streams/Stills tabs
            "render": render,
            "url": url,
            "page_url": (r.get("page_url") or "").strip(),
            "status": "live",
            "notes": (r.get("notes") or "").strip(),
            "geo": geo,
        })
        standalone += 1
    return attached, standalone


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "cameras.csv")
    locs = os.path.join(here, "locations.csv")
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

    attached, standalone = apply_locations(cameras, locs)
    geo_count = sum(1 for c in cameras if "geo" in c)

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
    print(f"geo: {geo_count} on map ({attached} attached, {standalone} standalone)")


if __name__ == "__main__":
    main()
