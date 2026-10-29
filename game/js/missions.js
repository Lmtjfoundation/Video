// Story-ish missions scattered across the three cities.
import * as THREE from 'three';
import { DriveAI } from './ai.js';
import { Ped } from './people.js';
import { dist2, rand, pick, formatMoney } from './util.js';
import { textTexture } from './textures.js';

const DALLAS = { cx: -2200, cz: -600 }, NOLA = { cx: 0, cz: 1300 }, ATL = { cx: 2200, cz: -600 };
const node = (c, i, j) => ({ x: c.cx + (i - 4) * 100, z: c.cz + (j - 4) * 100 });
const block = (c, i, j) => ({ x: c.cx + (i - 3.5) * 100, z: c.cz + (j - 3.5) * 100 });

export const MISSIONS = [
  {
    id: 'race', letter: 'R', color: '#ffcf33', city: 'DALLAS', title: 'Big D Street Race',
    desc: 'Four cars. One lap of Downtown Dallas. No rules.', reward: 15000,
    marker: () => { const b = block(DALLAS, 2, 6); return { x: b.x, z: b.z + 39 }; },
  },
  {
    id: 'express', letter: 'E', color: '#8fd16a', city: 'NEW ORLEANS', title: 'Bayou Express',
    desc: 'A van full of gumbo needs to be in Atlanta. Yesterday.', reward: 12000,
    marker: () => { const b = block(NOLA, 1, 6); return { x: b.x, z: b.z - 39 }; },
  },
  {
    id: 'rampage', letter: 'K', color: '#ff4d4d', city: 'ATLANTA', title: 'Peach State Rampage',
    desc: 'Take the minigun. The Old Fourth Ward crew started it.', reward: 20000,
    marker: () => { const b = block(ATL, 3, 6); return { x: b.x, z: b.z + 39 }; },
  },
  {
    id: 'monster', letter: 'M', color: '#b48cff', city: 'NEW ORLEANS', title: 'Mardi Gras Monster Mash',
    desc: 'Crush cars with a monster truck. Laissez les bons temps rouler!', reward: 15000,
    marker: () => { const b = block(NOLA, 6, 1); return { x: b.x, z: b.z - 39 }; },
  },
  {
    id: 'heist', letter: 'H', color: '#3dff6a', city: 'DALLAS', title: 'The Big D Heist',
    desc: 'Rob the Federal Reserve of Dallas and get the cash to the New Orleans safehouse.', reward: 250000,
    marker: (w) => ({ x: w.spawns.bank.x, z: w.spawns.bank.z - 4 }),
  },
  {
    id: 'skyfall', letter: 'S', color: '#4de1ff', city: 'ATLANTA', title: 'Skyfall Over The A',
    desc: 'Fly the Hornet to 500m, bail out, and parachute onto the Capitol lawn.', reward: 20000,
    marker: (w) => { const s = w.spawns.safehouses.find((o) => o.city === 'atlanta'); return { x: s.x + 8, z: s.z + 4 }; },
  },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.state = 'idle';
    this.completed = new Set(game.save.completed || []);
    this.markers = [];
    this.objects = [];
    this.gps = null;
    this.timer = null;
    this.cooldown = 0;
    const scene = game.scene;
    for (const m of MISSIONS) {
      const p = m.marker(game.world);
      const grp = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 24, 1, true), new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      cyl.position.y = 1.5;
      const tex = textTexture([{ text: m.letter, size: 180, color: m.color, stroke: '#000' }], { w: 256, h: 256, bg: 'rgba(0,0,0,0)' });
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      spr.scale.set(2.5, 2.5, 1);
      spr.position.y = 4.5;
      grp.add(cyl, spr);
      grp.position.set(p.x, 0.3, p.z);
      scene.add(grp);
      this.markers.push({ m, p, grp, spr });
    }
    // checkpoint visual
    this.cp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.5, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffcf33, transparent: true, opacity: 0.8 }));
    ring.position.y = 6;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 60, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcf33, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 30;
    this.cp.add(ring, beam);
    this.cp.visible = false;
    this.cpRing = ring; this.cpBeam = beam;
    scene.add(this.cp);
  }

  get busy() { return this.state !== 'idle'; }

  setCheckpoint(x, z, color = 0xffcf33, facing = 0, radius = 6) {
    this.cp.visible = true;
    this.cp.position.set(x, 0, z);
    this.cp.rotation.y = facing;
    this.cpRing.material.color.set(color);
    this.cpBeam.material.color.set(color);
    this.cp.scale.set(radius / 6, 1, radius / 6);
    this.gps = { x, z };
  }
  clearCheckpoint() { this.cp.visible = false; this.gps = null; }

  update(dt) {
    const g = this.game;
    const t = performance.now() / 1000;
    for (const mk of this.markers) {
      mk.grp.visible = this.state === 'idle';
      mk.spr.position.y = 4.5 + Math.sin(t * 2) * 0.4;
      mk.spr.material.opacity = this.completed.has(mk.m.id) ? 0.55 : 1;
    }
    this.cpRing.rotation.y = t;
    this.cooldown -= dt;
    if (this.state === 'idle') {
      if (g.player.dead || this.cooldown > 0) return;
      const pp = g.player.worldPos;
      for (const mk of this.markers) {
        if (dist2(pp.x, pp.z, mk.p.x, mk.p.z) < 3.2 && Math.abs(pp.y - 0.3) < 4) {
          if (g.player.vehicle && mk.m.id !== 'skyfall') { g.hud.hint(`Get out of the vehicle to start: ${mk.m.title}`); continue; }
          this.start(mk.m);
          break;
        }
      }
      return;
    }
    if (this.state === 'intro') {
      this.introT -= dt;
      if (this.introT <= 0) { this.state = 'active'; this.active.begin?.(); }
      return;
    }
    if (this.state === 'active') {
      if (this.timer !== null) {
        this.timer -= dt;
        if (this.timer <= 0) { this.fail('Out of time'); return; }
      }
      const r = this.active.update(dt);
      if (r === 'pass') this.pass();
      else if (typeof r === 'string' && r.startsWith('fail')) this.fail(r.slice(5) || 'Mission failed');
    }
  }

  start(def) {
    const g = this.game;
    this.state = 'intro';
    this.introT = 3;
    this.timer = null;
    this.def = def;
    this.active = this.create(def);
    this.active.setup?.();
    g.hud.missionIntro(def);
    g.audio.checkpoint();
  }

  onEvent(type, data) {
    if (this.state !== 'active' && this.state !== 'intro') return;
    if (type === 'playerDied') { this.fail('You died'); return; }
    if (type === 'busted') { this.fail('You got busted'); return; }
    this.active?.onEvent?.(type, data);
  }

  pass() {
    const g = this.game, def = this.def;
    g.player.money += def.reward;
    this.completed.add(def.id);
    g.save.completed = [...this.completed];
    g.persist();
    g.hud.missionResult(true, def.title, `+${formatMoney(def.reward)}`);
    g.audio.passed();
    g.fx.confetti(g.player.worldPos.x, g.player.worldPos.y + 3, g.player.worldPos.z, 120);
    this.cleanup();
  }

  fail(reason) {
    const g = this.game;
    g.hud.missionResult(false, this.def.title, reason);
    this.cleanup();
  }

  cleanup() {
    const g = this.game;
    this.active?.cleanup?.();
    for (const o of this.objects) {
      if (o.remove && !o.removed) {
        if (o === g.player.vehicle) { o.missionVehicle = false; continue; }
        o.remove();
      } else if (o.isObject3D) g.scene.remove(o);
    }
    this.objects = [];
    this.clearCheckpoint();
    this.state = 'idle';
    this.active = null;
    this.timer = null;
    this.cooldown = 6;
    g.wanted.locked = false;
    g.hud.objective('');
    g.hud.setRace(null);
  }

  // helper: put the player into a freshly spawned vehicle
  giveVehicle(type, x, z, h, opts) {
    const g = this.game;
    if (g.player.vehicle) g.exitVehicle(true);
    const v = g.spawnVehicle(type, x, z, h, opts);
    v.missionVehicle = true;
    this.objects.push(v);
    g.enterVehicle(v, true);
    return v;
  }

  racerCheckpoint(ai) { this.active?.onEvent?.('racerCp', ai); }

  // --------------------------------------------------------------- missions
  create(def) {
    const g = this.game, M = this;
    switch (def.id) {
      case 'race': {
        const route = [[4, 7], [4, 3], [7, 3], [7, 1], [2, 1], [2, 5], [0, 5], [0, 7], [3, 7]].map(([i, j]) => node(DALLAS, i, j));
        let idx = 0;
        const racers = [];
        return {
          setup() {
            const z0 = DALLAS.cz + 300;
            M.giveVehicle('sports', -2440, z0 + 3, Math.PI / 2, { color: '#ff2a2a' });
            const types = ['sports', 'muscle', 'sports'];
            [[-2440, z0 - 3], [-2455, z0 + 3], [-2455, z0 - 3]].forEach(([x, z], k) => {
              const v = g.spawnVehicle(types[k], x, z, Math.PI / 2, { color: ['#00c2ff', '#e8a000', '#b400ff'][k] });
              v.missionVehicle = true;
              v.T = { ...v.T, hp: v.T.hp * 3 }; v.health = v.T.hp;
              const ai = new DriveAI(g, v, 'parked');
              ai.checkpoints = route; ai.skill = [0.92, 0.88, 0.95][k];
              racers.push(v); M.objects.push(v);
            });
            g.wanted.set(0);
            g.wanted.locked = true;
          },
          begin() {
            for (const v of racers) v.ai.mode = 'race';
            g.hud.bigMessage('GO!', '#7fff7f', 1.2);
            M.setCheckpoint(route[0].x, route[0].z);
          },
          place() {
            // player's race position
            const pv = g.player.worldPos;
            const prog = (cp, x, z) => cp * 10000 - (route[cp] ? dist2(x, z, route[cp].x, route[cp].z) : 0);
            const me = prog(idx, pv.x, pv.z);
            let pos = 1;
            for (const v of racers) if (prog(v.ai.cpIdx, v.pos.x, v.pos.z) > me) pos++;
            return pos;
          },
          update() {
            if (!g.player.vehicle) g.hud.objective('Get back in a car!');
            else g.hud.objective(`Race through the checkpoints — ${idx}/${route.length}`);
            const pv = g.player.worldPos;
            const cp = route[idx];
            if (dist2(pv.x, pv.z, cp.x, cp.z) < 12) {
              idx++;
              g.audio.checkpoint();
              if (idx >= route.length) {
                const place = this.place();
                return place === 1 ? 'pass' : `fail:You finished ${['', '1st', '2nd', '3rd', '4th'][place]}`;
              }
              const n = route[idx];
              M.setCheckpoint(n.x, n.z, idx === route.length - 1 ? 0xffffff : 0xffcf33);
            }
            // rubber band
            for (const v of racers) {
              const ahead = v.ai.cpIdx > idx;
              v.ai.rubber = ahead ? 0.85 : v.ai.cpIdx < idx ? 1.12 : 1;
              if (v.ai.cpIdx >= route.length && this.place() > 1 && racers.every((r) => r.ai.cpIdx >= route.length)) return 'fail:Everyone beat you';
            }
            g.hud.setRace(`${this.place()}/4`);
            return null;
          },
        };
      }

      case 'express': {
        const dest = g.world.spawns.safehouses.find((s) => s.city === 'atlanta');
        let van;
        return {
          setup() {
            van = M.giveVehicle('van', -250, 1500 + 4.5, Math.PI / 2, { color: '#e0c080' });
            van.T = { ...van.T, maxSpeed: 44 };
          },
          begin() {
            M.timer = 170;
            M.setCheckpoint(dest.x, dest.z, 0x8fd16a);
          },
          update() {
            if (van.dead || van.removed) return 'fail:The gumbo is ruined';
            const hp = Math.round(100 * van.health / van.T.hp);
            if (hp < 25) return 'fail:You spilled the gumbo';
            if (g.player.vehicle !== van) g.hud.objective('Get back in the gumbo van!');
            else g.hud.objective(`Deliver the gumbo to the Atlanta safehouse. Gumbo integrity: ${hp}%`);
            if (g.player.vehicle === van && dist2(van.pos.x, van.pos.z, dest.x, dest.z) < 10) return 'pass';
            return null;
          },
        };
      }

      case 'rampage': {
        let kills = 0, spawnT = 0;
        const need = 35;
        const center = node(ATL, 3, 6);
        return {
          setup() {
            g.player.giveWeapon('minigun', 3000);
            g.hud.weaponChanged();
            g.wanted.set(0);
            g.wanted.locked = true;
          },
          begin() { M.timer = 80; },
          onEvent(type) { if (type === 'pedKilled') kills++; },
          update(dt) {
            spawnT -= dt;
            const pp = g.player.worldPos;
            const hostiles = g.peds.filter((p) => p.alive && p.missionHostile).length;
            if (spawnT <= 0 && hostiles < 14) {
              spawnT = 0.5;
              const a = rand(0, Math.PI * 2), r = rand(25, 55);
              let x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
              const o = g.world.collideCircle(x, z, 0, 0.5, 0.4, {});
              const p = new Ped(g, o.x, o.z, { kind: 'gang', gangColor: '#c0392b', city: 'atlanta' });
              p.hostile = true; p.missionHostile = true; p.state = 'attack';
              g.peds.push(p);
            }
            g.hud.objective(`RAMPAGE! Kill ${need} — ${kills}/${need}`);
            return kills >= need ? 'pass' : null;
          },
          cleanup() {
            for (const p of g.peds) if (p.missionHostile && p.alive) { p.hostile = false; p.state = 'flee'; p.fear = 20; }
            g.player.weapons.minigun = Math.min(g.player.weapons.minigun || 0, 300);
          },
        };
      }

      case 'monster': {
        let crushed = 0;
        const need = 10;
        return {
          setup() {
            M.giveVehicle('monster', 250, 1000 + 4.5, Math.PI / 2);
            // line up some victims along Rampart-ish street
            for (let k = 0; k < 10; k++) {
              const x = 330 + k * 14, z = 1000 + (k % 2 ? -4.5 : 4.5);
              const v = g.spawnVehicle(pick(['sedan', 'taxi', 'muscle', 'van']), x, z, k % 2 ? -Math.PI / 2 : Math.PI / 2);
              M.objects.push(v);
            }
          },
          begin() { M.timer = 110; },
          onEvent(type) { if (type === 'crush') { crushed++; g.fx.confetti(g.player.worldPos.x, 4, g.player.worldPos.z, 40); } },
          update() {
            if (!g.player.vehicle || g.player.vehicle.type !== 'monster') g.hud.objective('Get back in the Mardi Monster!');
            else g.hud.objective(`Crush cars! ${crushed}/${need}`);
            return crushed >= need ? 'pass' : null;
          },
        };
      }

      case 'heist': {
        const bank = g.world.spawns.bank;
        const dest = g.world.spawns.safehouses.find((s) => s.city === 'nola');
        let phase = 'vault', crack = 0;
        return {
          setup() { g.wanted.set(0); },
          begin() { M.setCheckpoint(bank.x, bank.z - 4, 0x3dff6a, 0, 3); },
          update(dt) {
            const pp = g.player.worldPos;
            if (phase === 'vault') {
              if (dist2(pp.x, pp.z, bank.x, bank.z - 4) < 3.5) {
                crack += dt;
                g.hud.objective(`Cracking the vault... ${Math.min(100, Math.floor(crack / 6 * 100))}%`);
                if (Math.random() < dt * 3) g.fx.sparks(bank.x + rand(-2, 2), 1.5, bank.z - 8, 6);
                if (crack >= 6) {
                  phase = 'escape';
                  g.player.money += 0;
                  g.fx.cashBurst(pp.x, pp.y + 1.5, pp.z);
                  g.audio.cash();
                  g.wanted.report('heist', pp.x, pp.z);
                  const car = g.spawnVehicle('muscle', bank.x + 12, bank.z + 10, Math.PI / 2, { color: '#111111' });
                  car.missionVehicle = true;
                  M.objects.push(car);
                  M.setCheckpoint(dest.x, dest.z, 0x3dff6a);
                  g.hud.bigMessage('YOU GOT THE CASH', '#3dff6a', 2, 'small');
                  // guards
                  for (let k = 0; k < 4; k++) {
                    const c = new Ped(g, bank.x + rand(-12, 12), bank.z + rand(4, 10), { kind: k < 2 ? 'swat' : 'cop' });
                    c.state = 'attack';
                    g.peds.push(c);
                  }
                }
              } else g.hud.objective('Stand at the Federal Reserve entrance to crack the vault');
              return null;
            }
            g.hud.objective('Get the cash to the New Orleans safehouse!');
            if (dist2(pp.x, pp.z, dest.x, dest.z) < 10) {
              g.wanted.set(0);
              return 'pass';
            }
            return null;
          },
        };
      }

      case 'skyfall': {
        const target = { x: ATL.cx + 50, z: ATL.cz + 185 };
        let phase = 'climb', max = 0;
        return {
          setup() {
            const s = g.world.spawns.safehouses.find((o) => o.city === 'atlanta');
            M.giveVehicle('heli', s.x + 12, ATL.cz + 300, Math.PI / 2, { rotorOn: true });
          },
          update() {
            const p = g.player, pp = p.worldPos;
            max = Math.max(max, pp.y);
            if (phase === 'climb') {
              if (!p.vehicle || !p.vehicle.isHeli) { if (pp.y < 50) return 'fail:You need the helicopter'; }
              g.hud.objective(`Climb to 500m — altitude ${Math.round(pp.y)}m`);
              if (pp.y > 500) { phase = 'jump'; g.audio.checkpoint(); }
              return null;
            }
            if (phase === 'jump') {
              g.hud.objective('BAIL OUT! Press F, then SPACE to open your parachute');
              if (!p.vehicle) { phase = 'fall'; M.setCheckpoint(target.x, target.z, 0x4de1ff, 0, 16); }
              return null;
            }
            g.hud.objective(`Land on the Capitol lawn — ${Math.round(dist2(pp.x, pp.z, target.x, target.z))}m away`);
            if (p.grounded || p.swimming || p.vehicle) {
              return dist2(pp.x, pp.z, target.x, target.z) < 25 ? 'pass' : 'fail:You missed the landing zone';
            }
            return null;
          },
        };
      }
    }
    return { update: () => 'pass' };
  }
}
