// Humans: jointed character models, pedestrians, cops and gang members.
import * as THREE from 'three';
import { GeoBuilder, mat } from './geo.js';
import { clamp, rand, pick, chance, wrapAngle, smoothAngle, headingTo, dist2 } from './util.js';

// One shared vertex-coloured material; each body segment is a merged mesh,
// so a whole person is ~10 draw calls while still having a face and joints.
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.4, metalness: 0.6 });
const gunGeo = (() => {
  const b = new GeoBuilder();
  b.box(0, -0.02, 0.1, 0.045, 0.07, 0.22, '#1c1c1e');
  b.box(0, -0.1, 0.03, 0.04, 0.1, 0.05, '#2a2a2a');
  const g = b.build();
  g.rotateX(-Math.PI / 2);
  return g;
})();

const SKIN = ['#f3cfb3', '#e8b896', '#d49a72', '#b87d56', '#8d5a3b', '#6b4329', '#4a2e1c'];
const SHIRTS = ['#e8e8e8', '#b22222', '#1f3f8a', '#2e7d32', '#f9a825', '#6a1b9a', '#212121', '#ff7043', '#00838f', '#c2185b', '#8d6e63', '#f5f0e1', '#5b7fa6'];
const PANTS = ['#1f2d4a', '#2b2b2b', '#5d4037', '#3e4b3a', '#c8b58a', '#455a64', '#3b5a8a', '#6d6d6d'];
const HAIR = ['#141110', '#2b1d14', '#4a3222', '#7a5230', '#c9a15a', '#8a8a8a', '#a0522d'];
const SHOES = ['#161616', '#f0f0f0', '#5a3a22', '#2d2d4a', '#8a1c1c'];

const cap = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);
const sph = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);

// Build one rig segment from parts [geometry, matrix, colour]
function segment(parts) {
  const b = new GeoBuilder();
  for (const [g, m, c] of parts) { b.addGeometry(g, m, c); g.dispose(); }
  const mesh = new THREE.Mesh(b.build(), bodyMat);
  mesh.castShadow = true;
  return mesh;
}

