// World builders: geometry, materials, colliders and layouts for the three worlds.
import * as THREE from 'three';
import { std, glow, membrane, beamMaterial, portalMaterial, createSky, createMotes, voronoiTextures, grassTexture, rng, timeU, isMobile } from './fx.js';

const TAU = Math.PI * 2;
export const ARENA_R = 33.5; // walkable radius
export const GATE = { x: 0, z: -27 };
export const SPAWN = [0, 0, 24];

class Builder {
  constructor(seed) {
    this.group = new THREE.Group();
    this.colliders = [];
    this.mini = [];
    this.anims = [];
    this.R = rng(seed);
  }
  add(o) {
    this.group.add(o);
    return o;
  }
  circle(x, z, r, top, mini = true) {
    this.colliders.push({ t: 'c', x, z, r, top });
    if (mini) this.mini.push({ t: 'c', x, z, r });
  }
  box(cx, cz, w, d, top) {
    const c = { t: 'b', x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top };
    this.colliders.push(c);
    this.mini.push(c);
  }
  // chain of circles along a rotated axis (for lying capsules)
  capsule(x, z, half, r, rotY, top, n = 3) {
    for (let i = 0; i < n; i++) {
      const o = -half + (2 * half * i) / (n - 1);
      this.circle(x + Math.cos(rotY) * o, z - Math.sin(rotY) * o, r, top, false);
    }
    this.mini.push({ t: 'cap', x, z, half, r, rot: rotY });
  }
  anim(fn) {
    this.anims.push(fn);
  }
}

function shadow(o, cast = true, recv = true) {
  o.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = recv;
    }
  });
  return o;
}

// ---------------- shared pieces ----------------
function floor(b, maps, radius = 42, color = 0xffffff, ei = 1) {
  const mat = new THREE.MeshStandardMaterial({ map: maps.map, emissiveMap: maps.emissiveMap, emissive: maps.emissiveMap ? 0xffffff : 0, emissiveIntensity: ei, roughness: 0.62, metalness: 0.05, color });
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 128), mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  b.add(m);
  return m;
}

function membraneWall(b, { color, rim, r = 35.6, h = 14, wobble = 0.35, opacity = 0.1, base }) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 160, 20, true), membrane({ color, rim, opacity, wobble, intensity: 1.4, power: 1.6, side: THREE.DoubleSide, speed: 0.8 }));
  m.position.y = h / 2 - 0.5;
  b.add(m);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 220), glow(base ?? rim, 1.1));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  b.add(ring);
}

function pillarPlatform(b, x, z, top, r, padColor, rimColor) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.45, top - 0.3, 16), std(padColor, { rough: 0.5, emissive: padColor, ei: 0.15 }));
  stalk.position.y = (top - 0.3) / 2;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.86, 0.32, 40), std(padColor, { rough: 0.35, metal: 0.1, emissive: padColor, ei: 0.25 }));
  pad.position.y = top - 0.16;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.06, 8, 64), glow(rimColor, 2.4));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = top + 0.01;
  g.add(stalk, pad, rim);
  shadow(g);
  rim.castShadow = false;
  b.add(g);
  b.circle(x, z, r, top);
  return g;
}

function filaments(b, color, count, seed) {
  const R = rng(seed);
  const mat = glow(color, 0.9, { opacity: 0.55 });
  for (let i = 0; i < count; i++) {
    const pts = [];
    const a = R() * TAU;
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      pts.push(new THREE.Vector3(Math.cos(a) * 34 * (1 - 2 * t) + (R() - 0.5) * 10, 7 + R() * 7, Math.sin(a) * 34 * (1 - 2 * t) + (R() - 0.5) * 10));
    }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.05 + R() * 0.05, 5), mat);
    b.add(m);
  }
}

// ---------------- gate ----------------
export function makeGate(colA, colB) {
  const g = new THREE.Group();
  g.position.set(GATE.x, 0, GATE.z);
  const metal = std(0x1f2b33, { metal: 0.85, rough: 0.28 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.0, 0.3, 64), metal);
  base.position.y = 0.15;
  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(4.65, 0.07, 8, 128), glow(colA, 2.4));
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.31;
  const arch = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.38, 20, 90, Math.PI), metal);
  arch.position.y = 3.0;
  const archGlow = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.07, 8, 90, Math.PI), glow(colA, 2.6));
  archGlow.position.y = 3.0;
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.55, 3.0, 20), metal);
    l.position.set(s * 3.3, 1.5, 0);
    return l;
  });
  const legGlow = [-1, 1].map((s) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.0, 0.08), glow(colA, 2.6));
    l.position.set(s * 2.95, 1.5, 0);
    return l;
  });
  // portal surface (arch shape)
  const shape = new THREE.Shape();
  shape.moveTo(-2.95, 0.3);
  shape.lineTo(-2.95, 3.0);
  shape.absarc(0, 3.0, 2.95, Math.PI, 0, true);
  shape.lineTo(2.95, 0.3);
  shape.lineTo(-2.95, 0.3);
  const portalMat = portalMaterial();
  const portal = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), portalMat);
  portal.position.z = 0.02;
  const locks = [Math.PI * 0.78, Math.PI * 0.5, Math.PI * 0.22].map((a) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), std(0xff3355, { emissive: 0xff3355, ei: 1.0, rough: 0.2, metal: 0.3, flat: true }));
    m.position.set(Math.cos(a) * 3.3, 3.0 + Math.sin(a) * 3.3, 0.42);
    return m;
  });
  const light = new THREE.PointLight(colA, 8, 14, 1.8);
  light.position.set(0, 3.2, 2.2);
  g.add(base, baseRing, arch, archGlow, ...legs, ...legGlow, portal, ...locks, light);
  shadow(g, true, true);
  portal.castShadow = false;
  const cA = new THREE.Color(colA), cB = new THREE.Color(colB), tmp = new THREE.Color();
  portalMat.uniforms.uA.value.copy(cA);
  portalMat.uniforms.uB.value.copy(cB);
  let act = 0;
  return {
    group: g,
    colliders: [
      { t: 'c', x: GATE.x - 3.3, z: GATE.z, r: 0.6, top: 7 },
      { t: 'c', x: GATE.x + 3.3, z: GATE.z, r: 0.6, top: 7 },
      { t: 'c', x: GATE.x, z: GATE.z, r: 4.8, top: 0.3 },
    ],
    update(dt, t, lockState, open) {
      act += ((open ? 1 : 0) - act) * Math.min(1, dt * 2);
      portalMat.uniforms.uActive.value = act;
      tmp.copy(cA).lerp(cB, act);
      for (const m of [baseRing, archGlow, ...legGlow]) {
        m.material.color.copy(tmp);
        m.material.emissive.copy(tmp);
      }
      light.color.copy(tmp);
      light.intensity = 7 + act * 9 + Math.sin(t * 3) * 1.5;
      locks.forEach((m, i) => {
        const on = lockState[i];
        m.material.color.set(on ? 0x5dffb0 : 0xff3355);
        m.material.emissive.set(on ? 0x5dffb0 : 0xff3355);
        m.material.emissiveIntensity = on ? 3.2 : 0.9 + Math.sin(t * 4 + i) * 0.3;
        m.rotation.y = t * (on ? 2.5 : 0.6);
        m.scale.setScalar(on ? 1.15 : 1);
      });
    },
  };
}

