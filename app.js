/* STL Webcams — static dashboard.
   Reads data/cameras.json and renders one view at a time (Streams / Stills /
   Map). Only the active view is mounted, so we never spin up every
   iframe/stream at once. Cameras with a `geo` block appear on the Map view as
   a pin plus an FOV wedge; clicking a pin opens the stream in a lightbox. */

'use strict';

const IMG_REFRESH_MS = 20000;    // still-image cadence while visible
const WETMET_REFRESH_MS = 285000; // wetmet feeds stall to black at ~300s;
                                  // reload just before that (#3)
const FOV_RADIUS_M = 1600;    // illustrative length of the FOV wedge (these are
                              // elevated, long-range cams); visible at metro zoom
const MAP_KEY = 'map';
const CAMERAS_KEY = 'cameras';
const PROBE_INTERVAL_MS = 120000; // re-check liveness every 2 min (#17)

const state = {
  data: null,
  activeView: null,
  gridSink: null,   // media resources for the active grid view
  modalSink: null,  // media resources for the open lightbox
  map: null,        // Leaflet instance for the Map view
  filters: { type: 'all', status: 'all' }, // Cameras-view filters (#4)
  live: {},         // name -> {online: bool, at: ms} from probes (#17)
};

const $ = (sel) => document.querySelector(sel);

/* ---------- media resource sinks ---------- */

const newSink = () => ({ timers: [], hls: [], observer: null, cleanups: [] });

function destroySink(sink) {
  if (!sink) return;
  sink.timers.forEach(clearInterval);
  sink.hls.forEach((h) => h.destroy());
  if (sink.observer) sink.observer.disconnect();
  sink.cleanups.forEach((fn) => fn());
}

/* ---------- boot ---------- */

async function boot() {
  try {
    const res = await fetch('data/cameras.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $('#grid').innerHTML =
      `<p class="empty">Couldn't load camera data (${err.message}).</p>`;
    return;
  }

  buildTabs();
  buildFilterBar();
  selectView(CAMERAS_KEY);
  updateMeta();
  startClock();
  probeAll(); // fire-and-forget; dots/uptime fill in as results land (#17)
  setInterval(() => {
    if (document.visibilityState === 'visible') probeAll();
  }, PROBE_INTERVAL_MS);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// 24-hour Central Time clock in the top bar. (#5)
function startClock() {
  const el = $('#clock');
  if (!el) return;
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'America/Chicago',
  });
  const tick = () => { el.textContent = `${fmt.format(new Date())} CT`; };
  tick();
  setInterval(tick, 1000);
}

const geoCameras = () => state.data.cameras.filter((c) => c.geo);

function buildTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  const entries = [{ key: CAMERAS_KEY, label: `Cameras (${state.data.cameras.length})` }];
  if (geoCameras().length) {
    entries.push({ key: MAP_KEY, label: `Map (${geoCameras().length})` });
  }
  for (const e of entries) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.type = 'button';
    btn.role = 'tab';
    btn.textContent = e.label;
    btn.dataset.view = e.key;
    btn.setAttribute('aria-selected', 'false');
    btn.addEventListener('click', () => selectView(e.key));
    tabs.appendChild(btn);
  }
}

function selectView(key) {
  if (state.activeView === key) return;
  state.activeView = key;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.setAttribute('aria-selected', String(btn.dataset.view === key));
  }
  teardownView();
  $('#filters').hidden = key !== CAMERAS_KEY;
  if (key === MAP_KEY) renderMap();
  else renderCameras();
}

/* ---------- camera classification + filters (#4) ---------- */

const TYPE_LABEL = { stream: 'Stream', still: 'Still', event: 'Event', external: 'External' };

function camType(cam) {
  if (cam.status === 'event_only') return 'event';
  if (cam.render === 'link') return 'external';
  if (cam.render === 'image') return 'still';
  return 'stream'; // hls / iframe (a live stream, online or offline)
}

// Static status from the CSV — the fallback when we can't probe.
const staticOnline = (cam) => cam.status !== 'offline' && cam.status !== 'dead';