export function buildHuman(o = {}) {
  const female = o.female ?? (o.hat === 'cop' || o.hat === 'cap' && o.armed ? Math.random() < 0.2 : Math.random() < 0.48);
  const skin = o.skin || pick(SKIN);
  const shirt = o.shirt || pick(SHIRTS);
  const pants = o.pants || pick(PANTS);
  const hair = o.hair || pick(HAIR);
  const shoes = o.shoes || pick(SHOES);
  const shortSleeves = o.sleeves === 'short' || (o.sleeves !== 'long' && !o.armed && Math.random() < 0.55);
  const skirt = female && !o.armed && !o.pants && Math.random() < 0.4;
  const shorts = !skirt && !o.armed && !o.pants && Math.random() < 0.2;
  const build = o.build ?? (female ? rand(0.86, 1.0) : rand(0.95, 1.2)); // shoulder width
  const height = o.height ?? (female ? rand(0.92, 1.0) : rand(0.97, 1.06));
  const lip = new THREE.Color(skin).multiplyScalar(0.72).lerp(new THREE.Color('#9a3b3b'), female ? 0.45 : 0.15);
  const shade = new THREE.Color(skin).multiplyScalar(0.85);

  const group = new THREE.Group();
  const rig = new THREE.Group();
  rig.scale.setScalar(height);
  group.add(rig);

  // ---- torso, neck and head: one merged mesh
  const sw = build * (female ? 0.9 : 1);
  const hipW = female ? 1.12 : 1;
  const body = [
    [cap(0.115, 0.12), mat(0, 0.99, 0, 0, 0, Math.PI / 2, 0.9, hipW, 0.78), pants],                           // pelvis
    [cap(0.145, 0.22), mat(0, 1.2, 0, 0, 0, 0, 0.92 * sw, 1, 0.66), shirt],                                  // waist
    [cap(0.17, 0.2), mat(0, 1.36, 0.005, 0, 0, 0, 1.02 * sw, 1, 0.7), shirt],                                 // chest
    [cap(0.07, 0.34 * sw), mat(0, 1.46, 0, 0, 0, Math.PI / 2, 1, 1, 0.9), shirt],                             // shoulders
    [new THREE.CylinderGeometry(0.048, 0.056, 0.12, 10), mat(0, 1.55, 0.005), skin],                         // neck
    [sph(0.108, 16, 12), mat(0, 1.68, 0.01, 0, 0, 0, 0.9, 1.15, 1.0), skin],                                  // skull
    [sph(0.075, 12, 8), mat(0, 1.615, 0.035, 0, 0, 0, 0.95, 0.75, 1.0), skin],                               // jaw
    [sph(0.022, 8, 6), mat(-0.098, 1.67, 0.005, 0, 0, 0, 0.5, 1, 0.8), shade],                                // ears
    [sph(0.022, 8, 6), mat(0.098, 1.67, 0.005, 0, 0, 0, 0.5, 1, 0.8), shade],
    [sph(0.017, 8, 6), mat(-0.036, 1.695, 0.093), '#f4f1ea'],                                                 // eye whites
    [sph(0.017, 8, 6), mat(0.036, 1.695, 0.093), '#f4f1ea'],
    [sph(0.009, 6, 4), mat(-0.036, 1.695, 0.108), '#1e1712'],                                                 // pupils
    [sph(0.009, 6, 4), mat(0.036, 1.695, 0.108), '#1e1712'],
    [new THREE.BoxGeometry(0.042, 0.008, 0.012), mat(-0.037, 1.722, 0.1, 0, 0, female ? 0.12 : 0.05), hair],   // brows
    [new THREE.BoxGeometry(0.042, 0.008, 0.012), mat(0.037, 1.722, 0.1, 0, 0, female ? -0.12 : -0.05), hair],
    [new THREE.ConeGeometry(0.018, 0.05, 6), mat(0, 1.668, 0.112, Math.PI / 2 + 0.3, 0, 0), shade],          // nose
    [new THREE.BoxGeometry(0.04, 0.009, 0.01), mat(0, 1.626, 0.1), '#' + lip.getHexString()],                 // mouth
  ];
  // hair styles
  const style = o.hat ? 'short' : female ? pick(['long', 'long', 'bun', 'bob', 'curly']) : pick(['short', 'short', 'buzz', 'fade', 'curly', 'bald']);
  if (style !== 'bald') {
    const top = new THREE.SphereGeometry(0.114, 16, 10, 0, Math.PI * 2, 0, style === 'buzz' || style === 'fade' ? Math.PI * 0.42 : Math.PI * 0.55);
    body.push([top, mat(0, 1.685, -0.004, -0.12, 0, 0, 0.94, 1.18, 1.05), hair]);
  }
  if (style === 'long') body.push([new THREE.BoxGeometry(0.2, 0.3, 0.06), mat(0, 1.56, -0.075), hair], [new THREE.BoxGeometry(0.035, 0.22, 0.1), mat(-0.095, 1.6, -0.02), hair], [new THREE.BoxGeometry(0.035, 0.22, 0.1), mat(0.095, 1.6, -0.02), hair]);
  if (style === 'bob') body.push([new THREE.CylinderGeometry(0.118, 0.125, 0.14, 14, 1, true), mat(0, 1.64, -0.01), hair]);
  if (style === 'bun') body.push([sph(0.05), mat(0, 1.8, -0.07), hair]);
  if (style === 'curly') for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; body.push([sph(0.045, 8, 6), mat(Math.cos(a) * 0.07, 1.78 + Math.sin(i) * 0.015, Math.sin(a) * 0.07 - 0.01), hair]); }
  if (female) body.push([sph(0.075, 10, 8), mat(-0.06, 1.35, 0.075, 0, 0, 0, 1, 0.9, 0.7), shirt], [sph(0.075, 10, 8), mat(0.06, 1.35, 0.075, 0, 0, 0, 1, 0.9, 0.7), shirt]);
  if (skirt) body.push([new THREE.CylinderGeometry(0.17 * hipW, 0.27, 0.42, 14, 1, true), mat(0, 0.8, 0), pants]);
  // headwear
  if (o.hat === 'cop') body.push([new THREE.CylinderGeometry(0.118, 0.118, 0.08, 16), mat(0, 1.78, 0), '#10204a'], [new THREE.BoxGeometry(0.2, 0.012, 0.09), mat(0, 1.745, 0.1), '#0a0a0a'], [new THREE.BoxGeometry(0.03, 0.03, 0.01), mat(0, 1.79, 0.12), '#d4a73a']);
  else if (o.hat === 'cowboy') body.push([new THREE.CylinderGeometry(0.21, 0.23, 0.015, 18), mat(0, 1.77, 0, 0, 0, 0, 1, 1, 1.1), '#e8dcc2'], [new THREE.CylinderGeometry(0.09, 0.11, 0.12, 14), mat(0, 1.83, 0), '#e8dcc2'], [new THREE.CylinderGeometry(0.112, 0.112, 0.02, 14), mat(0, 1.785, 0), '#5a3a22']);
  else if (o.hat === 'cap') { const c = o.capColor || pick(SHIRTS); body.push([new THREE.SphereGeometry(0.118, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 1.72, 0), c], [new THREE.CylinderGeometry(0.1, 0.1, 0.01, 14, 1, false, -Math.PI / 2, Math.PI), mat(0, 1.725, 0.07, 0, 0, 0, 1, 1, 0.9), c]); }
  if (o.beads) for (const c of ['#7a3fbf', '#2fa84f', '#e8c33a']) body.push([new THREE.TorusGeometry(0.13, 0.012, 4, 16), mat(0, 1.43 - Math.random() * 0.06, 0.03, Math.PI / 2 - 0.35, 0, 0), c]);
  if (o.vest) body.push([cap(0.18, 0.22), mat(0, 1.3, 0, 0, 0, 0, 1.05 * sw, 1, 0.75), o.vest]);
  const torso = segment(body);
  rig.add(torso);

  // ---- legs: hip -> thigh, knee -> shin + shoe
  const legColor = skirt ? skin : pants;
  const mkLeg = (x) => {
    const hip = new THREE.Group(); hip.position.set(x, 0.95, 0); rig.add(hip);
    hip.add(segment([[cap(female ? 0.078 : 0.084, 0.34), mat(0, -0.22, 0), skirt ? skin : pants]]));
    const knee = new THREE.Group(); knee.position.set(0, -0.44, 0); hip.add(knee);
    knee.add(segment([
      [cap(0.064, 0.3), mat(0, -0.19, 0), shorts || skirt ? skin : legColor],
      [cap(0.05, 0.16), mat(0, -0.45, 0.05, Math.PI / 2, 0, 0, 1.05, 1, 0.8), shoes],
      [new THREE.BoxGeometry(0.1, 0.02, 0.26), mat(0, -0.49, 0.05), '#2a2a2a'],
    ]));
    return [hip, knee];
  };
  const [legL, kneeL] = mkLeg(-0.095 * hipW);
  const [legR, kneeR] = mkLeg(0.095 * hipW);

  // ---- arms: shoulder -> upper arm, elbow -> forearm + hand
  const mkArm = (x) => {
    const sh = new THREE.Group(); sh.position.set(x * sw, 1.45, 0); rig.add(sh);
    sh.add(segment([[cap(0.052, 0.2), mat(0, -0.14, 0), shirt], ...(shortSleeves ? [[cap(0.045, 0.1), mat(0, -0.22, 0), skin]] : [])]));
    const el = new THREE.Group(); el.position.set(0, -0.29, 0); sh.add(el);
    el.add(segment([
      [cap(0.043, 0.19), mat(0, -0.12, 0), shortSleeves ? skin : shirt],
      [sph(0.045, 10, 8), mat(0, -0.28, 0.01, 0, 0, 0, 0.8, 1.15, 0.6), skin],
    ]));
    return [sh, el];
  };
  const [armL, elbowL] = mkArm(-0.205);
  const [armR, elbowR] = mkArm(0.205);
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.position.set(0, -0.3, 0.03);
  gun.castShadow = true;
  elbowR.add(gun);
  gun.visible = !!o.armed;
  const m = { group, rig, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, torso, head: torso, gun, female };
  animateHuman(m, 0, 0, false);
  return m;
}