// ---------------- clue crystal ----------------
export function makeClue(info, pos) {
  const g = new THREE.Group();
  g.position.copy(pos);
  const color = info.color;
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.78, 0.25, 6), std(0x1d2830, { metal: 0.7, rough: 0.3 }));
  ped.position.y = 0.125;
  ped.castShadow = ped.receiveShadow = true;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, metalness: 0.3, roughness: 0.12, flatShading: true }));
  crystal.scale.set(1, 1.6, 1);
  crystal.castShadow = true;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), glow(0xffffff, 5));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.022, 6, 64), glow(color, 3));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 16, 24, 1, true), beamMaterial(color, info.secret ? 1.3 : 1));
  beam.position.y = 8.2;
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.02, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.27;
  const floatG = new THREE.Group();
  floatG.add(crystal, core, halo);
  g.add(ped, floatG, beam, ring);
  let found = false;
  let shrink = 1;
  const phase = Math.random() * 10;
  return {
    group: g,
    id: info.id,
    pos,
    get found() {
      return found;
    },
    setFound(f) {
      found = f;
      if (!f) {
        shrink = 1;
        floatG.visible = beam.visible = true;
      }
    },
    update(dt, t) {
      if (found && shrink > 0) {
        shrink = Math.max(0, shrink - dt * 2.5);
        if (shrink === 0) floatG.visible = beam.visible = false;
      }
      const s = found ? shrink : 1;
      floatG.scale.setScalar(s);
      floatG.position.y = 1.35 + Math.sin(t * 2 + phase) * 0.15;
      crystal.rotation.y = t * 1.6;
      halo.rotation.x = Math.PI / 2 + Math.sin(t + phase) * 0.4;
      halo.rotation.y = t * 0.8;
      beam.scale.set(s, 1, s);
      ringMat.opacity = found ? 0.18 : 0.6 + Math.sin(t * 3 + phase) * 0.25;
      ring.rotation.z = t * 0.5;
    },
  };
}

// ---------------- hazards ----------------
export function makeHazard(kind) {
  const g = new THREE.Group();
  if (kind === 'virus') {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), std(0xff2d55, { emissive: 0xff1040, ei: 1.3, rough: 0.35, flat: true }));
    g.add(core);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const p = ico.attributes.position;
    const seen = new Set();
    const spikeMat = std(0xffb3c4, { emissive: 0xff4d7a, ei: 1.6 });
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
      const k = v.toArray().map((n) => n.toFixed(2)).join();
      if (seen.has(k)) continue;
      seen.add(k);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 6), spikeMat);
      stick.position.copy(v).multiplyScalar(0.62);
      stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), glow(0xff8aa8, 2.6));
      tip.position.copy(v).multiplyScalar(0.82);
      g.add(stick, tip);
    }
  } else if (kind === 'radical') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), glow(0xffe08a, 3.2)));
    const R = rng(9);
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.75, 6), glow(0xff7a1a, 2.2));
      c.position.copy(v).multiplyScalar(0.45);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      g.add(c);
    }
  } else {
    // smog cloud with grumpy eyes
    const R = rng(4);
    const mat = std(0x46335a, { emissive: 0x2a1040, ei: 0.7, rough: 1, opacity: 0.92 });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.45 + R() * 0.35, 14, 10), mat);
      s.position.set((R() - 0.5) * 1.3, (R() - 0.5) * 0.5, (R() - 0.5) * 0.9);
      g.add(s);
    }
    for (const sx of [-0.25, 0.25]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), glow(0xfff3a0, 2.5));
      eye.position.set(sx, 0.15, 0.62);
      eye.scale.set(1, 0.6, 0.6);
      g.add(eye);
    }
  }
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return g;
}

export function hazardPos(h, t, out) {
  out.set(h.cx + h.ax * Math.sin(h.fx * t + h.ph), h.y + Math.sin(t * 2.2 + h.ph) * 0.3, h.cz + h.az * Math.sin(h.fz * t + h.ph * 1.7));
  return out;
}

