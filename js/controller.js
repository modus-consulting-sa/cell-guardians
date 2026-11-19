// Input, character physics (cylinder vs circles/boxes) and third-person camera.
import * as THREE from 'three';
import { ARENA_R } from './env.js';

const GRAV = 26, JUMP = 9.6, WALK = 5.4, RUN = 8.6, RADIUS = 0.42, STEP = 0.45, HEIGHT = 1.75;

export class Input {
  constructor(canvas, touchRoot) {
    this.keys = new Set();
    this.move = new THREE.Vector2();
    this.look = new THREE.Vector2();
    this.jumpQueued = 0;
    this.sprint = false;
    this.enabled = true;
    this.touchMove = null;
    this.canvas = canvas;
    this.onInteract = null;
    this.locked = false;

    addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.enabled) {
        this.jumpQueued = 0.15;
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // mouse look: pointer lock when available, drag otherwise
    canvas.addEventListener('click', () => {
      if (!this.enabled || matchMedia('(pointer: coarse)').matches) return;
      canvas.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === canvas));
    let dragging = false;
    canvas.addEventListener('mousedown', (e) => (dragging = e.button === 0 || e.button === 2));
    addEventListener('mouseup', () => (dragging = false));
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || dragging) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.setupTouch(touchRoot);
  }

  setupTouch(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#knob');
    let moveId = null, lookId = null, origin = null, lastLook = null;
    const area = this.canvas;
    const start = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && moveId === null) {
          moveId = t.identifier;
          origin = { x: t.clientX, y: t.clientY };
          stick.style.display = 'block';
          stick.style.left = t.clientX - 60 + 'px';
          stick.style.top = t.clientY - 60 + 'px';
          knob.style.transform = 'translate(0px,0px)';
          this.touchMove = new THREE.Vector2();
        } else if (lookId === null) {
          lookId = t.identifier;
          lastLook = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) {
          let dx = t.clientX - origin.x, dy = t.clientY - origin.y;
          const len = Math.hypot(dx, dy), max = 55;
          if (len > max) {
            dx *= max / len;
            dy *= max / len;
          }
          knob.style.transform = `translate(${dx}px,${dy}px)`;
          this.touchMove.set(dx / max, -dy / max);
        } else if (t.identifier === lookId) {
          this.look.x += (t.clientX - lastLook.x) * 1.6;
          this.look.y += (t.clientY - lastLook.y) * 1.4;
          lastLook = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) {
          moveId = null;
          this.touchMove = null;
          stick.style.display = 'none';
        } else if (t.identifier === lookId) lookId = null;
      }
    };
    area.addEventListener('touchstart', start, { passive: false });
    area.addEventListener('touchmove', move, { passive: false });
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', end);
    root.querySelector('#btnJump').addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.enabled) this.jumpQueued = 0.15;
    }, { passive: false });
    root.querySelector('#btnAct').addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.enabled) this.onInteract?.();
    }, { passive: false });
  }

  read() {
    const k = this.keys;
    let x = 0, y = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    }
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.touchMove && this.enabled) {
      this.move.copy(this.touchMove);
      this.sprint = this.touchMove.length() > 0.92;
    }
    return this.move;
  }
}

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(0, 0, 20);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // facing -z (towards the gate)
    this.onGround = true;
    this.coyote = 0;
    this.speed = 0;
    this.camYaw = 0;
    this.camPitch = 0.32;
    this.camDist = 7;
    this.camPos = new THREE.Vector3();
    this.anim = 0;
    this.knock = 0;
    this.stamina = 1;
  }

  teleport(p) {
    this.pos.set(p[0], p[1] + 0.05, p[2]);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.camYaw = 0;
    this.camPos.set(p[0], p[1] + 4, p[2] + 7);
  }

  impulse(v) {
    this.vel.copy(v);
    this.knock = 0.35;
    this.onGround = false;
  }

  update(dt, input, colliders) {
    // camera look
    this.camYaw -= input.look.x * 0.0032;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + input.look.y * 0.0024, -0.15, 1.1);
    input.look.set(0, 0);

    const mv = input.read();
    const sprinting = input.sprint && mv.lengthSq() > 0.01 && this.stamina > 0.05;
    this.stamina = THREE.MathUtils.clamp(this.stamina + (sprinting ? -0.22 : 0.18) * dt, 0, 1);
    const speed = sprinting ? RUN : WALK;
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
    const dx = (fx * mv.y + rx * mv.x) * speed;
    const dz = (fz * mv.y + rz * mv.x) * speed;
    const accel = this.knock > 0 ? 2 : this.onGround ? 42 : 14;
    this.knock = Math.max(0, this.knock - dt);
    this.vel.x += THREE.MathUtils.clamp(dx - this.vel.x, -accel * dt, accel * dt);
    this.vel.z += THREE.MathUtils.clamp(dz - this.vel.z, -accel * dt, accel * dt);
    if (mv.lengthSq() > 0.01) {
      const target = Math.atan2(dx, dz);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }

    // jump (with coyote time + buffer)
    this.coyote = this.onGround ? 0.12 : Math.max(0, this.coyote - dt);
    input.jumpQueued = Math.max(0, input.jumpQueued - dt);
    let jumped = false;
    if (input.jumpQueued > 0 && this.coyote > 0) {
      this.vel.y = JUMP;
      this.coyote = 0;
      input.jumpQueued = 0;
      this.onGround = false;
      jumped = true;
    }

    // integrate in small steps for stable collisions
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this.step(h, colliders);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.anim = !this.onGround ? 3 : this.speed > 6.5 ? 2 : this.speed > 0.4 ? 1 : 0;
    return jumped;
  }

  step(h, colliders) {
    const p = this.pos;
    this.vel.y -= GRAV * h;
    p.addScaledVector(this.vel, h);

    // horizontal push-out
    for (const c of colliders) {
      if (c.top <= p.y + STEP) continue;
      if (c.t === 'c') {
        const ox = p.x - c.x, oz = p.z - c.z;
        const d = Math.hypot(ox, oz), min = c.r + RADIUS;
        if (d < min) {
          const nx = d > 1e-5 ? ox / d : 1, nz = d > 1e-5 ? oz / d : 0;
          p.x = c.x + nx * min;
          p.z = c.z + nz * min;
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) {
            this.vel.x -= vn * nx;
            this.vel.z -= vn * nz;
          }
        }
      } else {
        const cx = THREE.MathUtils.clamp(p.x, c.x0, c.x1), cz = THREE.MathUtils.clamp(p.z, c.z0, c.z1);
        let ox = p.x - cx, oz = p.z - cz;
        let d = Math.hypot(ox, oz);
        if (d < RADIUS) {
          let nx, nz;
          if (d < 1e-5) {
            // centre inside the box: leave by the shortest side
            const pen = [p.x - c.x0, c.x1 - p.x, p.z - c.z0, c.z1 - p.z];
            const i = pen.indexOf(Math.min(...pen));
            nx = [-1, 1, 0, 0][i];
            nz = [0, 0, -1, 1][i];
            p.x += nx * (pen[i] + RADIUS);
            p.z += nz * (pen[i] + RADIUS);
          } else {
            nx = ox / d;
            nz = oz / d;
            p.x = cx + nx * RADIUS;
            p.z = cz + nz * RADIUS;
          }
          const vn = this.vel.x * nx + this.vel.z * nz;
          if (vn < 0) {
            this.vel.x -= vn * nx;
            this.vel.z -= vn * nz;
          }
        }
      }
    }
    // arena boundary
    const r = Math.hypot(p.x, p.z), lim = ARENA_R - RADIUS;
    if (r > lim) {
      p.x *= lim / r;
      p.z *= lim / r;
    }

    // ground
    let ground = 0;
    for (const c of colliders) {
      if (c.top > p.y + STEP + 1e-3) continue;
      let inside;
      if (c.t === 'c') inside = Math.hypot(p.x - c.x, p.z - c.z) < c.r + RADIUS * 0.4;
      else inside = p.x > c.x0 - RADIUS * 0.4 && p.x < c.x1 + RADIUS * 0.4 && p.z > c.z0 - RADIUS * 0.4 && p.z < c.z1 + RADIUS * 0.4;
      if (inside && c.top > ground) ground = c.top;
    }
    if (p.y <= ground) {
      if (this.vel.y <= 0) {
        p.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      }
    } else {
      this.onGround = p.y - ground < 0.04 && this.vel.y <= 0;
      if (this.onGround) p.y = ground;
    }
  }

  updateCamera(camera, dt, snap = false) {
    const target = new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z);
    const cp = Math.cos(this.camPitch);
    let dist = this.camDist;
    const off = new THREE.Vector3(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    // keep the camera inside the arena wall
    for (let i = 0; i < 6; i++) {
      const test = target.clone().addScaledVector(off, dist);
      if (Math.hypot(test.x, test.z) < 34.6) break;
      dist *= 0.82;
    }
    const want = target.clone().addScaledVector(off, dist);
    want.y = Math.max(0.6, want.y);
    if (snap) this.camPos.copy(want);
    else this.camPos.lerp(want, 1 - Math.exp(-dt * 14));
    camera.position.copy(this.camPos);
    camera.lookAt(target);
  }
}
