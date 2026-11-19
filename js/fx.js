// Rendering pipeline, procedural textures and reusable shader materials.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const isMobile =
  matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('mobile');

// Shared time uniform used by every animated shader.
export const timeU = { value: 0 };

// ---------- deterministic random ----------
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- renderer + post ----------
// Retina at full DPR with MSAA + HDR bloom is very heavy; cap it (quality drops further at runtime if needed).
export const MAX_PR = isMobile ? 1.25 : 1.5;
export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(MAX_PR, devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft filtering is built in since r18x
  container.appendChild(renderer.domElement);
  return renderer;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 0 },
    uHurt: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform vec3 uTint; uniform float uFade; uniform float uHurt;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      float vig = smoothstep(0.85, 0.15, r * (1.0 + uVignette * 2.2));
      vec3 col = c.rgb * mix(1.0, vig, uVignette * 1.6) * uTint;
      col = mix(col, vec3(0.75, 0.05, 0.12), uHurt * smoothstep(0.08, 0.45, r));
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export function createPipeline(renderer, scene, camera) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: isMobile ? 0 : 2 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.45, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  function resize() {
    if (!innerWidth || !innerHeight) return;
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    // keep horizontal field of view usable on tall phones
    const base = 62;
    camera.fov = camera.aspect < 1 ? Math.min(85, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) / camera.aspect)) * 0.8) : base;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  function setPixelRatio(pr) {
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    resize();
  }
  return { composer, bloom, grade: grade.uniforms, resize, setPixelRatio };
}

// ---------- procedural textures ----------
function canvasTex(canvas, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Tileable Voronoi "cell" pattern: returns { map, emissiveMap }.
export function voronoiTextures({ size = 512, seeds = 26, base, inner, edge, glow, edgeWidth = 0.06, seed = 7, repeat = 6 }) {
  const R = rng(seed);
  const pts = [];
  for (let i = 0; i < seeds; i++) pts.push([R(), R(), R()]);
  const c1 = document.createElement('canvas');
  const c2 = document.createElement('canvas');
  c1.width = c1.height = c2.width = c2.height = size;
  const g1 = c1.getContext('2d');
  const g2 = c2.getContext('2d');
  const im1 = g1.createImageData(size, size);
  const im2 = g2.createImageData(size, size);
  // work directly in sRGB 0..1 (the canvas is uploaded as an sRGB texture)
  const srgb = (h) => ({ r: ((h >> 16) & 255) / 255, g: ((h >> 8) & 255) / 255, b: (h & 255) / 255 });
  const B = srgb(base), I = srgb(inner), E = srgb(edge), G = srgb(glow);
  const tmp = { r: 0, g: 0, b: 0 };
  const mix = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let d1 = 9, d2 = 9, id = 0;
      for (let i = 0; i < seeds; i++) {
        let dx = Math.abs(u - pts[i][0]); dx = Math.min(dx, 1 - dx);
        let dy = Math.abs(v - pts[i][1]); dy = Math.min(dy, 1 - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1); // distance to border
      const border = 1 - Math.min(1, e / edgeWidth);
      const centre = Math.min(1, Math.sqrt(d1) * 5);
      const shade = 0.85 + pts[id][2] * 0.3, bb = border * border, ct = centre * 0.8;
      tmp.r = mix(mix(I.r, B.r, ct) * shade, E.r, bb);
      tmp.g = mix(mix(I.g, B.g, ct) * shade, E.g, bb);
      tmp.b = mix(mix(I.b, B.b, ct) * shade, E.b, bb);
      const k = (y * size + x) * 4;
      im1.data[k] = tmp.r * 255; im1.data[k + 1] = tmp.g * 255; im1.data[k + 2] = tmp.b * 255; im1.data[k + 3] = 255;
      const gl = Math.pow(border, 3);
      im2.data[k] = G.r * 255 * gl; im2.data[k + 1] = G.g * 255 * gl; im2.data[k + 2] = G.b * 255 * gl; im2.data[k + 3] = 255;
    }
  }
  g1.putImageData(im1, 0, 0);
  g2.putImageData(im2, 0, 0);
  return { map: canvasTex(c1, repeat), emissiveMap: canvasTex(c2, repeat) };
}

