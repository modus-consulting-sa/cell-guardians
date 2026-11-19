// حُرّاس الخلية · Cell Guardians — game orchestration, rules, multiplayer protocol and UI.
import * as THREE from 'three';
import { createRenderer, createPipeline, timeU, Bursts, disposeTree, isMobile, std, glow, MAX_PR } from './fx.js';
import { buildWorld, makeGate, makeClue, makeHazard, hazardPos, SPAWN, GATE } from './env.js';
import { createExplorer, textSprite, disposeSprite } from './character.js';
import { Input, Player } from './controller.js';
import { Net, randomCode, cleanCode } from './net.js';
import { WORLDS, PLAYER_COLORS, NAME_IDEAS, requiredCount } from './content.js';
import * as Sound from './audio.js';

const VERSION = 1;
const MAX_PLAYERS = 6;
const NET_HZ = 15;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round(n * 100) / 100;

// ---------- tiny DOM helper (always textContent, never innerHTML for dynamic text) ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// ---------- storage ----------
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
function tabPid() {
  try {
    let p = sessionStorage.getItem('cg-pid');
    if (!p) {
      p = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('cg-pid', p);
    }
    return p;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) || 'مستكشف';
const cleanChat = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
const clampColor = (c) => (Number.isInteger(c) && c >= 0 && c < PLAYER_COLORS.length ? c : 0);
const validVec = (p) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n) && Math.abs(n) < 200);
const hex = (c) => '#' + PLAYER_COLORS[c].toString(16).padStart(6, '0');

const me = {
  pid: tabPid(),
  name: store.get('cg-name', NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)] + ' ' + (10 + Math.floor(Math.random() * 89))),
  color: store.get('cg-color', Math.floor(Math.random() * 6)),
};
const journal = new Set(store.get('cg-journal', []));

// ---------- renderer / scene ----------
const renderer = createRenderer($('stage'));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 900);
const pipe = createPipeline(renderer, scene, camera);
scene.fog = new THREE.Fog(0x000000, 30, 100);
const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 120 });
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(hemi, sun, sun.target);
const bursts = new Bursts(scene);

// ---------- shared game state ----------
function newGame(w = 0, score = 0) {
  return { w, found: {}, q: 0, locks: [0, 0, 0], open: false, score, clock: 0, pend: 0, phase: 'play', tw: 0 };
}
let G = newGame();
const roster = new Map(); // pid -> { pid, n, c, p, r, a, s, k }
let order = []; // join order (pids); used to choose a new host
let hostPid = null;
const pidByPeer = new Map();
const peerByPid = new Map();
const ghostStats = new Map(); // stats of players who dropped (restored if they come back)

const net = new Net();
let mode = 'title';

// ---------- world (visual) ----------
let W = null;
function loadWorld(index) {
  if (W) {
    scene.remove(W.root);
    disposeTree(W.root);
  }
  const env = buildWorld(index);
  const root = new THREE.Group();
  root.add(env.group);
  const gate = makeGate(...env.gateColors);
  root.add(gate.group);
  const colliders = env.colliders.concat(gate.colliders);
  const clueObjs = {};
  for (const info of WORLDS[index].clues) {
    const p = env.clues[info.id];
    const obj = makeClue(info, new THREE.Vector3(...p));
    obj.setFound(!!G.found[info.id]);
    root.add(obj.group);
    clueObjs[info.id] = obj;
    colliders.push({ t: 'c', x: p[0], z: p[2], r: 0.75, top: p[1] + 0.25 });
  }
  const hazards = env.hazards.map((spec) => {
    const mesh = makeHazard(env.hazardKind);
    root.add(mesh);
    return { spec, mesh };
  });
  const P = env.palette;
  scene.fog.color.set(P.fog[0]);
  scene.fog.near = P.fog[1];
  scene.fog.far = P.fog[2];
  hemi.color.set(P.hemi[0]);
  hemi.groundColor.set(P.hemi[1]);
  hemi.intensity = P.hemi[2];
  sun.color.set(P.sun[0]);
  sun.intensity = P.sun[1];
  sun.position.set(...P.sun[2]);
  pipe.bloom.strength = P.bloom;
  renderer.toneMappingExposure = P.exposure ?? 1;
  scene.add(root);
  W = { index, env, root, gate, clueObjs, hazards, colliders };
  drawMinimapBase();
}

// ---------- local player ----------
const input = new Input(renderer.domElement, $('touch'));
const player = new Player();
let myAv = null;
function buildMyAvatar() {
  if (myAv) {
    scene.remove(myAv.root);
    disposeTree(myAv.root);
  }
  myAv = createExplorer(PLAYER_COLORS[me.color]);
  scene.add(myAv.root);
}
let hp = 100, invuln = 0, hurtFlash = 0, wasAir = false, portalCooldown = 0;

// Nano: the little drone that follows you around and talks
const nanoBot = new THREE.Group();
{
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), std(0xf0f6fa, { metal: 0.6, rough: 0.2 }));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), glow(0x3ff0e0, 3.2));
  eye.position.z = 0.16;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 40), glow(0x3ff0e0, 2.4));
  ring.rotation.x = Math.PI / 2;
  ring.name = 'ring';
  const light = new THREE.PointLight(0x7dfff0, 1.6, 6, 1.8);
  nanoBot.add(shell, eye, ring, light);
  scene.add(nanoBot);
}

// ---------- remote avatars ----------
const avatars = new Map(); // pid -> { av, tag, bubble, bubbleT, pos, yaw, speed, name, color }
function syncAvatars(dt, t) {
  for (const [pid, P] of roster) {
    if (pid === me.pid) continue;
    let A = avatars.get(pid);
    if (!A || A.color !== P.c) {
      if (A) removeAvatar(pid);
      const av = createExplorer(PLAYER_COLORS[P.c]);
      A = { av, pos: new THREE.Vector3(...P.p), yaw: P.r, speed: 0, name: null, color: P.c, bubble: null, bubbleT: 0, tag: null };
      scene.add(av.root);
      avatars.set(pid, A);
    }
    if (A.name !== P.n) {
      disposeSprite(A.tag);
      A.tag = textSprite(P.n, { color: hex(P.c) });
      A.tag.position.y = 2.3;
      A.av.root.add(A.tag);
      A.name = P.n;
    }
    const target = new THREE.Vector3(...P.p);
    const before = A.pos.clone();
    if (A.pos.distanceTo(target) > 8) A.pos.copy(target);
    else A.pos.lerp(target, 1 - Math.exp(-dt * 12));
    const moved = dt > 0 ? Math.hypot(A.pos.x - before.x, A.pos.z - before.z) / dt : 0;
    A.speed += (moved - A.speed) * Math.min(1, dt * 8);
    let d = P.r - A.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    A.yaw += d * Math.min(1, dt * 12);
    A.av.root.position.copy(A.pos);
    A.av.root.rotation.y = A.yaw;
    A.av.animate(dt, A.speed, P.a === 3, t);
    if (A.bubble) {
      A.bubbleT -= dt;
      if (A.bubbleT <= 0) {
        disposeSprite(A.bubble);
        A.bubble = null;
      }
    }
  }
  for (const pid of avatars.keys()) if (!roster.has(pid)) removeAvatar(pid);
}
function removeAvatar(pid) {
  const A = avatars.get(pid);
  if (!A) return;
  disposeSprite(A.tag);
  disposeSprite(A.bubble);
  scene.remove(A.av.root);
  disposeTree(A.av.root);
  avatars.delete(pid);
}
let myBubble = null, myBubbleT = 0;
function showBubble(pid, text, color) {
  const s = textSprite(text, { color: hex(color), bg: 'rgba(255,255,255,0.12)', size: 34, height: 0.32 });
  s.position.y = 2.75;
  if (pid === me.pid) {
    disposeSprite(myBubble);
    myBubble = s;
    myBubbleT = 6;
    myAv.root.add(s);
  } else {
    const A = avatars.get(pid);
    if (!A) return disposeSprite(s);
    disposeSprite(A.bubble);
    A.bubble = s;
    A.bubbleT = 6;
    A.av.root.add(s);
  }
}

