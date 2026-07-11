# STL Webcams

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

Only the active view (Streams / Stills) is mounted at a time, so the browser
never spins up every embed at once. `hls.js` is vendored in `vendor/` — no CDN
dependency.

## Editing the camera list

`data/cameras.csv` is the source of truth. To add or change a camera, edit a
row, then regenerate the JSON:

```
python3 data/convert.py     # rewrites data/cameras.json
```

Columns and `render`/`view` semantics are documented in `convert.py`. `skip`
rows (dead cameras, index pages, non-video bookmarks) are excluded from the app.

## Deploy

Pushing to `main` publishes via GitHub Pages (Settings → Pages → deploy from
`main` / root). To host on another site, copy the whole folder as-is.

[hls.js]: https://github.com/video-dev/hls.js
