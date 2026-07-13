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

const state = {
  data: null,
  activeView: null,
  gridSink: null,   // media resources for the active grid view
  modalSink: null,  // media resources for the open lightbox
  map: null,        // Leaflet instance for the Map view
};

const $ = (sel) => document.querySelector(sel);

/* ---------- media resource sinks ---------- */

const newSink = () => ({ timers: [], hls: [], observer: null });

function destroySink(sink) {
  if (!sink) return;
  sink.timers.forEach(clearInterval);
  sink.hls.forEach((h) => h.destroy());
  if (sink.observer) sink.observer.disconnect();
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
  selectView(state.data.views[0].key);
  updateMeta();
  startClock();
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
const countForView = (key) =>
  state.data.cameras.filter((c) => c.view === key).length;

function buildTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  const entries = state.data.views.map((v) => ({
    key: v.key,
    label: `${v.title} (${countForView(v.key)})`,
  }));
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
  if (key === MAP_KEY) renderMap();
  else renderGrid(key);
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
  card.appendChild(buildBody(cam));
  return card;
}

function buildBody(cam) {
  const body = document.createElement('div');
  body.className = 'card-body';
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
  body.appendChild(title);
  if (cam.status && cam.status !== 'live') {
    const badge = document.createElement('span');
    badge.className = `badge ${cam.status}`;
    badge.textContent = cam.status.replace('_', ' ');
    body.appendChild(badge);
  }
  return body;
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
  load();
  media.appendChild(img);
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') load();
  }, IMG_REFRESH_MS);
  sink.timers.push(timer);
}

function mountIframe(media, cam, sink) {
  const frame = document.createElement('iframe');
  frame.src = cam.url;
  frame.loading = 'lazy';
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  media.appendChild(frame);

  if (/wetmet\.net/.test(cam.url)) {
    const reload = () => {
      const sep = cam.url.includes('?') ? '&' : '?';
      frame.src = `${cam.url}${sep}_r=${Date.now()}`;
    };
    // wetmet frame.php renders some feeds larger than the card, so the iframe
    // scrolls internally and steals the page's wheel. A transparent guard on
    // top catches the wheel (it can't scroll, so the page does) and a click
    // reloads the frame. (#2)
    const guard = document.createElement('button');
    guard.type = 'button';
    guard.className = 'iframe-guard';
    guard.title = 'Click to reload';
    guard.setAttribute('aria-label', `Reload ${cam.name}`);
    guard.addEventListener('click', reload);
    media.appendChild(guard);
    // wetmet feeds go black after ~300s; reload just before that so a frame
    // left on screen never stalls. Cleared on view/modal teardown. (#3)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
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

  // Grid: show a play badge and auto-start (muted) when scrolled into view.
  const overlay = document.createElement('button');
  overlay.className = 'play-overlay';
  overlay.type = 'button';
  overlay.setAttribute('aria-label', `Play ${cam.name}`);
  overlay.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.45)"/><path d="M9.5 7.5v9l7-4.5z" fill="#fff"/></svg>';
  media.appendChild(overlay);

  let started = false;
  const go = () => { if (started) return; started = true; overlay.remove(); start(); };
  overlay.addEventListener('click', go);
  if (!sink.observer) sink.observer = new IntersectionObserver(onIntersect, { rootMargin: '200px' });
  media._start = go;
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
  if (cam.status === 'offline' || cam.status === 'dead') return 'offline';
  if (cam.render === 'image') return 'still';
  return 'stream'; // hls / iframe / link-out, live
}

const camIcon = (cam) =>
  L.divIcon({ className: `cam-pin cam-pin--${pinStatus(cam)}`, iconSize: [18, 18], iconAnchor: [9, 9] });

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const cardinal = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

function typeLabel(cam) {
  if (cam.status === 'offline' || cam.status === 'dead') return 'Offline';
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
  const detail = geoDetail(cam);
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
}

boot();