// ---------- helpers ----------
function foundRequired() {
  return WORLDS[G.w].clues.filter((c) => !c.secret && G.found[c.id]).length;
}
function clueInfo(id) {
  for (const w of WORLDS) for (const c of w.clues) if (c.id === id) return c;
  return null;
}
function spawnPoint() {
  const i = Math.max(0, order.indexOf(me.pid));
  const a = i * 1.25;
  const rr = i ? 1.8 : 0;
  return [SPAWN[0] + Math.sin(a) * rr, 0, SPAWN[2] + Math.cos(a) * rr * 0.6];
}
function inviteLink() {
  return `${location.origin}${location.pathname}?room=${net.code}`;
}

// =================================================================
// HOST LOGIC (authoritative)
// =================================================================
function hostEvent(e) {
  net.broadcast({ t: 'ev', e });
  onEvent(e);
}
function snapshot() {
  return {
    t: 'snap',
    g: G,
    pl: [...roster.values()].map((P) => [P.pid, P.n, P.c, P.p[0], P.p[1], P.p[2], r2(P.r), P.a, P.s, P.k]),
    order,
    host: me.pid,
  };
}
function hostAct(pid, m) {
  const P = roster.get(pid);
  if (!P) return;
  if (m.k === 'chat') {
    const text = cleanChat(m.text);
    if (text) hostEvent({ k: 'chat', by: pid, n: P.n, c: P.c, text });
    return;
  }
  if (m.k === 'restart') {
    if (pid !== me.pid || G.phase !== 'won') return;
    G = newGame(0, 0);
    for (const R of roster.values()) R.s = R.k = 0;
    hostEvent({ k: 'restart' });
    hostEvent({ k: 'world', w: 0 });
    return;
  }
  if (G.phase !== 'play') return;
  const quiz = WORLDS[G.w].quiz;
  if (m.k === 'clue') {
    const info = WORLDS[G.w].clues.find((c) => c.id === m.id);
    if (!info || G.found[m.id] || !W || W.index !== G.w) return;
    const cp = W.env.clues[m.id];
    if (!cp || Math.hypot(P.p[0] - cp[0], P.p[2] - cp[2]) > 6) return;
    G.found[m.id] = pid;
    P.s++;
    G.score += info.secret ? 250 : 100;
    hostEvent({ k: 'clue', id: m.id, by: pid, n: P.n });
  } else if (m.k === 'ans') {
    if (m.w !== G.w || m.q !== G.q || G.open) return;
    if (foundRequired() < requiredCount(G.w)) return;
    const Q = quiz[G.q];
    const ok = (m.o | 0) === Q.answer;
    if (ok) {
      G.locks[G.q] = 1;
      G.q++;
      P.k++;
      G.score += 150;
      const e = { k: 'ans', ok: true, q: m.q, by: pid, n: P.n };
      if (G.q >= quiz.length) {
        G.open = true;
        e.open = true;
        e.bonus = Math.max(50, 600 - Math.floor(G.clock) * 2);
        G.score += e.bonus;
      }
      hostEvent(e);
    } else {
      G.score = Math.max(0, G.score - 50);
      hostEvent({ k: 'ans', ok: false, q: m.q, o: m.o | 0, by: pid, n: P.n });
    }
  } else if (m.k === 'next') {
    if (G.open && G.pend <= 0) {
      G.pend = 2.2;
      hostEvent({ k: 'portal', by: pid, n: P.n });
    }
  }
}
function hostTick(dt) {
  G.clock += dt;
  G.tw += dt;
  if (G.pend > 0) {
    G.pend -= dt;
    if (G.pend <= 0) {
      G.pend = 0;
      if (G.w < WORLDS.length - 1) {
        const tw = G.tw;
        G = newGame(G.w + 1, G.score);
        G.tw = tw;
        hostEvent({ k: 'world', w: G.w });
      } else {
        G.phase = 'won';
        hostEvent({ k: 'won' });
      }
    }
  }
}
function hostOnMessage(m, peerId) {
  if (m.t === 'hello') {
    const pid = String(m.pid || '').slice(0, 24);
    if (!pid || pid === me.pid) return;
    if (!roster.has(pid) && roster.size >= MAX_PLAYERS) {
      net.sendTo(peerId, { t: 'full' });
      net.kick(peerId);
      return;
    }
    const old = peerByPid.get(pid);
    if (old && old !== peerId) pidByPeer.delete(old);
    pidByPeer.set(peerId, pid);
    peerByPid.set(pid, peerId);
    const prev = roster.get(pid) || ghostStats.get(pid);
    const isNew = !roster.has(pid);
    roster.set(pid, { pid, n: cleanName(m.name), c: clampColor(m.c), p: [SPAWN[0], 0, SPAWN[2]], r: Math.PI, a: 0, s: prev?.s || 0, k: prev?.k || 0 });
    if (!order.includes(pid)) order.push(pid);
    net.sendTo(peerId, { t: 'welcome', g: G, order, ver: VERSION });
    net.broadcast(snapshot());
    if (isNew) hostEvent({ k: 'join', by: pid, n: roster.get(pid).n });
    return;
  }
  const pid = pidByPeer.get(peerId);
  if (!pid) return;
  if (m.t === 'st') {
    const P = roster.get(pid);
    if (P && validVec(m.p)) {
      P.p = m.p.map(r2);
      P.r = Number.isFinite(m.r) ? m.r : 0;
      P.a = m.a | 0;
    }
  } else if (m.t === 'act') hostAct(pid, m);
}
net.on('peerleft', (peerId) => {
  const pid = pidByPeer.get(peerId);
  if (!pid) return;
  pidByPeer.delete(peerId);
  if (peerByPid.get(pid) === peerId) peerByPid.delete(pid);
  else return; // the same player already reconnected on a new connection
  const P = roster.get(pid);
  if (P) {
    ghostStats.set(pid, { s: P.s, k: P.k });
    roster.delete(pid);
    order = order.filter((x) => x !== pid);
    hostEvent({ k: 'leave', by: pid, n: P.n });
  }
});

