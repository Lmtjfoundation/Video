// AI controllers that drive Vehicles by writing to vehicle.input.
//  - traffic: follows lanes on the road graph, brakes for obstacles
//  - chase:   police pursuit (A* over the road graph, then direct ramming)
//  - race:    follows a list of checkpoints
//  - flee:    panicked traffic
//  - heli:    police helicopter orbiting the player
import { clamp, wrapAngle, headingTo, dist2, pick, rand, chance } from './util.js';

export class DriveAI {
  constructor(game, v, mode = 'traffic') {
    this.game = game;
    this.v = v;
    this.mode = mode;
    this.edge = null; this.from = -1; this.to = -1; this.next = null;
    this.lane = 4.5;
    this.stuck = 0; this.reverse = 0;
    this.path = null; this.pathIdx = 0; this.repath = 0;
    this.shootCd = rand(1, 2);
    this.copsOut = false;
    this.panic = 0;
    this.honk = 0;
    this.checkpoints = null; this.cpIdx = 0;
    this.skill = rand(0.85, 1.0);
    v.ai = this;
    v.driver = 'ai';
  }

  placeOnEdge(edge, from, t) {
    const w = this.game.world;
    this.edge = edge; this.from = from; this.to = edge.a === from ? edge.b : edge.a;
    this.lane = pick(edge.lanes);
    const A = w.nodes[this.from], B = w.nodes[this.to];
    const dx = (B.x - A.x) / edge.len, dz = (B.z - A.z) / edge.len;
    const s = edge.len * t;
    this.v.pos.x = A.x + dx * s - dz * this.lane;
    this.v.pos.z = A.z + dz * s + dx * this.lane;
    this.v.h = Math.atan2(dx, dz);
    const sp = Math.min(edge.speed, 14);
    this.v.vx = dx * sp; this.v.vz = dz * sp;
    this.next = null;
  }

  // nearest edge -> start following traffic from where we are
  attachToRoad() {
    const w = this.game.world;
    const ne = w.nearestEdge(this.v.pos.x, this.v.pos.z);
    if (!ne) return false;
    const e = ne.edge;
    const A = w.nodes[e.a], B = w.nodes[e.b];
    const hx = Math.sin(this.v.h), hz = Math.cos(this.v.h);
    const forward = (B.x - A.x) * hx + (B.z - A.z) * hz > 0;
    this.edge = e;
    this.from = forward ? e.a : e.b; this.to = forward ? e.b : e.a;
    this.lane = pick(e.lanes);
    this.next = null;
    return true;
  }

  lanePoint(edge, from, s, lane) {
    const w = this.game.world;
    const to = edge.a === from ? edge.b : edge.a;
    const A = w.nodes[from], B = w.nodes[to];
    const dx = (B.x - A.x) / edge.len, dz = (B.z - A.z) / edge.len;
    return { x: A.x + dx * s - dz * lane, z: A.z + dz * s + dx * lane, dx, dz };
  }

  chooseNext() {
    const w = this.game.world;
    const node = w.nodes[this.to];
    let opts = node.adj.filter((a) => a.to !== this.from);
    if (!opts.length) opts = node.adj;
    // prefer to keep going straight-ish on highways
    const a = pick(opts);
    this.next = { edge: w.edges[a.edge], from: this.to };
  }

  update(dt) {
    const v = this.v;
    if (v.dead || v.driver !== 'ai') return;
    if (this.mode === 'heli') return this.updateHeli(dt);
    let target, desired;
    switch (this.mode) {
      case 'chase': ({ target, desired } = this.chase(dt)); break;
      case 'race': ({ target, desired } = this.race(dt)); break;
      case 'parked': v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true; return;
      default: ({ target, desired } = this.traffic(dt));
    }
    if (!target) { v.input.throttle = 0; v.input.handbrake = true; return; }
    this.drive(target, desired, dt);
  }

  drive(target, desired, dt) {
    const v = this.v;
    const want = headingTo(v.pos.x, v.pos.z, target.x, target.z);
    let diff = wrapAngle(want - v.h);
    const vf = v.forwardSpeed;
    let steer = clamp(-diff * 2.2, -1, 1);
    let throttle = clamp((desired - vf) * 0.35, -1, 1);
    if (Math.abs(diff) > 1.2 && vf > 12) throttle = Math.min(throttle, -0.4);
    // stuck recovery
    if (this.reverse > 0) {
      this.reverse -= dt;
      throttle = -1; steer = -steer;
    } else if (throttle > 0.2 && Math.abs(vf) < 1.2 && v.grounded) {
      this.stuck += dt;
      if (this.stuck > 1.6) { this.reverse = 1.2; this.stuck = 0; this.stuckCount = (this.stuckCount || 0) + 1; }
    } else this.stuck = Math.max(0, this.stuck - dt);
    v.input.steer = steer;
    v.input.throttle = throttle;
    v.input.handbrake = desired === 0 && Math.abs(vf) < 1;
  }