// ================= WORLD 1: plant cell =================
function plantCell() {
  const b = new Builder(11);
  floor(b, voronoiTextures({ base: 0x14544a, inner: 0x2a8270, edge: 0x072a25, glow: 0x5dffd0, seeds: 30, seed: 3, repeat: 7 }), 42, 0xffffff, 0.45);
  membraneWall(b, { color: 0x0b3b33, rim: 0x6dffe0, opacity: 0.08, wobble: 0.4 });

  // cellulose wall bricks behind the membrane
  const brickGeo = new THREE.BoxGeometry(2.3, 2.6, 1.1);
  const N = 92;
  const bricks = new THREE.InstancedMesh(brickGeo, std(0x6f9c3c, { rough: 0.85, emissive: 0x16300a, ei: 1 }), N * 3);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  let k = 0;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < N; i++) {
      const a = ((i + (row % 2) * 0.5) / N) * TAU;
      P.set(Math.cos(a) * 38.2, 1.35 + row * 2.75, Math.sin(a) * 38.2);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      S.set(1, 0.9 + b.R() * 0.15, 0.9 + b.R() * 0.3);
      M.compose(P, Q, S);
      bricks.setMatrixAt(k++, M);
    }
  }
  bricks.receiveShadow = true;
  b.add(bricks);

  // Nucleus
  {
    const x = -12, z = -7, r = 5;
    const g = new THREE.Group();
    g.position.set(x, r * 0.92, z);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 72, 48), membrane({ color: 0x2a1060, rim: 0xc49bff, opacity: 0.26, wobble: 0.1, intensity: 2.0 }));
    const nucleolus = new THREE.Mesh(new THREE.SphereGeometry(r * 0.34, 32, 24), glow(0xd59bff, 1.3));
    nucleolus.position.set(r * 0.2, -r * 0.1, 0.4);
    g.add(shell, nucleolus);
    for (let s = 0; s < 3; s++) {
      const pts = [];
      for (let i = 0; i < 40; i++) {
        const v = new THREE.Vector3(b.R() - 0.5, b.R() - 0.5, b.R() - 0.5).normalize().multiplyScalar(r * (0.3 + b.R() * 0.45));
        pts.push(v);
      }
      const chrom = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 400, 0.06, 5, true), glow([0xb07bff, 0x8f6bff, 0xe0a8ff][s], 0.9));
      g.add(chrom);
      b.anim((dt) => (chrom.rotation.y += dt * (0.05 + s * 0.03)));
    }
    // nuclear pores
    const pores = new THREE.InstancedMesh(new THREE.TorusGeometry(0.22, 0.06, 6, 14), glow(0xc9a8ff, 0.5), 90);
    for (let i = 0; i < 90; i++) {
      const yy = 1 - (i / 89) * 2, rr = Math.sqrt(1 - yy * yy), th = i * 2.39996;
      const n = new THREE.Vector3(Math.cos(th) * rr, yy, Math.sin(th) * rr);
      P.copy(n).multiplyScalar(r * 1.0);
      Q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      M.compose(P, Q, S.set(1, 1, 1));
      pores.setMatrixAt(i, M);
    }
    g.add(pores);
    b.add(g);
    b.circle(x, z, r * 0.98, 10);
    // rough ER ribbons around the nucleus
    const erMat = std(0x46c9b4, { emissive: 0x0f4d44, ei: 1, rough: 0.4, opacity: 0.85 });
    const ribo = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), glow(0xffe066, 2), 260);
    let ri = 0;
    [[r + 1.7, 3.4, 0.2], [r + 2.6, 5.6, -0.15]].forEach(([rad, yy, tilt]) => {
      const geo = new THREE.TorusGeometry(rad, 0.32, 10, 160);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const ang = Math.atan2(p.getY(i), p.getX(i));
        p.setZ(i, p.getZ(i) * 0.35 + Math.sin(ang * 9) * 0.45);
      }
      geo.computeVertexNormals();
      const er = new THREE.Mesh(geo, erMat);
      er.rotation.x = Math.PI / 2 + tilt;
      er.position.set(x, yy, z);
      b.add(er);
      for (let i = 0; i < 130; i++) {
        const a = (i / 130) * TAU;
        P.set(Math.cos(a) * (rad + (b.R() - 0.5) * 0.5), Math.sin(a) * rad, Math.sin(a * 9) * 0.45 + 0.3 * (b.R() > 0.5 ? 1 : -1));
        P.applyEuler(er.rotation).add(er.position);
        M.compose(P, Q.identity(), S.set(1, 1, 1));
        ribo.setMatrixAt(ri++, M);
      }
    });
    b.add(ribo);
  }

  // Vacuole
  {
    const x = 13, z = 3, r = 6.2;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), membrane({ color: 0x0b3a6e, rim: 0x8fd0ff, opacity: 0.16, wobble: 0.22, intensity: 1.8 }));
    shell.position.set(x, r * 0.5, z);
    b.add(shell);
    const sap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 48, 32), std(0x2f7fd0, { opacity: 0.22, rough: 0.1, metal: 0.2, emissive: 0x0a2a60, ei: 1 }));
    sap.position.copy(shell.position);
    b.add(sap);
    const bits = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.25 + b.R() * 0.25), glow(0x9fd8ff, 1.6));
      m.userData.o = [b.R() * TAU, 1 + b.R() * 3.5, 1 + b.R() * 4.5];
      bits.push(m);
      b.add(m);
    }
    b.anim((dt, t) => bits.forEach((m) => {
      const [a, rr, yy] = m.userData.o;
      m.position.set(x + Math.cos(a + t * 0.2) * rr, yy + Math.sin(t + a) * 0.4, z + Math.sin(a + t * 0.2) * rr);
      m.rotation.y = t + a;
    }));
    b.circle(x, z, 6.0, 9.3);
  }

  // Chloroplasts
  const granaGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20);
  [[4, -13.5, 0.3], [-22, 8, 1.2], [23, -6, -0.6]].forEach(([x, z, rot]) => {
    const g = new THREE.Group();
    g.position.set(x, 1.35, z);
    g.rotation.y = rot;
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 4.2, 10, 28), membrane({ color: 0x0f5a1e, rim: 0x8dff9a, opacity: 0.32, wobble: 0.05, intensity: 1.6 }));
    shell.rotation.z = Math.PI / 2;
    const stroma = new THREE.Mesh(new THREE.CapsuleGeometry(1.12, 4.0, 8, 24), std(0x2f9e3c, { emissive: 0x0c3a12, ei: 1, opacity: 0.55, rough: 0.3 }));
    stroma.rotation.z = Math.PI / 2;
    const grana = new THREE.InstancedMesh(granaGeo, glow(0x6dff5c, 1.3), 30);
    let gi = 0;
    for (let s = -2; s <= 2; s++) for (let l = 0; l < 6; l++) {
      M.compose(P.set(s * 0.85, -0.32 + l * 0.13, (s % 2) * 0.2), Q.identity(), S.set(1, 1, 1));
      grana.setMatrixAt(gi++, M);
    }
    const lam = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.04, 0.2), glow(0x9dff8a, 1.2));
    g.add(stroma, grana, lam, shell);
    b.add(g);
    b.capsule(x, z, 2.1, 1.35, rot, 2.7);
  });

  // Mitochondria
  [[-16.5, 19, 0.4], [21, 18, -0.9]].forEach(([x, z, rot]) => {
    const g = new THREE.Group();
    g.position.set(x, 1.05, z);
    g.rotation.y = rot;
    const outer = new THREE.Mesh(new THREE.CapsuleGeometry(1.0, 2.6, 10, 24), std(0xff8a3d, { opacity: 0.5, rough: 0.3, emissive: 0x3a1200, ei: 1 }));
    outer.rotation.z = Math.PI / 2;
    g.add(outer);
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.25, 1.1), glow(0xffb46b, 1.4));
      c.position.x = -1.55 + i * 0.44;
      c.rotation.z = i % 2 ? 0.45 : -0.45;
      g.add(c);
    }
    shadow(g, true, false);
    b.add(g);
    b.capsule(x, z, 1.3, 1.05, rot, 2.1);
  });

  // Golgi apparatus
  {
    const x = -25, z = -11;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    [2.3, 2.1, 1.85, 1.6, 1.3].forEach((rad, i) => {
      const geo = new THREE.CylinderGeometry(rad, rad, 0.2, 48, 1);
      const p = geo.attributes.position;
      for (let v = 0; v < p.count; v++) p.setY(v, p.getY(v) + (p.getX(v) ** 2 + p.getZ(v) ** 2) * 0.06);
      geo.computeVertexNormals();
      const d = new THREE.Mesh(geo, std(0xffc94d, { emissive: 0x5a3a00, ei: 1, rough: 0.35 }));
      d.position.y = 0.55 + i * 0.42;
      g.add(d);
    });
    const ves = [];
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Mesh(new THREE.SphereGeometry(0.18 + b.R() * 0.12, 12, 8), glow(0xffe08a, 1.6));
      v.userData.a = b.R() * TAU;
      ves.push(v);
      g.add(v);
    }
    b.anim((dt, t) => ves.forEach((v, i) => {
      const a = v.userData.a + t * 0.4;
      v.position.set(Math.cos(a) * (2.9 + (i % 3) * 0.4), 1.2 + Math.sin(t * 1.3 + i) * 0.8, Math.sin(a) * (2.9 + (i % 3) * 0.4));
    }));
    shadow(g);
    b.add(g);
    b.circle(x, z, 2.35, 2.8);
  }

  // stepping vesicles up to the secret clue
  const steps = [[13.5, -18, 1.1, 1.5], [17, -21.5, 2.2, 1.3], [21, -22.5, 3.3, 1.3], [23.5, -18.5, 4.4, 2.0]];
  steps.forEach(([x, z, top, r]) => pillarPlatform(b, x, z, top, r, 0x2e8f86, 0x7dfff0));

  // ribosome dust
  const dust = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), glow(0xfff1a8, 1.5), 260);
  for (let i = 0; i < 260; i++) {
    const a = b.R() * TAU, rr = 4 + Math.sqrt(b.R()) * 29;
    M.compose(P.set(Math.cos(a) * rr, 0.4 + b.R() * 7, Math.sin(a) * rr), Q.identity(), S.setScalar(0.6 + b.R()));
    dust.setMatrixAt(i, M);
  }
  b.add(dust);
  filaments(b, 0x5dffd0, 7, 21);

  return {
    b,
    palette: {
      sky: { top: 0x06232a, horizon: 0x0f5a55, bottom: 0x02100f, nebula: 0x1fae8f, nebulaAmt: 0.35 },
      fog: [0x0a3a3a, 30, 100],
      hemi: [0x9ff7ff, 0x0b2a24, 0.7],
      sun: [0xfff1d6, 2.0, [18, 34, 14]],
      motes: 0x9dffe6,
      bloom: 0.6,
    },
    clues: { nuc: [-12, 0, 0.6], chl: [4, 0, -9.6], mit: [-12.2, 0, 21], vac: [13, 0, 11.6], wal: [-29.4, 0, 2], mem: [28, 0, 8], rib: [23.5, 4.4, -18.5] },
    hazardKind: 'virus',
    hazards: [
      { cx: 0, cz: -2, ax: 10, az: 6, fx: 0.35, fz: 0.5, ph: 0, y: 1.1 },
      { cx: -18, cz: 10, ax: 6, az: 5, fx: 0.5, fz: 0.4, ph: 2, y: 1.1 },
      { cx: 16, cz: -12, ax: 6, az: 4, fx: 0.45, fz: 0.3, ph: 4, y: 1.1 },
      { cx: 0, cz: 13, ax: 12, az: 3, fx: 0.3, fz: 0.7, ph: 1, y: 1.1 },
    ],
    gateColors: [0xff2d6b, 0x3ff0e0],
  };
}

