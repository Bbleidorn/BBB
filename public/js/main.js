import * as THREE from 'three';
import { TRACKS } from './tracks.js';
import { Track } from './track.js';
import { buildTrackMeshes, buildScenery } from './trackMesh.js';
import { CarPhysics, createCarModel, orientModel } from './car.js';
import { GameAudio } from './audio.js';
import { computeMedals } from './medals.js';

const $ = (id) => document.getElementById(id);
const DT = 1 / 120; // feste Physikrate
const GHOST_EVERY = 6; // Ghost mit 20 Hz aufzeichnen
const UP = new THREE.Vector3(0, 1, 0);

const MEDALS = [
  { key: 'author', name: 'Autor', color: '#3fd16b' },
  { key: 'gold', name: 'Gold', color: '#ffcc33' },
  { key: 'silver', name: 'Silber', color: '#c8d0da' },
  { key: 'bronze', name: 'Bronze', color: '#d08a4a' },
];

// ---------- Hilfen ----------
function fmt(ms) {
  if (ms == null || !isFinite(ms)) return '-:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
function fmtDiff(ms) {
  const sign = ms < 0 ? '-' : '+';
  const a = Math.abs(ms);
  return `${sign}${(a / 1000).toFixed(3)}`;
}
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* Speicher nicht verfügbar */ }
  },
};
const pbKey = (id) => `trackrush.pb.${id}`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Renderer & Szene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe6ff');
scene.fog = new THREE.Fog('#cfe6ff', 300, 1800);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 6000);

scene.add(new THREE.HemisphereLight('#e4f1ff', '#4a6b3a', 1.3));
const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 450 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const audio = new GameAudio();
audio.setMuted(store.get('trackrush.muted') === true);

// ---------- Spielzustand ----------
const game = {
  state: 'menu', // menu | countdown | racing | finished
  def: null,
  track: null,
  world: null,
  gates: [],
  car: null,
  model: createCarModel('#1f6fff'),
  ghostModel: createCarModel('#ffffff', true),
  steps: 0,
  countdown: 0,
  lastCount: 0,
  nextCp: 0,
  respawnIdx: 0,
  splits: [],
  ghostRec: [],
  pb: null,
  camMode: Number(store.get('trackrush.cam')) || 0,
  showGhost: store.get('trackrush.ghost') !== false,
  finishTime: 0,
  menuAngle: 0,
};
scene.add(game.model, game.ghostModel);
game.ghostModel.visible = false;

const visUp = new THREE.Vector3(0, 1, 0);
const camFwd = new THREE.Vector3(0, 0, 1);
const tmpObj = new THREE.Object3D();

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of [].concat(o.material)) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function loadTrack(def) {
  if (game.def && game.def.id === def.id) return;
  if (game.world) {
    scene.remove(game.world);
    disposeGroup(game.world);
  }
  game.def = def;
  game.track = new Track(def);
  const { group, gates } = buildTrackMeshes(game.track);
  const { group: scenery, sky } = buildScenery(game.track, def.id.length * 7 + 3);
  game.world = new THREE.Group();
  game.world.add(group, scenery);
  game.sky = sky;
  game.gates = gates;
  scene.add(game.world);
  game.car = new CarPhysics(game.track);
  game.car.placeAt(game.track.startIdx);
  prepareMinimap();
  renderMedalsHud();
}

// ---------- Rennablauf ----------
function startRun() {
  audio.init();
  const t = game.track;
  game.car.placeAt(t.startIdx);
  game.state = 'countdown';
  game.countdown = 3;
  game.lastCount = 4;
  game.steps = 0;
  game.nextCp = 0;
  game.respawnIdx = t.startIdx;
  game.splits = [];
  game.ghostRec = [];
  game.pb = store.get(pbKey(game.def.id));
  game.gates.forEach((g) => {
    g.postMat.color.set('#2a7fff');
    g.line.material.color.set('#2a7fff');
  });
  $('menu').classList.add('hidden');
  $('finish').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('split').classList.add('hidden');
  $('countdown').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  updateCpHud();
  renderMedalsHud();
  snapCamera();
}

function respawn() {
  if (game.state !== 'racing') return;
  game.car.placeAt(game.respawnIdx);
  snapCamera();
  audio.beep(300, 0.12, 'triangle', 0.15);
}