export function disposeHuman(m) {
  m.group.traverse((o) => { if (o.isMesh && o.geometry !== gunGeo) o.geometry.dispose(); });
}

export function animateHuman(m, phase, amount, aiming) {
  const s = Math.sin(phase) * amount;
  const run = Math.min(1, amount / 0.9);
  m.legL.rotation.set(s * 0.9, 0, 0);
  m.legR.rotation.set(-s * 0.9, 0, 0);
  // knees bend as the leg swings back and lifts
  m.kneeL.rotation.x = (0.08 + Math.max(0, Math.sin(phase + 1.3)) * (0.5 + run * 0.9)) * (amount > 0.02 ? 1 : 0.3);
  m.kneeR.rotation.x = (0.08 + Math.max(0, Math.sin(phase + 1.3 + Math.PI)) * (0.5 + run * 0.9)) * (amount > 0.02 ? 1 : 0.3);
  m.armL.rotation.set(-s * 0.75, 0, -0.08);
  m.elbowL.rotation.set(-0.25 - run * 0.9, 0, 0);
  if (aiming) {
    m.armR.rotation.set(-Math.PI / 2 + 0.05, 0, 0.1);
    m.elbowR.rotation.set(0, 0, 0);
    m.armL.rotation.set(-Math.PI / 2 + 0.2, 0, 0.55);
    m.elbowL.rotation.set(-0.35, 0, 0);
  } else {
    m.armR.rotation.set(s * 0.75, 0, 0.08);
    m.elbowR.rotation.set(-0.25 - run * 0.9, 0, 0);
  }
  // counter-rotate the torso and bob
  m.torso.rotation.y = aiming ? 0 : s * 0.12;
  m.rig.position.y = Math.abs(Math.cos(phase)) * amount * 0.06;
}

