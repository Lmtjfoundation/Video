// Wanted level: crimes raise stars, police units spawn and hunt you,
// and breaking line of sight long enough lets you escape.
import { DriveAI } from './ai.js';
import { Vehicle } from './vehicles.js';
import { dist2, rand, pick, clamp } from './util.js';

const CARS_FOR_LEVEL = [0, 2, 3, 5, 6, 8];

export class Wanted {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this.seen = false;
    this.searchTimer = 0;
    this.kills = 0;
    this.units = [];      // vehicles
    this.spawnCd = 0;
    this.locked = false;  // missions can suppress police
    this.lastLevel = 0;
    this.heat = 0;
  }

  get evadeTime() { return 7 + this.level * 3; }

  report(crime, x, z) {
    const g = this.game;
    if (this.locked || g.cheats.neverWanted) return;
    const inCity = !!g.world.inCity(x, z, 60);
    const before = this.level;
    switch (crime) {
      case 'gunfire': if (inCity) this.level = Math.max(this.level, 1); break;
      case 'assault': this.level = Math.max(this.level, 1); break;
      case 'murder':
        this.kills++;
        this.level = Math.max(this.level, 2);
        if (this.kills % 4 === 0) this.level++;
        break;
      case 'copKill': this.level = Math.max(this.level + 1, 3); break;
      case 'copAssault': this.level = Math.max(this.level, 2); break;
      case 'stealCop': this.level = Math.max(this.level, 2); break;
      case 'explosion': if (inCity) this.level = Math.max(this.level, 2); break;
      case 'tank': this.level = Math.max(this.level, 4); break;
      case 'carjack': this.level = Math.max(this.level, 1); break;
      case 'vehicleKill': this.level = Math.max(this.level, 2); break;
      case 'heist': this.level = Math.max(this.level, 4); break;
    }
    this.level = clamp(this.level, 0, 5);
    if (this.level > before) {
      g.audio.star();
      this.searchTimer = 0;
      this.seen = true;
      this.lastX = x; this.lastZ = z;
    }
  }

  set(level) {
    const before = this.level;
    this.level = clamp(level, 0, 5);
    this.searchTimer = 0;
    if (this.level > before) this.game.audio.star();
    if (this.level === 0) this.clear();
  }

  clear() {
    this.level = 0;
    this.kills = 0;
    for (const v of this.units) {
      if (v.removed || v.dead) continue;
      v.siren = false;
      if (v.ai) {
        if (v.isHeli) v.ai.mode = 'heli';
        else { v.ai.mode = 'traffic'; v.ai.edge = null; }
      }
    }
    this.units = this.units.filter((v) => v.isHeli && !v.removed);
    for (const p of this.game.peds) if ((p.kind === 'cop' || p.kind === 'swat') && p.state === 'attack') p.state = 'idle';
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.units = this.units.filter((v) => !v.removed && !(v.dead && v.wreckTimer > 5));
    if (this.level === 0) {
      this.lastLevel = 0;
      // retire police helicopters once they've flown off
      for (const v of this.units) {
        if (v.isHeli && dist2(v.pos.x, v.pos.z, p.worldPos.x, p.worldPos.z) > 400) v.remove();
      }
      return;
    }
    if (p.dead) return;
    const pp = p.worldPos;
    // are we seen?
    let seen = false;
    for (const v of this.units) {
      if (v.dead || v.removed) continue;
      const d = dist2(v.pos.x, v.pos.z, pp.x, pp.z);
      const range = v.isHeli ? 160 : 110;
      if (d < range && (d < 25 || g.world.lineOfSight(v.pos.x, v.pos.y + 1.5, v.pos.z, pp.x, pp.y + 1.2, pp.z))) { seen = true; break; }
    }
    if (!seen) {
      for (const c of g.peds) {
        if ((c.kind !== 'cop' && c.kind !== 'swat') || !c.alive) continue;
        if (dist2(c.pos.x, c.pos.z, pp.x, pp.z) < 50) { seen = true; break; }
      }
    }
    this.seen = seen;
    if (seen) { this.searchTimer = 0; this.lastX = pp.x; this.lastZ = pp.z; }
    else {
      this.searchTimer += dt;
      if (this.searchTimer > this.evadeTime) {
        this.clear();
        g.hud.bigMessage('LOST THE COPS', '#7fff7f', 2.5, 'small');
        return;
      }
    }

    // spawn units
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) {
      this.spawnCd = 1.5;
      const cars = this.units.filter((v) => !v.isHeli && !v.dead && !v.removed && v.driver !== 'player');
      // officers run back to their cruisers when you drive off
      if (p.vehicle) {
        for (const v of cars) {
          if (v.driver || dist2(v.pos.x, v.pos.z, pp.x, pp.z) < 30) continue;
          let boarded = 0;
          for (const c of g.peds) {
            if (boarded >= 4 || !c.alive || (c.kind !== 'cop' && c.kind !== 'swat')) continue;
            if (dist2(c.pos.x, c.pos.z, v.pos.x, v.pos.z) < 30) { c.remove(); boarded++; }
          }
          if (boarded) {
            new DriveAI(g, v, 'chase');
            v.siren = true;
          }
        }
      }
      const helis = this.units.filter((v) => v.isHeli && !v.dead);
      const wantCars = CARS_FOR_LEVEL[this.level];
      const wantHelis = this.level >= 5 ? 2 : this.level >= 3 ? 1 : 0;
      if (cars.length < wantCars) this.spawnCar(this.level >= 5 && !this.units.some((u) => u.type === 'tank' && !u.dead) ? 'tank' : this.level >= 4 && chance(0.35) ? 'van' : 'police');
      if (helis.length < wantHelis) this.spawnHeli();
      // recruit nearby patrol cars
      for (const v of g.vehicles) {
        if (v.isPolice && !v.isHeli && v.ai && v.ai.mode === 'traffic' && !v.dead && dist2(v.pos.x, v.pos.z, pp.x, pp.z) < 200) {
          v.ai.mode = 'chase';
          if (!this.units.includes(v)) this.units.push(v);
        }
      }
    }
    // despawn units that fell far behind
    for (const v of this.units) {
      if (!v.isHeli && dist2(v.pos.x, v.pos.z, pp.x, pp.z) > 520 && v.driver !== 'player') v.remove();
    }
  }

  spawnCar(type) {
    const g = this.game, w = g.world, pp = g.player.worldPos;
    for (let tries = 0; tries < 30; tries++) {
      const e = w.edges[Math.floor(Math.random() * w.edges.length)];
      const t = Math.random();
      const A = w.nodes[e.a], B = w.nodes[e.b];
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
      const d = dist2(x, z, pp.x, pp.z);
      if (d < 110 || d > 260) continue;
      if (g.vehicles.some((v) => !v.removed && dist2(v.pos.x, v.pos.z, x, z) < 10)) continue;
      const v = g.spawnVehicle(type, x, z, 0, { color: type === 'van' ? '#111111' : undefined });
      const ai = new DriveAI(g, v, 'chase');
      const from = chance(0.5) ? e.a : e.b;
      ai.placeOnEdge(e, from, from === e.a ? t : 1 - t);
      v.isPolice = true;
      v.siren = true;
      v.swat = type === 'van';
      if (type === 'tank') g.hud.bigMessage('THE MILITARY IS HERE', '#ff4040', 2.5, 'small');
      this.units.push(v);
      return v;
    }
    return null;
  }

  spawnHeli() {
    const g = this.game, pp = g.player.worldPos;
    const a = rand(0, Math.PI * 2);
    const v = g.spawnVehicle('policeHeli', pp.x + Math.cos(a) * 250, pp.z + Math.sin(a) * 250, a, { y: 90, rotorOn: true });
    const ai = new DriveAI(g, v, 'heli');
    v.isPolice = true;
    this.units.push(v);
  }
}

function chance(p) { return Math.random() < p; }