function passCheckpoint() {
  const k = game.nextCp;
  const time = game.steps * DT * 1000;
  game.splits.push(time);
  game.respawnIdx = Math.min(game.track.checkpoints[k] + 3, game.track.P.length - 1);
  game.nextCp++;
  const gate = game.gates[k];
  gate.postMat.color.set('#2ee66b');
  gate.line.material.color.set('#2ee66b');
  updateCpHud();
  audio.beep(1046, 0.18, 'sine', 0.25);

  const el = $('split');
  const ref = game.pb && game.pb.splits && game.pb.splits[k];
  if (ref != null) {
    const d = time - ref;
    el.textContent = `${fmt(time)}  ${fmtDiff(d)}`;
    el.className = d <= 0 ? 'faster' : 'slower';
  } else {
    el.textContent = fmt(time);
    el.className = '';
  }
  clearTimeout(passCheckpoint.t);
  passCheckpoint.t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function finishRun() {
  const time = Math.round(game.steps * DT * 1000);
  game.finishTime = time;
  game.splits.push(time);
  game.state = 'finished';
  audio.beep(784, 0.15);
  setTimeout(() => audio.beep(1175, 0.35), 150);

  const prev = game.pb;
  const isPb = !prev || time < prev.time;
  if (isPb) {
    store.set(pbKey(game.def.id), { time, splits: game.splits, ghost: game.ghostRec });
  }

  $('finishTime').textContent = fmt(time);
  const info = $('finishInfo');
  if (!prev) info.innerHTML = 'Erste Zeit auf dieser Strecke!';
  else if (isPb) info.innerHTML = `Neue Bestzeit! <span class="faster">${fmtDiff(time - prev.time)}</span>`;
  else info.innerHTML = `Bestzeit ${fmt(prev.time)} <span class="slower">${fmtDiff(time - prev.time)}</span>`;

  const medals = computeMedals(game.track);
  const won = MEDALS.find((m) => time <= medals[m.key]);
  $('finishMedal').innerHTML = won
    ? `<span style="color:${won.color}">● ${won.name}-Medaille</span>`
    : `<span class="muted">Bronze: ${fmt(medals.bronze)}</span>`;

  const name = getName();
  $('finishBoard').innerHTML = '<li class="muted">Lädt …</li>';
  const req = name
    ? fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track: game.def.id, name, time }),
      })
    : fetch(`/api/leaderboard?track=${game.def.id}`);
  req
    .then((r) => r.json())
    .then((d) => renderBoard($('finishBoard'), d.entries || [], name))
    .catch(() => ($('finishBoard').innerHTML = '<li class="muted">Bestenliste nicht erreichbar</li>'));
  if (!name) info.insertAdjacentHTML('beforeend', '<br><span class="muted small">Gib im Menü einen Namen ein, um in die Bestenliste zu kommen.</span>');

  setTimeout(() => {
    if (game.state === 'finished') {
      $('finish').classList.remove('hidden');
      $('touch').classList.add('hidden');
    }
  }, 1200);
}

function toMenu() {
  game.state = 'menu';
  $('hud').classList.add('hidden');
  $('finish').classList.add('hidden');
  $('touch').classList.add('hidden');
  $('menu').classList.remove('hidden');
  game.ghostModel.visible = false;
  renderMenu();
}

// ---------- Physik-Schritt ----------
const NO_INPUT = { throttle: 0, brake: 0, steer: 0, drift: false };
const BRAKE_INPUT = { throttle: 0, brake: 1, steer: 0, drift: false };

function physicsStep(inp) {
  const car = game.car;
  const t = game.track;
  const effective = game.state === 'racing' ? inp : game.state === 'finished' ? BRAKE_INPUT : NO_INPUT;
  car.step(DT, effective);
  if (game.state !== 'racing') return;

  game.steps++;
  if (game.steps % GHOST_EVERY === 0) {
    orientModel(tmpObj, car.pos, car.fwd, car.up);
    const q = tmpObj.quaternion;
    const r = (x) => Math.round(x * 1000) / 1000;
    game.ghostRec.push(r(car.pos.x), r(car.pos.y), r(car.pos.z), r(q.x), r(q.y), r(q.z), r(q.w));
  }

  const q = car.q;
  const nearTrack = Math.abs(q.lateral) < t.halfWidth + 2 && Math.abs(q.h) < 8;
  if (nearTrack) {
    if (game.nextCp < t.checkpoints.length && car.idx >= t.checkpoints[game.nextCp]) passCheckpoint();
    else if (game.nextCp === t.checkpoints.length && car.idx >= t.finishIdx) finishRun();
  }

  if (car.wallHit > 4) audio.thud(car.wallHit);
  if (car.landImpact > 6) audio.thud(car.landImpact * 0.6);
  if (car.hasFallen()) respawn();
}

