# STL Webcams

Disclaimer: I don't know how to code literally anything. Clankers made everything you see with my instructions. 

A single-page dashboard of live St. Louis–area webcams — live streams and
periodically-refreshed still cameras. **No build step, no backend:** it's plain
HTML/CSS/JS that reads a generated `data/cameras.json` in the browser, so it
hosts anywhere static (GitHub Pages, `n0ssc.com`, an S3 bucket, a USB stick).

This started as a Home Assistant Lovelace dashboard; the camera list still lives
in a CSV, and a small script turns it into the JSON the app reads.

## Run it locally

Any static file server works (the app fetches `data/cameras.json`, so
`file://` won't do):

```
python3 -m http.server 8000
# open http://localhost:8000
```

## How it renders

Each camera has a `render` type (derived from the CSV) that picks the tile:

| render   | source                          | tile                                            |
|----------|---------------------------------|-------------------------------------------------|
| `image`  | JPEG that updates in place      | `<img>`, cache-busted refresh every 20 s        |
| `hls`    | direct `.m3u8`                  | `<video>` via [hls.js] (native HLS on Safari), click/scroll to play |
| `iframe` | embeddable player               | lazy `<iframe>`                                 |
| `link`   | frame-busting / click-to-play   | link-out button                                 |

Only the active view (Streams / Stills / Map) is mounted at a time, so the
browser never spins up every embed at once. `hls.js` and Leaflet are vendored
in `vendor/` — no CDN dependency (map tiles come from OpenStreetMap at runtime).

## Map view

Cameras that have a location show up on a **Map** tab as a pin plus a shaded
field-of-view wedge; clicking a pin opens that camera's stream in a lightbox.

## Editing the camera list

`data/cameras.csv` is the single source of truth — streams/stills config and
map geo data live in the same row:

```
name,page_url,stream_url,type,status,source,render,view,
lat,lon,left,right,azimuth,fov,ptz,range_m,elev_m,ground_m,notes
```

To add or change a camera, edit a row, then regenerate the JSON:

```
python3 data/convert.py     # rewrites data/cameras.json
```

`render`/`view` semantics for the first 8 columns are documented in
`convert.py`. `skip` rows (dead cameras, index pages, non-video bookmarks) are
excluded from the app entirely.

The geo columns (`lat` onward) are all optional — leave them blank for a
camera with no map presence:

- `azimuth` is a compass bearing (0°=N, 90°=E, clockwise); `fov` is the total
  cone width, so the wedge spans `azimuth ± fov/2`. Give these directly, or
  give `left`/`right` (the FOV's edge headings, sweeping clockwise
  left→right) and `convert.py` derives azimuth/fov for you — `left`/`right`
  win if both styles are present.
- `ptz` (any truthy value) flags a panning camera.
- `range_m` overrides the default FOV-wedge length for that camera.
- `elev_m` (camera height ASL, including building/mount) and `ground_m`
  (ground ASL at the camera's base) are carried through for a future
  viewshed feature; unused by the map today.
- With `lat`/`lon` but no azimuth/fov/left/right, the camera drops a plain
  pin with no wedge.

## Deploy

Pushing to `main` publishes via GitHub Pages (Settings → Pages → deploy from
`main` / root). To host on another site, copy the whole folder as-is.

[hls.js]: https://github.com/video-dev/hls.js
