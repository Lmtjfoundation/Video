// Humans: box-rig character models, pedestrians, cops and gang members.
import * as THREE from 'three';
import { clamp, rand, pick, chance, wrapAngle, smoothAngle, headingTo, dist2 } from './util.js';

const matCache = new Map();
function M(hex) {
  let m = matCache.get(hex);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85 }); matCache.set(hex, m); }
  return m;
}
const G = {
  leg: new THREE.BoxGeometry(0.22, 0.9, 0.24).translate(0, -0.45, 0),
  foot: new THREE.BoxGeometry(0.22, 0.1, 0.32).translate(0, -0.9, 0.05),
  torso: new THREE.BoxGeometry(0.56, 0.66, 0.3),
  head: new THREE.BoxGeometry(0.28, 0.32, 0.28),
  hair: new THREE.BoxGeometry(0.3, 0.1, 0.3),
  cap: new THREE.BoxGeometry(0.32, 0.1, 0.42).translate(0, 0, 0.05),
  cowboy: new THREE.CylinderGeometry(0.34, 0.34, 0.04, 12),
  cowboyTop: new THREE.BoxGeometry(0.24, 0.16, 0.26),
  arm: new THREE.BoxGeometry(0.14, 0.62, 0.16).translate(0, -0.31, 0),
  hand: new THREE.BoxGeometry(0.12, 0.12, 0.12).translate(0, -0.66, 0),
  gun: new THREE.BoxGeometry(0.08, 0.16, 0.36).translate(0, -0.7, 0.14),
  beads: new THREE.TorusGeometry(0.2, 0.03, 4, 12),
};
const SKIN = ['#f1c7a4', '#e0ac85', '#c68860', '#8d5a3b', '#5c3a24', '#3d2616'];
const SHIRTS = ['#e8e8e8', '#b22222', '#1f3f8a', '#2e7d32', '#f9a825', '#6a1b9a', '#212121', '#ff7043', '#00838f', '#c2185b', '#8d6e63'];
const PANTS = ['#1f2d4a', '#2b2b2b', '#5d4037', '#3e4b3a', '#c8b58a', '#455a64', '#1a237e'];
const HAIR = ['#1a1a1a', '#3b2616', '#6b4a2a', '#c9a15a', '#888888'];

export function buildHuman(o = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const skin = M(o.skin || pick(SKIN));
  const shirt = M(o.shirt || pick(SHIRTS));
  const pants = M(o.pants || pick(PANTS));
  const shoes = M(o.shoes || '#1a1a1a');
  const mk = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const legL = new THREE.Group(); legL.position.set(-0.13, 0.96, 0); rig.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.13, 0.96, 0); rig.add(legR);
  mk(G.leg, pants, 0, 0, 0, legL); mk(G.foot, shoes, 0, 0, 0, legL);
  mk(G.leg, pants, 0, 0, 0, legR); mk(G.foot, shoes, 0, 0, 0, legR);
  const torso = mk(G.torso, shirt, 0, 1.3, 0, rig);
  const head = mk(G.head, skin, 0, 1.81, 0, rig);
  if (o.hat === 'cop') mk(G.cap, M('#10204a'), 0, 0.2, 0, head);
  else if (o.hat === 'cowboy') { mk(G.cowboy, M('#f0e6d0'), 0, 0.17, 0, head); mk(G.cowboyTop, M('#f0e6d0'), 0, 0.27, 0, head); }
  else if (o.hat === 'cap') mk(G.cap, M(o.capColor || pick(SHIRTS)), 0, 0.2, 0, head);
  else mk(G.hair, M(o.hair || pick(HAIR)), 0, 0.2, 0, head);
  if (o.beads) {
    const b = new THREE.Mesh(G.beads, M(pick(['#7a3fbf', '#2fa84f', '#e8c33a'])));
    b.rotation.x = Math.PI / 2; b.position.set(0, 1.58, 0.02); rig.add(b);
  }
  const armL = new THREE.Group(); armL.position.set(-0.36, 1.6, 0); rig.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.36, 1.6, 0); rig.add(armR);
  mk(G.arm, shirt, 0, 0, 0, armL); mk(G.hand, skin, 0, 0, 0, armL);
  mk(G.arm, shirt, 0, 0, 0, armR); mk(G.hand, skin, 0, 0, 0, armR);
  const gun = mk(G.gun, M('#222'), 0, 0, 0, armR);
  gun.visible = !!o.armed;
  return { group, rig, legL, legR, armL, armR, torso, head, gun };
}

export function animateHuman(m, phase, amount, aiming, dt) {
  const s = Math.sin(phase) * amount;
  m.legL.rotation.x = s;
  m.legR.rotation.x = -s;
  m.armL.rotation.x = -s * 0.8;
  if (aiming) {
    m.armR.rotation.x = -Math.PI / 2;
    m.armL.rotation.x = -Math.PI / 2.4;
    m.armL.rotation.z = -0.5;
  } else {
    m.armR.rotation.x = s * 0.8;
    m.armL.rotation.z = 0;
  }
  m.rig.position.y = Math.abs(Math.cos(phase)) * amount * 0.08;
}

// ------------------------------------------------------------------------ Ped
let PID = 1;
export class Ped {
  constructor(game, x, z, opts = {}) {
    this.id = PID++;
    this.game = game;
    this.kind = opts.kind || 'civ';
    const look = {};
    if (this.kind === 'cop') Object.assign(look, { shirt: '#1d3a7a', pants: '#10204a', hat: 'cop', armed: true });
    else if (this.kind === 'swat') Object.assign(look, { shirt: '#222', pants: '#222', skin: '#2a2a2a', hat: 'cap', capColor: '#111', armed: true });
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

  remove() { this.game.scene.remove(this.group); this.removed = true; }

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