// =================================================================
// CLIENT LOGIC
// =================================================================
let snapAt = 0;
let waitingWelcome = null;
function clientOnMessage(m) {
  if (m.t === 'welcome') {
    G = m.g;
    if (Array.isArray(m.order)) order = m.order;
    if (waitingWelcome) {
      waitingWelcome();
      waitingWelcome = null;
    }
  } else if (m.t === 'full') {
    setStatus('الغرفة ممتلئة (٦ لاعبين). جرّب غرفة أخرى.', true);
    net.destroy();
    enableTitle(true);
  } else if (m.t === 'snap') {
    applySnap(m);
  } else if (m.t === 'ev') {
    onEvent(m.e);
  }
}
function applySnap(m) {
  if (!m.g || !Array.isArray(m.pl)) return;
  G = m.g;
  snapAt = performance.now();
  hostPid = m.host;
  order = Array.isArray(m.order) ? m.order : order;
  const seen = new Set();
  for (const row of m.pl) {
    const [pid, n, c, x, y, z, r, a, s, k] = row;
    seen.add(pid);
    const prev = roster.get(pid);
    const entry = prev || { pid };
    Object.assign(entry, { n: cleanName(n), c: clampColor(c), r: +r || 0, a: a | 0, s: s | 0, k: k | 0 });
    if (pid !== me.pid || !prev) entry.p = [x, y, z];
    roster.set(pid, entry);
  }
  for (const pid of [...roster.keys()]) if (!seen.has(pid)) roster.delete(pid);
  if (mode === 'play' && W && G.w !== W.index) goToWorld(G.w);
  if (mode === 'play' && G.phase === 'won' && !victoryShown) showVictory();
}
net.on('message', (m, from) => {
  try {
    if (net.isHost) hostOnMessage(m, from);
    else clientOnMessage(m);
  } catch (err) {
    console.warn('bad message', err);
  }
});
function helloMsg() {
  return { t: 'hello', pid: me.pid, name: me.name, c: me.color, ver: VERSION };
}

// host migration: if the host disappears, the earliest remaining player takes over the same room code
let migrating = false;
net.on('hostlost', () => {
  if (mode !== 'play' || migrating) return;
  migrate();
});
async function migrate() {
  migrating = true;
  const lastG = JSON.parse(JSON.stringify(G));
  const code = net.code;
  const oldHost = hostPid;
  const candidates = order.filter((p) => p !== oldHost);
  let rank = candidates.indexOf(me.pid);
  if (rank < 0) rank = candidates.length;
  const lastRoster = new Map(roster);
  showNet('انقطع الاتصال بالمضيف… جارٍ إعادة الاتصال ⏳');
  const t0 = performance.now();
  while (mode === 'play') {
    const el = (performance.now() - t0) / 1000;
    if (el > 90) {
      showNet('تعذّر استعادة الاتصال. أعد تحميل الصفحة للانضمام من جديد.');
      break;
    }
    if (el > rank * 6 + 1.2) {
      try {
        await net.host(code);
        becomeHost(lastG, lastRoster, oldHost);
        break;
      } catch {}
    }
    try {
      await net.join(code);
      await new Promise((res, rej) => {
        waitingWelcome = res;
        net.sendToHost(helloMsg());
        setTimeout(() => rej(new Error('no welcome')), 6000);
      });
      hideNet();
      feed('عدت إلى الغرفة ✅', 'good');
      break;
    } catch {}
    await sleep(1200);
  }
  migrating = false;
}
function becomeHost(lastG, lastRoster, oldHost) {
  G = lastG;
  hostPid = me.pid;
  pidByPeer.clear();
  peerByPid.clear();
  for (const [pid, P] of lastRoster) if (pid !== me.pid && pid !== oldHost) ghostStats.set(pid, { s: P.s, k: P.k });
  const mine = lastRoster.get(me.pid);
  roster.clear();
  roster.set(me.pid, { pid: me.pid, n: me.name, c: me.color, p: [player.pos.x, player.pos.y, player.pos.z], r: player.yaw, a: 0, s: mine?.s || 0, k: mine?.k || 0 });
  order = [me.pid];
  hideNet();
  feed('أصبحت مضيف الغرفة 👑 سيعود الآخرون تلقائيًا', 'good');
}

// =================================================================
// EVENTS (both host and clients)
// =================================================================
let allFoundAnnounced = -1;
function onEvent(e) {
  if (!e || typeof e !== 'object') return;
  const name = cleanName(e.n);
  switch (e.k) {
    case 'clue': {
      const info = clueInfo(e.id);
      if (!info) return;
      if (!net.isHost) G.found[e.id] = e.by;
      journal.add(e.id);
      store.set('cg-journal', [...journal]);
      const obj = W?.clueObjs[e.id];
      if (obj) {
        obj.setFound(true);
        bursts.spawn(obj.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), info.color, 70, 6);
      }
      Sound.sfx('clue');
      if (e.by === me.pid) showClueCard(info);
      else feed(`${name} وجد دليلًا: ${info.icon} ${info.title}`, 'good');
      if (foundRequired() >= requiredCount(G.w) && allFoundAnnounced !== G.w) {
        allFoundAnnounced = G.w;
        setTimeout(() => nano('اكتملت الدلائل! توجّهوا إلى البوابة في الشمال وحلّوا أسئلتها الثلاثة 🔐', 7), 600);
      }
      break;
    }
    case 'ans': {
      if (!net.isHost && e.ok) {
        G.locks[e.q] = 1;
        G.q = Math.max(G.q, e.q + 1);
        if (e.open) G.open = true;
      }
      if (e.ok) {
        Sound.sfx('correct');
        feed(`${name} فتح قفلًا 🔓`, 'good');
      } else {
        Sound.sfx('wrong');
        feed(`${name} أجاب إجابة خاطئة (−50)`, 'bad');
      }
      quizResult(e);
      if (e.open) {
        setTimeout(() => Sound.sfx('open'), 500);
        nano('البوابة مفتوحة! امشوا عبرها للانتقال إلى العالم التالي 🌀', 7);
        feed(`مكافأة السرعة +${e.bonus | 0} ⭐`, 'good');
      }
      break;
    }
    case 'portal':
      Sound.sfx('portal');
      feed(`${name} عبر البوابة… استعدّوا للانتقال!`, 'good');
      fadeTarget = 0.6;
      break;
    case 'world':
      goToWorld(e.w | 0);
      break;
    case 'won':
      Sound.sfx('win');
      if (!net.isHost) G.phase = 'won';
      setTimeout(showVictory, 400);
      break;
    case 'restart':
      victoryShown = false;
      allFoundAnnounced = -1;
      closeModal();
      feed('بدأت مغامرة جديدة! 🚀', 'good');
      break;
    case 'join':
      Sound.sfx('join');
      feed(`${name} انضم إلى الفريق 👋`, 'good');
      chatLine(null, `${name} انضم`, null, true);
      break;
    case 'leave':
      Sound.sfx('leave');
      feed(`${name} غادر الغرفة`);
      chatLine(null, `${name} غادر`, null, true);
      break;
    case 'chat': {
      const text = cleanChat(e.text);
      if (!text) return;
      chatLine(name, text, clampColor(e.c));
      showBubble(e.by, text, clampColor(e.c));
      if (e.by !== me.pid) Sound.sfx('chat');
      break;
    }
  }
}