// ------------------------------------------------------------------------ Ped
let PID = 1;
export class Ped {
  constructor(game, x, z, opts = {}) {
    this.id = PID++;
    this.game = game;
    this.kind = opts.kind || 'civ';
    const look = {};
    if (this.kind === 'cop') Object.assign(look, { shirt: '#2c4a8a', pants: '#10204a', hat: 'cop', armed: true, sleeves: 'short', shoes: '#111' });
    else if (this.kind === 'swat') Object.assign(look, { shirt: '#2a2d30', pants: '#23262a', hat: 'cap', capColor: '#111', armed: true, sleeves: 'long', vest: '#15171a', shoes: '#111', female: false });
    else if (this.kind === 'gang') Object.assign(look, { shirt: opts.gangColor || '#b22222', hat: 'cap', capColor: opts.gangColor || '#b22222', armed: true });
    else {
      if (opts.city === 'dallas' && chance(0.25)) look.hat = 'cowboy';
      if (opts.city === 'nola' && chance(0.35)) look.beads = true;
      if (chance(0.15)) look.hat = 'cap';
    }
    this.model = buildHuman(look);
    this.group = this.model.group;
    this.pos = this.group.position;
    this.pos.set(x, 0.25, z);
    this.h = rand(-Math.PI, Math.PI);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.state = 'walk';
    this.health = this.kind === 'swat' ? 180 : this.kind === 'cop' ? 110 : this.kind === 'gang' ? 90 : 50;
    this.walkSpeed = rand(1.1, 1.8);
    this.phase = rand(0, 6);
    this.block = opts.block || null;
    this.corner = Math.floor(rand(0, 4));
    this.dir = chance(0.5) ? 1 : -1;
    this.fear = 0;
    this.fearX = 0; this.fearZ = 0;
    this.shootCd = rand(0.5, 1.5);
    this.deadTimer = 0;
    this.hostile = this.kind === 'cop' || this.kind === 'swat' ? false : false;
    this.spin = 0;
    this.aiming = false;
    this.cash = this.kind === 'civ' ? Math.floor(rand(5, 120)) : Math.floor(rand(40, 300));
    this.city = opts.city;
    this.ringR = 38.3;
    if (this.block) this.target = this.cornerPos(this.corner);
    else this.target = { x, z };
    game.scene.add(this.group);
  }

  get alive() { return this.state !== 'dead' && !(this.state === 'ragdoll' && this.health <= 0); }

  cornerPos(k) {
    const b = this.block, r = this.ringR;
    const c = [[-r, -r], [r, -r], [r, r], [-r, r]][((k % 4) + 4) % 4];
    return { x: b.x + c[0] + rand(-0.6, 0.6), z: b.z + c[1] + rand(-0.6, 0.6) };
  }

  remove() { this.game.scene.remove(this.group); disposeHuman(this.model); this.removed = true; }

  scare(x, z, t = 8) {
    if (!this.alive || this.state === 'ragdoll') return;
    if (this.kind !== 'civ') {
      if (this.kind === 'gang') this.hostile = true;
      return;
    }
    this.fear = Math.max(this.fear, t);
    this.fearX = x; this.fearZ = z;
    this.state = 'flee';
    if (chance(0.02)) this.game.audio.scream(this.pos.x, this.pos.z);
  }