// Live probe result wins when we have one; otherwise fall back to the CSV. (#17)
function camOnline(cam) {
  const live = state.live[cam.name];
  return live ? live.online : staticOnline(cam);
}

/* ---------- liveness probing (#17) ----------
   wetmet's stream server answers an unsigned playlist request with 403 when
   the stream exists (it just wants its wmsAuthSign token) and 404 when the
   camera is down — and sends Access-Control-Allow-Origin:* on both, so a HEAD
   from the browser can read the status. No token, no backend, no CI.
   Cameras without a probe_url (Dacast/Nest/stills) keep their static status. */

function setLive(cam, online) {
  state.live[cam.name] = { online, at: Date.now() };
}

// Stills hosts send no CORS headers, so fetch() can't read their status — but
// an <img> loads cross-origin fine, and its load/error is the same question we
// were going to ask. Empirically these hosts 404 a dead camera rather than
// serving a stale frame, so this is a real signal. (Caveat: a camera that
// froze while still serving a valid old frame is undetectable from the
// browser — reading last-modified or pixels both need CORS.)
const probeImageUrl = (url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(true);
  img.onerror = () => resolve(false);
  const sep = url.includes('?') ? '&' : '?';
  img.src = `${url}${sep}_probe=${Date.now()}`;
});

async function probeCamera(cam) {
  try {
    if (cam.probe_url) {
      const res = await fetch(cam.probe_url, { method: 'HEAD', cache: 'no-store' });
      setLive(cam, res.status !== 404);
    } else if (cam.render === 'image') {
      setLive(cam, await probeImageUrl(cam.url));
    }
  } catch {
    // Network/CORS failure tells us nothing about the camera — leave the last
    // known result (or the static status) rather than crying offline.
  }
}

async function probeAll() {
  const cams = state.data.cameras.filter((c) => {
    if (c.probe_url) return true;                  // wetmet: cheap HEAD, always
    // Stills: a rendered <img> self-reports for free on every 20s refresh, so
    // only probe the ones we've never heard from (e.g. never scrolled into
    // view) rather than re-downloading every JPEG each cycle.
    return c.render === 'image' && !state.live[c.name];
  });
  if (!cams.length) return;
  await Promise.all(cams.map(probeCamera));
  refreshLiveUi();
}

// Update dots/uptime in place. Deliberately NOT a re-render: rebuilding the
// grid would tear down and reload every iframe.
function refreshLiveUi() {
  const byName = new Map(state.data.cameras.map((c) => [c.name, c]));
  for (const el of document.querySelectorAll('[data-cam]')) {
    const cam = byName.get(el.dataset.cam);
    if (!cam) continue;
    if (el.classList.contains('status-dot')) applyDot(el, cam);
    else if (el.classList.contains('card-uptime')) el.__render && el.__render();
  }
}

function applyDot(dot, cam) {
  const online = camOnline(cam);
  dot.className = `status-dot ${online ? 'is-online' : 'is-offline'}`;
  const live = state.live[cam.name];
  dot.title = live
    ? `${online ? 'Online' : 'Offline'} — checked ${new Date(live.at).toLocaleTimeString()}`
    : `${online ? 'Online' : 'Offline'} — from camera data (not live-checked)`;
}

function matchesFilters(cam) {
  const f = state.filters;
  if (f.type !== 'all' && camType(cam) !== f.type) return false;
  if (f.status === 'online' && !camOnline(cam)) return false;
  if (f.status === 'offline' && camOnline(cam)) return false;
  return true;
}