// ================= WORLD 2: inside the mitochondrion =================
function mitochondrion() {
  const b = new Builder(22);
  floor(b, voronoiTextures({ base: 0x5a1a0c, inner: 0x8f3818, edge: 0x2a0804, glow: 0xff7a2a, seeds: 34, seed: 9, repeat: 8, edgeWidth: 0.05 }), 42, 0xffffff, 0.6);
  membraneWall(b, { color: 0x4e1606, rim: 0xffa060, opacity: 0.1, wobble: 0.45 });
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(38.5, 38.5, 18, 120, 10, true), membrane({ color: 0x2e0a02, rim: 0xff7a3a, opacity: 0.05, wobble: 0.6, side: THREE.DoubleSide, intensity: 0.9 }));
  outer.position.y = 8;
  b.add(outer);

  const H = 4.6;
  const wallMat = std(0xd9572a, { emissive: 0x4a1204, ei: 1, rough: 0.45, side: THREE.DoubleSide });
  const capMat = glow(0xffa25a, 1.6);
  const rows = [
    { z: 11, segs: [[-36, -10], [-4, 12], [18, 36]] },
    { z: 0, segs: [[-36, -18], [-12, 4], [10, 36]] },
    { z: -12, segs: [[-36, -14], [-8, 8], [14, 36]] },
  ];
  const stalks = [], heads = [];
  for (const row of rows) {
    const lim = Math.sqrt(35.0 ** 2 - row.z ** 2);
    for (let [x0, x1] of row.segs) {
      x0 = Math.max(x0, -lim);
      x1 = Math.min(x1, lim);
      const len = x1 - x0, cx = (x0 + x1) / 2;
      const geo = new THREE.PlaneGeometry(len, H, Math.ceil(len * 5), 10);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const wx = p.getX(i) + cx, y = p.getY(i);
        p.setZ(i, Math.sin(wx * 1.4) * 0.45 + Math.sin(y * 2 + wx) * 0.08);
      }
      geo.computeVertexNormals();
      const wall = new THREE.Mesh(geo, wallMat);
      wall.position.set(cx, H / 2, row.z);
      wall.castShadow = wall.receiveShadow = true;
      b.add(wall);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, len, 12), capMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(cx, H, row.z);
      b.add(cap);
      b.box(cx, row.z, len, 1.5, H);
      for (let x = x0 + 0.8; x < x1 - 0.5; x += 1.6) {
        for (const yy of [1.2, 2.4, 3.6]) for (const side of [-1, 1]) {
          const zz = row.z + Math.sin(x * 1.4) * 0.45 + side * 0.32;
          stalks.push([x, yy, zz, side]);
          heads.push([x, yy, row.z + Math.sin(x * 1.4) * 0.45 + side * 0.62]);
        }
      }
    }
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
  const stalkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), std(0xffcf9a, { emissive: 0x6a3a10, ei: 1 }), stalks.length);
  const headMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 12, 8), glow(0xffd66b, 1.7), heads.length);
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  stalks.forEach(([x, y, z], i) => {
    M.compose(P.set(x, y, z), qx, S);
    stalkMesh.setMatrixAt(i, M);
  });
  heads.forEach(([x, y, z], i) => {
    M.compose(P.set(x, y, z), Q, S);
    headMesh.setMatrixAt(i, M);
  });
  b.add(stalkMesh, headMesh);

  // Krebs cycle wheel (decor)
  {
    const g = new THREE.Group();
    g.position.set(22, 5.2, -20);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.07, 8, 96), glow(0xff8a3d, 2));
    g.add(ring);
    const nodes = [];
    for (let i = 0; i < 8; i++) {
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), glow([0xff4f8b, 0xffd66b, 0x7dfcff][i % 3], 2));
      nodes.push(n);
      g.add(n);
    }
    b.anim((dt, t) => {
      nodes.forEach((n, i) => {
        const a = (i / 8) * TAU + t * 0.5;
        n.position.set(Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0);
      });
      g.rotation.y = t * 0.3;
    });
    b.add(g);
  }

  // mtDNA ring floating above the secret platform
  {
    const g = new THREE.Group();
    g.position.set(-25.5, 8.6, 5);
    for (let s = 0; s < 2; s++) {
      const pts = [];
      for (let i = 0; i <= 200; i++) {
        const a = (i / 200) * TAU;
        const tw = a * 12 + s * Math.PI;
        pts.push(new THREE.Vector3(Math.cos(a) * (2.2 + Math.cos(tw) * 0.3), Math.sin(tw) * 0.3, Math.sin(a) * (2.2 + Math.cos(tw) * 0.3)));
      }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 300, 0.06, 6, true), glow(s ? 0xd59bff : 0x7dfcff, 2)));
    }
    b.anim((dt, t) => {
      g.rotation.y = t * 0.4;
      g.rotation.x = Math.sin(t * 0.5) * 0.2;
    });
    b.add(g);
  }

  const steps = [[-13.5, 6, 1.1, 1.4], [-17.5, 7.5, 2.2, 1.3], [-21.5, 6, 3.3, 1.3], [-25.5, 5, 4.4, 1.9]];
  steps.forEach(([x, z, top, r]) => pillarPlatform(b, x, z, top, r, 0x8a3a16, 0xffc46b));
  filaments(b, 0xff9a5a, 5, 31);

  return {
    b,
    palette: {
      sky: { top: 0x1a0502, horizon: 0x5a1c08, bottom: 0x0c0201, nebula: 0xff6a2a, nebulaAmt: 0.3 },
      fog: [0x2a0c06, 22, 82],
      hemi: [0xffb48a, 0x2a0a04, 0.7],
      sun: [0xffd8b0, 2.0, [-16, 34, 18]],
      motes: 0xffc46b,
      bloom: 0.65,
    },
    clues: { out: [26, 0, 18], cri: [0, 0, 13.9], mat: [-24, 0, -6], atp: [22, 0, 5.5], eqn: [17, 0, -20], mdn: [-25.5, 4.4, 5] },
    hazardKind: 'radical',
    hazards: [
      { cx: 4, cz: 5.5, ax: 13, az: 1.2, fx: 0.42, fz: 0.9, ph: 0, y: 1.2 },
      { cx: -4, cz: -6, ax: 15, az: 1.5, fx: 0.36, fz: 0.7, ph: 2, y: 1.2 },
      { cx: 0, cz: -20, ax: 12, az: 3.5, fx: 0.5, fz: 0.45, ph: 4, y: 1.2 },
      { cx: 6, cz: 17.5, ax: 12, az: 2.5, fx: 0.33, fz: 0.6, ph: 1, y: 1.2 },
    ],
    gateColors: [0xff6a1a, 0xffe14d],
  };
}

