import * as THREE from 'three';
import { createCarModel } from './car.js';

const INTERP_DELAY = 120; // ms Verzögerung für flüssige Interpolation
const HIDE_AFTER = 1500; // ms ohne Update → ausblenden
const FADE_DIST = 9; // näher als das → durchsichtig

function makeLabel(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 12);
  g.fill();
  g.fillStyle = color;
  g.fillRect(16, 24, 16, 16);
  g.fillStyle = '#fff';
  g.font = 'bold 30px "Segoe UI", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(name, 42, 33, 200);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set(6, 1.5, 1);
  sprite.position.y = 3;
  return sprite;
}

function disposeObject(o) {
  o.traverse((x) => {
    if (x.geometry) x.geometry.dispose();
    if (x.material) {
      if (x.material.map) x.material.map.dispose();
      x.material.dispose();
    }
  });
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map(); // id -> { model, label, buf, lastSeen, name, color }
    this.roster = new Map(); // id -> { name, color }
  }

  setRoster(list, myId) {
    this.roster = new Map(list.filter((p) => p.id !== myId).map((p) => [p.id, p]));
    for (const [id, p] of this.players) {
      const info = this.roster.get(id);
      if (!info) this.remove(id);
      else if (info.name !== p.name || info.color !== p.color) {
        this.remove(id); // mit neuem Namen/Farbe neu aufbauen
      }
    }
  }

  get count() {
    return this.roster.size;
  }

  ensure(id) {
    let p = this.players.get(id);
    if (p) return p;
    const info = this.roster.get(id) || { name: `Fahrer-${id}`, color: '#ffffff' };
    const model = createCarModel(info.color, { shadow: false });
    const label = makeLabel(info.name, info.color);
    model.add(label);
    model.visible = false;
    const mats = [];
    model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material.transparent = true;
        mats.push(o.material);
      }
    });
    this.scene.add(model);
    p = { model, label, mats, opacity: 1, buf: [], lastSeen: 0, name: info.name, color: info.color };
    this.players.set(id, p);
    return p;
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.model);
    disposeObject(p.model);
    this.players.delete(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
    this.roster.clear();
  }

  snapshot(ps, myId) {
    const now = performance.now();
    for (const row of ps) {
      const id = row[0];
      if (id === myId || !this.roster.has(id)) continue;
      const p = this.ensure(id);
      p.buf.push({
        t: now,
        pos: new THREE.Vector3(row[1], row[2], row[3]),
        q: new THREE.Quaternion(row[4], row[5], row[6], row[7]).normalize(),
        sp: row[8],
      });
      if (p.buf.length > 30) p.buf.shift();
      p.lastSeen = now;
    }
  }

  update(dt, myPos) {
    const now = performance.now();
    const rt = now - INTERP_DELAY;
    for (const p of this.players.values()) {
      const b = p.buf;
      if (!b.length || now - p.lastSeen > HIDE_AFTER) {
        p.model.visible = false;
        continue;
      }
      p.model.visible = true;
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > rt) i--;
      const a = b[Math.max(0, i - 1)];
      const c = b[i];
      const span = c.t - a.t;
      const f = span > 0 ? THREE.MathUtils.clamp((rt - a.t) / span, 0, 1) : 1;
      p.model.position.lerpVectors(a.pos, c.pos, f);
      p.model.quaternion.slerpQuaternions(a.q, c.q, f);
      const sp = a.sp + (c.sp - a.sp) * f;
      for (const w of p.model.userData.wheels) w.spin.rotation.x += (sp / 0.45) * dt;

      // Autos direkt neben dem eigenen durchsichtig machen
      const target = myPos && p.model.position.distanceTo(myPos) < FADE_DIST ? 0.3 : 1;
      if (Math.abs(target - p.opacity) > 0.01) {
        p.opacity += (target - p.opacity) * Math.min(1, dt * 8);
        for (const m of p.mats) {
          m.opacity = p.opacity;
          m.depthWrite = p.opacity > 0.95;
        }
      }
    }
  }

  visiblePositions() {
    const out = [];
    for (const p of this.players.values()) if (p.model.visible) out.push({ pos: p.model.position, color: p.color });
    return out;
  }
}
