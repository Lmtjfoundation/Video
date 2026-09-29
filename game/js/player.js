// The player: on-foot movement, swimming, parachuting, weapons, and the
// mapping from input to whatever vehicle you're driving/flying.
import * as THREE from 'three';
import { buildHuman, animateHuman } from './people.js';
import { clamp, rand, wrapAngle, smoothAngle, dist2 } from './util.js';

export const WEAPONS = {
  fist: { name: 'Fists', icon: '✊', rate: 0.4, melee: true, dmg: 20 },
  // mag: rounds per magazine, reload: seconds, recoil: view kick (radians), bloom: spread added per shot
  pistol: { name: 'Pistol', icon: '🔫', rate: 0.16, dmg: 36, spread: 0.012, range: 220, sound: 'pistol', max: 250, give: 60, mag: 15, reload: 1.4, recoil: 0.028, bloom: 0.012 },
  smg: { name: 'Micro SMG', icon: '🔫', rate: 0.075, dmg: 20, spread: 0.028, range: 180, auto: true, sound: 'smg', max: 600, give: 180, mag: 30, reload: 1.9, recoil: 0.014, bloom: 0.006 },
  shotgun: { name: 'Pump Shotgun', icon: '💥', rate: 0.85, dmg: 16, pellets: 9, spread: 0.06, range: 70, sound: 'shotgun', force: 9, max: 80, give: 24, mag: 8, reload: 2.6, recoil: 0.09, bloom: 0.02 },
  rpg: { name: 'RPG', icon: '🚀', rate: 1.1, projectile: 'rocket', sound: 'rpg', max: 30, give: 8, mag: 1, reload: 2.4, recoil: 0.06, bloom: 0 },
  minigun: { name: 'Minigun', icon: '⚙️', rate: 0.03, dmg: 24, spread: 0.035, range: 220, auto: true, sound: 'minigun', max: 5000, give: 1500, recoil: 0.004, bloom: 0.002 },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun', 'rpg', 'minigun'];

export class Player {
  constructor(game) {
    this.game = game;
    this.model = buildHuman({ shirt: '#2e7d32', pants: '#c8b58a', skin: '#8d5a3b', hair: '#111', shoes: '#f0f0f0', armed: true, female: false, sleeves: 'short', build: 1.12, height: 1.03 });
    this.group = this.model.group;
    this.pos = this.group.position;
    this.h = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.grounded = true;
    this.health = 100; this.armor = 0;
    this.money = 5000;
    this.vehicle = null;
    this.dead = false;
    this.weapons = { fist: Infinity, pistol: 90 };
    this.weapon = 'pistol';
    this.cooldown = 0;
    this.phase = 0;
    this.aiming = false;
    this.parachute = null;
    this.chuteState = 'none'; // none | available | open
    this.swimming = false;
    this.nitro = 1;
    this.sprintStamina = 1;
    this.fallStartY = 0;
    this.worldPos = new THREE.Vector3();
    this.bustTimer = 0;
    this.lastShot = -99;
    this.spin = 0;
    // first-person gun handling
    this.clip = {};           // rounds in the current magazine (part of weapons[w])
    this.reloadT = 0; this.reloadDur = 1;
    this.adsK = 0;            // 0 = hip, 1 = aiming down sights
    this.sprintK = 0;
    this.sprinting = false;
    this.bloom = 0;           // extra spread from sustained fire
    this.recoilBack = 0;      // view kick still to recover
    this.pumpT = 0;
    this.stepPhase = 0;
    game.scene.add(this.group);
    this.buildChute();
  }

  buildChute() {
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xff3b3b, side: THREE.DoubleSide, roughness: 0.8 }));
    canopy.scale.set(1.3, 0.6, 0.9);
    canopy.position.y = 2.5;
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(4.02, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, wireframe: true }));
    stripe.scale.copy(canopy.scale); stripe.position.copy(canopy.position);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -2.3, 0), new THREE.Vector3(-3.5, 2.7, 0), new THREE.Vector3(0, -2.3, 0), new THREE.Vector3(3.5, 2.7, 0),
      new THREE.Vector3(0, -2.3, 0), new THREE.Vector3(0, 2.7, 2.5), new THREE.Vector3(0, -2.3, 0), new THREE.Vector3(0, 2.7, -2.5)]), new THREE.LineBasicMaterial({ color: 0x222222 }));
    g.add(canopy, stripe, lines);
    g.position.y = 4;
    g.visible = false;
    this.group.add(g);
    this.chute = g;
  }

  giveWeapon(w, ammo) {
    const W = WEAPONS[w];
    this.weapons[w] = Math.min(W.max || Infinity, (this.weapons[w] || 0) + (ammo ?? W.give));
    this.weapon = w;
    this.reloadT = 0;
  }

  // rounds loaded in the current magazine
  loaded(w = this.weapon) {
    const W = WEAPONS[w], total = this.weapons[w] || 0;
    if (!W.mag) return total;
    if (this.clip[w] === undefined) this.clip[w] = Math.min(W.mag, total);
    return Math.min(this.clip[w], total);
  }

  startReload() {
    const W = WEAPONS[this.weapon];
    if (!W.mag || this.reloadT > 0 || this.vehicle) return;
    const total = this.weapons[this.weapon] || 0;
    if (this.loaded() >= Math.min(W.mag, total)) return;
    this.reloadT = this.reloadDur = W.reload;
    this.game.audio.reload(this.weapon);
  }

  cycleWeapon(dir) {
    const owned = WEAPON_ORDER.filter((w) => this.weapons[w] > 0);
    let i = owned.indexOf(this.weapon);
    i = (i + dir + owned.length) % owned.length;
    this.weapon = owned[i];
    this.reloadT = 0;
    this.game.hud.weaponChanged();
  }

  update(dt, input, cam) {
    const g = this.game;
    this.cooldown -= dt;
    this.nitro = Math.min(1, this.nitro + dt * 0.05);
    if (this.dead) {
      this.worldPos.copy(this.pos);
      return;
    }

    // weapon switching
    if (input.mouse.wheel) this.cycleWeapon(input.mouse.wheel > 0 ? 1 : -1);
    for (let k = 1; k <= 6; k++) {
      if (input.pressed('Digit' + k)) {
        const w = WEAPON_ORDER[k - 1];
        if (this.weapons[w] > 0 && w !== this.weapon) { this.weapon = w; this.reloadT = 0; g.hud.weaponChanged(); }
      }
    }

    // reloading
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        const W = WEAPONS[this.weapon];
        this.clip[this.weapon] = Math.min(W.mag, this.weapons[this.weapon] || 0);
      }
    }
    if (input.pressed('KeyR') && !this.vehicle) this.startReload();
    // recoil recovery: the view drifts most of the way back down
    if (this.recoilBack > 0) {
      const back = Math.min(this.recoilBack, this.recoilBack * dt * 7 + dt * 0.02);
      cam.pitch += back;
      this.recoilBack -= back;
    }
    this.bloom = Math.max(0, this.bloom - dt * (this.adsK > 0.5 ? 0.12 : 0.08));
    this.pumpT = Math.max(0, this.pumpT - dt);

    if (this.vehicle) this.updateInVehicle(dt, input, cam);
    else this.updateOnFoot(dt, input, cam);

    if (this.vehicle) this.worldPos.copy(this.vehicle.pos);
    else this.worldPos.copy(this.pos);
  }

  // ------------------------------------------------------------------ on foot
  updateOnFoot(dt, input, cam) {
    const g = this.game, world = g.world;
    const fwd = input.axis('KeyS', 'KeyW');
    const right = input.axis('KeyA', 'KeyD');
    const yaw = cam.yaw;
    // camera forward = (sin yaw, cos yaw); camera right = (-cos yaw, sin yaw)
    let mx = Math.sin(yaw) * fwd - Math.cos(yaw) * right;
    let mz = Math.cos(yaw) * fwd + Math.sin(yaw) * right;
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }

    const fp = g.cam.mode === 0;
    const Wc = WEAPONS[this.weapon];
    const ads = input.mouse.right && !Wc.melee && !this.swimming && this.chuteState !== 'open';
    this.aiming = ads || (!fp && ((input.mouse.left && !Wc.melee) || (performance.now() - this.lastShot < 600)));
    const sprint = (input.key('ShiftLeft') || input.key('ShiftRight')) && !ads;
    this.sprinting = sprint && fwd > 0 && this.grounded && performance.now() - this.lastShot > 400;
    this.adsK += ((ads && this.reloadT <= 0 ? 1 : 0) - this.adsK) * Math.min(1, dt * 12);
    this.sprintK += ((this.sprinting ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);
    let speed = this.swimming ? 3 : sprint ? 8.5 : 5.2;
    if (g.cheats.fastRun) speed *= 1.8;
    if (this.aiming) speed = Math.min(speed, 3.6);

    if (this.chuteState === 'open') {
      // glide
      this.h += -right * 1.4 * dt;
      const glide = 9 + fwd * 6;
      this.vx = Math.sin(this.h) * glide; this.vz = Math.cos(this.h) * glide;
      this.vy += (-4.5 - this.vy) * Math.min(1, dt * 3);
    } else if (this.grounded || this.swimming) {
      const tvx = mx * speed, tvz = mz * speed;
      const k = Math.min(1, dt * (this.grounded ? 14 : 3));
      this.vx += (tvx - this.vx) * k; this.vz += (tvz - this.vz) * k;
      if (ml > 0 && !this.aiming) this.h = smoothAngle(this.h, Math.atan2(mx, mz), 12, dt);
      if (input.pressed('Space') && this.grounded && !this.swimming) {
        this.vy = g.cheats.superJump ? 24 : 6.8;
        this.grounded = false;
        this.fallStartY = this.pos.y;
      }
    } else {
      // air control
      this.vx += mx * 3 * dt; this.vz += mz * 3 * dt;
    }
    if (this.aiming) this.h = smoothAngle(this.h, yaw, 20, dt);
    if (g.cam.mode === 0) this.h = yaw; // first person: body faces where you look

    if (this.chuteState !== 'open') this.vy -= (g.cheats.moonGravity ? 7 : 22) * dt;
    this.pos.x += this.vx * dt; this.pos.z += this.vz * dt; this.pos.y += this.vy * dt;

    const out = world.collideCircle(this.pos.x, this.pos.z, this.pos.y, 0.35, 0.5, this._o || (this._o = {}));
    if (out.hit) { this.pos.x = out.x; this.pos.z = out.z; }

    const inWater = world.isWater(this.pos.x, this.pos.z);
    const gh = world.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.5);
    if (inWater && this.pos.y <= -0.9) {
      if (!this.swimming && this.vy < -8) g.fx.splash(this.pos.x, 0, this.pos.z, 30);
      this.swimming = true;
      this.pos.y = -1.1; this.vy = 0; this.grounded = false;
      this.closeChute();
    } else {
      if (!inWater) this.swimming = false;
      if (this.pos.y <= gh) {
        const impact = -this.vy;
        this.pos.y = gh;
        if (!this.grounded) {
          if (impact > 15 && this.chuteState !== 'open' && !g.cheats.godmode) {
            this.damage((impact - 15) * 9, 'fall');
            g.shake(Math.min(1, impact / 30));
          }
          this.closeChute();
        }
        this.vy = 0;
        this.grounded = true;
      } else if (this.pos.y > gh + 0.3) {
        if (this.grounded) this.fallStartY = this.pos.y;
        this.grounded = false;
      } else if (this.grounded) {
        this.pos.y = gh; // follow small steps
      }
    }

    // parachute availability
    const heightAbove = this.pos.y - gh;
    if (!this.grounded && !this.swimming && this.chuteState === 'none' && this.vy < -6 && heightAbove > 25) this.chuteState = 'available';
    if (this.chuteState === 'available') {
      g.hud.hint('Press SPACE or F to open parachute');
      if (input.pressed('Space') || input.pressed('KeyF')) this.openChute();
      if (heightAbove < 3) this.chuteState = 'none';
    }
    if (!this.grounded && this.vy < -25) g.audio.setWind(Math.min(0.3, -this.vy / 150));
    else g.audio.setWind(0);

    // enter vehicle
    if (input.pressed('KeyF') && this.chuteState !== 'available' && this.chuteState !== 'open') this.tryEnter();

    // weapons
    const W = WEAPONS[this.weapon];
    if (this.weapons[this.weapon] <= 0 && this.weapon !== 'fist') this.cycleWeapon(-1);
    const fire = W.auto ? input.mouse.left : input.mouse.leftDown;
    if (fire && this.reloadT <= 0 && W.mag && this.loaded() <= 0 && this.weapons[this.weapon] > 0) this.startReload();
    else if (fire && this.cooldown <= 0 && this.reloadT <= 0 && !this.swimming && this.chuteState !== 'open') this.fire(cam);

    // animation
    const sp = Math.hypot(this.vx, this.vz);
    this.phase += dt * sp * (this.swimming ? 1.5 : 3.1);
    // footsteps twice per stride
    if (this.grounded && sp > 1.5) {
      const st = Math.floor(this.phase / Math.PI);
      if (st !== this.stepPhase) { this.stepPhase = st; g.audio.footstep(sp > 7 ? 1 : sp > 4 ? 0.7 : 0.45); }
    }
    animateHuman(this.model, this.phase, this.grounded || this.swimming ? Math.min(1, sp * 0.18) : 0.3, this.aiming && !W.melee, dt);
    if (this.punchT > 0) {
      this.punchT -= dt;
      this.model.armR.rotation.x = -Math.PI / 2 * Math.sin((0.3 - this.punchT) / 0.3 * Math.PI);
    }
    this.model.gun.visible = !W.melee;
    this.model.rig.rotation.x = this.swimming ? -1.2 : this.chuteState === 'open' ? 0 : 0;
    this.group.rotation.y = this.h;
    this.group.visible = true;
  }

  openChute() {
    if (this.grounded || this.dead || this.swimming) return;
    this.chuteState = 'open';
    this.chute.visible = true;
    this.vy = Math.max(this.vy, -12);
    this.game.audio.ui();
  }
  closeChute() {
    this.chuteState = 'none';
    this.chute.visible = false;
  }

  tryEnter() {
    const g = this.game;
    let best = null, bd = 5.5;
    for (const v of g.vehicles) {
      if (v.removed || v.dead) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) - v.T.len * 0.3;
      if (d < bd && Math.abs(v.pos.y - this.pos.y) < 3) { bd = d; best = v; }
    }
    if (!best) return;
    g.enterVehicle(best);
  }

  // ---------------------------------------------------------------- in vehicle
  updateInVehicle(dt, input, cam) {
    const g = this.game, v = this.vehicle;
    this.group.visible = false;
    this.pos.copy(v.pos);
    this.swimming = false;
    const inp = v.input;
    if (v.isHeli) {
      inp.pitch = input.axis('KeyS', 'KeyW');
      inp.yaw = input.axis('KeyA', 'KeyD');
      inp.lift = (input.key('Space') ? 1 : 0) - (input.key('ShiftLeft') || input.key('ShiftRight') || input.key('KeyC') ? 1 : 0);
    } else {
      inp.throttle = input.axis('KeyS', 'KeyW');
      inp.steer = input.axis('KeyA', 'KeyD');
      inp.handbrake = input.key('Space');
      inp.nitro = input.key('ShiftLeft') || input.key('ShiftRight');
    }
    g.audio.setHorn(input.key('KeyE') && !v.isHeli);
    if (input.pressed('KeyE') && v.isPolice) { v.siren = !v.siren; }
    if (v.type === 'tank') v.turretYaw = cam.yaw;

    // exit
    if (input.pressed('KeyF')) { g.exitVehicle(); return; }

    // vehicle weapons
    if (v.type === 'tank') {
      if (input.mouse.left && this.cooldown <= 0) { this.cooldown = 1.1; g.fireCannon(v, cam); }
    } else if (v.type === 'heli') {
      if (input.mouse.left && this.cooldown <= 0) { this.cooldown = 0.35; g.fireHeliRockets(v, cam); }
    } else if (!v.isHeli) {
      const W = WEAPONS[this.weapon];
      if (!W.melee) {
        const fire = W.auto ? input.mouse.left : input.mouse.leftDown;
        if (fire && this.cooldown <= 0) this.fire(cam, true);
      }
    }
  }

  // ------------------------------------------------------------------ firing
  fire(cam, fromVehicle = false) {
    const g = this.game;
    const W = WEAPONS[this.weapon];
    this.cooldown = W.rate;
    this.lastShot = performance.now();
    if (W.melee) { this.punch(); return; }
    if (this.weapons[this.weapon] !== Infinity) {
      if (this.weapons[this.weapon] <= 0) { g.audio.shot('empty'); return; }
      if (!fromVehicle && W.mag && this.loaded() <= 0) { g.audio.shot('empty'); this.startReload(); return; }
      if (!g.cheats.infiniteAmmo) {
        this.weapons[this.weapon]--;
        if (W.mag && !fromVehicle) this.clip[this.weapon] = this.loaded() - 1;
      }
    }
    // recoil: kick the view up and a little sideways, most of it recovers
    if (!fromVehicle && W.recoil) {
      const k = W.recoil * (1 - this.adsK * 0.35) * (this.grounded ? 1 : 1.5);
      cam.pitch -= k;
      cam.yaw += rand(-k, k) * 0.35;
      this.recoilBack += k * 0.75;
      this.bloom = Math.min(0.06, this.bloom + (W.bloom || 0));
    }
    if (g.cam.mode === 0 && !fromVehicle) g.vmShot();
    if (this.weapon === 'shotgun') this.pumpT = 0.5;
    // muzzle position
    let mx, my, mz;
    if (fromVehicle) {
      const v = this.vehicle;
      mx = v.pos.x - Math.cos(v.h) * 1.0; my = v.pos.y + v.T.hgt * 0.8; mz = v.pos.z + Math.sin(v.h) * 1.0;
    } else if (g.cam.mode === 0) {
      ({ x: mx, y: my, z: mz } = g.fpMuzzle());
    } else {
      mx = this.pos.x + Math.sin(this.h) * 0.6 - Math.cos(this.h) * 0.36;
      my = this.pos.y + 1.55;
      mz = this.pos.z + Math.cos(this.h) * 0.6 + Math.sin(this.h) * 0.36;
    }
    const aim = g.aimPoint();
    let dx = aim.x - mx, dy = aim.y - my, dz = aim.z - mz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    g.audio.shot(W.sound);
    g.fx.muzzle(mx + dx * 0.4, my + dy * 0.4, mz + dz * 0.4, dx, dy, dz, this.weapon === 'minigun' || this.weapon === 'shotgun');
    g.onPlayerGunfire(mx, mz);
    if (W.projectile) {
      g.spawnRocket(mx + dx, my + dy, mz + dz, dx, dy, dz, 'player');
      g.shake(0.25);
      return;
    }
    const pellets = W.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const s = this.currentSpread() * (W.pellets ? 1 : 0.6);
      let ddx = dx + rand(-s, s), ddy = dy + rand(-s, s), ddz = dz + rand(-s, s);
      const ll = Math.hypot(ddx, ddy, ddz); ddx /= ll; ddy /= ll; ddz /= ll;
      g.fireBullet(mx, my, mz, ddx, ddy, ddz, W.dmg, W.range, 'player', W.force || 2, i === 0 || i % 3 === 0);
    }
    if (this.weapon === 'minigun') g.shake(0.06);
    if (this.weapon === 'shotgun') g.shake(0.2);
  }

  // cone half-angle for the next shot (also drives the crosshair size)
  currentSpread() {
    const W = WEAPONS[this.weapon];
    if (!W.spread) return 0;
    const moving = Math.min(1, Math.hypot(this.vx, this.vz) / 5);
    let s = W.spread * (1 + moving * 0.8 + (this.grounded || this.vehicle ? 0 : 1.5)) + this.bloom;
    s *= 1 - this.adsK * (W.pellets ? 0.3 : 0.65);
    return s;
  }

  punch() {
    const g = this.game;
    this.punchT = 0.3;
    g.audio.shot('punch');
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    for (const p of g.peds) {
      if (!p.alive) continue;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.9 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
        p.hit(WEAPONS.fist.dmg * (g.cheats.explosivePunch ? 5 : 1), fx, fz, 'player', { force: g.cheats.explosivePunch ? 25 : 4, up: g.cheats.explosivePunch ? 12 : 2 });
        if (g.cheats.explosivePunch) g.explosion(p.pos.x, p.pos.y + 1, p.pos.z, 0.6, 'player');
      }
    }
  }

  damage(amount, source) {
    if (this.dead || this.game.cheats.godmode) return;
    if (this.armor > 0 && source !== 'fall' && source !== 'drown') {
      const a = Math.min(this.armor, amount * 0.7);
      this.armor -= a;
      amount -= a;
    }
    this.health -= amount;
    this.game.hud.flashDamage();
    if (this.health <= 0) {
      this.health = 0;
      this.game.playerDied(source);
    }
  }
}
