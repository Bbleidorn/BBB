import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
export const GRAVITY = 25;
const ENGINE = 22; // Beschleunigung bei 0 km/h (m/s²)
const VMAX = 80; // theoretische Höchstgeschwindigkeit ohne Luftwiderstand (m/s)
const BRAKE = 38;
const REVERSE_MAX = 14;
const CAR_HALF_WIDTH = 1.05;
const WALL_HEIGHT = 2.2;

const _r = new THREE.Vector3();
const _g = new THREE.Vector3();
const _d = new THREE.Vector3();

export class CarPhysics {
  constructor(track) {
    this.track = track;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.idx = 0;
    this.grounded = true;
    this.steer = 0;
    this.boost = 0;
    this.drifting = false;
    this.wallHit = 0;
    this.landImpact = 0;
    this.q = null;
  }

  placeAt(idx) {
    const t = this.track;
    this.idx = idx;
    this.pos.copy(t.P[idx]);
    this.vel.set(0, 0, 0);
    this.fwd.copy(t.T[idx]);
    this.up.copy(t.U[idx]);
    this.grounded = true;
    this.steer = 0;
    this.boost = 0;
    this.q = t.query(this.pos, idx, 2);
  }

  get speed() {
    return this.vel.length();
  }

  get forwardSpeed() {
    return this.vel.dot(this.fwd);
  }

  step(dt, inp) {
    const t = this.track;
    const hw = t.halfWidth;
    const q = t.query(this.pos, this.idx, 40);
    this.idx = q.idx;
    this.q = q;
    this.wallHit = 0;
    this.landImpact = 0;

    // ---- Bodenkontakt ----
    const onSurface = q.road && Math.abs(q.lateral) <= hw + 0.4;
    const vU = this.vel.dot(q.U);
    const snap = this.grounded ? 0.9 : 0.15;
    if (onSurface && q.h < snap && q.h > -2 && (!this.grounded || vU < 6)) {
      if (!this.grounded && vU < -1) {
        this.landImpact = -vU;
        this.vel.addScaledVector(q.U, -vU);
      }
      this.grounded = true;
      this.pos.copy(q.P).addScaledVector(q.N, q.lateral);
      // Geschwindigkeit an die Fahrbahn anpassen (Kuppen/Senken), Betrag bleibt erhalten
      const sp = this.vel.length();
      const vu = this.vel.dot(q.U);
      this.vel.addScaledVector(q.U, -vu);
      const l = this.vel.length();
      if (l > 1e-4) this.vel.multiplyScalar(sp / l);
      this.up.copy(q.U);
    } else {
      this.grounded = false;
    }

    // ---- Steuerung ----
    const fwd = this.fwd;
    fwd.addScaledVector(this.up, -fwd.dot(this.up)).normalize();
    const vF = this.vel.dot(fwd);
    const steerTarget = inp.steer;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 9);
    this.drifting = false;

    if (this.grounded) {
      const sp = Math.abs(vF);
      const drift = inp.drift && sp > 12;
      this.drifting = drift && Math.abs(this.steer) > 0.2;
      const rate = ((2.3 * Math.min(1, sp / 5)) / (1 + sp / 75)) * (drift ? 1.45 : 1);
      fwd.applyAxisAngle(this.up, -this.steer * rate * dt * (vF < -0.5 ? -1 : 1));

      let a = 0;
      if (inp.throttle > 0) {
        a += inp.throttle * (vF < -0.5 ? BRAKE : ENGINE * Math.max(0, 1 - vF / VMAX));
      }
      if (inp.brake > 0) {
        if (vF > 0.5) a -= inp.brake * BRAKE;
        else if (vF > -REVERSE_MAX && inp.throttle === 0) a -= inp.brake * 12;
      }
      this.vel.addScaledVector(fwd, a * dt);

      if (q.type === 'boost') this.boost = 1.6;
      if (this.boost > 0) {
        this.vel.addScaledVector(fwd, 32 * dt * Math.max(0, 1 - vF / (VMAX * 1.35)));
      }

      // Seitenführung
      _r.crossVectors(fwd, this.up).normalize();
      const vS = this.vel.dot(_r);
      const grip = drift ? 1.6 : 10;
      this.vel.addScaledVector(_r, -vS * (1 - Math.exp(-grip * dt)));

      // Widerstand
      const coast = inp.throttle === 0 ? 0.1 : 0;
      this.vel.multiplyScalar(1 - (0.02 + coast + (drift ? 0.25 : 0)) * dt);
      if (inp.throttle === 0 && inp.brake === 0 && this.vel.length() < 0.6) this.vel.set(0, 0, 0);

      // Hangabtrieb (nur tangential zur Fahrbahn)
      _g.set(0, -GRAVITY, 0);
      _g.addScaledVector(this.up, -_g.dot(this.up));
      this.vel.addScaledVector(_g, dt);
    } else {
      this.vel.y -= GRAVITY * dt;
      fwd.applyAxisAngle(UP, -this.steer * 1.3 * dt);
      this.up.lerp(UP, 1 - Math.exp(-1.5 * dt)).normalize();
    }
    this.boost = Math.max(0, this.boost - dt);

