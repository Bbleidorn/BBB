import * as THREE from 'three';
import { STEP } from './track.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function roadTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3b3f46';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const v = 50 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v + 6},0.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#e8e8e8';
    g.fillRect(w * 0.035, 0, w * 0.02, h);
    g.fillRect(w * 0.945, 0, w * 0.02, h);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(w * 0.495, 0, w * 0.01, h * 0.5);
  });
}

function boostTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#ff6a00';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffe14d';
    g.lineWidth = 22;
    g.lineJoin = 'miter';
    for (const y of [70, 190]) {
      g.beginPath();
      g.moveTo(w * 0.15, y + 45);
      g.lineTo(w * 0.5, y - 25);
      g.lineTo(w * 0.85, y + 45);
      g.stroke();
    }
  });
}

function bannerTexture(text, bg, fg, checker = false) {
  return canvasTexture(1024, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (checker) {
      const s = 32;
      for (let y = 0; y < h; y += s)
        for (let x = 0; x < w; x += s)
          if ((x / s + y / s) % 2 === 0) {
            g.fillStyle = '#111';
            g.fillRect(x, y, s, s);
          }
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(w * 0.25, 10, w * 0.5, h - 20);
    }
    g.fillStyle = fg;
    g.font = 'bold 84px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

class Builder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
  }
  // Viereck a-b-c-d, optional mit UVs und Farbe
  quad(a, b, c, d, uvs, color) {
    const verts = [a, b, c, a, c, d];
    const uvo = uvs ? [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]] : null;
    for (let k = 0; k < 6; k++) {
      this.pos.push(verts[k].x, verts[k].y, verts[k].z);
      if (uvo) this.uv.push(uvo[k][0], uvo[k][1]);
      if (color) this.col.push(color.r, color.g, color.b);
    }
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    return geo;
  }
}

const v = () => new THREE.Vector3();