// ================= WORLD 3: ecosystem =================
function lowTree(R, scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.38 * scale, 3 * scale, 7), std(0x6b4a2b, { rough: 0.9, flat: true }));
  trunk.position.y = 1.5 * scale;
  g.add(trunk);
  const greens = [0x3f9a3a, 0x52b246, 0x2f7f33, 0x68c24f];
  [[1.7, 3.3], [1.35, 4.5], [0.95, 5.5]].forEach(([r, y], i) => {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 0), std(greens[(i + Math.floor(R() * 4)) % 4], { rough: 0.8, flat: true }));
    f.position.set((R() - 0.5) * 0.4 * scale, y * scale, (R() - 0.5) * 0.4 * scale);
    f.rotation.set(R() * 3, R() * 3, R() * 3);
    g.add(f);
  });
  shadow(g);
  return g;
}

function ecosystem() {
  const b = new Builder(33);
  const grassTex = grassTexture(5);
  grassTex.repeat.set(48, 48);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(140, 96), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, color: 0xd8f0c0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  b.add(ground);

  // path from spawn to gate
  const curve = new THREE.CatmullRomCurve3([[0, 0, 30], [-3, 0, 16], [2, 0, 6], [-2, 0, -4], [3, 0, -14], [0, 0, -24]].map((p) => new THREE.Vector3(...p)));
  const pathPts = curve.getPoints(120);
  {
    const pos = [], idx = [];
    pathPts.forEach((p, i) => {
      const n = i < pathPts.length - 1 ? pathPts[i + 1].clone().sub(p) : p.clone().sub(pathPts[i - 1]);
      n.normalize();
      const side = new THREE.Vector3(-n.z, 0, n.x).multiplyScalar(1.4 + Math.sin(i * 0.7) * 0.15);
      pos.push(p.x + side.x, 0.02, p.z + side.z, p.x - side.x, 0.02, p.z - side.z);
      if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, i * 2, (i - 1) * 2 + 1, i * 2 + 1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const path = new THREE.Mesh(geo, std(0xa58a5c, { rough: 1, side: THREE.DoubleSide }));
    path.receiveShadow = true;
    b.add(path);
  }
  const nearPath = (x, z) => pathPts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 4);

  // pond
  const pond = { x: 14, z: 7, r: 4.5 };
  {
    const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 64), new THREE.MeshPhysicalMaterial({ color: 0x2f8fd0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.88, clearcoat: 1, emissive: 0x0a3050, emissiveIntensity: 0.6 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(pond.x, 0.06, pond.z);
    b.add(water);
    const ripples = [];
    for (let i = 0; i < 3; i++) {
      const rp = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.4, depthWrite: false }));
      rp.rotation.x = -Math.PI / 2;
      rp.position.set(pond.x + (b.R() - 0.5) * 4, 0.08, pond.z + (b.R() - 0.5) * 4);
      ripples.push(rp);
      b.add(rp);
    }
    b.anim((dt, t) => ripples.forEach((rp, i) => {
      const k = (t * 0.5 + i / 3) % 1;
      rp.scale.setScalar(0.3 + k * 1.6);
      rp.material.opacity = 0.45 * (1 - k);
    }));
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45 + b.R() * 0.4, 0), std(0x8a8f8c, { rough: 0.9, flat: true }));
      rock.position.set(pond.x + Math.cos(a) * (pond.r + 0.2), 0.15, pond.z + Math.sin(a) * (pond.r + 0.2));
      rock.scale.y = 0.6;
      rock.castShadow = rock.receiveShadow = true;
      b.add(rock);
    }
    for (let i = 0; i < 5; i++) {
      const lp = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20, 0.3, TAU - 0.6), std(0x3faa3a, { rough: 0.6, side: THREE.DoubleSide }));
      lp.rotation.x = -Math.PI / 2;
      lp.rotation.z = b.R() * TAU;
      lp.position.set(pond.x + (b.R() - 0.5) * 5, 0.09, pond.z + (b.R() - 0.5) * 5);
      b.add(lp);
    }
    b.circle(pond.x, pond.z, pond.r + 0.3, 3);
  }

  // trees with colliders
  const trees = [[-18, 21], [12, 24], [28, 2], [-29, -11], [25, -18], [-9, -9], [9, -4], [-15, 2], [17, -27], [-6, 26], [21, 19], [27, 13.5], [-26, 14]];
  trees.forEach(([x, z], i) => {
    const t = lowTree(b.R, 0.95 + b.R() * 0.35);
    t.position.set(x, 0, z);
    t.rotation.y = b.R() * TAU;
    b.add(t);
    b.circle(x, z, 0.65, 6);
  });
  // spider web between two trees (food web clue)
  {
    const pts = [];
    const c = new THREE.Vector3(24, 2.6, 16.25);
    const dx = 0.737, dz = -0.676; // along the line between the two trees
    const off = (a, r) => new THREE.Vector3(Math.cos(a) * r * dx, Math.sin(a) * r, Math.cos(a) * r * dz);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      pts.push(c.clone(), c.clone().add(off(a, 1.9)));
    }
    for (let r = 0.4; r <= 1.9; r += 0.3) for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * TAU, a1 = ((i + 1) / 12) * TAU;
      pts.push(c.clone().add(off(a0, r)), c.clone().add(off(a1, r)));
    }
    b.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.8 })));
  }
  // forest ring + hills on the horizon
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * TAU + b.R() * 0.1;
    const rr = 36 + b.R() * 8;
    const t = lowTree(b.R, 1.2 + b.R() * 0.8);
    t.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    b.add(t);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const h = new THREE.Mesh(new THREE.SphereGeometry(18 + b.R() * 12, 24, 12), std([0x4f9a3a, 0x3f8a36, 0x5aa846][i % 3], { rough: 1, flat: true }));
    h.position.set(Math.cos(a) * 85, -8, Math.sin(a) * 85);
    h.scale.y = 0.55;
    b.add(h);
  }

  // stone circle around the sun clue
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    const x = -5 + Math.cos(a) * 3.3, z = 8 + Math.sin(a) * 3.3;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.0 + b.R() * 0.6, 0.5), std(0x9a9a94, { rough: 0.9, flat: true }));
    s.position.set(x, 1, z);
    s.rotation.y = -a;
    s.castShadow = s.receiveShadow = true;
    b.add(s);
    b.circle(x, z, 0.45, 2.2, false);
  }

  // giant flowers (producers)
  const flowerCols = [0xff6fae, 0xffd84d, 0xb88bff, 0xff8a5a];
  [[-12, 18.5], [-14.5, 14], [-9, 13]].forEach(([x, z], i) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const h = 2.2 + i * 0.5;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, h, 8), std(0x3f9a3a));
    stem.position.y = h / 2;
    g.add(stem);
    const head = new THREE.Group();
    head.position.y = h;
    head.rotation.x = 0.5;
    for (let p = 0; p < 8; p++) {
      const pet = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), std(flowerCols[i], { rough: 0.5, emissive: flowerCols[i], ei: 0.25 }));
      const a = (p / 8) * TAU;
      pet.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0);
      pet.scale.set(1, 0.55, 0.2);
      pet.rotation.z = a;
      head.add(pet);
    }
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), glow(0xffe066, 1.2)));
    g.add(head);
    b.anim((dt, t) => (head.rotation.z = Math.sin(t * 0.8 + i) * 0.15));
    shadow(g, true, false);
    b.add(g);
    b.circle(x, z, 0.35, h, false);
  });
  // meadow flowers
  {
    const n = isMobile ? 160 : 320;
    const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), std(0xffffff, { rough: 0.6 }), n);
    const M = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = b.R() * TAU, rr = 3 + Math.sqrt(b.R()) * 30;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      M.makeTranslation(x, 0.25 + b.R() * 0.2, z);
      fl.setMatrixAt(i, M);
      fl.setColorAt(i, col.set(flowerCols[i % 4]));
    }
    b.add(fl);
  }

  // grass blades with wind
  {
    const n = isMobile ? 2600 : 7500;
    const blade = new THREE.PlaneGeometry(0.11, 0.5, 1, 3);
    blade.translate(0, 0.25, 0);
    const bp = blade.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i) / 0.5;
      bp.setX(i, bp.getX(i) * (1 - y * 0.85));
    }
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = timeU;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float hh = position.y / 0.5;
         vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
         float wv = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.22) * 0.22 + sin(uTime * 3.3 + wp.x * 1.1) * 0.05;
         transformed.x += wv * hh * hh;
         transformed.z += wv * 0.6 * hh * hh;`
      );
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.55 + 0.45 * vGrassH;');
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vGrassH;\nvoid main() {\n vGrassH = position.y / 0.5;');
      sh.fragmentShader = 'varying float vGrassH;\n' + sh.fragmentShader;
    };
    const grass = new THREE.InstancedMesh(blade, mat, n);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), col = new THREE.Color();
    let placed = 0;
    for (let i = 0; i < n * 2 && placed < n; i++) {
      const a = b.R() * TAU, rr = Math.sqrt(b.R()) * 35;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if ((x - pond.x) ** 2 + (z - pond.z) ** 2 < (pond.r + 0.6) ** 2) continue;
      if (nearPath(x, z)) continue;
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.R() * TAU);
      const s = 0.6 + b.R() * 0.7;
      M.compose(P.set(x, 0, z), Q, S.set(1, s, 1));
      grass.setMatrixAt(placed, M);
      grass.setColorAt(placed, col.setHSL(0.25 + b.R() * 0.07, 0.55, 0.32 + b.R() * 0.15));
      placed++;
    }
    grass.count = placed;
    b.add(grass);
  }

  // rabbits (primary consumers)
  const rabbits = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const fur = std(0xe8dccb, { rough: 0.9 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 10), fur);
    body.scale.set(0.8, 0.8, 1.15);
    body.position.y = 0.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), fur);
    head.position.set(0, 0.6, 0.35);
    const ear1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), fur);
    ear1.position.set(-0.08, 0.92, 0.3);
    const ear2 = ear1.clone();
    ear2.position.x = 0.08;
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), std(0xffffff));
    tail.position.set(0, 0.42, -0.42);
    g.add(body, head, ear1, ear2, tail);
    shadow(g, true, false);
    b.add(g);
    rabbits.push(g);
  }
  b.anim((dt, t) => rabbits.forEach((g, i) => {
    const a = t * (0.35 + i * 0.07) + i * 2;
    const rr = 3.2 + i * 1.1;
    g.position.set(19 + Math.cos(a) * rr, Math.abs(Math.sin(t * 5 + i)) * 0.35, -7 + Math.sin(a) * rr);
    g.rotation.y = -a;
  }));

  // fox den + fox (secondary consumer)
  {
    const rockMat = std(0x7f7a72, { rough: 0.9, flat: true });
    [[-27.5, 0.8], [-27, 3.4]].forEach(([x, z]) => {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1.3, 0), rockMat);
      r.position.set(x, 1, z);
      r.scale.y = 1.4;
      r.castShadow = r.receiveShadow = true;
      b.add(r);
      b.circle(x, z, 1.2, 2.8);
    });
    const top = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5, 0), rockMat);
    top.position.set(-27.3, 2.9, 2.1);
    top.scale.set(1, 0.6, 1.6);
    top.castShadow = true;
    b.add(top);
    const fox = new THREE.Group();
    const fur = std(0xff7a2e, { rough: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 6, 10), fur);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 8), fur);
    head.rotation.x = Math.PI / 2;
    head.position.set(0, 0.6, 0.55);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.7, 8), std(0xfff3e6));
    tail.rotation.x = -Math.PI / 2.6;
    tail.position.set(0, 0.55, -0.6);
    const ears = [-0.1, 0.1].map((sx) => {
      const e = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), fur);
      e.position.set(sx, 0.82, 0.42);
      return e;
    });
    fox.add(body, head, tail, ...ears);
    shadow(fox, true, false);
    b.add(fox);
    b.anim((dt, t) => {
      const a = t * 0.3;
      fox.position.set(-22 + Math.cos(a) * 2.5, 0, 0.5 + Math.sin(a) * 2);
      fox.rotation.y = -a;
      tail.rotation.z = Math.sin(t * 4) * 0.3;
    });
  }

  // fallen log with glowing mushrooms (decomposers)
  {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 5, 12), std(0x5a3d22, { rough: 1, flat: true }));
    log.rotation.z = Math.PI / 2;
    log.rotation.y = 0.4;
    log.position.set(7.5, 0.5, -17.5);
    log.castShadow = log.receiveShadow = true;
    b.add(log);
    b.capsule(7.5, -17.5, 2, 0.65, 0.4, 1.1);
    const caps = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const s = 0.6 + b.R() * 0.8;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.4 * s, 8), std(0xf3ead8));
      stem.position.y = 0.2 * s;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 14, 8, 0, TAU, 0, Math.PI / 2), glow(i % 2 ? 0xc59bff : 0xff6f9e, 1.3));
      cap.position.y = 0.4 * s;
      g.add(stem, cap);
      const a = b.R() * TAU;
      g.position.set(7.5 + Math.cos(a) * (1.2 + b.R() * 2.2), 0, -17.5 + Math.sin(a) * (1 + b.R() * 1.2));
      b.add(g);
      caps.push(cap);
    }
    b.anim((dt, t) => caps.forEach((c, i) => (c.material.emissiveIntensity = 1 + Math.sin(t * 2 + i) * 0.5)));
  }

  // mossy stone pillars to the secret clue
  const steps = [[-13, -15, 1.1, 1.5], [-16.5, -18, 2.2, 1.3], [-20.5, -17, 3.3, 1.3], [-23, -20.5, 4.4, 2.0]];
  steps.forEach(([x, z, top, r]) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, top - 0.2, 7), std(0x8d8a80, { rough: 0.95, flat: true }));
    col.position.y = (top - 0.2) / 2;
    const moss = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.92, 0.2, 7), std(0x5fae3e, { rough: 0.9, flat: true }));
    moss.position.y = top - 0.1;
    g.add(col, moss);
    shadow(g);
    b.add(g);
    b.circle(x, z, r, top);
  });

  return {
    b,
    palette: {
      sky: { top: 0x2f7fe8, horizon: 0xcfeaff, bottom: 0x8fb88a, sun: [25, 40, -20] },
      fog: [0xcfe6f5, 45, 150],
      hemi: [0xe4f3ff, 0x4a6b2a, 1.1],
      sun: [0xfff0cf, 2.8, [25, 40, -20]],
      motes: 0xfff3a6,
      bloom: 0.4,
      exposure: 0.95,
    },
    clues: { sun: [-5, 0, 8], pro: [-11.5, 0, 15.5], pri: [19, 0, -7], sec: [-21.5, 0, 4.5], dec: [9, 0, -14.2], web: [24, 0, 13.6], pyr: [-23, 4.4, -20.5] },
    hazardKind: 'smog',
    hazards: [
      { cx: 0, cz: -2, ax: 12, az: 6, fx: 0.25, fz: 0.32, ph: 0, y: 1.4 },
      { cx: -14, cz: 12, ax: 7, az: 5, fx: 0.3, fz: 0.22, ph: 2, y: 1.4 },
      { cx: 14, cz: -12, ax: 8, az: 6, fx: 0.28, fz: 0.36, ph: 4, y: 1.4 },
    ],
    gateColors: [0xff9a3c, 0x7dff6a],
  };
}

const BUILDERS = [plantCell, mitochondrion, ecosystem];

export function buildWorld(index) {
  const def = BUILDERS[index]();
  const { b, palette } = def;
  const sky = createSky(palette.sky);
  b.add(sky);
  const motes = createMotes({ count: isMobile ? 380 : 900, color: palette.motes, seed: 3 + index, rise: index === 2 ? 0.05 : 0.18, size: index === 2 ? 0.16 : 0.22 });
  b.add(motes);
  return {
    group: b.group,
    colliders: b.colliders,
    mini: b.mini,
    palette,
    clues: def.clues,
    hazards: def.hazards,
    hazardKind: def.hazardKind,
    gateColors: def.gateColors,
    update(dt, t) {
      for (const f of b.anims) f(dt, t);
    },
  };
}