function act(k, data = {}) {
  const m = { t: 'act', k, ...data };
  if (net.isHost) hostAct(me.pid, m);
  else net.sendToHost(m);
}

// =================================================================
// WORLD TRANSITIONS / FADE
// =================================================================
let fade = 1, fadeTarget = 0, transitioning = false;
async function goToWorld(w) {
  if (transitioning || (W && W.index === w)) return;
  transitioning = true;
  fadeTarget = 1;
  await sleep(550);
  closeModal();
  loadWorld(w);
  hp = 100;
  player.teleport(spawnPoint());
  player.updateCamera(camera, 0, true);
  Sound.playMusic(w);
  fadeTarget = 0;
  transitioning = false;
  nano(WORLDS[w].intro, 8);
  feed(WORLDS[w].name, 'good');
}

// =================================================================
// INTERACTION
// =================================================================
function nearestInteract() {
  if (!W) return null;
  const p = player.pos;
  if (G.phase !== 'play') return null;
  for (const [id, obj] of Object.entries(W.clueObjs)) {
    if (G.found[id]) continue;
    if (Math.hypot(p.x - obj.pos.x, p.z - obj.pos.z) < 2.3 && Math.abs(p.y - obj.pos.y) < 1.6) return { type: 'clue', id };
  }
  if (Math.hypot(p.x - GATE.x, p.z - GATE.z) < 6.5) return { type: 'gate' };
  return null;
}
function interact() {
  if (mode !== 'play' || !$('modal').hidden) return;
  const it = nearestInteract();
  if (!it) {
    nano('لا يوجد شيء هنا. اقترب من بلّورة مضيئة أو من البوابة.', 3);
    return;
  }
  if (it.type === 'clue') act('clue', { id: it.id });
  else if (it.type === 'gate') {
    if (G.open) return nano('البوابة مفتوحة! امشِ عبرها 🌀', 3);
    const need = requiredCount(G.w), have = foundRequired();
    if (have < need) return nano(`البوابة تحتاج ${need} دلائل لتعمل. وجدتم ${have} حتى الآن.`, 4);
    openQuiz();
  }
}
input.onInteract = interact;

// =================================================================
// UI: feed, nano, modals
// =================================================================
function feed(text, kind = '') {
  const box = $('feed');
  const el = h('div', { class: 'feed-item ' + kind }, text);
  box.append(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}
let nanoTimer = 0;
function nano(text, secs = 4) {
  $('nanoText').textContent = text;
  $('nano').hidden = false;
  nanoTimer = secs;
}
function openModal(...nodes) {
  $('card').replaceChildren(...nodes);
  $('modal').hidden = false;
  input.enabled = false;
  input.keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeModal() {
  $('modal').hidden = true;
  quiz = null;
  input.enabled = true;
}
$('modal').addEventListener('pointerdown', (e) => {
  if (e.target === $('modal') && !quiz?.busy) closeModal();
});

function showClueCard(info) {
  openModal(
    h('h2', { style: `color:#${info.color.toString(16).padStart(6, '0')}` }, h('span', { class: 'ic' }, info.icon), info.title),
    h('div', { class: 'fact', style: `--c:#${info.color.toString(16).padStart(6, '0')}` }, h('p', {}, info.text)),
    h('div', { class: 'sub' }, info.secret ? '✦ دليل سرّي! +250 نقطة · أُضيف إلى سجل الحقائق 📖' : '+100 نقطة للفريق · أُضيف إلى سجل الحقائق 📖'),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'رائع! تابِع'))
  );
}

let quiz = null;
function openQuiz() {
  quiz = { busy: false, waitQ: -1, btn: null };
  renderQuiz();
}
function renderQuiz() {
  if (!quiz) return;
  const Q = WORLDS[G.w].quiz[G.q];
  if (!Q || G.open) return closeModal();
  quiz.busy = false;
  const fb = h('div', { class: 'feedback' });
  quiz.fb = fb;
  const opts = Q.options.map((o, i) =>
    h('button', {
      class: 'opt',
      onclick: (ev) => {
        if (!quiz || quiz.busy) return;
        quiz.busy = true;
        quiz.waitQ = G.q;
        quiz.btn = ev.currentTarget;
        Sound.sfx('click');
        act('ans', { w: G.w, q: G.q, o: i });
        setTimeout(() => quiz && quiz.waitQ === G.q && (quiz.busy = false), 3500);
      },
    }, o)
  );
  openModal(
    h('h2', {}, h('span', { class: 'ic' }, '🔐'), `لغز البوابة · ${G.q + 1}/3`),
    h('div', { class: 'quiz-progress' }, [0, 1, 2].map((i) => h('i', { class: G.locks[i] ? 'on' : i === G.q ? 'cur' : '' }))),
    h('p', {}, Q.q),
    h('div', { class: 'options' }, opts),
    fb,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: openJournal }, '📖 سجل الحقائق'), h('button', { class: 'btn', onclick: closeModal }, 'لاحقًا'))
  );
  quiz = Object.assign(quiz || {}, { fb, busy: false });
}
function quizResult(e) {
  if (!quiz) return;
  if (e.by === me.pid && e.q === quiz.waitQ) {
    if (e.ok) {
      quiz.btn?.classList.add('right');
      quiz.fb.className = 'feedback good';
      quiz.fb.textContent = '✅ ' + WORLDS[G.w].quiz[e.q].explain;
      quiz.busy = true;
      setTimeout(() => quiz && (e.open ? closeModal() : renderQuiz()), 1800);
    } else {
      quiz.btn?.classList.add('wrong');
      quiz.fb.className = 'feedback bad';
      quiz.fb.textContent = '❌ إجابة غير صحيحة (−50). راجعوا سجل الحقائق وحاولوا مجددًا.';
      quiz.busy = false;
    }
  } else if (e.ok) {
    quiz.fb.className = 'feedback good';
    quiz.fb.textContent = `✅ ${cleanName(e.n)} أجاب على هذا السؤال!`;
    quiz.busy = true;
    setTimeout(() => quiz && (e.open ? closeModal() : renderQuiz()), 1400);
  }
}