export function buildTrackMeshes(track) {
  const group = new THREE.Group();
  const { P, N, U, samples } = track;
  const hw = track.halfWidth;
  const n = P.length;

  const road = new Builder();
  const boost = new Builder();
  const skirt = new Builder();
  const walls = new Builder();
  const red = new THREE.Color('#d6312b');
  const white = new THREE.Color('#f2f2f2');
  const skirtDepth = 1.4;
  const wallH = 1.1;
  const wallW = 0.7;
  const texLen = 16;

  const edge = (i, side, out = 0, up = 0) =>
    v().copy(P[i]).addScaledVector(N[i], side * (hw + out)).addScaledVector(U[i], up);

  for (let i = 0; i < n - 1; i++) {
    const s = samples[i + 1];
    if (!s.road) continue;
    const j = i + 1;
    const L0 = edge(i, -1), R0 = edge(i, 1), L1 = edge(j, -1), R1 = edge(j, 1);
    const v0 = (i * STEP) / texLen, v1 = (j * STEP) / texLen;
    const target = s.type === 'boost' ? boost : road;
    target.quad(L0, R0, R1, L1, [[0, v0], [1, v0], [1, v1], [0, v1]]);

    // Unterbau
    for (const side of [-1, 1]) {
      const a = edge(i, side), b = edge(j, side);
      const c = edge(j, side, 0, -skirtDepth), d = edge(i, side, 0, -skirtDepth);
      skirt.quad(a, b, c, d);
    }
    skirt.quad(edge(i, -1, 0, -skirtDepth), edge(i, 1, 0, -skirtDepth), edge(j, 1, 0, -skirtDepth), edge(j, -1, 0, -skirtDepth));

    // Banden mit rot-weißen Streifen
    if (s.walls) {
      const col = Math.floor(i / 4) % 2 === 0 ? red : white;
      for (const side of [-1, 1]) {
        const ib0 = edge(i, side, 0, 0), ib1 = edge(j, side, 0, 0);
        const it0 = edge(i, side, 0, wallH), it1 = edge(j, side, 0, wallH);
        const ot0 = edge(i, side, wallW, wallH), ot1 = edge(j, side, wallW, wallH);
        const ob0 = edge(i, side, wallW, -skirtDepth), ob1 = edge(j, side, wallW, -skirtDepth);
        walls.quad(ib0, ib1, it1, it0, null, col);
        walls.quad(it0, it1, ot1, ot0, null, col);
        walls.quad(ot0, ot1, ob1, ob0, null, col);
      }
    }
  }

  // Stirnseiten an Lücken (Schanzenkante / Landung)
  for (let i = 1; i < n - 1; i++) {
    const startGap = samples[i].road && !samples[i + 1].road;
    const endGap = !samples[i].road && samples[i + 1].road;
    if (startGap || endGap) {
      skirt.quad(edge(i, -1), edge(i, 1), edge(i, 1, 0, -skirtDepth), edge(i, -1, 0, -skirtDepth));
    }
  }

  const roadTex = roadTexture();
  const boostTex = boostTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, side: THREE.DoubleSide });
  const boostMat = new THREE.MeshStandardMaterial({
    map: boostTex, roughness: 0.5, emissive: new THREE.Color('#ff5a00'), emissiveIntensity: 0.35, side: THREE.DoubleSide,
  });
  const skirtMat = new THREE.MeshStandardMaterial({ color: '#5d6b7a', roughness: 0.9, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });

  for (const [b, mat] of [[road, roadMat], [boost, boostMat], [skirt, skirtMat], [walls, wallMat]]) {
    if (!b.pos.length) continue;
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.castShadow = mat !== roadMat && mat !== boostMat;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Pfeiler
  const pillarIdx = [];
  for (let i = 0; i < n; i += 22) {
    if (samples[i].road && P[i].y - skirtDepth > 0.5) pillarIdx.push(i);
  }
  const pillarGeo = new THREE.BoxGeometry(2, 1, 2);
  pillarGeo.translate(0, 0.5, 0);
  const pillars = new THREE.InstancedMesh(
    pillarGeo,
    new THREE.MeshStandardMaterial({ color: '#8a96a3', roughness: 0.9 }),
    pillarIdx.length,
  );
  const m = new THREE.Matrix4();
  pillarIdx.forEach((i, k) => {
    const height = P[i].y - skirtDepth;
    m.makeScale(1, height, 1).setPosition(P[i].x, 0, P[i].z);
    pillars.setMatrixAt(k, m);
  });
  pillars.castShadow = true;
  pillars.receiveShadow = true;
  group.add(pillars);

  // Tore
  const gates = [];
  const makeGate = (idx, label, color, checker) => {
    const g = new THREE.Group();
    const basis = new THREE.Matrix4().makeBasis(N[idx].clone().negate(), U[idx], track.T[idx]);
    g.quaternion.setFromRotationMatrix(basis);
    g.position.copy(P[idx]);
    const postMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });
    const postGeo = new THREE.BoxGeometry(1.2, 8, 1.2);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(side * (hw + 1.4), 4, 0);
      post.castShadow = true;
      g.add(post);
    }
    const bannerMat = new THREE.MeshStandardMaterial({
      map: bannerTexture(label, color, '#fff', checker), roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.08,
    });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2 * hw + 4, 2.2, 0.6), bannerMat);
    banner.position.set(0, 8, 0);
    banner.castShadow = true;
    g.add(banner);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * hw, 1.2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.04;
    g.add(line);
    group.add(g);
    return { group: g, postMat, line };
  };

  makeGate(14, 'START', '#1e9e57');
  track.checkpoints.forEach((idx, k) => {
    gates.push(makeGate(idx, `CHECKPOINT ${k + 1}`, '#2a7fff'));
  });
  makeGate(track.finishIdx, 'ZIEL', '#c0392b', true);

  return { group, gates };
}

// Bäume und Gelände rund um die Strecke
export function buildScenery(track, seed = 1) {
  const group = new THREE.Group();
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);

  const grass = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#5a9a3c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const c = 70 + Math.random() * 60;
      g.fillStyle = `rgba(${c * 0.6},${c + 40},${c * 0.4},0.35)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  });
  grass.repeat.set(400, 400);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Platzierung abseits der Strecke
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.P) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 250;
  const coarse = track.P.filter((_, i) => i % 4 === 0);
  const spots = [];
  for (let tries = 0; tries < 6000 && spots.length < 700; tries++) {
    const x = minX - pad + rand() * (maxX - minX + 2 * pad);
    const z = minZ - pad + rand() * (maxZ - minZ + 2 * pad);
    let ok = true;
    for (const p of coarse) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < 30 * 30) { ok = false; break; }
    }
    if (ok) spots.push([x, z, 0.7 + rand() * 0.9]);
  }

  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3, 6);
  trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.ConeGeometry(2.6, 7, 7);
  crownGeo.translate(0, 6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6b4a2b' }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#2f6b33', flatShading: true }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, sc], k) => {
    m.makeScale(sc, sc, sc).setPosition(x, 0, z);
    trunks.setMatrixAt(k, m);
    crowns.setMatrixAt(k, m);
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);

  // Himmel mit Farbverlauf
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2b6fd6') },
        bottom: { value: new THREE.Color('#cfe6ff') },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
        void main(){ float h = clamp(normalize(vPos).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
    }),
  );
  sky.userData.followCamera = true;
  group.add(sky);
  return { group, sky };
}