// ---------- Eingabe ----------
const keys = new Set();
const touchState = { left: false, right: false, gas: false, brake: false, drift: false };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let padPrev = [];

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Enter') e.target.blur();
    return;
  }
  const k = e.code;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'].includes(k)) e.preventDefault();
  if (!e.repeat) handleAction(k);
  keys.add(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function handleAction(code) {
  audio.init();
  const s = game.state;
  if (code === 'Escape') {
    if (s !== 'menu') toMenu();
    return;
  }
  if (s === 'menu') {
    if (code === 'Enter') startRun();
    return;
  }
  if (code === 'KeyR' || code === 'Delete') startRun();
  else if (code === 'Enter' || code === 'Backspace' || code === 'NumpadEnter') respawn();
  else if (code === 'KeyC') {
    game.camMode = (game.camMode + 1) % 3;
    store.set('trackrush.cam', game.camMode);
  } else if (code === 'KeyG') {
    game.showGhost = !game.showGhost;
    store.set('trackrush.ghost', game.showGhost);
    toast(game.showGhost ? 'Ghost an' : 'Ghost aus');
  } else if (code === 'KeyM') {
    audio.setMuted(!audio.muted);
    store.set('trackrush.muted', audio.muted);
    toast(audio.muted ? 'Ton aus' : 'Ton an');
  }
}

document.querySelectorAll('#touch button').forEach((b) => {
  const k = b.dataset.k;
  const set = (v) => (e) => {
    e.preventDefault();
    audio.init();
    if (k === 'respawn') {
      if (v) respawn();
      return;
    }
    touchState[k] = v;
    b.classList.toggle('active', v);
  };
  b.addEventListener('pointerdown', set(true));
  b.addEventListener('pointerup', set(false));
  b.addEventListener('pointercancel', set(false));
  b.addEventListener('pointerleave', set(false));
});

function readInput() {
  const k = (...codes) => codes.some((c) => keys.has(c));
  let throttle = k('KeyW', 'ArrowUp') || touchState.gas ? 1 : 0;
  let brake = k('KeyS', 'ArrowDown') || touchState.brake ? 1 : 0;
  let steer = (k('KeyD', 'ArrowRight') || touchState.right ? 1 : 0) - (k('KeyA', 'ArrowLeft') || touchState.left ? 1 : 0);
  let drift = k('Space') || touchState.drift;

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0;
    if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88);
    const btn = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
    throttle = Math.max(throttle, btn(7), btn(0));
    brake = Math.max(brake, btn(6), btn(1));
    drift = drift || btn(2) > 0.5 || btn(5) > 0.5;
    const pressed = p.buttons.map((b) => b.pressed);
    if (pressed[3] && !padPrev[3]) handleAction('Backspace');
    if (pressed[9] && !padPrev[9]) handleAction(game.state === 'menu' ? 'Enter' : 'KeyR');
    if (pressed[8] && !padPrev[8]) handleAction('Escape');
    padPrev = pressed;
    break;
  }
  return { throttle, brake, steer: THREE.MathUtils.clamp(steer, -1, 1), drift };
}

// ---------- HUD ----------
function updateCpHud() {
  $('cp').textContent = `CP ${game.nextCp}/${game.track.checkpoints.length}`;
}

function renderMedalsHud() {
  if (!game.track) return;
  const m = computeMedals(game.track);
  const pb = store.get(pbKey(game.def.id));
  $('medalsHud').innerHTML =
    MEDALS.map((x) => `<div><span class="dot" style="background:${x.color}"></span>${fmt(m[x.key])}</div>`).join('') +
    `<div style="margin-top:4px">PB ${fmt(pb && pb.time)}</div>`;
}

function toast(text, ms = 1200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), ms);
}

let mini = null;
function prepareMinimap() {
  const P = game.track.P;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of P) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const size = 180, pad = 14;
  const scale = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (size - (maxX - minX) * scale) / 2;
  const oz = (size - (maxZ - minZ) * scale) / 2;
  const map = (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];
  mini = { map, pts: P.filter((_, i) => i % 3 === 0).map((p) => map(p.x, p.z)) };
}