function openJournal() {
  const kids = [h('h2', {}, h('span', { class: 'ic' }, '📖'), `سجل الحقائق (${journal.size})`)];
  const list = h('div', { class: 'journal' });
  WORLDS.forEach((w) => {
    list.append(h('div', { class: 'w' }, w.name));
    for (const c of w.clues) {
      const col = '#' + c.color.toString(16).padStart(6, '0');
      if (journal.has(c.id)) list.append(h('div', { class: 'fact', style: `--c:${col}` }, h('p', {}, h('b', {}, `${c.icon} ${c.title}: `), c.text)));
      else list.append(h('div', { class: 'fact locked' }, h('p', {}, c.secret ? '✦ حقيقة سرّية لم تُكتشف بعد' : '🔒 حقيقة لم تُكتشف بعد')));
    }
  });
  kids.push(list, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => (quiz ? renderQuiz() : closeModal()) }, quiz ? 'رجوع إلى اللغز' : 'إغلاق')));
  const keepQuiz = quiz;
  openModal(...kids);
  quiz = keepQuiz;
}

function openHelp() {
  const row = (k, v) => [h('div', {}, h('kbd', {}, k)), h('div', {}, v)];
  openModal(
    h('h2', {}, h('span', { class: 'ic' }, '🧭'), 'كيف تلعب'),
    h('p', {}, 'أنتم فريق من المستكشفين داخل عالم مجهري. اجمعوا البلّورات المضيئة لتتعلّموا حقائق علمية، ثم افتحوا أقفال البوابة الثلاثة بالإجابة الصحيحة، وادخلوا البوابة إلى العالم التالي. احذروا الأعداء المتجوّلين!'),
    h('p', { class: 'sub' }, 'كل دليل يجمعه أي لاعب يُحسب للفريق كله. الإجابة الخاطئة تخصم 50 نقطة. ابحثوا عن الدليل السرّي فوق المنصّات في كل عالم ✦'),
    h('div', { class: 'help-grid' }, row('W A S D', 'الحركة'), row('Space', 'القفز'), row('Shift', 'الركض'), row('E', 'جمع دليل / فتح لغز البوابة'), row('Enter', 'دردشة مع الفريق'), row('J', 'سجل الحقائق'), row('H', 'تلميح'), row('M', 'كتم الصوت'), row('🖱️', 'انقر ثم حرّك الفأرة لتدوير الكاميرا')),
    h('p', { class: 'sub' }, 'على الجوال: اسحب يسار الشاشة للحركة، ويمينها لتدوير الكاميرا.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'فهمت!'))
  );
}

function openInvite() {
  if (net.mode === 'solo') return nano('أنت في وضع منفرد لأن خادم الاتصال غير متاح الآن.', 4);
  const link = inviteLink();
  const inp = h('input', { value: link, readonly: true, onfocus: (e) => e.target.select() });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('تم نسخ رابط الدعوة ✅');
    } catch {
      inp.select();
      document.execCommand?.('copy');
      toast('تم نسخ الرابط');
    }
  };
  openModal(
    h('h2', {}, h('span', { class: 'ic' }, '🔗'), 'ادعُ أصدقاءك'),
    h('p', {}, 'أرسل هذا الرابط لأصدقائك ليدخلوا غرفتك مباشرة، أو أعطهم رمز الغرفة:'),
    h('div', { style: 'text-align:center;font-family:Orbitron,monospace;font-size:34px;letter-spacing:.3em;color:var(--gold)', dir: 'ltr' }, net.code),
    h('div', { class: 'share' }, inp, h('button', { class: 'btn', onclick: copy }, 'نسخ')),
    navigator.share ? h('button', { class: 'btn', onclick: () => navigator.share({ title: 'حُرّاس الخلية', text: 'انضم إلى مغامرتي في حُرّاس الخلية!', url: link }).catch(() => {}) }, '📤 مشاركة') : null,
    h('p', { class: 'sub' }, `حتى ${MAX_PLAYERS} لاعبين في الغرفة الواحدة.`),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: closeModal }, 'تم'))
  );
}

let victoryShown = false;
function showVictory() {
  if (victoryShown) return;
  victoryShown = true;
  const mins = Math.floor(G.tw / 60), secs = Math.floor(G.tw % 60);
  const rows = [...roster.values()].sort((a, b) => b.s + b.k - (a.s + a.k)).map((P) =>
    h('div', { class: 'r' }, h('span', {}, h('span', { style: `color:${hex(P.c)}` }, '● '), P.n), h('span', { dir: 'ltr' }, `🔬 ${P.s}  ✅ ${P.k}`))
  );
  openModal(
    h('h2', {}, h('span', { class: 'ic' }, '🏆'), 'أنقذتم الحياة!'),
    h('p', {}, 'من الخلية النباتية إلى الميتوكوندريا وحتى النظام البيئي… عاد التوازن بفضل فريقكم.'),
    h('div', { class: 'stats-table' }, h('div', { class: 'r' }, h('b', {}, 'نقاط الفريق'), h('b', { dir: 'ltr' }, `⭐ ${G.score}`)), h('div', { class: 'r' }, h('span', {}, 'الوقت'), h('span', { dir: 'ltr' }, `${mins}:${String(secs).padStart(2, '0')}`)), h('div', { class: 'r' }, h('span', {}, 'حقائق في سجلّك'), h('span', {}, `${journal.size}`)), ...rows),
    h('div', { class: 'actions' },
      net.isHost ? h('button', { class: 'btn primary', onclick: () => act('restart') }, '🔁 العب من جديد') : h('div', { class: 'sub' }, 'بانتظار المضيف ليبدأ مغامرة جديدة…'),
      h('button', { class: 'btn', onclick: openJournal }, '📖 السجل')
    )
  );
}

let toastT = 0;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  toastT = 2;
}
function showNet(text) {
  $('netStatus').textContent = text;
  $('netStatus').hidden = false;
}
function hideNet() {
  $('netStatus').hidden = true;
}

// ---------- chat ----------
function chatLine(name, text, color, sys = false) {
  const log = $('chatLog');
  const el = sys ? h('div', { class: 'chat-line sys' }, text) : h('div', { class: 'chat-line' }, h('b', { style: `color:${hex(color)}` }, name + ':'), text);
  log.append(el);
  while (log.children.length > 7) log.firstChild.remove();
  setTimeout(() => el.remove(), 30000);
}
function openChat() {
  const inp = $('chatIn');
  inp.hidden = false;
  input.keys.clear();
  input.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  inp.focus();
}
function closeChat() {
  const inp = $('chatIn');
  inp.value = '';
  inp.hidden = true;
  inp.blur();
  if ($('modal').hidden) input.enabled = true;
}
$('chatIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = cleanChat(e.target.value);
    if (text) act('chat', { text });
    closeChat();
    e.preventDefault();
  } else if (e.key === 'Escape') closeChat();
  e.stopPropagation();
});
$('chatIn').addEventListener('blur', () => setTimeout(() => !$('chatIn').hidden && closeChat(), 100));