  hit(dmg, dx, dz, source, opts = {}) {
    if (this.state === 'dead') return;
    this.health -= dmg;
    this.game.fx.blood(this.pos.x, this.pos.y + 1.3, this.pos.z, dx, dz);
    if (source === 'player' || source === 'explosion-player') {
      this.game.onPlayerHurtPed(this, this.health <= 0);
      if (this.kind === 'gang') this.hostile = true;
    }
    if (this.health <= 0) {
      this.ragdoll(dx * (opts.force || 3), opts.up ?? 2.5, dz * (opts.force || 3));
    } else if (opts.force && opts.force > 6) {
      this.ragdoll(dx * opts.force, opts.up ?? 3, dz * opts.force);
    } else if (this.kind === 'civ') {
      this.scare(this.pos.x - dx, this.pos.z - dz, 12);
    }
  }

  ragdoll(vx, vy, vz) {
    this.state = 'ragdoll';
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.spin = rand(4, 10) * (chance(0.5) ? 1 : -1);
    this.pos.y += 0.2;
  }

  die() {
    this.state = 'dead';
    this.deadTimer = 0;
    this.model.rig.rotation.set(-Math.PI / 2, 0, rand(-0.3, 0.3));
    this.model.rig.position.set(0, 0.18, 0);
    this.model.legL.rotation.x = 0.2; this.model.legR.rotation.x = -0.1;
    this.model.armL.rotation.set(0, 0, -1.2); this.model.armR.rotation.set(0, 0, 1.2);
    this.model.kneeL.rotation.x = 0.3; this.model.kneeR.rotation.x = 0.05; this.model.elbowL.rotation.x = -0.4; this.model.elbowR.rotation.x = -0.2;
    this.model.gun.visible = false;
    this.game.onPedDied(this);
  }

  update(dt, world) {
    const g = this.game;
    const p = g.player;
    switch (this.state) {
      case 'dead':
        this.deadTimer += dt;
        return;
      case 'ragdoll': {
        this.vy -= 20 * dt;
        this.pos.x += this.vx * dt; this.pos.y += this.vy * dt; this.pos.z += this.vz * dt;
        this.model.rig.rotation.x += this.spin * dt;
        this.model.rig.rotation.z += this.spin * 0.3 * dt;
        const gh = world.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.3);
        const out = world.collideCircle(this.pos.x, this.pos.z, this.pos.y, 0.3, 0.3, this._o || (this._o = {}));
        if (out.hit) { this.pos.x = out.x; this.pos.z = out.z; this.vx *= -0.3; this.vz *= -0.3; }
        if (this.pos.y <= gh + 0.05 && this.vy < 0) {
          this.pos.y = gh + 0.05;
          const sp = Math.hypot(this.vx, this.vz);
          if (sp > 4) { this.vy = sp * 0.25; this.vx *= 0.5; this.vz *= 0.5; }
          else if (this.health <= 0) this.die();
          else {
            this.state = this.kind === 'civ' ? 'flee' : 'attack';
            this.fear = 8;
            this.model.rig.rotation.set(0, 0, 0);
          }
        }
        return;
      }
    }

    // --- alive behaviours
    let tx = this.target.x, tz = this.target.z, speed = this.walkSpeed;
    const playerPos = p.worldPos;
    const dP = dist2(this.pos.x, this.pos.z, playerPos.x, playerPos.z);

    if ((this.kind === 'cop' || this.kind === 'swat') && g.wanted.level > 0) this.state = 'attack';
    if (this.kind === 'gang' && this.hostile && !p.dead) this.state = 'attack';
    if ((this.kind === 'cop' || this.kind === 'swat') && g.wanted.level === 0 && this.state === 'attack') {
      this.state = this.block ? 'walk' : 'idle';
    }

