// Keeps the world alive around the player: traffic, parked cars, pedestrians,
// special vehicles; despawns what's far away; handles people getting run over.
import { DriveAI } from './ai.js';
import { Ped } from './people.js';
import { dist2, rand, pick, chance } from './util.js';

const CITY_MIX = {
  dallas: ['pickup', 'pickup', 'pickup', 'sedan', 'sedan', 'sports', 'muscle', 'muscle', 'van', 'bike', 'taxi', 'bus'],
  nola: ['sedan', 'sedan', 'taxi', 'taxi', 'van', 'van', 'muscle', 'pickup', 'bike', 'bus'],
  atlanta: ['sedan', 'sedan', 'sports', 'sports', 'muscle', 'taxi', 'van', 'bike', 'bike', 'pickup', 'bus'],
  hwy: ['sedan', 'pickup', 'pickup', 'van', 'muscle', 'sports', 'bus', 'sedan', 'bike'],
};
const GANGS = {
  'Deep Ellum': '#ff8c1a', 'Tremé': '#8e44ad', 'Old Fourth Ward': '#c0392b', 'Oak Cliff': '#ff8c1a', 'West End': '#c0392b', 'Mid-City': '#8e44ad',
};

export class Population {
  constructor(game) {
    this.game = game;
    this.spawnTimer = 0;
    this.pedTimer = 0;
    this.parkTimer = 0;
  }

  update(dt) {
    const g = this.game, w = g.world;
    const pp = g.player.worldPos;
    const city = w.inCity(pp.x, pp.z, 150);
    this.spawnTimer -= dt;
    this.pedTimer -= dt;
    this.parkTimer -= dt;

    // ---- traffic
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      const traffic = g.vehicles.filter((v) => v.ai && v.ai.mode === 'traffic' && !v.dead && !v.removed);
      const want = (city ? 26 : 12) * g.settings.density;
      if (traffic.length < want) this.spawnTraffic(city);
      // despawn
      for (const v of g.vehicles) {
        if (v.removed || v.persistent || v.driver === 'player' || v.missionVehicle) continue;
        const d = dist2(v.pos.x, v.pos.z, pp.x, pp.z);
        if (v.isPolice && g.wanted.level > 0 && !v.dead) continue;
        const lim = v.parkSpot ? 300 : 440;
        if (d > lim || (v.dead && v.wreckTimer > 45 && d > 60) || (v.dead && v.wreckTimer > 150)) {
          if (v.parkSpot) v.parkSpot.vehicle = null;
          v.remove();
        } else if (v.ai && v.ai.stuckCount > 6 && d > 60) {
          v.remove();
        }
      }
      g.vehicles = g.vehicles.filter((v) => !v.removed);
    }

    // ---- parked cars + special vehicles
    if (this.parkTimer <= 0) {
      this.parkTimer = 0.5;
      for (const s of w.parkingSpots) {
        const d = dist2(s.x, s.z, pp.x, pp.z);
        if (d < 200 && !s.vehicle && !s.cooldown) {
          const type = s.police ? 'police' : pick(CITY_MIX[s.city]).replace('bus', 'sedan');
          const v = g.spawnVehicle(type, s.x, s.z, s.h);
          v.parkSpot = s;
          s.vehicle = v;
        }
        if (s.vehicle && (s.vehicle.removed || dist2(s.vehicle.pos.x, s.vehicle.pos.z, s.x, s.z) > 8)) {
          // car was taken or destroyed: detach so the spot can refill later
          if (!s.vehicle.removed) s.vehicle.parkSpot = null;
          s.vehicle = null;
          s.cooldown = true;
        }
        if (s.cooldown && d > 260) s.cooldown = false;
      }
      for (const sp of w.spawns.special) {
        const d = dist2(sp.x, sp.z, pp.x, pp.z);
        if (d < 260 && (!sp.vehicle || sp.vehicle.removed || (sp.vehicle.dead && d > 150))) {
          if (sp.vehicle && !sp.vehicle.removed) continue;
          const v = g.spawnVehicle(sp.type, sp.x, sp.z, sp.h, { y: sp.y || 0 });
          v.specialSpawn = sp;
          sp.vehicle = v;
        }
        if (sp.vehicle && !sp.vehicle.removed && d > 320 && sp.vehicle.driver !== 'player' && dist2(sp.vehicle.pos.x, sp.vehicle.pos.z, pp.x, pp.z) > 320) {
          sp.vehicle.remove();
          sp.vehicle = null;
        }
      }
    }

    // ---- pedestrians
    if (this.pedTimer <= 0) {
      this.pedTimer = 0.2;
      const civs = g.peds.filter((p) => !p.removed && p.block);
      const want = city ? Math.round(42 * g.settings.density) : 0;
      if (civs.length < want) this.spawnPed(city);
      for (const p of g.peds) {
        const d = dist2(p.pos.x, p.pos.z, pp.x, pp.z);
        if (d > 230 || (p.state === 'dead' && (p.deadTimer > 40 || d > 120))) p.remove();
        else if (!p.block && p.state === 'idle' && d > 90 && g.wanted.level === 0) p.remove();
      }
      g.peds = g.peds.filter((p) => !p.removed);
    }