// ---------- keyboard shortcuts ----------
addEventListener('keydown', (e) => {
  if (mode !== 'play' || e.target.closest?.('input')) return;
  if (e.key === 'Escape' && !$('modal').hidden && !quiz?.busy) return closeModal();
  if (!$('modal').hidden) return;
  if (e.code === 'KeyE') interact();
  else if (e.code === 'KeyJ') openJournal();
  else if (e.code === 'KeyH') nano(WORLDS[G.w].hint, 7);
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'Enter') {
    e.preventDefault();
    openChat();
  }
});
function toggleMute() {
  const m = Sound.toggleMute();
  $('muteBtn').textContent = m ? '🔇' : '🔊';
}
$('journalBtn').onclick = openJournal;
$('hintBtn').onclick = () => nano(WORLDS[G.w].hint, 7);
$('chatBtn').onclick = openChat;
$('muteBtn').onclick = toggleMute;
$('muteBtn').textContent = Sound.isMuted() ? '🔇' : '🔊';
$('helpBtn').onclick = openHelp;
$('inviteBtn').onclick = openInvite;
$('fsBtn').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
};

// =================================================================
// HUD + MINIMAP
// =================================================================
const mm = $('minimap');
const mg = mm.getContext('2d');
let mmBase = null;
const MM_S = 100 / 36;
function drawMinimapBase() {
  const c = document.createElement('canvas');
  c.width = c.height = 200;
  const g = c.getContext('2d');
  g.translate(100, 100);
  const grd = g.createRadialGradient(0, 0, 10, 0, 0, 100);
  grd.addColorStop(0, 'rgba(20,60,70,0.85)');
  grd.addColorStop(1, 'rgba(4,16,22,0.9)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 100, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(63,240,224,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 34.5 * MM_S, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineCap = 'round';
  for (const s of W.env.mini) {
    if (s.t === 'c') {
      g.beginPath();
      g.arc(s.x * MM_S, s.z * MM_S, Math.max(1.5, s.r * MM_S), 0, Math.PI * 2);
      g.fill();
    } else if (s.t === 'b') g.fillRect(s.x0 * MM_S, s.z0 * MM_S, (s.x1 - s.x0) * MM_S, (s.z1 - s.z0) * MM_S);
    else if (s.t === 'cap') {
      g.lineWidth = s.r * 2 * MM_S;
      g.beginPath();
      g.moveTo((s.x - Math.cos(s.rot) * s.half) * MM_S, (s.z + Math.sin(s.rot) * s.half) * MM_S);
      g.lineTo((s.x + Math.cos(s.rot) * s.half) * MM_S, (s.z - Math.sin(s.rot) * s.half) * MM_S);
      g.stroke();
    }
  }
  mmBase = c;
}
const tmpV = new THREE.Vector3();
function drawMinimap(hz) {
  if (!mmBase) return;
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.clearRect(0, 0, 200, 200);
  mg.save();
  mg.beginPath();
  mg.arc(100, 100, 100, 0, Math.PI * 2);
  mg.clip();
  mg.drawImage(mmBase, 0, 0);
  mg.translate(100, 100);
  // gate
  mg.strokeStyle = G.open ? '#5dffb0' : '#ff3d6e';
  mg.lineWidth = 3;
  mg.beginPath();
  mg.arc(GATE.x * MM_S, GATE.z * MM_S, 7, Math.PI, 0);
  mg.stroke();
  // clues
  for (const c of WORLDS[W.index].clues) {
    if (G.found[c.id]) continue;
    const p = W.env.clues[c.id];
    if (!p) continue;
    mg.fillStyle = '#' + c.color.toString(16).padStart(6, '0');
    mg.save();
    mg.translate(p[0] * MM_S, p[2] * MM_S);
    mg.rotate(Math.PI / 4);
    const s = c.secret ? 3.5 : 5;
    mg.fillRect(-s, -s, s * 2, s * 2);
    mg.restore();
  }
  // hazards
  mg.fillStyle = '#ff2d55';
  for (const hz2 of W.hazards) {
    hazardPos(hz2.spec, hz, tmpV);
    mg.beginPath();
    mg.arc(tmpV.x * MM_S, tmpV.z * MM_S, 3, 0, Math.PI * 2);
    mg.fill();
  }
  // players
  for (const [pid, P] of roster) {
    if (pid === me.pid) continue;
    const A = avatars.get(pid);
    const x = A ? A.pos.x : P.p[0], z = A ? A.pos.z : P.p[2];
    mg.fillStyle = hex(P.c);
    mg.beginPath();
    mg.arc(x * MM_S, z * MM_S, 4.5, 0, Math.PI * 2);
    mg.fill();
  }
  mg.save();
  mg.translate(player.pos.x * MM_S, player.pos.z * MM_S);
  mg.rotate(-player.yaw + Math.PI);
  mg.fillStyle = '#fff';
  mg.beginPath();
  mg.moveTo(0, -8);
  mg.lineTo(5.5, 6);
  mg.lineTo(0, 3);
  mg.lineTo(-5.5, 6);
  mg.closePath();
  mg.fill();
  mg.restore();
  mg.restore();
}

function updateHud() {
  const w = WORLDS[G.w];
  $('worldName').textContent = w.name;
  $('score').textContent = `⭐ ${G.score}`;
  const secret = w.clues.some((c) => c.secret && G.found[c.id]);
  $('clueCount').textContent = `🔬 ${foundRequired()}/${requiredCount(G.w)}${secret ? ' ✦' : ''}`;
  $('locks').textContent = G.locks.map((l) => (l ? '🔓' : '🔒')).join('');
  $('hpBar').style.width = Math.max(0, hp) + '%';
  $('stBar').style.width = Math.round(player.stamina * 100) + '%';
  $('roomCode').textContent = net.mode === 'solo' ? 'منفرد' : net.code || '';
  $('inviteBtn').hidden = net.mode === 'solo';
  const list = $('players');
  const rows = [...roster.values()].sort((a, b) => order.indexOf(a.pid) - order.indexOf(b.pid));
  list.replaceChildren(
    ...rows.map((P) =>
      h('div', { class: 'p' + (P.pid === me.pid ? ' me' : '') },
        h('span', { class: 'dot', style: `color:${hex(P.c)};background:${hex(P.c)}` }),
        h('span', { class: 'nm' }, (P.pid === (net.isHost ? me.pid : hostPid) ? '👑 ' : '') + P.n),
        h('span', { class: 'sc' }, `🔬${P.s} ✅${P.k}`)
      )
    )
  );
}

// =================================================================
// TITLE / LOBBY
// =================================================================
function setStatus(text, err = false) {
  $('status').textContent = text;
  $('status').className = 'status' + (err ? ' err' : '');
}
function enableTitle(on) {
  for (const id of ['createBtn', 'joinBtn', 'joinInvited']) $(id).disabled = !on;
}
function readTitle() {
  me.name = cleanName($('nameIn').value);
  store.set('cg-name', me.name);
  store.set('cg-color', me.color);
}
function initTitle() {
  $('nameIn').value = me.name;
  const sw = $('swatches');
  PLAYER_COLORS.forEach((c, i) => {
    const b = h('button', { class: 'swatch' + (i === me.color ? ' on' : ''), style: `background:${hex(i)};color:${hex(i)}`, 'aria-label': 'لون ' + (i + 1) });
    b.onclick = () => {
      me.color = i;
      sw.querySelectorAll('.swatch').forEach((x, k) => x.classList.toggle('on', k === i));
      buildMyAvatar();
    };
    sw.append(b);
  });
  const params = new URLSearchParams(location.search);
  const urlCode = cleanCode(params.get('room') || location.hash.slice(1));
  if (urlCode.length >= 4) {
    $('joinBox').hidden = false;
    $('joinCodeLbl').textContent = urlCode;
    $('codeIn').value = urlCode;
    $('createBtn').classList.remove('primary');
  }
  $('createBtn').onclick = () => {
    readTitle();
    Sound.initAudio();
    startHosting(randomCode(), false);
  };
  $('joinBtn').onclick = () => {
    readTitle();
    Sound.initAudio();
    joinRoom(cleanCode($('codeIn').value));
  };
  $('joinInvited').onclick = () => {
    readTitle();
    Sound.initAudio();
    joinRoom(urlCode);
  };
  $('codeIn').addEventListener('keydown', (e) => e.key === 'Enter' && $('joinBtn').click());
  $('nameIn').addEventListener('keydown', (e) => e.key === 'Enter' && ($('joinBox').hidden ? $('createBtn') : $('joinInvited')).click());
}

async function startHosting(code, fromJoin, tries = 0) {
  enableTitle(false);
  setStatus('جارٍ تجهيز الغرفة…');
  try {
    await net.host(code);
    G = newGame();
    hostPid = me.pid;
    roster.clear();
    roster.set(me.pid, { pid: me.pid, n: me.name, c: me.color, p: [...SPAWN], r: Math.PI, a: 0, s: 0, k: 0 });
    order = [me.pid];
    beginPlay();
  } catch (e) {
    if (e.type === 'unavailable-id' && tries < 3) {
      // someone else grabbed this code first
      if (fromJoin) return joinRoom(code, tries + 1);
      return startHosting(randomCode(), false, tries + 1);
    }
    networkFail(e);
  }
}

async function joinRoom(code, tries = 0) {
  if (!code || code.length < 4) {
    setStatus('اكتب رمز الغرفة (٤ أحرف أو أرقام).', true);
    return;
  }
  enableTitle(false);
  setStatus(`جارٍ الاتصال بالغرفة ${code}…`);
  try {
    await net.join(code);
    await new Promise((res, rej) => {
      waitingWelcome = res;
      net.sendToHost(helloMsg());
      setTimeout(() => rej(Object.assign(new Error('no welcome'), { type: 'timeout' })), 8000);
    });
    beginPlay();
  } catch (e) {
    waitingWelcome = null;
    if (e.type === 'peer-unavailable' && tries < 3) {
      setStatus('لا يوجد أحد في هذه الغرفة بعد… سننشئها لك الآن ✨');
      await sleep(500);
      return startHosting(code, true, tries + 1);
    }
    networkFail(e);
  }
}

function networkFail(e) {
  console.warn('network', e);
  net.destroy();
  enableTitle(true);
  setStatus('', false);
  const st = $('status');
  st.className = 'status err';
  st.replaceChildren(
    'تعذّر الاتصال بخادم اللعب الجماعي. ',
    h('button', { class: 'btn small', onclick: () => {
      net.solo();
      G = newGame();
      roster.clear();
      roster.set(me.pid, { pid: me.pid, n: me.name, c: me.color, p: [...SPAWN], r: Math.PI, a: 0, s: 0, k: 0 });
      order = [me.pid];
      hostPid = me.pid;
      beginPlay();
    } }, 'العب منفردًا')
  );
}

function beginPlay() {
  mode = 'play';
  $('title').hidden = true;
  $('hud').hidden = false;
  if (isMobile) $('touch').hidden = false;
  else {
    $('lockHint').hidden = false;
    setTimeout(() => ($('lockHint').hidden = true), 9000);
  }
  if (net.mode !== 'solo' && net.code) history.replaceState(null, '', `${location.pathname}?room=${net.code}`);
  buildMyAvatar();
  if (!W || W.index !== G.w) loadWorld(G.w);
  else for (const [id, obj] of Object.entries(W.clueObjs)) obj.setFound(!!G.found[id]);
  player.teleport(spawnPoint());
  player.updateCamera(camera, 0, true);
  fade = 1;
  fadeTarget = 0;
  Sound.playMusic(G.w);
  nano(WORLDS[G.w].intro, 8);
  if (net.mode === 'host') setTimeout(() => feed('شارك رمز الغرفة مع أصدقائك ليلعبوا معك 🔗', 'good'), 2500);
  if (G.phase === 'won') showVictory();
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) $('lockHint').hidden = true;
});
addEventListener('pagehide', () => net.destroy());

