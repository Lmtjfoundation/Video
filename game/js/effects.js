// Particles, tracers, explosions, shockwaves, debris and rain.
import * as THREE from 'three';
import { rand, clamp } from './util.js';

const VS = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  vAlpha = alpha;
  vColor = pcolor;
}`;
const FS = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}`;

class ParticleSystem {
  constructor(scene, n, additive) {
    this.n = n;
    this.geo = new THREE.BufferGeometry();
    this.p = new Float32Array(n * 3);
    this.c = new Float32Array(n * 3);
    this.s = new Float32Array(n);
    this.a = new Float32Array(n);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uScale: { value: 400 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
    this.cursor = 0;
    this.active = 0;
  }

  emit(x, y, z, vx, vy, vz, life, size, col, alpha = 1, grav = 0, drag = 0, grow = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.c[i3] = col[0]; this.c[i3 + 1] = col[1]; this.c[i3 + 2] = col[2];
    this.life[i] = life; this.max[i] = life;
    this.s[i] = size; this.a[i] = alpha; this.a0[i] = alpha;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }

  update(dt) {
    const { p, v, life, max, s, a, a0, grav, drag, grow } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { if (a[i] !== 0) { a[i] = 0; s[i] = 0; } continue; }
      life[i] -= dt;
      const i3 = i * 3;
      const dk = Math.exp(-drag[i] * dt);
      v[i3] *= dk; v[i3 + 1] = v[i3 + 1] * dk - grav[i] * dt; v[i3 + 2] *= dk;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < 0.05 && grav[i] > 0) { p[i3 + 1] = 0.05; v[i3 + 1] *= -0.3; v[i3] *= 0.6; v[i3 + 2] *= 0.6; }
      s[i] += grow[i] * dt;
      const t = life[i] / max[i];
      a[i] = a0[i] * Math.min(1, t * 2.5);
      if (life[i] <= 0) { a[i] = 0; s[i] = 0; }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.add = new ParticleSystem(scene, 3000, true);
    this.norm = new ParticleSystem(scene, 3000, false);
    // tracers
    this.maxTracers = 80;
    this.tp = new Float32Array(this.maxTracers * 6);
    this.tc = new Float32Array(this.maxTracers * 6);
    this.tlife = new Float32Array(this.maxTracers);
    this.tcol = new Float32Array(this.maxTracers * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tp, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tc, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerMesh = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.tracerMesh.frustumCulled = false;
    scene.add(this.tracerMesh);
    this.tcur = 0;
    // flashes (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 60, 1.6);
      scene.add(l);
      this.lights.push({ l, t: 0, max: 1, power: 0 });
    }
    this.lcur = 0;
    // shockwave rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, t: 0, max: 0.6, scale: 1 });
    }
    // debris chunks
    this.debris = [];
    const dg = new THREE.BoxGeometry(0.5, 0.2, 0.7);
    const dm = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(dg, dm);
      m.visible = false;
      scene.add(m);
      this.debris.push({ m, vx: 0, vy: 0, vz: 0, t: 0, sx: 0, sz: 0 });
    }
    this.dcur = 0;
    // rain
    this.rainN = 2500;
    this.rp = new Float32Array(this.rainN * 6);
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.BufferAttribute(this.rp, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.rainSeed = false;
    this.raining = 0;
  }

  setPixelScale(h) {
    this.add.mat.uniforms.uScale.value = h * 0.9;
    this.norm.mat.uniforms.uScale.value = h * 0.9;
  }

  // ---------------------------------------------------------------- helpers
  fire(x, y, z, k = 1) {
    this.add.emit(x, y, z, rand(-0.6, 0.6), rand(2, 4) * k, rand(-0.6, 0.6), rand(0.4, 0.8), rand(1.2, 2.2) * k, [1, rand(0.35, 0.6), 0.1], 0.9, -1, 1, 1.5);
    if (Math.random() < 0.4) this.norm.emit(x, y + 1, z, rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5), rand(1.5, 3), rand(1.5, 2.5) * k, [0.1, 0.1, 0.1], 0.55, -0.4, 0.4, 2.5);
  }
  smoke(x, y, z, shade = 0.4) {
    this.norm.emit(x, y, z, rand(-0.4, 0.4), rand(1, 2.5), rand(-0.4, 0.4), rand(1.2, 2.4), rand(0.8, 1.4), [shade, shade, shade], 0.45, -0.3, 0.5, 1.8);
  }
  sparks(x, y, z, n = 10, col = [1, 0.8, 0.3]) {
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, rand(-6, 6), rand(1, 7), rand(-6, 6), rand(0.2, 0.5), rand(0.12, 0.25), col, 1, 18, 0.5);
  }
  blood(x, y, z, dx = 0, dz = 0) {
    for (let i = 0; i < 12; i++) this.norm.emit(x, y, z, dx * 3 + rand(-1.5, 1.5), rand(0, 3), dz * 3 + rand(-1.5, 1.5), rand(0.4, 0.8), rand(0.15, 0.3), [0.55, 0.02, 0.02], 0.95, 14, 0.5);
  }
  muzzle(x, y, z, dx, dy, dz, big = false) {
    const k = big ? 2 : 1;
    this.add.emit(x, y, z, dx * 3, dy * 3, dz * 3, 0.06, 0.6 * k, [1, 0.85, 0.4], 1);
    this.add.emit(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3, dx * 6, dy * 6, dz * 6, 0.05, 0.4 * k, [1, 0.6, 0.2], 1);
  }
  impact(x, y, z) {
    this.sparks(x, y, z, 5);
    this.norm.emit(x, y, z, rand(-0.5, 0.5), rand(0.5, 1.5), rand(-0.5, 0.5), 0.6, 0.35, [0.55, 0.52, 0.48], 0.6, 0, 1, 1.2);
  }
  tireSmoke(x, y, z) {
    this.norm.emit(x, y, z, rand(-0.5, 0.5), rand(0.4, 1.2), rand(-0.5, 0.5), rand(0.8, 1.6), rand(0.6, 1.0), [0.85, 0.85, 0.85], 0.35, -0.2, 0.8, 2.2);
  }
  dust(x, y, z) {
    this.norm.emit(x, y, z, rand(-1, 1), rand(0.3, 1), rand(-1, 1), rand(0.6, 1.2), rand(0.6, 1.2), [0.55, 0.45, 0.32], 0.35, 0, 1, 1.5);
  }
  nitroFlame(x, y, z, vx, vz) {
    this.add.emit(x, y, z, vx + rand(-0.5, 0.5), rand(-0.2, 0.4), vz + rand(-0.5, 0.5), rand(0.1, 0.2), rand(0.5, 0.9), [0.3, 0.55, 1], 1, 0, 2, -1);
    this.add.emit(x, y, z, vx * 0.6, 0, vz * 0.6, 0.08, 0.6, [1, 0.9, 0.7], 1);
  }
  splash(x, y, z, n = 20) {
    for (let i = 0; i < n; i++) this.norm.emit(x, y, z, rand(-3, 3), rand(3, 8), rand(-3, 3), rand(0.6, 1.1), rand(0.3, 0.6), [0.8, 0.9, 1], 0.7, 16, 0.3);
  }
  rocketTrail(x, y, z) {
    this.add.emit(x, y, z, rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3), 0.15, 0.7, [1, 0.6, 0.2], 1);
    this.norm.emit(x, y, z, rand(-0.3, 0.3), rand(0.2, 0.6), rand(-0.3, 0.3), rand(1, 1.8), rand(0.5, 0.8), [0.75, 0.75, 0.75], 0.5, -0.2, 0.6, 2);
  }
  confetti(x, y, z, n = 60) {
    const cols = [[0.48, 0.25, 0.75], [0.18, 0.66, 0.31], [0.91, 0.76, 0.23], [1, 0.3, 0.5]];
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, rand(-6, 6), rand(4, 12), rand(-6, 6), rand(1.2, 2.2), rand(0.25, 0.45), cols[i % 4], 1, 6, 0.8);
  }
  cashBurst(x, y, z) {
    for (let i = 0; i < 20; i++) this.add.emit(x, y, z, rand(-2, 2), rand(2, 5), rand(-2, 2), rand(0.6, 1), rand(0.25, 0.4), [0.3, 1, 0.3], 1, 8, 0.5);
  }

  tracer(ax, ay, az, bx, by, bz, col = [1, 0.85, 0.5]) {
    const i = this.tcur;
    this.tcur = (this.tcur + 1) % this.maxTracers;
    const i6 = i * 6;
    this.tp[i6] = ax; this.tp[i6 + 1] = ay; this.tp[i6 + 2] = az;
    this.tp[i6 + 3] = bx; this.tp[i6 + 4] = by; this.tp[i6 + 5] = bz;
    this.tlife[i] = 0.08;
    this.tcol[i * 3] = col[0]; this.tcol[i * 3 + 1] = col[1]; this.tcol[i * 3 + 2] = col[2];
  }

  flash(x, y, z, power = 1, dur = 0.35) {
    const L = this.lights[this.lcur];
    this.lcur = (this.lcur + 1) % this.lights.length;
    L.l.position.set(x, y + 2, z);
    L.t = dur; L.max = dur; L.power = 60 * power;
    L.l.intensity = L.power;
    L.l.distance = 50 * power;
  }

  ring(x, y, z, scale) {
    const r = this.rings.find((o) => o.t <= 0) || this.rings[0];
    r.t = r.max = 0.5;
    r.scale = scale;
    r.m.position.set(x, y + 0.3, z);
    r.m.visible = true;
  }

  explosion(x, y, z, k = 1) {
    for (let i = 0; i < 50 * k; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(2, 12) * k;
      this.add.emit(x, y, z, Math.cos(a) * sp, rand(1, 10) * k, Math.sin(a) * sp, rand(0.4, 0.9), rand(2, 4.5) * k, [1, rand(0.3, 0.65), 0.08], 1, -2, 2.5, 3);
    }
    for (let i = 0; i < 35 * k; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(1, 6) * k;
      this.norm.emit(x, y + 1, z, Math.cos(a) * sp, rand(2, 7), Math.sin(a) * sp, rand(2, 4.5), rand(2.5, 4.5) * k, [0.13, 0.12, 0.11], 0.7, -0.5, 1, 3);
    }
    this.sparks(x, y, z, 40 * k);
    this.flash(x, y, z, 1.2 * k, 0.6);
    this.ring(x, y, z, 14 * k);
    for (let i = 0; i < 8 * k; i++) {
      const d = this.debris[this.dcur];
      this.dcur = (this.dcur + 1) % this.debris.length;
      d.m.position.set(x, y + 0.5, z);
      d.vx = rand(-12, 12); d.vy = rand(8, 20); d.vz = rand(-12, 12);
      d.sx = rand(-8, 8); d.sz = rand(-8, 8);
      d.t = rand(2.5, 4);
      d.m.visible = true;
    }
  }

  setRain(amount) { this.raining = amount; }

  update(dt, camPos) {
    this.add.update(dt);
    this.norm.update(dt);
    // tracers
    for (let i = 0; i < this.maxTracers; i++) {
      const l = this.tlife[i];
      const i6 = i * 6;
      if (l > 0) {
        this.tlife[i] -= dt;
        const k = Math.max(0, this.tlife[i] / 0.08);
        const r = this.tcol[i * 3] * k, g = this.tcol[i * 3 + 1] * k, b = this.tcol[i * 3 + 2] * k;
        this.tc[i6] = r * 0.3; this.tc[i6 + 1] = g * 0.3; this.tc[i6 + 2] = b * 0.3;
        this.tc[i6 + 3] = r; this.tc[i6 + 4] = g; this.tc[i6 + 5] = b;
      } else if (this.tc[i6 + 3] !== 0) {
        for (let j = 0; j < 6; j++) this.tc[i6 + j] = 0;
      }
    }
    this.tracerMesh.geometry.attributes.position.needsUpdate = true;
    this.tracerMesh.geometry.attributes.color.needsUpdate = true;
    // flashes
    for (const L of this.lights) {
      if (L.t > 0) {
        L.t -= dt;
        L.l.intensity = Math.max(0, L.power * (L.t / L.max));
      } else L.l.intensity = 0;
    }
    for (const r of this.rings) {
      if (r.t > 0) {
        r.t -= dt;
        const k = 1 - r.t / r.max;
        const s = 1 + k * r.scale;
        r.m.scale.set(s, 1, s);
        r.m.material.opacity = (1 - k) * 0.7;
        if (r.t <= 0) r.m.visible = false;
      }
    }
    for (const d of this.debris) {
      if (d.t <= 0) continue;
      d.t -= dt;
      d.vy -= 22 * dt;
      d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
      d.m.rotation.x += d.sx * dt; d.m.rotation.z += d.sz * dt;
      if (d.m.position.y < 0.1) { d.m.position.y = 0.1; d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; d.sx *= 0.5; d.sz *= 0.5; }
      if (Math.random() < dt * 20) this.smoke(d.m.position.x, d.m.position.y, d.m.position.z, 0.15);
      if (d.t <= 0) d.m.visible = false;
    }
    // rain
    if (this.raining > 0.01) {
      this.rain.visible = true;
      this.rain.material.opacity = 0.35 * this.raining;
      const rp = this.rp;
      if (!this.rainSeed) {
        for (let i = 0; i < this.rainN; i++) {
          const x = camPos.x + rand(-40, 40), y = camPos.y + rand(-10, 30), z = camPos.z + rand(-40, 40);
          rp.set([x, y, z, x - 0.1, y - 0.9, z], i * 6);
        }
        this.rainSeed = true;
      }
      for (let i = 0; i < this.rainN; i++) {
        const i6 = i * 6;
        let y = rp[i6 + 1] - 30 * dt;
        let x = rp[i6], z = rp[i6 + 2];
        if (y < camPos.y - 12 || Math.abs(x - camPos.x) > 40 || Math.abs(z - camPos.z) > 40) {
          x = camPos.x + rand(-40, 40); z = camPos.z + rand(-40, 40); y = camPos.y + rand(10, 30);
        }
        rp[i6] = x; rp[i6 + 1] = y; rp[i6 + 2] = z;
        rp[i6 + 3] = x - 0.1; rp[i6 + 4] = y - 0.9; rp[i6 + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    } else {
      this.rain.visible = false;
      this.rainSeed = false;
    }
  }
}