function buildFilterBar() {
  const bar = $('#filters');
  bar.innerHTML = '';
  const group = (label, name, opts) => {
    const g = document.createElement('div');
    g.className = 'filter-group';
    const lbl = document.createElement('span');
    lbl.className = 'filter-label';
    lbl.textContent = label;
    g.appendChild(lbl);
    for (const [val, text] of opts) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.name = name;
      chip.dataset.val = val;
      chip.textContent = text;
      chip.setAttribute('aria-pressed', String(state.filters[name] === val));
      chip.addEventListener('click', () => {
        state.filters[name] = val;
        for (const c of bar.querySelectorAll(`.chip[data-name="${name}"]`)) {
          c.setAttribute('aria-pressed', String(c.dataset.val === val));
        }
        renderCameras();
      });
      g.appendChild(chip);
    }
    bar.appendChild(g);
  };
  group('Type', 'type', [
    ['all', 'All'], ['stream', 'Stream'], ['still', 'Still'],
    ['event', 'Event'], ['external', 'External'],
  ]);
  group('Status', 'status', [['all', 'All'], ['online', 'Online'], ['offline', 'Offline']]);
}

/* ---------- Cameras view (all streams + stills, one page) ---------- */

function renderCameras() {
  destroySink(state.gridSink);
  const grid = $('#grid');
  grid.innerHTML = '';
  const sink = newSink();
  state.gridSink = sink;
  const cams = state.data.cameras.filter(matchesFilters);
  $('#empty').hidden = cams.length > 0;
  for (const cam of cams) grid.appendChild(buildCard(cam, sink, { lazyHls: true }));
}

function teardownView() {
  destroySink(state.gridSink);
  state.gridSink = null;
  if (state.map) { state.map.remove(); state.map = null; }
  const grid = $('#grid');
  grid.classList.remove('map-mode');
  grid.innerHTML = '';
  $('#empty').hidden = true;
}

/* ---------- grid views (Streams / Stills) ---------- */

function renderGrid(key) {
  const grid = $('#grid');
  const sink = newSink();
  state.gridSink = sink;
  const cams = state.data.cameras.filter((c) => c.view === key);
  $('#empty').hidden = cams.length > 0;
  for (const cam of cams) grid.appendChild(buildCard(cam, sink, { lazyHls: true }));
}

function buildCard(cam, sink, opts = {}) {
  const card = document.createElement('article');
  card.className = `card ${cam.render}`;
  const media = document.createElement('div');
  media.className = 'card-media';
  card.appendChild(media);
  mountMedia(media, cam, sink, opts);
  // Click the media to enlarge — but NOT on Dacast (Arch) players, whose own
  // controls must stay reachable in the grid (they don't autoplay). Those
  // enlarge via the title-bar button only. Link-outs open externally. (#2, #11)
  if (cam.render !== 'link' && !isDacast(cam)) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'card-open';
    open.setAttribute('aria-label', `Enlarge ${cam.name}`);
    open.addEventListener('click', () => openModal(cam));
    media.appendChild(open);
  }
  card.appendChild(buildBody(cam, sink));
  return card;
}

const isDacast = (cam) => /dacast\.com/.test(cam.url);

function buildBody(cam, sink) {
  const body = document.createElement('div');
  body.className = 'card-body';

  // Row 1: title + enlarge button.
  const top = document.createElement('div');
  top.className = 'card-top';
  const title = document.createElement('div');
  title.className = 'card-title';
  title.title = cam.name;
  if (cam.page_url) {
    const a = document.createElement('a');
    a.href = cam.page_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = cam.name;
    title.appendChild(a);
  } else {
    title.textContent = cam.name;
  }
  top.appendChild(title);
  if (cam.render !== 'link') {
    const enlarge = document.createElement('button');
    enlarge.type = 'button';
    enlarge.className = 'card-enlarge';
    enlarge.title = 'Enlarge';
    enlarge.setAttribute('aria-label', `Enlarge ${cam.name}`);
    enlarge.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
    enlarge.addEventListener('click', () => openModal(cam));
    top.appendChild(enlarge);
  }
  body.appendChild(top);

  // Row 2 (caption): type tag + uptime/downtime timer. (#4, #6)
  const caption = document.createElement('div');
  caption.className = 'card-caption';
  const type = camType(cam);
  const tag = document.createElement('span');
  tag.className = `type-tag type-${type}`;
  tag.textContent = TYPE_LABEL[type];
  caption.appendChild(tag);
  // Live status dot (#17) — green pulsing when up, amber when down.
  const dot = document.createElement('span');
  dot.dataset.cam = cam.name;
  applyDot(dot, cam);
  caption.appendChild(dot);
  const timer = document.createElement('span');
  timer.className = 'card-uptime';
  timer.dataset.cam = cam.name;
  caption.appendChild(timer);
  startUptime(timer, cam, sink);
  body.appendChild(caption);

  return body;
}