// =================================================================
// NETWORK TICK (setInterval so it keeps running in background tabs)
// =================================================================
let lastNet = performance.now();
let lastWatch = 0;
// Drive networking from a Web Worker clock: background tabs throttle normal timers hard,
// which would make a minimised host look disconnected to everyone else.
function startTicker(fn, ms) {
  try {
    const src = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    const w = new Worker(src);
    w.onmessage = fn;
    return;
  } catch {}
  setInterval(fn, ms);
}
startTicker(() => {
  const now = performance.now();
  const dt = Math.min(1.5, (now - lastNet) / 1000);
  lastNet = now;
  if (mode !== 'play') return;
  const st = [r2(player.pos.x), r2(player.pos.y), r2(player.pos.z)];
  if (net.isHost) {
    const mine = roster.get(me.pid);
    if (mine) Object.assign(mine, { n: me.name, c: me.color, p: st, r: r2(player.yaw), a: player.anim });
    hostTick(dt);
    if (net.mode === 'host') net.broadcast(snapshot());
  } else if (net.mode === 'client') {
    net.sendToHost({ t: 'st', p: st, r: r2(player.yaw), a: player.anim });
  }
  if (now - lastWatch > 1000) {
    lastWatch = now;
    net.watchdog();
  }
}, Math.round(1000 / NET_HZ));

// =================================================================
// MAIN LOOP
// =================================================================
let hzClock = 0;
let hudT = 0, mmT = 0;
const timer = new THREE.Timer();
const tmp = new THREE.Vector3();
const chest = new THREE.Vector3();

let lastFrameAt = performance.now();
// Some mobile browsers/webviews occasionally never deliver the first animation frame;
// restart the loop if a visible page hasn't drawn for a while.
setInterval(() => {
  if (!document.hidden && performance.now() - lastFrameAt > 1500) {
    renderer.setAnimationLoop(null);
    renderer.setAnimationLoop(frame);
    lastFrameAt = performance.now();
  }
}, 1000);

// adaptive quality: if frames are slow, lower the render resolution step by step
let quality = Math.min(MAX_PR, devicePixelRatio), perfAcc = 0, perfN = 0, perfWarm = 3;
function adaptQuality(rawDt) {
  if (document.hidden || rawDt > 0.25) return; // ignore tab switches / hitches
  if (perfWarm > 0) return void (perfWarm -= rawDt);
  perfAcc += rawDt;
  perfN++;
  if (perfAcc < 2) return;
  const avg = perfAcc / perfN;
  perfAcc = perfN = 0;
  if (avg > 1 / 40 && quality > 1) {
    quality = Math.max(1, quality - 0.25);
    pipe.setPixelRatio(quality);
  }
}

