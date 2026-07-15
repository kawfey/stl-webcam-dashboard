#!/usr/bin/env python3
"""Convert cameras.csv into cameras.json.

Analogous to the Home Assistant gen_dashboard.py. Reads data/cameras.csv,
writes data/cameras.json. stdlib-only, idempotent. Run from the repo root:

    python3 data/convert.py

columns: name,page_url,stream_url,type,status,source,render,view,
         lat,lon,left,right,azimuth,fov,ptz,range_m,elev_m,ground_m,notes,owner

render column -> output render + primary url:
    entity:* + type still_image -> image  (url = stream_url)
    entity:* + type hls_direct  -> hls    (url = stream_url)
    iframe                      -> iframe (url = page_url)
    iframe_stream               -> iframe (url = stream_url)
    link                        -> link   (url = page_url)
    skip                        -> excluded entirely

Geo / map: lat/lon (+ optionally left/right or azimuth/fov, ptz, range_m,
elev_m, ground_m) are all optional per row. A row with lat/lon attaches a
`geo` block, so the camera appears on the Map view. Direction is optional:
give left/right FOV-edge headings (preferred) or azimuth/fov directly; with
either present the app draws an FOV wedge, otherwise a plain pin. ptz=truthy
flags a panning camera; range_m overrides the default cone length. See
parse_geo for the left/right -> azimuth/fov math and the elev_m/ground_m
(viewshed) fields.
"""
import csv, json, os, subprocess, sys
from datetime import datetime, timezone


def git_version(here):
    """Best-effort {branch, commit} of the repo at data-generation time.

    Note: this reflects HEAD when convert.py runs (i.e. one commit behind the
    commit that includes the regenerated JSON). Good enough as a "which build"
    footer; a deploy-time stamp would need CI.
    """
    def g(*args):
        return subprocess.check_output(
            ["git", "-C", here, *args], text=True,
            stderr=subprocess.DEVNULL).strip()
    try:
        return {"branch": g("rev-parse", "--abbrev-ref", "HEAD"),
                "commit": g("rev-parse", "--short", "HEAD")}
    except Exception:
        return None

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

    cam = {
        "name": r["name"].strip(),
        "view": r["view"].strip(),
        "render": out_render,
        "url": url,
        "page_url": page_url,
        "status": r["status"].strip(),
        "notes": r["notes"].strip(),
    }
    owner = r.get("owner", "").strip()
    if owner:
        cam["owner"] = owner
    geo = parse_geo(r)
    if geo is not None:
        cam["geo"] = geo
    return cam


def _num(s):
    """Parse a possibly-empty numeric cell to float, or None."""
    s = (s or "").strip()
    return float(s) if s else None


def parse_geo(r):
    """Return a geo dict from a cameras.csv row, or None if lat/lon missing.

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
        geo["azimuth"] = round(az)   # whole-degree headings (extents are
        geo["fov"] = round(fov)      # only approximate anyway)

    elev, ground = _num(r.get("elev_m")), _num(r.get("ground_m"))
    if elev is not None:
        geo["elev_m"] = elev
    if ground is not None:
        geo["ground_m"] = ground

    if str(r.get("ptz") or "").strip().lower() in ("1", "true", "yes", "y", "x"):
        geo["ptz"] = True
    rng = _num(r.get("range_m"))          # per-camera cone length; app falls back
    if rng is not None:                    # to a default when absent
        geo["range_m"] = rng
    return geo


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

    geo_count = sum(1 for c in cameras if "geo" in c)

    data = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version": git_version(here),
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
    print(f"geo: {geo_count} on map")


if __name__ == "__main__":
    main()