/* ---------- observed uptime/downtime, persisted per-browser (#6) ----------
   No server exists, so "uptime" = time this browser has continuously observed
   the camera online since first sight (stored in localStorage; survives
   reloads/redeploys). Offline cams show downtime since the last time this
   browser saw them online, or "forever" if never. */
const UPTIME_STORE_KEY = 'stl-webcams:seen';

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(UPTIME_STORE_KEY)) || {}; }
  catch { return {}; }
}
function saveSeen(store) {
  try { localStorage.setItem(UPTIME_STORE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

function startUptime(el, cam, sink) {
  const render = () => {
    // Probeable but not yet probed: say nothing rather than guess from the
    // static status and write a bogus "last seen online" into the store.
    if (cam.probe_url && !state.live[cam.name]) {
      el.className = 'card-uptime';
      el.textContent = 'checking…';
      return;
    }
    const online = camOnline(cam);
    const store = loadSeen();
    const rec = store[cam.name] || {};
    if (online) {
      if (!rec.firstOnline) rec.firstOnline = Date.now();
      rec.lastOnline = Date.now();
      el.className = 'card-uptime up';
      el.textContent = `up ${fmtDuration(Date.now() - rec.firstOnline)}`;
    } else {
      // Went down: drop firstOnline so uptime restarts when it returns, and
      // freeze lastOnline so downtime counts from when we last saw it up.
      delete rec.firstOnline;
      el.className = 'card-uptime down';
      el.textContent = rec.lastOnline
        ? `offline ${fmtDuration(Date.now() - rec.lastOnline)}`
        : 'offline · forever';
    }
    store[cam.name] = rec;
    saveSeen(store);
  };
  el.__render = render;
  render();
  sink.timers.push(setInterval(render, 30000));
}

/* ---------- media mounting (shared by grid + lightbox) ---------- */

function mountMedia(media, cam, sink, opts = {}) {
  if (cam.render === 'image') mountImage(media, cam, sink);
  else if (cam.render === 'iframe') mountIframe(media, cam, sink);
  else if (cam.render === 'hls') mountHls(media, cam, sink, opts);
  else if (cam.render === 'link') mountLink(media, cam);
}

function mountImage(media, cam, sink) {
  const img = document.createElement('img');
  img.alt = cam.name;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  const load = () => {
    const sep = cam.url.includes('?') ? '&' : '?';
    img.src = `${cam.url}${sep}_t=${Date.now()}`;
  };
  // Every refresh doubles as a liveness check, for free. (#17)
  img.addEventListener('load', () => { setLive(cam, true); refreshLiveUi(); });
  img.addEventListener('error', () => { setLive(cam, false); refreshLiveUi(); });
  load();
  media.appendChild(img);
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') load();
  }, IMG_REFRESH_MS);
  sink.timers.push(timer);
}

// wetmet frame.php hardcodes the video at 640x360 with an 8px body margin (a
// 656x376 content box) and no responsive class, so a smaller box clips it and
// forces internal scroll. We can't touch the cross-origin player, so size the
// iframe to that natural box (CSS) and scale + shift it to fill the card. (#11)
const WETMET_VIDEO_W = 640; // video width inside the frame
const WETMET_MARGIN = 8;    // default body margin around it

function mountIframe(media, cam, sink) {
  const frame = document.createElement('iframe');
  frame.src = cam.url;
  frame.loading = 'lazy';
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  media.appendChild(frame);

  if (/wetmet\.net/.test(cam.url)) {
    frame.classList.add('wetmet-frame');
    const fit = () => {
      const w = media.clientWidth;
      if (!w) return;
      // Scale the 640px video to the box width and shift out the 8px body
      // margin so the video fills the card edge-to-edge (no white border).
      const s = w / WETMET_VIDEO_W;
      frame.style.transform = `translate(${-WETMET_MARGIN * s}px, ${-WETMET_MARGIN * s}px) scale(${s})`;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(media);
    sink.cleanups.push(() => ro.disconnect());
    // wetmet feeds go black after ~300s; reload just before that so a frame
    // left on screen never stalls. Cleared on view/modal teardown. (#3)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        const sep = cam.url.includes('?') ? '&' : '?';
        frame.src = `${cam.url}${sep}_r=${Date.now()}`;
      }
    }, WETMET_REFRESH_MS);
    sink.timers.push(timer);
  }
}