export function grassTexture(seed = 3) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#3f7a2c';
  g.fillRect(0, 0, size, size);
  const R = rng(seed);
  for (let i = 0; i < 9000; i++) {
    const x = R() * size, y = R() * size;
    const l = 22 + R() * 30, h = 85 + R() * 40;
    g.strokeStyle = `hsla(${h},${45 + R() * 25}%,${l}%,0.55)`;
    g.lineWidth = 1 + R() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (R() - 0.5) * 6, y - 4 - R() * 8);
    g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${90 + R() * 40},${70 + R() * 30},${40},0.12)`;
    g.beginPath();
    g.arc(R() * size, R() * size, 10 + R() * 30, 0, Math.PI * 2);
    g.fill();
  }
  return canvasTex(c, 14);
}

// soft round sprite for particles
let _dot;
export function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}

// ---------- materials ----------
export function std(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.55,
    metalness: o.metal ?? 0.05,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? 1,
    flatShading: !!o.flat,
    transparent: o.opacity !== undefined && o.opacity < 1,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    vertexColors: !!o.vc,
  });
}
export function glow(color, ei = 2.2, o = {}) {
  return std(color, { emissive: color, ei, rough: 0.25, ...o });
}

// Translucent bubbly membrane with fresnel rim (used for organelles and walls).
export function membrane({ color = 0x3fd, rim = 0x9ff, opacity = 0.18, power = 2.2, intensity = 1.6, wobble = 0.12, speed = 1.2, side = THREE.FrontSide } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(color) },
        uRim: { value: new THREE.Color(rim) },
        uOpacity: { value: opacity },
        uPower: { value: power },
        uIntensity: { value: intensity },
        uWobble: { value: wobble },
        uSpeed: { value: speed },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime; uniform float uWobble; uniform float uSpeed;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec3 p = position;
        float w = sin(p.y * 1.7 + uTime * uSpeed + p.x * 1.1) * cos(p.z * 1.3 + uTime * uSpeed * 0.7);
        p += normal * w * uWobble;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mvPosition.xyz);
        vP = p;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor; uniform vec3 uRim; uniform float uOpacity; uniform float uPower; uniform float uIntensity; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        float shimmer = 0.5 + 0.5 * sin(vP.y * 6.0 - uTime * 2.0 + vP.x * 3.0);
        vec3 col = uColor * (0.6 + 0.4 * shimmer) + uRim * f * uIntensity;
        float a = clamp(uOpacity + f * 0.8, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side,
    fog: true,
  });
  m.uniforms.uTime = timeU; // shared clock (merge() would have cloned it)
  return m;
}

export function beamMaterial(color, strength = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: timeU, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uStrength; varying vec2 vUv;
      void main(){
        float a = pow(1.0 - vUv.y, 2.2) * 0.55;
        a *= 0.75 + 0.25 * sin(vUv.y * 30.0 - uTime * 4.0);
        float edge = sin(vUv.x * 3.14159 * 2.0) * 0.5 + 0.5;
        gl_FragColor = vec4(uColor * 1.6 * uStrength, a * uStrength * (0.6 + 0.4 * edge));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function portalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeU,
      uActive: { value: 0 },
      uA: { value: new THREE.Color(0xff2d6b) },
      uB: { value: new THREE.Color(0x3ff0e0) },
    },
    // Works on the gate's arch shape (object space: x in ±2.95, arch centre at y=3.0).
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uActive; uniform vec3 uA; uniform vec3 uB; varying vec2 vP;
      void main(){
        float R = 2.95;
        float dEdge = vP.y > 3.0 ? R - length(vec2(vP.x, vP.y - 3.0)) : R - abs(vP.x);
        dEdge = min(dEdge, vP.y - 0.3);
        float edge = smoothstep(0.0, 0.7, dEdge);
        vec2 p = (vP - vec2(0.0, 2.7)) / 3.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float swirl = sin(a * 5.0 + r * 14.0 - uTime * (1.5 + uActive * 4.0));
        float swirl2 = sin(a * 3.0 - r * 9.0 + uTime * 2.3);
        float bands = smoothstep(0.2, 1.0, swirl * 0.6 + swirl2 * 0.4);
        vec3 col = mix(uA, uB, uActive);
        vec3 c = col * (0.3 + bands * (0.5 + uActive * 0.8)) + mix(col, vec3(1.0), 0.5) * pow(max(0.0, 1.0 - r), 3.0) * (0.2 + uActive * 0.7);
        c += col * (1.0 - edge) * (0.6 + uActive * 0.6);
        float alpha = clamp((0.3 + uActive * 0.6) * (0.4 + 0.6 * edge) + (1.0 - edge) * 0.5, 0.0, 1.0);
        gl_FragColor = vec4(c, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------- sky dome ----------
export function createSky({ top, horizon, bottom, nebula = 0x000000, nebulaAmt = 0, sun = null }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHor: { value: new THREE.Color(horizon) },
      uBot: { value: new THREE.Color(bottom) },
      uNeb: { value: new THREE.Color(nebula) },
      uNebAmt: { value: nebulaAmt },
      uSunDir: { value: sun ? new THREE.Vector3(...sun).normalize() : new THREE.Vector3(0, -1, 0) },
      uSun: { value: sun ? 1 : 0 },
      uTime: timeU,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uBot; uniform vec3 uNeb; uniform float uNebAmt; uniform vec3 uSunDir; uniform float uSun; uniform float uTime;
      varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float noise(vec3 p){
        vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
        float n = mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
        return n;
      }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHor, uTop, pow(h, 0.6)) : mix(uHor, uBot, pow(-h, 0.5));
        if (uNebAmt > 0.0) {
          vec3 q = d * 3.0 + vec3(uTime * 0.02, 0.0, uTime * 0.015);
          float n = noise(q) * 0.55 + noise(q * 2.1) * 0.3 + noise(q * 4.3) * 0.15;
          col += uNeb * smoothstep(0.45, 0.9, n) * uNebAmt;
        }
        if (uSun > 0.5) {
          float s = max(dot(d, uSunDir), 0.0);
          col += vec3(1.0, 0.92, 0.7) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

// ---------- floating particles ----------
export function createMotes({ count = 700, radius = 34, height = 12, color = 0xaaffee, size = 0.22, seed = 5, rise = 0.15 }) {
  const R = rng(seed);
  const pos = new Float32Array(count * 3);
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * radius;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = R() * height;
    pos[i * 3 + 2] = Math.sin(a) * r;
    rnd[i] = R();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: timeU, uColor: { value: new THREE.Color(color) }, uSize: { value: size * (isMobile ? 260 : 340) }, uH: { value: height }, uRise: { value: rise }, uTex: { value: dotTexture() } },
    vertexShader: /* glsl */ `
      attribute float aRnd; uniform float uTime; uniform float uSize; uniform float uH; uniform float uRise; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + uTime * uRise * (0.5 + aRnd), uH);
        p.x += sin(uTime * 0.4 + aRnd * 30.0) * 0.6;
        p.z += cos(uTime * 0.33 + aRnd * 20.0) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = min(uSize * (0.4 + aRnd) / -mv.z, 16.0);
        vA = smoothstep(0.0, 1.5, p.y) * smoothstep(uH, uH - 2.0, p.y) * (0.4 + 0.6 * sin(uTime * 1.5 + aRnd * 40.0) * 0.5 + 0.3);
        vA *= smoothstep(2.0, 7.0, -mv.z) * 0.7;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform sampler2D uTex; varying float vA;
      void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uColor * 1.5, t.a * vA); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------- bursts (short-lived sparkle explosions) ----------
export class Bursts {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }
  spawn(pos, color, n = 40, speed = 5) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      v.push(Math.cos(a) * Math.cos(b) * s, Math.abs(Math.sin(b)) * s + 2, Math.sin(a) * Math.cos(b) * s);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), size: 0.35, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.list.push({ pts, v, life: 1.2, max: 1.2 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.life -= dt;
      const a = b.pts.geometry.attributes.position;
      for (let k = 0; k < a.count; k++) {
        b.v[k * 3 + 1] -= 6 * dt;
        a.array[k * 3] += b.v[k * 3] * dt;
        a.array[k * 3 + 1] += b.v[k * 3 + 1] * dt;
        a.array[k * 3 + 2] += b.v[k * 3 + 2] * dt;
      }
      a.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, b.life / b.max);
      if (b.life <= 0) {
        this.scene.remove(b.pts);
        b.pts.geometry.dispose();
        b.pts.material.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}

// Recursively dispose a group's GPU resources.
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k in m) if (m[k] && m[k].isTexture && m[k] !== _dot) m[k].dispose();
        m.dispose();
      }
    }
  });
}