  // -------------------------------------------------------------- traffic
  traffic(dt) {
    const v = this.v, w = this.game.world;
    if (!this.edge && !this.attachToRoad()) return {};
    const A = w.nodes[this.from], B = w.nodes[this.to];
    const len = this.edge.len;
    const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
    const s = (v.pos.x - A.x) * dx + (v.pos.z - A.z) * dz;
    if (!this.next && s > len - 30) this.chooseNext();
    if (s >= len - 2 && this.next) {
      this.edge = this.next.edge; this.from = this.next.from;
      this.to = this.edge.a === this.from ? this.edge.b : this.edge.a;
      this.lane = this.edge.lanes.includes(this.lane) ? this.lane : pick(this.edge.lanes);
      this.next = null;
      return this.traffic(dt);
    }
    const look = clamp(Math.abs(v.forwardSpeed) * 0.6, 6, 22);
    let target;
    if (s + look < len || !this.next) target = this.lanePoint(this.edge, this.from, Math.min(len, s + look), this.lane);
    else {
      const ne = this.next.edge;
      const lane = ne.lanes.includes(this.lane) ? this.lane : ne.lanes[0];
      target = this.lanePoint(ne, this.next.from, Math.min(ne.len, s + look - len), lane);
    }
    let desired = this.edge.speed * this.skill;
    if (this.panic > 0) { this.panic -= dt; desired *= 1.6; }
    // slow for turns
    if (this.next && s > len - 28) {
      const ne = this.next.edge;
      const nt = ne.a === this.next.from ? ne.b : ne.a;
      const N = w.nodes[nt], F = w.nodes[this.next.from];
      const turn = Math.abs(wrapAngle(Math.atan2(N.x - F.x, N.z - F.z) - Math.atan2(dx, dz)));
      if (turn > 0.4) desired = Math.min(desired, this.panic > 0 ? 14 : 8);
    }
    desired = Math.min(desired, this.obstacleSpeed(desired));
    return { target, desired };
  }