function mountHls(media, cam, sink, opts = {}) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.controls = true;
  video.preload = 'none';
  media.appendChild(video);

  const start = () => attachHls(video, cam.url, sink);

  if (!opts.lazyHls) { start(); return; }

  // Grid: auto-start (muted) when scrolled into view.
  if (!sink.observer) sink.observer = new IntersectionObserver(onIntersect, { rootMargin: '200px' });
  media._start = start;
  sink.observer.observe(media);
}

function onIntersect(entries) {
  for (const e of entries) {
    if (e.isIntersecting && e.target._start) {
      e.target._start();
      state.gridSink.observer.unobserve(e.target);
    }
  }
}

function attachHls(video, url, sink) {
  // Prefer hls.js where supported (Chromium et al.). Some Chromium builds
  // report canPlayType('...mpegurl')="maybe" but can't actually decode HLS, so
  // native playback is only a fallback for engines without hls.js (Safari).
  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else console.warn('HLS fatal', url, data.type);
    });
    sink.hls.push(hls);
  } else {
    video.src = url; // Safari / native HLS
    video.play().catch(() => {});
  }
}

function mountLink(media, cam) {
  const a = document.createElement('a');
  a.className = 'link-cta';
  a.href = cam.page_url || cam.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML =
    'Open stream <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>';
  media.appendChild(a);
}

/* ---------- Map view ---------- */

function renderMap() {
  const grid = $('#grid');
  grid.classList.add('map-mode');
  const el = document.createElement('div');
  el.id = 'map';
  grid.appendChild(el);

  const map = L.map(el, { scrollWheelZoom: true });
  state.map = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const bounds = L.latLngBounds([]);
  for (const cam of geoCameras()) {
    const { lat, lon, azimuth, fov } = cam.geo;
    bounds.extend([lat, lon]);

    if (azimuth != null && fov != null) {
      const pts = fovPolygon(cam.geo, cam.geo.range_m || FOV_RADIUS_M);
      L.polygon(pts, {
        color: '#2f6fed', weight: 1, fillColor: '#2f6fed', fillOpacity: 0.22,
      }).addTo(map);
      pts.forEach((p) => bounds.extend(p));
    }

    const marker = L.marker([lat, lon], { icon: camIcon(cam), title: cam.name }).addTo(map);
    marker.bindTooltip(tooltipHtml(cam), { direction: 'top', offset: [0, -10] });
    marker.on('click', () => openModal(cam));
  }

  if (bounds.isValid()) map.fitBounds(bounds.pad(0.25), { maxZoom: 16 });
  else map.setView([38.627, -90.199], 11); // downtown STL fallback
  // Leaflet needs a size recalc after the container becomes visible.
  setTimeout(() => map.invalidateSize(), 0);
}

// Pin/status bucket used for colour + the tooltip's type label. (#7)
function pinStatus(cam) {
  if (!camOnline(cam)) return 'offline'; // live probe result when we have one
  if (cam.render === 'image') return 'still';
  return 'stream'; // hls / iframe / link-out, live
}

const camIcon = (cam) =>
  L.divIcon({ className: `cam-pin cam-pin--${pinStatus(cam)}`, iconSize: [18, 18], iconAnchor: [9, 9] });

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const cardinal = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