    this.pos.addScaledVector(this.vel, dt);

    // ---- Banden ----
    const q2 = t.query(this.pos, this.idx, 3);
    if (q2.walls && q2.h < WALL_HEIGHT && q2.h > -2) {
      const lim = hw - CAR_HALF_WIDTH;
      const al = Math.abs(q2.lateral);
      if (al > lim && al < hw + 3) {
        const s = Math.sign(q2.lateral);
        this.pos.addScaledVector(q2.N, s * lim - q2.lateral);
        const vn = this.vel.dot(q2.N) * s;
        if (vn > 0) {
          this.vel.addScaledVector(q2.N, -s * vn * 1.25);
          this.vel.multiplyScalar(0.992);
          this.wallHit = vn;
          // Fahrzeug etwas in Fahrtrichtung drehen
          _d.copy(this.vel).addScaledVector(this.up, -this.vel.dot(this.up));
          if (_d.lengthSq() > 4) this.fwd.lerp(_d.normalize(), 0.25).normalize();
        }
      }
    }
  }

  // Von der Strecke gefallen?
  hasFallen() {
    const q = this.q;
    if (this.pos.y < -1) return true;
    if (!q) return false;
    const off = !q.road || Math.abs(q.lateral) > this.track.halfWidth + 1;
    return off && q.h < -12;
  }
}

// ---------- 3D-Modell ----------
export function createCarModel(color = '#1f6fff', ghost = false) {
  const group = new THREE.Group();
  const matOpts = ghost ? { transparent: true, opacity: 0.35, depthWrite: false } : {};
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.35, ...matOpts });
  const dark = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.6, ...matOpts });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd3ff', metalness: 0.6, roughness: 0.1, ...matOpts });
  const light = new THREE.MeshStandardMaterial({ color: '#fff6c8', emissive: '#fff2a0', emissiveIntensity: 1, ...matOpts });
  const tail = new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff0000', emissiveIntensity: 0.8, ...matOpts });

  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = !ghost;
    group.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(2.0, 0.45, 4.3), paint, 0, 0.55, 0);
  add(new THREE.BoxGeometry(1.7, 0.25, 1.6), paint, 0, 0.85, 1.4).rotation.x = 0.12;
  add(new THREE.BoxGeometry(1.4, 0.45, 1.6), glass, 0, 1.0, -0.2);
  add(new THREE.BoxGeometry(2.1, 0.12, 0.6), dark, 0, 1.25, -2.0);
  add(new THREE.BoxGeometry(0.12, 0.45, 0.4), dark, 0.7, 1.0, -2.0);
  add(new THREE.BoxGeometry(0.12, 0.45, 0.4), dark, -0.7, 1.0, -2.0);
  add(new THREE.BoxGeometry(2.05, 0.2, 0.5), dark, 0, 0.35, 2.05);
  add(new THREE.BoxGeometry(0.45, 0.14, 0.05), light, 0.6, 0.65, 2.16);
  add(new THREE.BoxGeometry(0.45, 0.14, 0.05), light, -0.6, 0.65, 2.16);
  add(new THREE.BoxGeometry(0.5, 0.12, 0.05), tail, 0.6, 0.65, -2.16);
  add(new THREE.BoxGeometry(0.5, 0.12, 0.05), tail, -0.6, 0.65, -2.16);

  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.42, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.8, roughness: 0.3, ...matOpts });
  const wheels = [];
  for (const [x, z, front] of [[1.05, 1.35, true], [-1.05, 1.35, true], [1.05, -1.35, false], [-1.05, -1.35, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.45, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, dark);
    tire.castShadow = !ghost;
    spin.add(tire, new THREE.Mesh(rimGeo, rimMat));
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ pivot, spin, front });
  }
  group.userData.wheels = wheels;
  return group;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();

export function orientModel(model, pos, fwd, up) {
  _x.crossVectors(up, fwd).normalize();
  const f = _d.crossVectors(_x, up).normalize();
  _m.makeBasis(_x, up, f);
  model.quaternion.setFromRotationMatrix(_m);
  model.position.copy(pos);
}