function frame(now) {
  lastFrameAt = performance.now();
  timer.update(now);
  const rawDt = timer.getDelta();
  adaptQuality(rawDt);
  const dt = Math.min(0.05, rawDt);
  const t = timer.getElapsed();
  timeU.value = t;

  if (mode === 'title') {
    const a = t * 0.06;
    camera.position.set(Math.sin(a) * 31, 12 + Math.sin(t * 0.2) * 2, Math.cos(a) * 31);
    camera.lookAt(0, 2.5, 0);
    if (myAv) {
      myAv.root.position.set(0, 0, 20);
      myAv.root.rotation.y = t * 0.6;
      myAv.animate(dt, 0, false, t);
    }
  } else {
    // local simulation
    const jumped = player.update(dt, input, W.colliders);
    if (jumped) Sound.sfx('jump');
    if (wasAir && player.onGround && player.vel.y === 0) Sound.sfx('land');
    wasAir = !player.onGround;
    player.updateCamera(camera, dt);
    myAv.root.position.copy(player.pos);
    myAv.root.rotation.y = player.yaw;
    myAv.animate(dt, player.speed, !player.onGround, t);
    if (myBubble) {
      myBubbleT -= dt;
      if (myBubbleT <= 0) {
        disposeSprite(myBubble);
        myBubble = null;
      }
    }

    // hazard clock: host is exact, clients follow the host smoothly
    const target = net.isHost ? G.clock : G.clock + Math.min(0.4, (performance.now() - snapAt) / 1000);
    hzClock += dt;
    if (Math.abs(target - hzClock) > 1.5) hzClock = target;
    else hzClock += (target - hzClock) * Math.min(1, dt * 3);

    invuln = Math.max(0, invuln - dt);
    chest.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
    for (const hz of W.hazards) {
      hazardPos(hz.spec, hzClock, hz.mesh.position);
      hz.mesh.rotation.y = t * 1.4;
      hz.mesh.rotation.x = t * 0.7;
      if (W.env.hazardKind === 'radical') hz.mesh.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
      if (W.env.hazardKind === 'smog') {
        hz.mesh.rotation.x = 0;
        hz.mesh.lookAt(player.pos.x, hz.mesh.position.y, player.pos.z);
      }
      if (invuln <= 0 && G.phase === 'play' && chest.distanceTo(hz.mesh.position) < 1.25) {
        hp -= 25;
        invuln = 1.3;
        hurtFlash = 1;
        tmp.subVectors(chest, hz.mesh.position).setY(0).normalize().multiplyScalar(10);
        tmp.y = 6;
        player.impulse(tmp);
        Sound.sfx('hurt');
        const who = W.env.hazardKind === 'virus' ? 'فيروس' : W.env.hazardKind === 'radical' ? 'جذر حرّ' : 'سحابة تلوث';
        if (hp > 0) nano(`احذر! أصابك ${who} (−25 صحة)`, 3);
      }
    }
    if (hp <= 0) {
      hp = 100;
      player.teleport(spawnPoint());
      player.updateCamera(camera, 0, true);
      fade = 0.8;
      nano('سقطت! عُدت إلى نقطة البداية بصحة كاملة. تجنّب الأعداء الحمراء.', 5);
    }
    hurtFlash = Math.max(0, hurtFlash - dt * 1.8);

    // portal: walking through it moves the whole team on
    portalCooldown = Math.max(0, portalCooldown - dt);
    if (G.open && G.pend <= 0 && portalCooldown <= 0 && Math.abs(player.pos.x - GATE.x) < 2.6 && Math.abs(player.pos.z - GATE.z) < 1.3) {
      portalCooldown = 3;
      act('next');
    }

    // interaction prompt
    const it = $('modal').hidden ? nearestInteract() : null;
    const pr = $('prompt');
    const key = isMobile ? '✋' : 'E';
    if (it?.type === 'clue') {
      pr.replaceChildren('اضغط ', h('kbd', {}, key), ' لجمع الدليل');
      pr.hidden = false;
    } else if (it?.type === 'gate') {
      if (G.open) pr.replaceChildren('🌀 امشِ عبر البوابة');
      else if (foundRequired() < requiredCount(G.w)) pr.replaceChildren(`🔒 البوابة تحتاج ${requiredCount(G.w)} دلائل (${foundRequired()}/${requiredCount(G.w)})`);
      else pr.replaceChildren('اضغط ', h('kbd', {}, key), ' لحل لغز البوابة');
      pr.hidden = false;
    } else pr.hidden = true;

    // remote players
    syncAvatars(dt, t);

    // nano drone
    tmp.set(player.pos.x + Math.sin(player.yaw + 2.2) * 0.9, player.pos.y + 2.15 + Math.sin(t * 3) * 0.12, player.pos.z + Math.cos(player.yaw + 2.2) * 0.9);
    nanoBot.position.lerp(tmp, 1 - Math.exp(-dt * 5));
    nanoBot.lookAt(camera.position);
    nanoBot.getObjectByName('ring').rotation.z = t * 2;

    // timers
    if (nanoTimer > 0 && (nanoTimer -= dt) <= 0) $('nano').hidden = true;
    if (toastT > 0 && (toastT -= dt) <= 0) $('toast').hidden = true;
    if ((hudT -= dt) <= 0) {
      hudT = 0.2;
      updateHud();
    }
    if ((mmT -= dt) <= 0) {
      mmT = 1 / 15;
      drawMinimap(hzClock);
    }
  }

  if (W) {
    W.env.update(dt, t);
    W.gate.update(dt, t, G.locks, G.open);
    for (const [id, obj] of Object.entries(W.clueObjs)) {
      if (!!G.found[id] !== obj.found && !G.found[id]) obj.setFound(false);
      if (G.found[id] && !obj.found) obj.setFound(true);
      obj.update(dt, t);
    }
  }
  bursts.update(dt);
  fade += (fadeTarget - fade) * Math.min(1, dt * 4);
  pipe.grade.uFade.value = fade;
  pipe.grade.uHurt.value = hurtFlash * 0.6;
  if (innerWidth && innerHeight) pipe.composer.render(dt);
}

// =================================================================
// BOOT
// =================================================================
async function boot() {
  await Promise.race([document.fonts?.ready, sleep(2500)]);
  loadWorld(0);
  buildMyAvatar();
  initTitle();
  renderer.setAnimationLoop(frame);
  await sleep(250);
  $('loading').classList.add('done');
  setTimeout(() => $('loading').remove(), 800);
}
boot().catch((err) => {
  console.error(err);
  $('loading').replaceChildren(h('div', {}, 'تعذّر تشغيل اللعبة على هذا الجهاز (WebGL مطلوب).'));
});

// debug handle for automated tests
window.__cg = { get G() { return G; }, get order() { return order; }, roster, me, net, player, get W() { return W; }, act, goToWorld, spawnPoint, interact, renderer, pipe, frame, get fade() { return fade; } };