function typeLabel(cam) {
  if (!camOnline(cam)) return 'Offline';
  if (cam.render === 'image') return 'Still image';
  if (cam.render === 'link') return 'Link-out';
  if (cam.status === 'event_only') return 'Event only';
  return 'Stream';
}

// Hover tooltip: name + type + heading (cardinal if fixed, "PTZ" if it pans). (#8)
function tooltipHtml(cam) {
  const g = cam.geo || {};
  let dir = '';
  if (g.ptz) dir = 'PTZ';
  else if (g.azimuth != null) dir = cardinal(g.azimuth);
  const line2 = [typeLabel(cam), dir].filter(Boolean).join(' · ');
  return `<strong>${cam.name}</strong><br>${line2}`;
}

// Detailed az / FOV / elevation for the stream popup title bar. (#8)
function geoDetail(cam) {
  const g = cam.geo;
  if (!g) return '';
  const parts = [];
  if (g.azimuth != null && g.fov != null) {
    parts.push(`${g.azimuth}° ${cardinal(g.azimuth)}${g.ptz ? ' (PTZ)' : ''}`);
    parts.push(`${g.fov}° FOV`);
  }
  if (g.elev_m != null) {
    parts.push(g.ground_m != null
      ? `${g.elev_m} m ASL (${(g.elev_m - g.ground_m).toFixed(0)} m AGL)`
      : `${g.elev_m} m ASL`);
  }
  return parts.join(' · ');
}

/* Geodesic destination point (haversine forward), bearing in compass degrees. */
function destPoint(lat, lon, bearingDeg, distM) {
  const R = 6371000, d = distM / R, br = bearingDeg * Math.PI / 180;
  const la1 = lat * Math.PI / 180, lo1 = lon * Math.PI / 180;
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(la1),
    Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [la2 * 180 / Math.PI, lo2 * 180 / Math.PI];
}

function fovPolygon(geo, radius) {
  const { lat, lon, azimuth, fov } = geo;
  const half = fov / 2;
  const steps = Math.max(8, Math.round(fov / 5));
  const pts = [[lat, lon]];
  for (let i = 0; i <= steps; i++) {
    pts.push(destPoint(lat, lon, azimuth - half + (fov * i) / steps, radius));
  }
  pts.push([lat, lon]);
  return pts;
}

/* ---------- lightbox ---------- */

function openModal(cam) {
  closeModal();
  const sink = newSink();
  state.modalSink = sink;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const media = document.createElement('div');
  media.className = 'card-media';
  mountMedia(media, cam, sink, { lazyHls: false });

  const bar = document.createElement('div');
  bar.className = 'modal-bar';
  const heading = document.createElement('div');
  heading.className = 'modal-heading';
  const title = document.createElement('span');
  title.className = 'modal-title';
  title.textContent = cam.name;
  heading.appendChild(title);
  const detail = [typeLabel(cam), geoDetail(cam)].filter(Boolean).join(' · ');
  if (detail) {
    const sub = document.createElement('span');
    sub.className = 'modal-sub';
    sub.textContent = detail;
    heading.appendChild(sub);
  }
  const close = document.createElement('button');
  close.className = 'modal-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.addEventListener('click', closeModal);
  bar.append(heading, close);

  dialog.append(bar, media);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function closeModal() {
  const overlay = $('#modal');
  if (!overlay) return;
  destroySink(state.modalSink);
  state.modalSink = null;
  overlay.remove();
}

/* ---------- misc ---------- */

function updateMeta() {
  const g = state.data.generated;
  if (g) {
    $('#meta').textContent = `data updated ${new Date(g).toLocaleDateString()}`;
  }
  $('#footer-count').textContent = `${state.data.cameras.length} cameras`;
  const v = state.data.version;
  if (v && v.commit) {
    $('#footer-version').textContent = `${v.branch} @ ${v.commit}`;
    $('#version-sep').hidden = false;
  }
}

boot();
