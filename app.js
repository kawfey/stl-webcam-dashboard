/* STL Webcams — static dashboard.
   Reads data/cameras.json and renders one view at a time. Only the active
   view is mounted, so we never spin up every iframe/stream at once. */

'use strict';

const IMG_REFRESH_MS = 20000; // still-image cadence while visible
const state = {
  data: null,
  activeView: null,
  imgTimers: [],
  hlsInstances: [],
  observer: null,
};

const $ = (sel) => document.querySelector(sel);

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
  const first = state.data.views[0];
  selectView(first.key);
  updateMeta();
}

function buildTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  for (const v of state.data.views) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.type = 'button';
    btn.role = 'tab';
    btn.textContent = `${v.title} (${countForView(v.key)})`;
    btn.dataset.view = v.key;
    btn.setAttribute('aria-selected', 'false');
    btn.addEventListener('click', () => selectView(v.key));
    tabs.appendChild(btn);
  }
}

const countForView = (key) =>
  state.data.cameras.filter((c) => c.view === key).length;

function selectView(key) {
  if (state.activeView === key) return;
  state.activeView = key;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.setAttribute('aria-selected', String(btn.dataset.view === key));
  }
  renderView(key);
}

function teardown() {
  state.imgTimers.forEach(clearInterval);
  state.imgTimers = [];
  state.hlsInstances.forEach((h) => h.destroy());
  state.hlsInstances = [];
  if (state.observer) state.observer.disconnect();
  state.observer = new IntersectionObserver(onIntersect, { rootMargin: '200px' });
}

function renderView(key) {
  teardown();
  const grid = $('#grid');
  grid.innerHTML = '';
  const cams = state.data.cameras.filter((c) => c.view === key);
  $('#empty').hidden = cams.length > 0;
  for (const cam of cams) grid.appendChild(buildCard(cam));
}

function buildCard(cam) {
  const card = document.createElement('article');
  card.className = `card ${cam.render}`;

  const media = document.createElement('div');
  media.className = 'card-media';
  card.appendChild(media);

  if (cam.render === 'image') buildImage(media, cam);
  else if (cam.render === 'iframe') buildIframe(media, cam);
  else if (cam.render === 'hls') buildHls(media, cam);
  else if (cam.render === 'link') buildLink(media, cam);

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

/* ---- render types ---- */

function buildImage(media, cam) {
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
  state.imgTimers.push(timer);
}

function buildIframe(media, cam) {
  const frame = document.createElement('iframe');
  frame.src = cam.url;
  frame.loading = 'lazy';
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  media.appendChild(frame);
}

function buildHls(media, cam) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.controls = true;
  video.preload = 'none';
  media.appendChild(video);

  const overlay = document.createElement('button');
  overlay.className = 'play-overlay';
  overlay.type = 'button';
  overlay.setAttribute('aria-label', `Play ${cam.name}`);
  overlay.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.45)"/><path d="M9.5 7.5v9l7-4.5z" fill="#fff"/></svg>';
  media.appendChild(overlay);

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    overlay.remove();
    attachHls(video, cam.url);
    video.play().catch(() => {});
  };
  overlay.addEventListener('click', start);
  // Auto-start (muted) when scrolled into view.
  media.dataset.autostart = '1';
  media._start = start;
  state.observer.observe(media);
}

function attachHls(video, url) {
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url; // Safari / native HLS
    return;
  }
  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ lowLatencyMode: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) console.warn('HLS fatal', url, data.type);
    });
    state.hlsInstances.push(hls);
  } else {
    video.src = url;
  }
}

function buildLink(media, cam) {
  const a = document.createElement('a');
  a.className = 'link-cta';
  a.href = cam.page_url || cam.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML =
    'Open stream <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg>';
  media.appendChild(a);
}

function onIntersect(entries) {
  for (const e of entries) {
    if (e.isIntersecting && e.target._start) {
      e.target._start();
      state.observer.unobserve(e.target);
    }
  }
}

function updateMeta() {
  const g = state.data.generated;
  if (!g) return;
  const d = new Date(g);
  $('#meta').textContent = `data updated ${d.toLocaleDateString()}`;
  $('#footer-count').textContent = `${state.data.cameras.length} cameras`;
}

boot();
