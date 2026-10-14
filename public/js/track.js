import * as THREE from 'three';

export const STEP = 1; // Meter pro Stützpunkt
const UP = new THREE.Vector3(0, 1, 0);

const EASE = {
  smooth: (u) => u * u * (3 - 2 * u),
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  linear: (u) => u,
};

function boxFilter(arr, radius) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      if (k >= 0 && k < arr.length) {
        sum += arr[k];
        n++;
      }
    }
    out[i] = sum / n;
  }
  return out;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Track {
  constructor(def) {
    this.def = def;
    this.width = def.width || 18;
    this.halfWidth = this.width / 2;
    this.samples = [];
    this.checkpoints = [];
    this.finishIdx = 0;
    this.startIdx = 6;
    this._generate();
    this._computeFrames();
  }

  _generate() {
    const blocks = [...this.def.blocks, { len: 110, finish: true }];
    let x = 0;
    let z = 0;
    let y = this.def.startHeight ?? 5;
    let heading = 0;
    const s = this.samples;
    s.push({ x, y, z, type: 'road', road: true, walls: true, bank: 0 });

    for (const b of blocks) {
      const n = Math.max(1, Math.round(b.len / STEP));
      const seg = b.len / n;
      const turn = THREE.MathUtils.degToRad(b.turn || 0);
      const ease = EASE[b.ease || 'smooth'];
      const y0 = y;
      const h0 = heading;
      const type = b.type || 'road';
      const bank = (b.bank || 0) * Math.sign(b.turn || 0);
      if (b.cp) this.checkpoints.push(s.length - 1);
      if (b.finish) this.finishIdx = s.length - 1;

      for (let k = 1; k <= n; k++) {
        const u = k / n;
        const hm = h0 - turn * ((k - 0.5) / n);
        x += Math.sin(hm) * seg;
        z += Math.cos(hm) * seg;
        heading = h0 - turn * u;
        y = y0 + (b.dy || 0) * ease(u);
        s.push({
          x, y, z, type,
          road: type !== 'gap',
          walls: type !== 'gap' && b.walls !== false,
          bank,
        });
      }
    }

    // Querneigung weich ein- und ausblenden
    let banks = s.map((p) => p.bank);
    banks = boxFilter(boxFilter(banks, 18), 18);
    banks.forEach((v, i) => (s[i].bank = v));
    this.length = (s.length - 1) * STEP;
  }

  _computeFrames() {
    const s = this.samples;
    const n = s.length;
    this.P = s.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.T = [];
    this.N = [];
    this.U = [];
    for (let i = 0; i < n; i++) {
      // Segment i→i+1 gehört zu Stützpunkt i+1
      const nextRoad = i < n - 1 ? s[i + 1].road : false;
      const prevRoad = i > 0 ? s[i].road : false;
      let i0 = Math.max(0, i - 1);
      let i1 = Math.min(n - 1, i + 1);
      if (!nextRoad && prevRoad) i1 = i;
      else if (nextRoad && !prevRoad) i0 = i;
      const T = new THREE.Vector3().subVectors(this.P[i1], this.P[i0]).normalize();
      const R = new THREE.Vector3().crossVectors(T, UP).normalize();
      const U0 = new THREE.Vector3().crossVectors(R, T);
      const b = THREE.MathUtils.degToRad(s[i].bank);
      const N = R.clone().multiplyScalar(Math.cos(b)).addScaledVector(U0, -Math.sin(b));
      const U = U0.clone().multiplyScalar(Math.cos(b)).addScaledVector(R, Math.sin(b));
      this.T.push(T);
      this.N.push(N);
      this.U.push(U);
    }
  }

  // Liefert die Lage relativ zur Strecke: nächster Stützpunkt, seitlicher Versatz, Höhe über Fahrbahn
  query(pos, hint, win = 40) {
    const n = this.P.length;
    let best = hint;
    let bd = Infinity;
    const lo = Math.max(0, hint - win);
    const hi = Math.min(n - 1, hint + win);
    for (let i = lo; i <= hi; i++) {
      const d = this.P[i].distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    let j = best;
    if (best >= n - 1) j = n - 2;
    else if (best > 0 && _a.subVectors(pos, this.P[best]).dot(this.T[best]) < 0) j = best - 1;

    const a = this.P[j];
    const b = this.P[j + 1];
    _b.subVectors(b, a);
    const f = THREE.MathUtils.clamp(_a.subVectors(pos, a).dot(_b) / _b.lengthSq(), 0, 1);
    const P = a.clone().lerp(b, f);
    const N = this.N[j].clone().lerp(this.N[j + 1], f).normalize();
    const U = this.U[j].clone().lerp(this.U[j + 1], f).normalize();
    const T = this.T[j].clone().lerp(this.T[j + 1], f).normalize();
    _a.subVectors(pos, P);
    const sm = this.samples[j + 1];
    return {
      idx: best,
      dist: j + f,
      P, N, U, T,
      lateral: _a.dot(N),
      h: _a.dot(U),
      road: sm.road,
      walls: sm.walls,
      type: sm.type,
    };
  }

}