function drawMinimap() {
  const c = $('minimap');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!mini) return;
  g.lineWidth = 5;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.beginPath();
  mini.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  const t = game.track;
  t.checkpoints.forEach((idx, k) => {
    const [x, y] = mini.map(t.P[idx].x, t.P[idx].z);
    g.fillStyle = k < game.nextCp ? '#2ee66b' : '#2a7fff';
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  });
  const [fx, fy] = mini.map(t.P[t.finishIdx].x, t.P[t.finishIdx].z);
  g.fillStyle = '#ff4040';
  g.fillRect(fx - 4, fy - 4, 8, 8);
  if (game.ghostModel.visible) {
    const [gx, gy] = mini.map(game.ghostModel.position.x, game.ghostModel.position.z);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath(); g.arc(gx, gy, 3.5, 0, Math.PI * 2); g.fill();
  }
  const [cx, cy] = mini.map(game.car.pos.x, game.car.pos.z);
  g.fillStyle = '#ffd400';
  g.strokeStyle = '#000';
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill(); g.stroke();
}

// ---------- Menü ----------
function getName() {
  return $('nameInput').value.trim().slice(0, 16);
}
$('nameInput').value = store.get('trackrush.name') || '';
$('nameInput').addEventListener('input', () => store.set('trackrush.name', getName()));

let selectedId = store.get('trackrush.track') || TRACKS[0].id;

function renderMenu() {
  const list = $('trackList');
  list.innerHTML = '';
  for (const def of TRACKS) {
    const pb = store.get(pbKey(def.id));
    const medals = computeMedals(new Track(def));
    const won = pb && MEDALS.find((m) => pb.time <= medals[m.key]);
    const card = document.createElement('button');
    card.className = 'track-card' + (def.id === selectedId ? ' selected' : '');
    card.innerHTML = `
      <div class="diff" style="color:${def.color}">${def.difficulty}</div>
      <div class="tname">${escapeHtml(def.name)}</div>
      <div class="pb">PB ${fmt(pb && pb.time)} ${won ? `<span style="color:${won.color}">●</span>` : ''}</div>
      <span class="play">Fahren ▶</span>`;
    card.addEventListener('click', (e) => {
      const wasSelected = selectedId === def.id;
      selectTrack(def.id);
      if (wasSelected || e.target.classList.contains('play')) startRun();
    });
    list.appendChild(card);
  }
  selectTrack(selectedId, false);
}

function selectTrack(id, rerender = true) {
  const def = TRACKS.find((t) => t.id === id) || TRACKS[0];
  selectedId = def.id;
  store.set('trackrush.track', def.id);
  loadTrack(def);
  if (rerender) {
    document.querySelectorAll('.track-card').forEach((el, i) => el.classList.toggle('selected', TRACKS[i].id === def.id));
  }
  $('boardTrack').textContent = `· ${def.name}`;
  $('board').innerHTML = '<li class="muted">Lädt …</li>';
  fetch(`/api/leaderboard?track=${def.id}`)
    .then((r) => r.json())
    .then((d) => {
      if (selectedId === def.id) renderBoard($('board'), d.entries || [], getName());
    })
    .catch(() => ($('board').innerHTML = '<li class="muted">Bestenliste nicht erreichbar</li>'));
}

function renderBoard(el, entries, me) {
  if (!entries.length) {
    el.innerHTML = '<li class="muted">Noch keine Zeiten – sei der Erste!</li>';
    return;
  }
  el.innerHTML = entries
    .map((e) => {
      const isMe = me && e.name.toLowerCase() === me.toLowerCase();
      return `<li class="${isMe ? 'me' : ''}">${escapeHtml(e.name)}<span class="t">${fmt(e.time)}</span></li>`;
    })
    .join('');
}

$('btnRetry').addEventListener('click', startRun);
$('btnMenu').addEventListener('click', toMenu);

// ---------- Kamera ----------
const CAM = [
  { dist: 9.5, height: 3.8, look: 1.3 },
  { dist: 6.5, height: 2.5, look: 1.1 },
];

function snapCamera() {
  const car = game.car;
  camFwd.copy(car.fwd);
  visUp.copy(car.up);
  const c = CAM[0];
  camera.position.copy(car.pos).addScaledVector(camFwd, -c.dist).addScaledVector(UP, c.height);
  camera.lookAt(car.pos.x, car.pos.y + c.look, car.pos.z);
}