    this.aiming = false;
    if (this.state === 'flee') {
      this.fear -= dt;
      const ax = this.pos.x - this.fearX, az = this.pos.z - this.fearZ;
      const l = Math.hypot(ax, az) || 1;
      tx = this.pos.x + ax / l * 10; tz = this.pos.z + az / l * 10;
      speed = 5.2;
      if (this.fear <= 0) {
        this.state = 'walk';
        if (this.block) this.target = this.cornerPos(this.corner);
      }
    } else if (this.state === 'attack') {
      tx = playerPos.x; tz = playerPos.z;
      speed = 4.2;
      const range = this.kind === 'swat' ? 18 : 14;
      const seeLimit = 55;
      const canSee = dP < seeLimit && !p.dead;
      if (dP < range && canSee) speed = 0;
      if (canSee) {
        this.aiming = true;
        this.shootCd -= dt;
        if (this.shootCd <= 0) {
          this.shootCd = this.kind === 'swat' ? rand(0.25, 0.5) : rand(0.7, 1.4);
          g.pedShoot(this, playerPos);
        }
      }
      // cops arrest on low wanted levels
      if ((this.kind === 'cop') && dP < 2.2 && g.wanted.level <= 2 && !p.vehicle) g.tryBust(this, dt);
      if (dP > 150) { this.state = 'idle'; }
    } else if (this.state === 'idle') {
      speed = 0;
    } else {
      // walk around the block
      if (dist2(this.pos.x, this.pos.z, tx, tz) < 1.0 && this.block) {
        this.corner += this.dir;
        if (chance(0.2)) this.crossStreet();
        else this.target = this.cornerPos(this.corner);
        tx = this.target.x; tz = this.target.z;
      }
    }

    // steer
    let moving = speed > 0 && dist2(this.pos.x, this.pos.z, tx, tz) > 0.4;
    if (moving) {
      const want = headingTo(this.pos.x, this.pos.z, tx, tz);
      this.h = smoothAngle(this.h, want, 8, dt);
      this.vx = Math.sin(this.h) * speed; this.vz = Math.cos(this.h) * speed;
    } else {
      this.vx = 0; this.vz = 0;
      if (this.aiming) this.h = smoothAngle(this.h, headingTo(this.pos.x, this.pos.z, playerPos.x, playerPos.z), 10, dt);
    }
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt;
    const out = world.collideCircle(this.pos.x, this.pos.z, this.pos.y, 0.3, 0.45, this._o || (this._o = {}));
    if (out.hit) {
      this.pos.x = out.x; this.pos.z = out.z;
      this.stuck = (this.stuck || 0) + dt;
      if (this.stuck > 1.5 && this.state === 'walk' && this.block) { this.dir *= -1; this.corner += this.dir; this.target = this.cornerPos(this.corner); this.stuck = 0; }
    } else this.stuck = 0;
    const gh = world.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.45);
    this.pos.y += (Math.max(gh, 0.02) + (world.isWater(this.pos.x, this.pos.z) ? 0 : 0) - this.pos.y) * Math.min(1, dt * 12);
    const sp = Math.hypot(this.vx, this.vz);
    this.phase += dt * sp * 3.2;
    animateHuman(this.model, this.phase, Math.min(0.9, sp * 0.22), this.aiming, dt);
    this.model.gun.visible = this.aiming || this.kind === 'cop' || this.kind === 'swat';
    this.group.rotation.y = this.h;
  }

  crossStreet() {
    const b = this.block;
    const blocks = this.game.world.sidewalkBlocks;
    const k = ((this.corner % 4) + 4) % 4;
    const dirs = [[[-1, 0], [0, -1]], [[1, 0], [0, -1]], [[1, 0], [0, 1]], [[-1, 0], [0, 1]]][k];
    const d = pick(dirs);
    const nx = b.x + d[0] * 100, nz = b.z + d[1] * 100;
    const nb = blocks.find((o) => Math.abs(o.x - nx) < 1 && Math.abs(o.z - nz) < 1);
    if (!nb) { this.target = this.cornerPos(this.corner); return; }
    // map the corner to the matching corner on the neighbouring block
    const cornerX = b.x + [-1, 1, 1, -1][k] * this.ringR, cornerZ = b.z + [-1, -1, 1, 1][k] * this.ringR;
    const tx = cornerX + d[0] * (100 - 2 * this.ringR), tz = cornerZ + d[1] * (100 - 2 * this.ringR);
    this.block = nb;
    let best = 0, bd = Infinity;
    for (let c = 0; c < 4; c++) {
      const cp = this.cornerPos(c);
      const dd = dist2(cp.x, cp.z, tx, tz);
      if (dd < bd) { bd = dd; best = c; }
    }
    this.corner = best;
    this.target = { x: tx, z: tz };
  }
}
