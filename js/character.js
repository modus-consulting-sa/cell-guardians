// Procedural explorer avatar with simple procedural animation + name tag / chat bubble.
import * as THREE from 'three';
import { std, glow } from './fx.js';

const white = std(0xc2cbd3, { rough: 0.5, metal: 0.1 });
const dark = std(0x1b232e, { rough: 0.55, metal: 0.3 });
const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x06121e, metalness: 0.6, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x0b4a60, emissiveIntensity: 0.55 });

function cap(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
  m.castShadow = true;
  return m;
}

export function createExplorer(colorHex) {
  const color = new THREE.Color(colorHex);
  const suit = std(color.clone().multiplyScalar(0.85), { rough: 0.5, metal: 0.15 });
  const accent = glow(colorHex, 2.6);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = cap(0.3, 0.38, suit);
  torso.position.y = 1.05;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 14), white);
  chest.scale.set(1, 0.85, 0.6);
  chest.position.set(0, 1.12, 0.14);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), accent);
  badge.position.set(0.1, 1.17, 0.305);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 24), dark);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.84;
  const beltLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.04), accent);
  beltLight.position.set(0, 0.84, 0.33);

  const head = new THREE.Group();
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.29, 28, 20), white);
  helmet.castShadow = true;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16), visorMat);
  visor.scale.set(1, 0.72, 0.62);
  visor.position.set(0, 0.0, 0.13);
  const visorRim = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.022, 8, 32), accent);
  visorRim.scale.set(1.2, 0.86, 1);
  visorRim.position.set(0, 0, 0.255);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), dark);
  antenna.position.set(0.17, 0.3, -0.04);
  antenna.rotation.z = -0.3;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), accent);
  tip.position.set(0.215, 0.44, -0.04);
  head.add(helmet, visor, visorRim, antenna, tip);

  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), white);
  pack.position.set(0, 1.1, -0.31);
  pack.castShadow = true;
  const tubes = [-0.11, 0.11].map((x) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 10), accent);
    t.position.set(x, 1.1, -0.43);
    return t;
  });

  function limb(x, y, r, len, mat, endMat, endR) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const seg = cap(r, len, mat);
    seg.position.y = -(len / 2 + r * 0.6);
    const end = new THREE.Mesh(new THREE.SphereGeometry(endR, 12, 10), endMat);
    end.position.y = -(len + r * 1.4);
    end.castShadow = true;
    pivot.add(seg, end);
    return pivot;
  }
  const armL = limb(-0.4, 1.3, 0.085, 0.36, suit, dark, 0.1);
  const armR = limb(0.4, 1.3, 0.085, 0.36, suit, dark, 0.1);
  const legL = limb(-0.14, 0.78, 0.105, 0.38, suit, dark, 0.13);
  const legR = limb(0.14, 0.78, 0.105, 0.38, suit, dark, 0.13);
  legL.children[1].scale.set(1, 0.8, 1.4);
  legR.children[1].scale.set(1, 0.8, 1.4);
  legL.children[1].position.z = 0.04;
  legR.children[1].position.z = 0.04;

  body.add(torso, chest, badge, belt, beltLight, head, pack, ...tubes, armL, armR, legL, legR);

  // soft blob shadow helps readability on bright floors
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  root.add(blob);

  let phase = 0;
  const api = {
    root,
    tagAnchor: new THREE.Object3D(),
    animate(dt, speed, air, t) {
      const k = Math.min(1, speed / 6);
      if (air) {
        legL.rotation.x += (-0.7 - legL.rotation.x) * Math.min(1, dt * 10);
        legR.rotation.x += (0.35 - legR.rotation.x) * Math.min(1, dt * 10);
        armL.rotation.x += (-2.4 - armL.rotation.x) * Math.min(1, dt * 8);
        armR.rotation.x += (-2.2 - armR.rotation.x) * Math.min(1, dt * 8);
        armL.rotation.z = 0.25;
        armR.rotation.z = -0.25;
        body.position.y = 0;
        return;
      }
      phase += dt * (4 + speed * 1.55);
      const s = Math.sin(phase);
      const target = k * 0.95;
      legL.rotation.x = s * target;
      legR.rotation.x = -s * target;
      armL.rotation.x = -s * target * 0.85;
      armR.rotation.x = s * target * 0.85;
      armL.rotation.z = 0.08 + (1 - k) * 0.05;
      armR.rotation.z = -0.08 - (1 - k) * 0.05;
      body.position.y = k > 0.05 ? Math.abs(Math.cos(phase)) * 0.06 * k : Math.sin(t * 2) * 0.012;
      body.rotation.x = k * 0.12;
      head.rotation.y = Math.sin(t * 0.7) * 0.15 * (1 - k);
    },
  };
  api.tagAnchor.position.y = 2.25;
  root.add(api.tagAnchor);
  return api;
}

// ---------- text sprites ----------
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function textSprite(text, { color = '#3ff0e0', bg = 'rgba(6,14,22,0.72)', size = 40, height = 0.36, maxWidth = 900 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `700 ${size}px Cairo, "Segoe UI", Tahoma, sans-serif`;
  g.font = font;
  const w = Math.min(maxWidth, Math.ceil(g.measureText(text).width) + size * 1.2);
  c.width = w;
  c.height = Math.ceil(size * 1.7);
  g.font = font;
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = bg;
  roundRect(g, 2, 2, c.width - 4, c.height - 4, c.height / 2.4);
  g.fill();
  g.strokeStyle = color;
  g.globalAlpha = 0.65;
  g.lineWidth = 3;
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = '#ffffff';
  g.fillText(text, c.width / 2, c.height / 2 + 2, c.width - size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, color: 0xd0d0d0 });
  const s = new THREE.Sprite(mat);
  s.scale.set((height * c.width) / c.height, height, 1);
  s.renderOrder = 20;
  return s;
}

export function disposeSprite(s) {
  if (!s) return;
  s.material.map.dispose();
  s.material.dispose();
  s.parent?.remove(s);
}
