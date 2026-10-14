import * as THREE from 'three';
import { CarPhysics } from './car.js';

const DT = 1 / 120;
const cache = new Map();
const _to = new THREE.Vector3();
const _right = new THREE.Vector3();

// Medaillenzeiten aus einer simulierten Ideallinie (Vollgas, lenkt zur Streckenmitte)
export function computeMedals(track) {
  const id = track.def.id;
  if (cache.has(id)) return cache.get(id);
  const car = new CarPhysics(track);
  car.placeAt(track.startIdx);
  let steps = 0;
  let respawnIdx = track.startIdx;
  let cp = 0;
  while (steps < 120 * 300) {
    const look = Math.min(track.P.length - 1, car.idx + 12 + Math.floor(car.speed * 0.25));
    _to.subVectors(track.P[look], car.pos);
    _right.crossVectors(car.fwd, car.up);
    const steer = THREE.MathUtils.clamp((_to.dot(_right) / _to.length()) * 4, -1, 1);
    car.step(DT, { throttle: 1, brake: 0, steer, drift: false });
    steps++;
    if (cp < track.checkpoints.length && car.idx >= track.checkpoints[cp]) respawnIdx = track.checkpoints[cp++] + 3;
    if (cp === track.checkpoints.length && car.idx >= track.finishIdx) break;
    if (car.hasFallen()) car.placeAt(respawnIdx);
  }
  const base = steps * DT;
  const r = (v) => Math.ceil(v * 10) * 100;
  const medals = {
    author: r(base * 1.01),
    gold: r(base * 1.07),
    silver: r(base * 1.2),
    bronze: r(base * 1.45),
  };
  cache.set(id, medals);
  return medals;
}