function updateCamera(dt) {
  const car = game.car;
  if (game.state === 'menu') {
    // Kamera kreist langsam um den Start
    game.menuAngle += dt * 0.15;
    const p = game.track.P[Math.floor(game.track.P.length * 0.25)];
    const r = 320;
    camera.position.set(p.x + Math.cos(game.menuAngle) * r, 140, p.z + Math.sin(game.menuAngle) * r);
    camera.lookAt(p.x, 0, p.z);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    return;
  }
  const target = new THREE.Vector3().copy(car.fwd);
  if (!car.grounded) target.y *= 0.3;
  camFwd.lerp(target, 1 - Math.exp(-6 * dt)).normalize();

  if (game.camMode === 2) {
    camera.position.copy(car.pos).addScaledVector(visUp, 1.25).addScaledVector(car.fwd, 0.4);
    const look = camera.position.clone().addScaledVector(car.fwd, 20);
    camera.up.copy(visUp);
    camera.lookAt(look);
  } else {
    const c = CAM[game.camMode];
    const desired = new THREE.Vector3().copy(car.pos).addScaledVector(camFwd, -c.dist).addScaledVector(UP, c.height);
    camera.position.lerp(desired, 1 - Math.exp(-14 * dt));
    camera.up.copy(UP);
    camera.lookAt(car.pos.x + camFwd.x * 4, car.pos.y + c.look + camFwd.y * 4, car.pos.z + camFwd.z * 4);
  }
  const fovTarget = 68 + Math.min(20, car.speed * 0.25) + (car.boost > 0 ? 4 : 0);
  camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();
}

// ---------- Ghost ----------
const gq0 = new THREE.Quaternion();
const gq1 = new THREE.Quaternion();
function updateGhost() {
  const gm = game.ghostModel;
  const g = game.pb && game.pb.ghost;
  if (!g || !game.showGhost || game.state === 'menu' || g.length < 14) {
    gm.visible = false;
    return;
  }
  const frames = g.length / 7;
  const f = Math.max(0, Math.min(frames - 1.001, game.steps / GHOST_EVERY - 1));
  const i = Math.floor(f);
  const a = (f - i);
  const o0 = i * 7;
  const o1 = Math.min(frames - 1, i + 1) * 7;
  gm.position.set(
    g[o0] + (g[o1] - g[o0]) * a,
    g[o0 + 1] + (g[o1 + 1] - g[o0 + 1]) * a,
    g[o0 + 2] + (g[o1 + 2] - g[o0 + 2]) * a,
  );
  gq0.set(g[o0 + 3], g[o0 + 4], g[o0 + 5], g[o0 + 6]).normalize();
  gq1.set(g[o1 + 3], g[o1 + 4], g[o1 + 5], g[o1 + 6]).normalize();
  gm.quaternion.slerpQuaternions(gq0, gq1, a);
  // Ghost ausblenden, wenn er direkt im eigenen Auto steckt
  gm.visible = gm.position.distanceTo(game.car.pos) > 2.5;
}

// ---------- Hauptschleife ----------
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const inp = readInput();

  if (game.state === 'countdown') {
    game.countdown -= dt;
    const n = Math.ceil(game.countdown);
    const el = $('countdown');
    if (n !== game.lastCount && n > 0) {
      game.lastCount = n;
      el.textContent = n;
      el.classList.remove('go');
      audio.beep(523, 0.15);
    }
    if (game.countdown <= 0) {
      game.state = 'racing';
      el.textContent = 'GO!';
      el.classList.add('go');
      audio.beep(1046, 0.3);
      setTimeout(() => el.classList.add('hidden'), 700);
    }
  }

  if (game.state !== 'menu') {
    acc += dt;
    while (acc >= DT) {
      physicsStep(inp);
      acc -= DT;
    }
  } else {
    acc = 0;
  }

  const car = game.car;
  if (car) {
    // Auto darstellen
    visUp.lerp(car.up, 1 - Math.exp(-12 * dt)).normalize();
    orientModel(game.model, car.pos, car.fwd, visUp);
    game.model.visible = game.state === 'menu' || game.camMode !== 2;
    const vF = car.forwardSpeed;
    for (const w of game.model.userData.wheels) {
      w.spin.rotation.x += (vF / 0.45) * dt;
      if (w.front) w.pivot.rotation.y = -car.steer * 0.45;
    }
    updateGhost();
    updateCamera(dt);

    // Licht folgt dem Auto, damit die Schatten scharf bleiben
    sun.position.set(car.pos.x + 70, car.pos.y + 140, car.pos.z + 45);
    sun.target.position.copy(car.pos);
    if (game.sky) game.sky.position.copy(camera.position);

    if (game.state !== 'menu') {
      const t = game.state === 'finished' ? game.finishTime : game.steps * DT * 1000;
      $('timer').textContent = fmt(t);
      $('speed').textContent = Math.round(car.speed * 3.6);
      drawMinimap();
    }
    const throttle = game.state === 'racing' ? inp.throttle : 0;
    audio.engine(car.speed, throttle, game.state !== 'menu');
  }

  renderer.render(scene, camera);
}

renderMenu();
requestAnimationFrame(frame);