    this.runOver();
  }

  spawnTraffic(city) {
    const g = this.game, w = g.world, pp = g.player.worldPos;
    for (let tries = 0; tries < 20; tries++) {
      const e = w.edges[Math.floor(Math.random() * w.edges.length)];
      const A = w.nodes[e.a], B = w.nodes[e.b];
      const t = rand(0.1, 0.9);
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
      const d = dist2(x, z, pp.x, pp.z);
      if (d < 110 || d > 330) continue;
      if (g.vehicles.some((v) => !v.removed && Math.abs(v.pos.x - x) < 16 && Math.abs(v.pos.z - z) < 16)) continue;
      const c = w.inCity(x, z);
      let type = pick(CITY_MIX[c ? c.key : 'hwy']);
      if (chance(0.05)) type = 'police';
      const v = g.spawnVehicle(type, x, z, 0);
      const ai = new DriveAI(g, v, 'traffic');
      const from = chance(0.5) ? e.a : e.b;
      ai.placeOnEdge(e, from, from === e.a ? t : 1 - t);
      if (type === 'police') v.isPolice = true;
      return v;
    }
    return null;
  }

  spawnPed(city) {
    const g = this.game, w = g.world, pp = g.player.worldPos;
    for (let tries = 0; tries < 12; tries++) {
      const b = pick(w.sidewalkBlocks);
      const d = dist2(b.x, b.z, pp.x, pp.z);
      if (d < 40 || d > 180) continue;
      const k = Math.floor(Math.random() * 4);
      const r = 38.3;
      const corners = [[-r, -r], [r, -r], [r, r], [-r, r]];
      const c1 = corners[k], c2 = corners[(k + 1) % 4];
      const t = Math.random();
      const x = b.x + c1[0] + (c2[0] - c1[0]) * t, z = b.z + c1[1] + (c2[1] - c1[1]) * t;
      if (dist2(x, z, pp.x, pp.z) < 35) continue;
      let kind = 'civ';
      const gang = GANGS[b.district];
      if (gang && chance(0.22)) kind = 'gang';
      else if (chance(0.03)) kind = 'cop';
      const p = new Ped(g, x, z, { kind, block: b, city: b.city, gangColor: gang });
      p.corner = (k + 1) % 4;
      p.target = p.cornerPos(p.corner);
      g.peds.push(p);
      return p;
    }
    return null;
  }

  // vehicles vs pedestrians (and the player on foot)
  runOver() {
    const g = this.game;
    const player = g.player;
    for (const v of g.vehicles) {
      if (v.removed) continue;
      const sp = v.speed;
      if (sp < 3.5 || v.isHeli && v.pos.y > 3) continue;
      const sh = Math.sin(v.h), ch = Math.cos(v.h);
      const halfL = v.T.len / 2 + 0.4, halfW = v.T.wid / 2 + 0.4;
      const test = (x, y, z) => {
        const dx = x - v.pos.x, dz = z - v.pos.z;
        if (Math.abs(dx) > 8 || Math.abs(dz) > 8) return false;
        if (Math.abs(y - v.pos.y) > v.T.hgt + 0.8) return false;
        const along = dx * sh + dz * ch, side = -dx * ch + dz * sh;
        return Math.abs(along) < halfL && Math.abs(side) < halfW;
      };
      for (const p of g.peds) {
        if (!p.alive || p.state === 'ragdoll') continue;
        if (!test(p.pos.x, p.pos.y, p.pos.z)) continue;
        const dmg = sp * 7 * (v.T.crusher ? 3 : 1);
        const k = 1.1;
        p.hit(dmg, v.vx / (sp || 1), v.vz / (sp || 1), v.driver === 'player' ? 'player' : 'traffic', { force: sp * k, up: 3 + sp * 0.25 });
        if (p.state !== 'ragdoll' && p.state !== 'dead') p.ragdoll(v.vx * k, 3 + sp * 0.25, v.vz * k);
        g.audio.crash(sp * 0.6, dist2(v.pos.x, v.pos.z, player.worldPos.x, player.worldPos.z));
        if (v.driver === 'player' && sp > 12) g.onRoadkill(p);
        if (v.ai && v.ai.mode === 'traffic') v.ai.panic = 6;
      }
      if (!player.vehicle && !player.dead && v.driver !== 'player' && test(player.pos.x, player.pos.y, player.pos.z)) {
        player.damage(sp * 3.5, 'vehicle');
        const l = sp || 1;
        player.vx = v.vx * 0.9; player.vz = v.vz * 0.9; player.vy = 4 + sp * 0.15;
        player.grounded = false;
        player.pos.x += v.vx / l * 1.5; player.pos.z += v.vz / l * 1.5;
      }
    }
  }
}