  obstacleSpeed(desired) {
    const v = this.v, g = this.game;
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    let lim = desired;
    const check = (x, z, pad, isPerson) => {
      const dx = x - v.pos.x, dz = z - v.pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 26) return;
      const side = Math.abs(-dx * fz + dz * fx);
      if (side > pad) return;
      const gap = ahead - v.T.len / 2 - 3;
      const s = Math.max(0, gap * 0.9);
      if (s < lim) lim = s;
      if (isPerson && gap < 10) this.honk = 0.6;
    };
    for (const o of g.vehicles) {
      if (o === v || o.removed || o.isHeli) continue;
      if (Math.abs(o.pos.x - v.pos.x) > 30 || Math.abs(o.pos.z - v.pos.z) > 30) continue;
      check(o.pos.x, o.pos.z, 2.6, o.driver === 'player');
    }
    const p = g.player;
    if (!p.vehicle && !p.dead) check(p.pos.x, p.pos.z, 2.2, true);
    for (const pd of g.peds) {
      if (!pd.alive || Math.abs(pd.pos.x - v.pos.x) > 26 || Math.abs(pd.pos.z - v.pos.z) > 26) continue;
      check(pd.pos.x, pd.pos.z, 1.8, false);
    }
    if (this.panic > 0) lim = Math.max(lim, desired * 0.5);
    return lim;
  }

  // ---------------------------------------------------------------- chase
  chase(dt) {
    const v = this.v, g = this.game, w = g.world;
    const p = g.player;
    const tp = p.worldPos;
    const pv = p.vehicle;
    const d = dist2(v.pos.x, v.pos.z, tp.x, tp.z);
    v.siren = true;
    // shooting from the car
    if (g.wanted.level >= 2 && d < 45 && !p.dead) {
      this.shootCd -= dt;
      if (this.shootCd <= 0) {
        this.shootCd = rand(0.6, 1.3) / (g.wanted.level >= 4 ? 1.6 : 1);
        if (w.lineOfSight(v.pos.x, v.pos.y + 1.4, v.pos.z, tp.x, tp.y + 1, tp.z)) g.copCarShoot(v, tp);
      }
    }
    // on-foot suspects: pull up and get out
    if (!pv && d < 26) {
      if (!this.copsOut && Math.abs(v.forwardSpeed) < 3) {
        this.copsOut = true;
        g.spawnCopsFromCar(v);
      }
      return { target: tp, desired: 0 };
    }
    if (pv) this.copsOut = false;
    // direct pursuit when close
    const lead = pv ? 0.5 : 0;
    const tx = tp.x + (pv ? pv.vx * lead : 0), tz = tp.z + (pv ? pv.vz * lead : 0);
    if (d < 70) return { target: { x: tx, z: tz }, desired: v.T.maxSpeed * 0.95 };
    // path follow
    this.repath -= dt;
    if (this.repath <= 0 || !this.path) {
      this.repath = 1.5;
      const hx = Math.sin(v.h), hz = Math.cos(v.h);
      const start = w.nearestNode(v.pos.x + hx * 25, v.pos.z + hz * 25);
      const goal = w.nearestNode(tp.x, tp.z);
      this.path = w.findPath(start, goal);
      this.pathIdx = 0;
    }
    if (this.path && this.pathIdx < this.path.length) {
      let n = w.nodes[this.path[this.pathIdx]];
      if (dist2(v.pos.x, v.pos.z, n.x, n.z) < 14) { this.pathIdx++; }
      if (this.pathIdx < this.path.length) {
        n = w.nodes[this.path[this.pathIdx]];
        const turnAhead = this.pathIdx + 1 < this.path.length;
        const dn = dist2(v.pos.x, v.pos.z, n.x, n.z);
        return { target: n, desired: turnAhead && dn < 35 ? 18 : v.T.maxSpeed * 0.9 };
      }
    }
    return { target: { x: tx, z: tz }, desired: v.T.maxSpeed * 0.9 };
  }

  // ----------------------------------------------------------------- race
  race(dt) {
    const v = this.v;
    if (!this.checkpoints || this.cpIdx >= this.checkpoints.length) return { target: null, desired: 0 };
    const cp = this.checkpoints[this.cpIdx];
    const d = dist2(v.pos.x, v.pos.z, cp.x, cp.z);
    if (d < 12) { this.cpIdx++; this.game.missions.racerCheckpoint(this); }
    const next = this.checkpoints[this.cpIdx + 1];
    let desired = Math.min(56, v.T.maxSpeed * this.skill) * (this.rubber || 1);
    if (next) {
      const a1 = Math.atan2(cp.x - v.pos.x, cp.z - v.pos.z), a2 = Math.atan2(next.x - cp.x, next.z - cp.z);
      const turn = Math.abs(wrapAngle(a2 - a1));
      if (turn > 0.5) {
        // brake early enough to make the corner
        const vc = 12 + (Math.PI - turn) * 4;
        const vf = Math.max(0, v.forwardSpeed);
        const brakeDist = Math.max(0, (vf * vf - vc * vc) / (2 * v.T.brake * 0.55));
        if (d < brakeDist + 14) desired = Math.min(desired, vc);
      }
    }
    return { target: cp, desired };
  }

  // ------------------------------------------------------------ police heli
  updateHeli(dt) {
    const v = this.v, g = this.game, w = g.world;
    const tp = g.player.worldPos;
    this.orbit = (this.orbit || rand(0, 6)) + dt * 0.25;
    const leaving = g.wanted.level === 0;
    const tx = leaving ? v.pos.x + Math.sin(v.h) * 200 : tp.x + Math.cos(this.orbit) * 35;
    const tz = leaving ? v.pos.z + Math.cos(v.h) * 200 : tp.z + Math.sin(this.orbit) * 35;
    const ty = (leaving ? 120 : Math.max(tp.y, 0) + 38);
    const inp = v.input;
    inp.lift = clamp((ty - v.pos.y) * 0.15 - v.vy * 0.2, -1, 1);
    const face = leaving ? v.h : headingTo(v.pos.x, v.pos.z, tp.x, tp.z);
    const travel = headingTo(v.pos.x, v.pos.z, tx, tz);
    const d = dist2(v.pos.x, v.pos.z, tx, tz);
    const useH = d > 60 ? travel : face;
    inp.yaw = clamp(-wrapAngle(useH - v.h) * 2, -1, 1);
    // project desired velocity onto heading for pitch
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const wantV = clamp(d * 0.5, 0, 45);
    const dirx = (tx - v.pos.x) / (d || 1), dirz = (tz - v.pos.z) / (d || 1);
    const along = (dirx * fx + dirz * fz) * wantV;
    const cur = v.vx * fx + v.vz * fz;
    inp.pitch = clamp((along - cur) * 0.08, -1, 1);
    // strafe assistance so it can orbit while facing the player
    v.vx += (dirx * wantV - v.vx) * dt * 0.4;
    v.vz += (dirz * wantV - v.vz) * dt * 0.4;
    if (!leaving && g.wanted.level >= 3 && !g.player.dead) {
      this.shootCd -= dt;
      const dd = dist2(v.pos.x, v.pos.z, tp.x, tp.z);
      if (this.shootCd <= 0 && dd < 90) {
        this.shootCd = rand(0.15, 0.3);
        if (w.lineOfSight(v.pos.x, v.pos.y - 1, v.pos.z, tp.x, tp.y + 1, tp.z)) g.heliShoot(v, tp);
      }
    }
  }
}
