// Grand Theft: Southern Heat — main game loop and glue.
import * as THREE from 'three';
import { World, WORLD_BOUNDS } from './world.js';
import { setAnisotropy, setTextureScale } from './textures.js';
import { Vehicle, VEHICLE_TYPES, resolveVehicleCollisions } from './vehicles.js';
import { Player, WEAPONS } from './player.js';
import { Effects } from './effects.js';
import { Graphics } from './graphics.js';
import { buildViewmodel } from './viewmodel.js';
import { AudioEngine, STATIONS } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Population } from './population.js';
import { Wanted } from './police.js';
import { Missions } from './missions.js';
import { Ped } from './people.js';
import { DriveAI } from './ai.js';
import { clamp, lerp, rand, pick, dist2, wrapAngle, smoothAngle, smoothDamp, formatMoney, headingTo } from './util.js';

const SAVE_KEY = 'gt-southern-heat-save';
const params = new URLSearchParams(location.search);

// time-of-day palette: [hour, skyTop, horizon, sunIntensity, hemiIntensity]
// height of the bore above each first-person gun's grip
const BORE = { pistol: 0.05, smg: 0.05, shotgun: 0.062, rpg: 0.1, minigun: 0.05 };

const SKY_KEYS = [
  [0, '#03050d', '#0d1428', 0, 0.6],
  [4.5, '#060a1a', '#1a1a33', 0, 0.6],
  [5.8, '#2a2f5a', '#e27a5a', 0.3, 0.55],
  [7, '#4a86c8', '#f4c08a', 1.6, 0.9],
  [9, '#2f72c0', '#b8dcf2', 2.8, 1.1],
  [16, '#2f72c0', '#bfe0f5', 2.8, 1.1],
  [18, '#3a5ea8', '#ffb37a', 1.8, 0.9],
  [19.3, '#2a2a5e', '#ff6a4a', 0.5, 0.6],
  [20.3, '#0c1030', '#3a2447', 0, 0.6],
  [24, '#03050d', '#0d1428', 0, 0.6],
];

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    let pref = null;
    try { pref = localStorage.getItem('gt-quality'); } catch (e) { /* storage unavailable */ }
    const q = params.get('quality') || pref;
    const weak = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4);
    this.low = q ? q === 'low' : !!weak;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.low ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      showFatal('Your graphics card ran out of memory. Switch Graphics to LOW on the title screen, then reload.');
    });
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    setAnisotropy(Math.min(this.low ? 4 : 16, this.renderer.capabilities.getMaxAnisotropy()));
    setTextureScale(this.low ? 1 : 2);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.3, 3200);
    this.scene.fog = new THREE.Fog(0xbfe0f5, 250, 1500);

    this.settings = { density: parseFloat(params.get('density') || '1') };
    if (this.low && !params.get('density')) this.settings.density = 0.6;
    this.cheats = {};
    this.save = this.loadSave();
    this.time = 0;
    this.hour = parseFloat(params.get('hour') || '17.2');
    this.timeScale = 1;
    this.shakeAmt = 0;
    this.vehicles = [];
    this.peds = [];
    this.rockets = [];
    this.pickups = [];
    this.cash = [];
    this.stats = { kills: 0, stunts: 0, cars: 0, cheats: 0 };
    this.started = false;
    this.paused = false;
    this.cam = { yaw: Math.PI, pitch: 0.05, dist: 5, idle: 0, fov: 75, mode: 0, pos: new THREE.Vector3() }; // mode 0 = first person
  }

  loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
  }
  persist() {
    try {
      this.save.money = Math.floor(this.player.money);
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch (e) { /* storage unavailable */ }
  }

  async init(progress) {
    progress('Paving the interstates…');
    await tick();
    this.buildSky();
    this.world = new World(this.scene);
    this.world.treeTries = this.low ? 2500 : 5000;
    progress('Raising Dallas, New Orleans and Atlanta…');
    await tick();
    this.world.build();
    progress('Hiring pedestrians…');
    await tick();
    this.fx = new Effects(this.scene);
    this.fx.setPixelScale(this.renderer.domElement.height);
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.player = new Player(this);
    if (this.save.money) this.player.money = this.save.money;
    this.hud = new HUD(this);
    this.wanted = new Wanted(this);
    this.population = new Population(this);
    this.missions = new Missions(this);
    this.buildPickups();
    this.buildHeadlight();
    this.buildViewmodel();
    // start outside the Dallas safehouse
    const sh = this.world.spawns.safehouses.find((s) => s.city === 'dallas');
    this.player.pos.set(sh.x, 0.3, sh.z + 4);
    this.player.h = 0;
    this.cam.yaw = 0;
    this.player.worldPos.copy(this.player.pos);
    this.setupCheatConsole();
    window.addEventListener('resize', () => this.onResize());
    progress('Warming up the engine…');
    await tick();
    // pre-warm: compile shaders
    this.population.update(0.016);
    this.renderer.compile(this.scene, this.camera);
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  start() {
    this.started = true;
    if (matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches)) this.input.setupTouch();
    this.audio.init();
    this.input.lock();
    document.getElementById('title').classList.add('hidden');
    this.hud.show();
    if (this.input.touch) this.hud.help('Welcome to the <b>Southern Triangle</b>.<br>Left stick moves, drag the screen to look.<br>Walk up to a car and tap <b>ENTER</b>. Tap <b>MAP</b> to set GPS.', 10);
    else this.hud.help('Welcome to the <b>Southern Triangle</b>.<br>Steal a car with <b>F</b>. Press <b>M</b> for the map and GPS.<br>Mission markers are the <b>lettered squares</b>. Press <b>T</b> for cheats. <b>H</b> shows help again.', 10);
    this.hud.bigMessage('DALLAS', '#ffb347', 3, 'small', 'WELCOME TO');
    this.canvas.addEventListener('click', () => {
      if (!this.started) return;
      this.audio.init();
      if (!this.hud.mapOpen) this.input.lock();
    });
    document.getElementById('pause').addEventListener('click', () => { this.setPaused(false); this.input.lock(); });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.started && !this.hud.mapOpen && !this.consoleOpen && !params.has('autostart')) this.setPaused(true);
    });
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause').classList.toggle('hidden', !p);
    if (p) {
      document.getElementById('stats').innerHTML = `Money: ${formatMoney(this.player.money)}<br>Missions: ${this.missions.completed.size}/6<br>Kills: ${this.stats.kills} &nbsp; Stunts: ${this.stats.stunts} &nbsp; Cars stolen: ${this.stats.cars}`;
      this.audio.setMusicAudible(false);
      this.audio.setEngine(false, 0, 0);
      this.audio.setSiren(0); this.audio.setRotor(0); this.audio.setScreech(0);
    } else if (this.player.vehicle) this.audio.setMusicAudible(true);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.gfx.resize(window.innerWidth, window.innerHeight);
    this.vmCamera.aspect = window.innerWidth / window.innerHeight;
    this.vmCamera.updateProjectionMatrix();
    this.fx.setPixelScale(this.renderer.domElement.height);
  }

  // --------------------------------------------------------------- sky/light
  buildSky() {
    // first-person weapon scene, drawn on top of the world with its own narrower FOV
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmHemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a4030, 1);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 2);
    this.vmScene.add(this.vmHemi, this.vmSun, this.vmSun.target);
    this.gfx = new Graphics(this.renderer, this.scene, this.camera, this.low ? 'low' : 'high', { scene: this.vmScene, camera: this.vmCamera });
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a4030, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.5);
    this.sun.castShadow = !this.low;
    this.sun.shadow.mapSize.set(this.low ? 1024 : 2048, this.low ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
  }

  buildHeadlight() {
    this.headlight = new THREE.SpotLight(0xfff0d0, 0, 90, 0.55, 0.5, 1.2);
    this.scene.add(this.headlight, this.headlight.target);
  }

  updateSky(dt) {
    const speed = this.cheats.timelapse ? 0.5 : 24 / (16 * 60); // 16-minute day
    this.hour = (this.hour + dt * speed) % 24;
    const h = this.hour;
    let a = SKY_KEYS[0], b = SKY_KEYS[1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    const t = (h - a[0]) / (b[0] - a[0] || 1);
    const top = new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), t);
    const hor = new THREE.Color(a[2]).lerp(new THREE.Color(b[2]), t);
    let sunI = lerp(a[3], b[3], t), hemiI = lerp(a[4], b[4], t);
    const rain = this.fx.raining;
    if (rain > 0) {
      const grey = new THREE.Color('#6b7580').multiplyScalar(Math.max(0.15, hemiI));
      top.lerp(grey, rain * 0.8); hor.lerp(grey, rain * 0.8);
      sunI *= 1 - rain * 0.75;
    }
    const ang = (h - 6) / 12 * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();
    const night = clamp((0.12 - sunDir.y) / 0.32, 0, 1);
    this.night = night;
    this.gfx.setSun(sunDir, night, rain);
    this.scene.fog.color.copy(hor).multiplyScalar(0.82);
    this.scene.background = this.scene.fog.color;
    this.scene.fog.near = rain > 0 ? 60 : 180;
    this.scene.fog.far = rain > 0 ? 700 : night > 0.5 ? 1300 : 2400;
    this.hemi.intensity = hemiI * 0.55;
    this.hemi.color.copy(top).lerp(new THREE.Color('#ffffff'), 0.5);
    // sun or moon
    const light = sunDir.y > -0.05 ? sunDir : new THREE.Vector3(-sunDir.x, -sunDir.y, sunDir.z);
    this.sun.intensity = sunDir.y > -0.05 ? sunI : 0.7 * (1 - rain * 0.5);
    this.sun.color.set(sunDir.y > -0.05 ? (sunDir.y < 0.25 ? '#ffb88a' : '#fff2dd') : '#8aa4ff');
    const c = this.player.worldPos;
    this.sun.target.position.set(c.x, 0, c.z);
    this.sun.position.set(c.x + light.x * 400, Math.max(40, light.y * 400), c.z + light.z * 400);
    this.world.setNight(night);
    this.wetness = clamp((this.wetness || 0) + (rain > 0 ? dt / 20 : -dt / 90), 0, 1);
    this.world.setWet(this.wetness);
    this.renderer.toneMappingExposure = 0.75 + night * 0.35;
  }

  // ------------------------------------------------------------ spawning
  spawnVehicle(type, x, z, h, opts = {}) {
    const v = new Vehicle(this, type, x, z, h, opts);
    const gh = this.world.groundHeight(x, z, opts.y ?? 50, 0.5);
    v.pos.y = opts.y !== undefined ? Math.max(opts.y, gh) : gh;
    this.vehicles.push(v);
    return v;
  }

  buildPickups() {
    const defs = {
      health: { color: '#4cff6a', label: '+' }, armor: { color: '#4aa3df', label: '◆' }, cash: { color: '#7fd477', label: '$' },
      pistol: { color: '#ffcf33' }, smg: { color: '#ffcf33' }, shotgun: { color: '#ff9f33' }, rpg: { color: '#ff4d4d' }, minigun: { color: '#ff33cc' },
    };
    for (const s of this.world.spawns.pickups) {
      const d = defs[s.type];
      const grp = new THREE.Group();
      const core = new THREE.Mesh(s.type === 'health' ? new THREE.BoxGeometry(0.9, 0.3, 0.3) : s.type === 'armor' ? new THREE.OctahedronGeometry(0.45) : s.type === 'cash' ? new THREE.BoxGeometry(0.6, 0.3, 0.3) : new THREE.BoxGeometry(0.2, 0.3, 1.0),
        new THREE.MeshBasicMaterial({ color: d.color }));
      grp.add(core);
      if (s.type === 'health') { const c2 = core.clone(); c2.rotation.z = Math.PI / 2; grp.add(c2); }
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      halo.position.y = -0.7;
      grp.add(halo);
      const y = s.y || this.world.groundHeight(s.x, s.z, 500, 0.5);
      grp.position.set(s.x, y + 1, s.z);
      this.scene.add(grp);
      this.pickups.push({ ...s, y, grp, active: true, respawn: 0, color: d.color });
    }
  }

  updatePickups(dt) {
    const p = this.player, pp = p.worldPos;
    const t = this.time;
    for (const pk of this.pickups) {
      if (!pk.active) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) { pk.active = true; pk.grp.visible = true; }
        continue;
      }
      pk.grp.rotation.y = t * 2;
      pk.grp.position.y = pk.y + 1 + Math.sin(t * 3 + pk.x) * 0.15;
      if (p.dead) continue;
      if (Math.abs(pp.x - pk.x) < 2 && Math.abs(pp.z - pk.z) < 2 && Math.abs(pp.y - pk.y) < 3) {
        const onFoot = !p.vehicle;
        if (!onFoot && !['cash', 'health', 'armor'].includes(pk.type)) continue;
        if (pk.type === 'health') { if (p.health >= 100) continue; p.health = 100; }
        else if (pk.type === 'armor') { if (p.armor >= 100) continue; p.armor = 100; }
        else if (pk.type === 'cash') p.money += 2500;
        else { p.giveWeapon(pk.type); this.hud.weaponChanged(); this.hud.help(`Picked up <b>${WEAPONS[pk.type].name}</b>`, 2.5); }
        this.audio.pickup();
        pk.active = false; pk.grp.visible = false; pk.respawn = 60;
      }
    }
    // dropped cash
    for (const c of this.cash) {
      c.t -= dt;
      c.m.rotation.y += dt * 3;
      if (!p.dead && dist2(pp.x, pp.z, c.m.position.x, c.m.position.z) < 1.8 && Math.abs(pp.y - c.m.position.y) < 3) {
        p.money += c.amount; this.audio.cash(); c.t = 0;
      }
      if (c.t <= 0) this.scene.remove(c.m);
    }
    this.cash = this.cash.filter((c) => c.t > 0);
  }

  dropCash(x, y, z, amount) {
    if (!this.cashGeo) { this.cashGeo = new THREE.BoxGeometry(0.35, 0.12, 0.2); this.cashMat = new THREE.MeshBasicMaterial({ color: 0x5fdc5f }); }
    const m = new THREE.Mesh(this.cashGeo, this.cashMat);
    m.position.set(x, Math.max(y, 0.1) + 0.25, z);
    this.scene.add(m);
    this.cash.push({ m, amount, t: 30 });
  }

  // ------------------------------------------------------------- vehicles
  enterVehicle(v, instant = false) {
    const p = this.player;
    if (v.driver === 'ai') {
      // carjack!
      const side = -1;
      const dx = Math.cos(v.h) * side * -(v.T.wid / 2 + 1), dz = -Math.sin(v.h) * side * -(v.T.wid / 2 + 1);
      if (!v.isHeli) {
        const ped = new Ped(this, v.pos.x + dx, v.pos.z + dz, { city: this.world.inCity(v.pos.x, v.pos.z)?.key, kind: v.isPolice ? 'cop' : 'civ' });
        if (!v.isPolice) ped.scare(v.pos.x, v.pos.z, 15);
        this.peds.push(ped);
      }
      if (!instant) this.wanted.report(v.isPolice ? 'stealCop' : 'carjack', v.pos.x, v.pos.z);
      if (this.wanted.units.includes(v)) this.wanted.units = this.wanted.units.filter((u) => u !== v);
    } else if (v.isPolice && !instant) this.wanted.report('stealCop', v.pos.x, v.pos.z);
    if (v.type === 'tank' && !instant) this.wanted.report('tank', v.pos.x, v.pos.z);
    v.ai = null;
    v.driver = 'player';
    v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = false;
    if (v.parkSpot) { v.parkSpot.vehicle = null; v.parkSpot.cooldown = true; v.parkSpot = null; }
    if (v.specialSpawn) { v.specialSpawn.vehicle = null; v.specialSpawn = null; }
    v.persistent = true;
    if (this.lastVehicle && this.lastVehicle !== v) this.lastVehicle.persistent = false;
    this.lastVehicle = v;
    if (v.isHeli && v.rotorSpeed < 0.3) v.rotorSpeed = 0.3;
    p.vehicle = v;
    this.cam.yaw = v.h; this.cam.pitch = v.isHeli ? 0.3 : 0.2; this.cam.idle = 0;
    p.closeChute();
    p.group.visible = false;
    this.stats.cars++;
    this.hud.vehicleName(v.T.name);
    this.audio.setMusicAudible(true);
    if (this.audio.station !== 3) this.hud.radio(STATIONS[this.audio.station]);
    if (v.type === 'tank') this.hud.help('<b>TANK</b>: Aim with the mouse, <b>LMB</b> fires the cannon. Drive over cars to crush them.', 5);
    else if (v.type === 'heli') this.hud.help('<b>HELICOPTER</b>: <b>Space</b> climb, <b>Shift</b> descend, <b>W/S</b> tilt, <b>A/D</b> turn. <b>LMB</b> fires rockets.', 6);
    else if (v.type === 'policeHeli') this.hud.help('<b>HELICOPTER</b>: <b>Space</b> climb, <b>Shift</b> descend, <b>W/S</b> tilt, <b>A/D</b> turn.', 6);
    else if (v.type === 'monster') this.hud.help('<b>MONSTER TRUCK</b>: Drive over cars to crush them. <b>Shift</b> for nitro.', 5);
  }

  exitVehicle(force = false) {
    const p = this.player, v = p.vehicle;
    if (!v) return;
    const sp = v.speed;
    const lx = Math.cos(v.h), lz = -Math.sin(v.h); // left side
    const off = v.T.wid / 2 + 0.9;
    let x = v.pos.x + lx * off, z = v.pos.z + lz * off;
    const o = this.world.collideCircle(x, z, v.pos.y, 0.4, 0.5, {});
    x = o.x; z = o.z;
    p.pos.set(x, v.pos.y + (v.isHeli ? 0 : 0.3), z);
    p.h = v.h;
    p.vx = v.vx * (sp > 12 && !v.isHeli ? 0.5 : 1); p.vz = v.vz * (sp > 12 && !v.isHeli ? 0.5 : 1); p.vy = v.vy;
    p.grounded = false;
    if (sp > 12 && !v.isHeli && !force) {
      p.vx += lx * 4; p.vz += lz * 4; p.vy = 3;
      p.damage(Math.min(30, sp * 0.8), 'fall');
      this.hud.help('You <b>bailed out</b>!', 2);
    }
    v.driver = null;
    v.input.throttle = 0; v.input.steer = 0; v.input.nitro = false; v.input.lift = 0; v.input.pitch = 0; v.input.yaw = 0;
    v.siren = false;
    p.vehicle = null;
    p.group.visible = true;
    this.audio.setMusicAudible(false);
    this.audio.setHorn(false);
    this.audio.setEngine(false, 0, 0);
    this.audio.setScreech(0);
    this.cam.yaw = v.h;
  }

  // -------------------------------------------------------------- combat
  aimPoint() {
    if (this._aimFrame === this.frame) return this._aim;
    this._aimFrame = this.frame;
    const cam = this.camera;
    const d = new THREE.Vector3();
    cam.getWorldDirection(d);
    const o = cam.position;
    // skip the first few metres so we don't hit ourselves
    const start = this.player.vehicle ? this.cam.dist * 0.8 : 1.5;
    let best = this.world.raycast(o.x + d.x * start, o.y + d.y * start, o.z + d.z * start, d.x, d.y, d.z, 400, 1.5) + start;
    const hit = this.rayTargets(o.x, o.y, o.z, d.x, d.y, d.z, best, 'player');
    if (hit) best = hit.t;
    this._aim = new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
    return this._aim;
  }

  // ray vs peds/vehicles/player. Returns nearest {t, ped|vehicle|player, head}
  rayTargets(ox, oy, oz, dx, dy, dz, maxT, source, ignore) {
    let best = null, bt = maxT;
    const sphere = (cx, cy, cz, r) => {
      const lx = cx - ox, ly = cy - oy, lz = cz - oz;
      const tca = lx * dx + ly * dy + lz * dz;
      if (tca < 0) return -1;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      if (d2 > r * r) return -1;
      return tca - Math.sqrt(r * r - d2);
    };
    for (const p of this.peds) {
      if (!p.alive || p === ignore) continue;
      if (Math.abs(p.pos.x - ox) > maxT + 2 && Math.abs(p.pos.z - oz) > maxT + 2) continue;
      const hs = [[0.55, 0.35], [1.2, 0.38], [1.8, 0.2]];
      for (let i = 0; i < 3; i++) {
        const t = sphere(p.pos.x, p.pos.y + hs[i][0], p.pos.z, hs[i][1]);
        if (t > 0 && t < bt) { bt = t; best = { t, ped: p, head: i === 2 }; }
      }
    }
    const pv = this.player.vehicle;
    for (const v of this.vehicles) {
      if (v.removed || (source === 'player' && v === pv) || v === ignore) continue;
      const dd = Math.hypot(v.pos.x - ox, v.pos.z - oz);
      if (dd > maxT + 8) continue;
      const sh = Math.sin(v.h), ch = Math.cos(v.h);
      if (v.isHeli) {
        const t = sphere(v.pos.x, v.pos.y + 1.2, v.pos.z, 2.2);
        if (t > 0 && t < bt) { bt = t; best = { t, vehicle: v }; }
        continue;
      }
      for (const off of v.circles) {
        const t = sphere(v.pos.x + sh * off, v.pos.y + v.T.hgt * 0.45, v.pos.z + ch * off, v.cr + 0.2);
        if (t > 0 && t < bt) { bt = t; best = { t, vehicle: v }; }
      }
    }
    if (source !== 'player' && !this.player.dead) {
      const p = this.player;
      if (p.vehicle) {
        const v = p.vehicle;
        const t = sphere(v.pos.x, v.pos.y + v.T.hgt * 0.5, v.pos.z, v.isHeli ? 2.3 : v.T.len * 0.45);
        if (t > 0 && t < bt) { bt = t; best = { t, vehicle: v }; }
      } else {
        for (const [yy, r] of [[0.6, 0.4], [1.3, 0.45]]) {
          const t = sphere(p.pos.x, p.pos.y + yy, p.pos.z, r);
          if (t > 0 && t < bt) { bt = t; best = { t, player: true }; }
        }
      }
    }
    return best;
  }

  fireBullet(ox, oy, oz, dx, dy, dz, dmg, range, source, force = 2, tracer = true) {
    let t = this.world.raycast(ox, oy, oz, dx, dy, dz, range, 1.0);
    const hit = this.rayTargets(ox, oy, oz, dx, dy, dz, t, source);
    const explosive = source === 'player' && this.cheats.explosiveAmmo;
    if (hit) {
      t = hit.t;
      const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
      if (hit.ped) {
        const killBefore = hit.ped.alive;
        hit.ped.hit(dmg * (hit.head ? 3 : 1), dx, dz, source, { force });
        if (source === 'player') this.hud.hitMarker(killBefore && !hit.ped.alive);
      } else if (hit.vehicle) {
        hit.vehicle.damage(dmg * 1.2, source === 'player' ? 'player' : 'shot');
        this.fx.sparks(hx, hy, hz, 4);
        if (source === 'player') {
          this.hud.hitMarker(false);
          const v = hit.vehicle;
          if (v.isPolice) this.wanted.report('copAssault', v.pos.x, v.pos.z);
          if (v.ai && v.ai.mode === 'traffic') v.ai.panic = 8;
        } else if (hit.vehicle === this.player.vehicle && Math.random() < 0.25) this.player.damage(dmg * 0.4, 'shot');
      } else if (hit.player) {
        this.player.damage(dmg, 'shot');
      }
      if (explosive) this.explosion(hx, hy, hz, 0.5, 'player');
    } else if (t < range) {
      const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
      this.fx.impact(hx, hy, hz);
      const n = this.world.hitNormal(hx, hy, hz, dx, dy, dz, this._hitN || (this._hitN = new THREE.Vector3()));
      if (n) this.fx.bulletHole(hx, hy, hz, n);
      if (explosive) this.explosion(hx, hy, hz, 0.5, 'player');
    }
    if (tracer) this.fx.tracer(ox, oy, oz, ox + dx * Math.min(t, range), oy + dy * Math.min(t, range), oz + dz * Math.min(t, range), source === 'player' ? [1, 0.85, 0.5] : [1, 0.5, 0.4]);
  }

  // NPC fire at the player with distance-based inaccuracy
  npcShoot(ox, oy, oz, target, acc, dmg, sound, ignore) {
    const p = this.player;
    const moving = p.vehicle ? p.vehicle.speed : Math.hypot(p.vx, p.vz);
    const d = Math.hypot(target.x - ox, target.z - oz);
    const miss = (1 - acc) * (0.6 + d / 60) + moving * 0.015;
    let tx = target.x + rand(-miss, miss) * 3, ty = target.y + 1.1 + rand(-miss, miss) * 2, tz = target.z + rand(-miss, miss) * 3;
    let dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    this.audio.shot(sound, dist2(ox, oz, p.worldPos.x, p.worldPos.z));
    this.fx.muzzle(ox + dx * 0.5, oy + dy * 0.5, oz + dz * 0.5, dx, dy, dz);
    let t = this.world.raycast(ox, oy, oz, dx, dy, dz, 160, 1.5);
    const hit = this.rayTargets(ox, oy, oz, dx, dy, dz, t, 'npc', ignore);
    if (hit) {
      t = hit.t;
      if (hit.player) this.player.damage(dmg, 'shot');
      else if (hit.vehicle) {
        hit.vehicle.damage(dmg * 1.2, 'shot');
        if (hit.vehicle === p.vehicle && Math.random() < 0.3) p.damage(dmg * 0.5, 'shot');
        this.fx.sparks(ox + dx * t, oy + dy * t, oz + dz * t, 3);
      } else if (hit.ped) hit.ped.hit(dmg, dx, dz, 'npc');
    }
    this.fx.tracer(ox, oy, oz, ox + dx * t, oy + dy * t, oz + dz * t, [1, 0.45, 0.35]);
  }

  pedShoot(ped, target) {
    const acc = ped.kind === 'swat' ? 0.6 : ped.kind === 'cop' ? 0.45 : 0.35;
    const ox = ped.pos.x + Math.sin(ped.h) * 0.6, oz = ped.pos.z + Math.cos(ped.h) * 0.6;
    this.npcShoot(ox, ped.pos.y + 1.55, oz, target, acc, ped.kind === 'swat' ? 9 : 7, ped.kind === 'swat' ? 'smg' : 'pistol', ped);
  }
  copCarShoot(v, target) {
    this.npcShoot(v.pos.x, v.pos.y + 1.4, v.pos.z, target, 0.4, 7, 'pistol', v);
  }
  heliShoot(v, target) {
    this.npcShoot(v.pos.x, v.pos.y - 0.5, v.pos.z, target, 0.35, 6, 'smg', v);
  }

  spawnCopsFromCar(v) {
    const onFoot = this.peds.filter((p) => p.alive && (p.kind === 'cop' || p.kind === 'swat')).length;
    const n = Math.min(v.swat ? 4 : 2, Math.max(0, 2 + this.wanted.level * 2 - onFoot));
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = v.pos.x + Math.cos(v.h) * side * 2.2, z = v.pos.z - Math.sin(v.h) * side * 2.2 + (i > 1 ? -2 : 0);
      const c = new Ped(this, x, z, { kind: v.swat ? 'swat' : 'cop' });
      c.state = 'attack';
      this.peds.push(c);
    }
    if (v.ai) v.ai.mode = 'parked';
    v.driver = null;
    v.ai = null;
  }

  tryBust(cop, dt) {
    const p = this.player;
    if (p.dead || p.vehicle) return;
    this.bustAcc = (this.bustAcc || 0) + dt * (Math.hypot(p.vx, p.vz) < 2.5 ? 1 : 0.35);
    this.bustSeen = this.time;
    if (this.bustAcc > 1.4) this.busted();
    else this.hud.hint('Cops are arresting you! Move!');
  }

  // ------------------------------------------------------------ projectiles
  spawnRocket(x, y, z, dx, dy, dz, source, opts = {}) {
    if (!this.rocketGeo) {
      this.rocketGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.9, 8).rotateX(Math.PI / 2);
      this.rocketMat = new THREE.MeshStandardMaterial({ color: 0x556b2f });
    }
    const m = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    m.position.set(x, y, z);
    m.lookAt(x + dx, y + dy, z + dz);
    this.scene.add(m);
    const speed = opts.speed || 75;
    this.rockets.push({ m, vx: dx * speed, vy: dy * speed, vz: dz * speed, t: 0, source, k: opts.k || 1, owner: opts.owner, shell: opts.shell });
    this.audio.shot(opts.shell ? 'cannon' : 'rpg', dist2(x, z, this.player.worldPos.x, this.player.worldPos.z));
  }

  updateRockets(dt) {
    for (const r of this.rockets) {
      r.t += dt;
      const p = r.m.position;
      const steps = 3;
      let boom = false;
      for (let s = 0; s < steps && !boom; s++) {
        p.x += r.vx * dt / steps; p.y += r.vy * dt / steps; p.z += r.vz * dt / steps;
        if (r.shell) r.vy -= 4 * dt / steps;
        if (this.world.solidAt(p.x, p.y, p.z) || p.y < this.world.groundHeight(p.x, p.z, p.y, 0)) boom = true;
        for (const v of this.vehicles) {
          if (boom || v.removed || v === r.owner) continue;
          if (Math.abs(v.pos.x - p.x) < v.radius + 0.5 && Math.abs(v.pos.z - p.z) < v.radius + 0.5 && p.y > v.pos.y - 0.5 && p.y < v.pos.y + v.T.hgt + 1) boom = true;
        }
        for (const pd of this.peds) {
          if (boom || !pd.alive) continue;
          if (Math.abs(pd.pos.x - p.x) < 0.8 && Math.abs(pd.pos.z - p.z) < 0.8 && p.y > pd.pos.y && p.y < pd.pos.y + 2) boom = true;
        }
        if (r.source !== 'player' && !this.player.vehicle && dist2(p.x, p.z, this.player.pos.x, this.player.pos.z) < 1 && Math.abs(p.y - this.player.pos.y - 1) < 1.2) boom = true;
      }
      if (!r.shell || Math.random() < 0.5) this.fx.rocketTrail(p.x, p.y, p.z);
      if (boom || r.t > 6) {
        this.explosion(p.x, p.y, p.z, r.k, r.source);
        this.scene.remove(r.m);
        r.dead = true;
      }
    }
    this.rockets = this.rockets.filter((r) => !r.dead);
  }

  fireCannon(v, cam) {
    const aim = this.aimPoint();
    const bx = v.pos.x + Math.sin(v.turretYaw) * 6.2, bz = v.pos.z + Math.cos(v.turretYaw) * 6.2, by = v.pos.y + 2.65;
    let dx = aim.x - bx, dy = aim.y - by, dz = aim.z - bz;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    // keep the shell roughly along the turret
    this.fx.muzzle(bx, by, bz, dx, dy, dz, true);
    this.fx.smoke(bx, by, bz, 0.6);
    this.spawnRocket(bx, by, bz, dx, dy, dz, 'player', { speed: 140, k: 1.6, owner: v, shell: true });
    this.shake(0.5);
    v.vx -= Math.sin(v.turretYaw) * 1.5; v.vz -= Math.cos(v.turretYaw) * 1.5;
    this.onPlayerGunfire(bx, bz);
  }

  fireHeliRockets(v, cam) {
    const aim = this.aimPoint();
    this.heliSide = -(this.heliSide || 1);
    const s = this.heliSide * 1.4;
    const bx = v.pos.x + Math.cos(v.h) * s + Math.sin(v.h) * 1.5, bz = v.pos.z - Math.sin(v.h) * s + Math.cos(v.h) * 1.5, by = v.pos.y + 0.9;
    let dx = aim.x - bx, dy = aim.y - by, dz = aim.z - bz;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.spawnRocket(bx, by, bz, dx / l, dy / l, dz / l, 'player', { speed: 90, owner: v });
    this.onPlayerGunfire(bx, bz);
  }

  explosion(x, y, z, k = 1, source = 'world', ignoreVehicle = null) {
    const pp = this.player.worldPos;
    const dist = Math.hypot(x - pp.x, y - pp.y, z - pp.z);
    this.fx.explosion(x, y, z, k);
    this.audio.explosion(dist, Math.min(1.3, k));
    this.shake(clamp(1.4 * k - dist / 60, 0, 1.2));
    const R = 9 * k;
    const src = source === 'player' ? 'explosion-player' : 'explosion';
    for (const v of this.vehicles) {
      if (v.removed || v === ignoreVehicle) continue;
      const d = Math.hypot(v.pos.x - x, v.pos.y - y, v.pos.z - z);
      if (d > R + v.radius) continue;
      const f = clamp(1 - (d - v.radius) / R, 0.1, 1);
      if (source === 'player') v.lastHitByPlayer = true;
      const push = 14 * f / Math.sqrt(v.T.mass);
      const l = Math.hypot(v.pos.x - x, v.pos.z - z) || 1;
      v.vx += (v.pos.x - x) / l * push; v.vz += (v.pos.z - z) / l * push;
      if (!v.isHeli) { v.vy += 9 * f / Math.sqrt(v.T.mass); v.grounded = false; }
      v.damage(1800 * f * k, src);
    }
    for (const p of this.peds) {
      if (!p.alive && p.state !== 'ragdoll') continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d > R) { if (d < 60) p.scare(x, z, 10); continue; }
      const f = 1 - d / R;
      const l = d || 1;
      p.hit(200 * f + 40, (p.pos.x - x) / l, (p.pos.z - z) / l, src, { force: 16 * f + 5, up: 8 + 8 * f });
    }
    const p = this.player;
    if (!p.dead && !p.vehicle) {
      const d = Math.hypot(p.pos.x - x, p.pos.y - y, p.pos.z - z);
      if (d < R) {
        const f = 1 - d / R;
        p.damage(130 * f, 'explosion');
        const l = Math.hypot(p.pos.x - x, p.pos.z - z) || 1;
        p.vx += (p.pos.x - x) / l * 12 * f; p.vz += (p.pos.z - z) / l * 12 * f; p.vy = 6 * f; p.grounded = false;
      }
    }
    if (source === 'player') this.wanted.report('explosion', x, z);
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  // ----------------------------------------------------------- game events
  onPlayerGunfire(x, z) {
    this.wanted.report('gunfire', x, z);
    for (const p of this.peds) {
      const d = dist2(p.pos.x, p.pos.z, x, z);
      if (d < 45) p.scare(x, z, 10);
      if (p.kind === 'gang' && d < 30) p.hostile = true;
    }
    for (const v of this.vehicles) if (v.ai && v.ai.mode === 'traffic' && dist2(v.pos.x, v.pos.z, x, z) < 40) v.ai.panic = 6;
  }

  onPlayerHurtPed(ped, killed) {
    const cop = ped.kind === 'cop' || ped.kind === 'swat';
    this.wanted.report(killed ? (cop ? 'copKill' : 'murder') : (cop ? 'copAssault' : 'assault'), ped.pos.x, ped.pos.z);
    if (killed) ped.killedByPlayer = true;
  }

  onPedDied(ped) {
    if (ped.cash > 0) this.dropCash(ped.pos.x + rand(-0.5, 0.5), ped.pos.y, ped.pos.z + rand(-0.5, 0.5), ped.cash);
    if (ped.killedByPlayer) {
      this.stats.kills++;
      this.missions.onEvent('pedKilled', ped);
    }
  }

  onRoadkill() {}

  onVehicleDestroyed(v, drowned) {
    const p = this.player;
    if (v === p.vehicle) {
      if (drowned) {
        this.exitVehicle(true);
        p.pos.y = -1;
        this.hud.help('Your ride is <b>sleeping with the fishes</b>.', 3);
      } else if (!this.cheats.godmode) {
        this.exitVehicle(true);
        p.damage(999, 'explosion');
      } else this.exitVehicle(true);
    }
    if (v.lastHitByPlayer) {
      this.wanted.report(v.isPolice ? 'copKill' : 'vehicleKill', v.pos.x, v.pos.z);
      this.missions.onEvent('vehicleDestroyed', v);
    }
  }

  onVehicleCrash(v, impact, x, z) {
    this.fx.sparks(x, v.pos.y + 0.6, z, Math.min(30, impact * 1.5));
    this.audio.crash(impact, dist2(x, z, this.player.worldPos.x, this.player.worldPos.z));
    if (v === this.player.vehicle) this.shake(Math.min(0.8, impact / 40));
  }

  onVehicleCollision(a, b, vrel, x, z) {
    this.fx.sparks(x, (a.pos.y + b.pos.y) / 2 + 0.7, z, Math.min(30, vrel * 1.5));
    this.audio.crash(vrel, dist2(x, z, this.player.worldPos.x, this.player.worldPos.z));
    const pv = this.player.vehicle;
    if (a === pv || b === pv) {
      this.shake(Math.min(0.8, vrel / 35));
      const other = a === pv ? b : a;
      if (other.isPolice && vrel > 7) this.wanted.report('copAssault', other.pos.x, other.pos.z);
      if (other.ai && other.ai.mode === 'traffic') other.ai.panic = 8;
    }
  }

  onCrush(victim, crusher) {
    this.audio.crash(25, dist2(victim.pos.x, victim.pos.z, this.player.worldPos.x, this.player.worldPos.z));
    this.fx.sparks(victim.pos.x, victim.pos.y + 1, victim.pos.z, 30);
    if (crusher.driver === 'player') {
      this.missions.onEvent('crush', victim);
      this.shake(0.4);
      if (victim.isPolice) this.wanted.report('copAssault', victim.pos.x, victim.pos.z);
    }
  }

  onPlayerLanded(v, impact) {
    if (v.airTime > 0.8 && v.maxAir > 3) {
      const bonus = Math.floor(v.airTime * v.maxAir * 25);
      const insane = v.airTime > 1.8 || v.maxAir > 12;
      this.player.money += bonus;
      this.stats.stunts++;
      this.hud.stunt(insane ? 'INSANE STUNT BONUS!' : 'STUNT BONUS', `${v.airTime.toFixed(1)}s air • ${Math.round(v.maxAir)}m high • +${formatMoney(bonus)}`);
      this.audio.cash();
    }
    v.airTime = 0; v.maxAir = 0;
    if (impact > 8) this.shake(Math.min(0.9, impact / 30));
  }

  playerDied(source) {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    if (p.vehicle) this.exitVehicle(true);
    p.closeChute();
    p.group.visible = true;
    p.model.rig.rotation.set(-Math.PI / 2, 0, 0.2);
    p.model.rig.position.set(0, 0.2, 0);
    this.canvas.classList.add('wasted');
    this.hud.bigMessage('WASTED', '#c83232', 5);
    this.audio.wasted();
    this.audio.setMusicAudible(false);
    this.missions.onEvent('playerDied');
    this.respawnAt = this.time + 5;
    this.respawnKind = 'hospital';
  }

  busted() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    this.bustAcc = 0;
    this.canvas.classList.add('wasted');
    this.hud.bigMessage('BUSTED', '#4a8cff', 5);
    this.audio.wasted();
    this.missions.onEvent('busted');
    this.respawnAt = this.time + 5;
    this.respawnKind = 'police';
  }

  respawn() {
    const p = this.player, w = this.world;
    if (p.vehicle) this.exitVehicle(true);
    const list = this.respawnKind === 'police' ? w.spawns.police : w.spawns.hospitals;
    let best = list[0], bd = Infinity;
    for (const s of list) { const d = dist2(s.x, s.z, p.pos.x, p.pos.z); if (d < bd) { bd = d; best = s; } }
    const fee = this.respawnKind === 'police' ? 1000 : 500;
    p.money = Math.max(0, p.money - fee);
    if (this.respawnKind === 'police') {
      for (const k of Object.keys(p.weapons)) if (k !== 'fist' && k !== 'pistol') p.weapons[k] = Math.floor(p.weapons[k] / 2);
    }
    this.wanted.clear();
    for (const u of this.wanted.units) if (u.isHeli) u.remove();
    // clear aggressive cops
    for (const pd of this.peds) if (pd.kind === 'cop' || pd.kind === 'swat' || pd.hostile) pd.remove();
    this.peds = this.peds.filter((x) => !x.removed);
    p.dead = false;
    p.health = 100;
    p.armor = 0;
    p.vx = p.vz = p.vy = 0;
    p.pos.set(best.x, 0.3, best.z);
    p.worldPos.copy(p.pos);
    p.model.rig.rotation.set(0, 0, 0);
    p.model.rig.position.set(0, 0, 0);
    p.h = best.h || 0;
    this.cam.yaw = p.h + Math.PI;
    this.canvas.classList.remove('wasted');
    this.hud.help(this.respawnKind === 'police' ? `You were released on bail. <b>-${formatMoney(fee)}</b>` : `Hospital bill: <b>-${formatMoney(fee)}</b>`, 4);
    this.persist();
  }

  // --------------------------------------------------------------- cheats
  setupCheatConsole() {
    const box = document.getElementById('cheat'), inp = document.getElementById('cheatInput');
    const close = () => { box.classList.add('hidden'); this.input.typing = false; this.consoleOpen = false; inp.blur(); this.input.lock(); };
    this.openConsole = () => {
      box.classList.remove('hidden'); this.input.typing = true; this.consoleOpen = true;
      this.input.keys.clear();
      inp.value = '';
      if (document.pointerLockElement) document.exitPointerLock();
      setTimeout(() => inp.focus(), 10);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.applyCheat(inp.value.trim().toUpperCase()); close(); }
      if (e.key === 'Escape') close();
    });
  }

  applyCheat(code) {
    const p = this.player, pp = p.worldPos;
    const c = this.cheats;
    const ok = (name) => { this.hud.help(`Cheat activated: <b>${name}</b>`, 3); this.audio.cheat(); this.stats.cheats++; };
    const spawnNear = (type) => {
      const h = p.vehicle ? p.vehicle.h : p.h;
      const x = pp.x + Math.sin(h) * 8, z = pp.z + Math.cos(h) * 8;
      const o = this.world.collideCircle(x, z, 0, 3, 0.5, {});
      return this.spawnVehicle(type, o.x, o.z, h);
    };
    switch (code) {
      case 'HESOYAM': p.health = 100; p.armor = 100; p.money += 250000; if (p.vehicle) { p.vehicle.health = p.vehicle.T.hp; p.vehicle.onFire = false; } ok('Health, armor, $250k'); break;
      case 'TURTLE': p.health = 100; p.armor = 100; ok('Max health & armor'); break;
      case 'PAINKILLER': c.godmode = !c.godmode; ok(`Invincibility ${c.godmode ? 'ON' : 'OFF'}`); break;
      case 'TOOLUP': for (const w of ['pistol', 'smg', 'shotgun', 'rpg', 'minigun']) p.giveWeapon(w); p.weapon = 'rpg'; this.hud.weaponChanged(); ok('All weapons'); break;
      case 'FULLCLIP': c.infiniteAmmo = !c.infiniteAmmo; ok(`Infinite ammo ${c.infiniteAmmo ? 'ON' : 'OFF'}`); break;
      case 'LAWYERUP': this.wanted.set(0); ok('Wanted level cleared'); break;
      case 'FUGITIVE': this.wanted.locked = false; this.wanted.set(this.wanted.level + 1); ok('Wanted level raised'); break;
      case 'LEAVEMEALONE': c.neverWanted = !c.neverWanted; if (c.neverWanted) this.wanted.set(0); ok(`Never wanted ${c.neverWanted ? 'ON' : 'OFF'}`); break;
      case 'SKYFALL':
        if (p.vehicle) this.exitVehicle(true);
        p.pos.y = 800; p.vy = 0; p.grounded = false; p.chuteState = 'none'; ok('Skyfall — press SPACE for parachute'); break;
      case 'COMET': spawnNear('sports'); ok('Comet X'); break;
      case 'BUZZOFF': spawnNear('heli').rotorSpeed = 1; ok('Hornet attack helicopter'); break;
      case 'RHINO': spawnNear('tank'); ok('Tank'); break;
      case 'MONSTER': spawnNear('monster'); ok('Mardi Monster'); break;
      case 'ROCKET': spawnNear('bike'); ok('Hellcat 1000 bike'); break;
      case 'CATCHME': c.fastRun = !c.fastRun; ok(`Fast run ${c.fastRun ? 'ON' : 'OFF'}`); break;
      case 'HOPTOIT': c.superJump = !c.superJump; ok(`Super jump ${c.superJump ? 'ON' : 'OFF'}`); break;
      case 'FLOATER': c.moonGravity = !c.moonGravity; ok(`Moon gravity ${c.moonGravity ? 'ON' : 'OFF'}`); break;
      case 'SLOWMO': c.slowmo = !c.slowmo; ok(`Slow motion ${c.slowmo ? 'ON' : 'OFF'}`); break;
      case 'MAKEITRAIN': this.fx.setRain(this.fx.raining > 0 ? 0 : 1); ok(`Rain ${this.fx.raining ? 'ON' : 'OFF'}`); break;
      case 'TIMEWARP': this.hour = (this.hour + 6) % 24; ok('Skipped 6 hours'); break;
      case 'TIMELAPSE': c.timelapse = !c.timelapse; ok(`Timelapse ${c.timelapse ? 'ON' : 'OFF'}`); break;
      case 'HIGHEX': c.explosiveAmmo = !c.explosiveAmmo; ok(`Explosive bullets ${c.explosiveAmmo ? 'ON' : 'OFF'}`); break;
      case 'HOTHANDS': c.explosivePunch = !c.explosivePunch; ok(`Explosive punches ${c.explosivePunch ? 'ON' : 'OFF'}`); break;
      case 'SPEEDFREAK': c.fastCars = !c.fastCars; ok(`Turbo vehicles ${c.fastCars ? 'ON' : 'OFF'}`); break;
      case 'SLIPPERY': c.drift = !c.drift; ok(`Drift mode ${c.drift ? 'ON' : 'OFF'}`); break;
      case 'ARMAGEDDON': c.armageddon = 20; ok('ARMAGEDDON. Good luck.'); break;
      case 'RIOT':
        for (const pd of this.peds) if (pd.alive && pd.kind === 'civ') { pd.kind = 'gang'; pd.hostile = true; pd.model.gun.visible = true; }
        ok('Riot mode');
        break;
      default: this.hud.help(`Unknown cheat: <b>${code || '—'}</b>`, 2); this.audio.ui();
    }
  }

  updateArmageddon(dt) {
    const c = this.cheats;
    if (!c.armageddon) return;
    c.armageddon -= dt;
    if (c.armageddon <= 0) { c.armageddon = 0; return; }
    const pp = this.player.worldPos;
    if (Math.random() < dt * 4) {
      const a = rand(0, Math.PI * 2), r = rand(15, 90);
      this.spawnRocket(pp.x + Math.cos(a) * r + rand(-10, 10), 160, pp.z + Math.sin(a) * r, rand(-0.1, 0.1), -1, rand(-0.1, 0.1), 'world', { speed: 90, k: 1.3 });
    }
    if (Math.random() < dt * 1.5) {
      const near = this.vehicles.filter((v) => !v.dead && v !== this.player.vehicle && dist2(v.pos.x, v.pos.z, pp.x, pp.z) < 80);
      if (near.length) pick(near).explode();
    }
  }

  // --------------------------------------------------------------- camera
  updateCamera(dt) {
    const cam = this.cam, input = this.input, p = this.player, v = p.vehicle;
    const sens = 0.0024;
    const mdx = input.mouse.dx, mdy = input.mouse.dy;
    cam.yaw -= mdx * sens;
    cam.pitch = clamp(cam.pitch + mdy * sens, -0.9, 1.35);
    if (Math.abs(mdx) + Math.abs(mdy) > 0.5) cam.idle = 0; else cam.idle += dt;
    if (input.pressed('KeyV')) {
      cam.mode = (cam.mode + 1) % 3;
      this.hud.help(cam.mode === 0 ? 'Camera: <b>first person</b>' : 'Camera: <b>third person</b>', 1.5);
    }
    if (cam.mode === 0 && !p.dead) { this.updateFirstPerson(dt); return; }
    this.viewmodel.visible = false;
    this.camera.near = 0.3;
    let target = new THREE.Vector3();
    let dist, fov = 70, shoulder = 0;
    if (v) {
      const T = v.T;
      target.set(v.pos.x, v.pos.y + T.hgt * 0.75 + (v.isHeli ? 1.5 : 0.8), v.pos.z);
      dist = (v.isHeli ? 15 : T.len * 1.2 + 3.8) * [1, 1, 1.6][cam.mode];
      if (T.style === 'bike') dist = 5.2 * [1, 1, 1.6][cam.mode];
      if (cam.idle > 1.0 && (v.speed > 3 || v.isHeli)) {
        const back = v.forwardSpeed < -2 && !v.isHeli;
        const velH = Math.atan2(v.vx, v.vz);
        const heading = back ? v.h : v.speed > 8 && !v.isHeli && v.grounded ? smoothAngleMix(v.h, velH, 0.5) : v.h;
        cam.yaw = smoothAngle(cam.yaw, heading, v.isHeli ? 1.5 : 3.2, dt);
        cam.pitch = smoothDamp(cam.pitch, v.isHeli ? 0.3 : 0.17, 2, dt);
      }
      const sp = v.speed;
      fov = 70 + clamp(sp - 15, 0, 50) * 0.35 + (v.input.nitro && p.nitro > 0 ? 8 : 0);
    } else {
      target.set(p.pos.x, p.pos.y + (p.swimming ? 0.6 : 1.65), p.pos.z);
      dist = (p.aiming ? 2.4 : 4.4) * [1, 1, 1.5][cam.mode];
      shoulder = p.aiming ? 0.75 : 0.45;
      fov = p.aiming ? 52 : 70;
      if (p.chuteState === 'open') { dist = 9; }
      if (p.dead) { dist = 7; cam.yaw += dt * 0.3; }
    }
    cam.fov = smoothDamp(cam.fov, fov, 5, dt);
    cam.dist = smoothDamp(cam.dist, dist, 6, dt);
    const cp = Math.cos(cam.pitch), spch = Math.sin(cam.pitch);
    const fx = Math.sin(cam.yaw) * cp, fy = -spch, fz = Math.cos(cam.yaw) * cp;
    const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
    target.x += rx * shoulder; target.z += rz * shoulder;
    // collide the boom with buildings
    let d = cam.dist;
    const hit = this.world.raycast(target.x, target.y, target.z, -fx, -fy, -fz, d, 0.5);
    if (hit < d) d = Math.max(0.8, hit - 0.4);
    let px = target.x - fx * d, py = target.y - fy * d, pz = target.z - fz * d;
    const gh = this.world.groundHeight(px, pz, py, 0) + 0.4;
    if (py < gh) py = gh;
    // shake
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt;
      px += rand(-s, s) * 0.5; py += rand(-s, s) * 0.5; pz += rand(-s, s) * 0.5;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    }
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(target.x + fx * 10, target.y + fy * 10, target.z + fz * 10);
    if (this.cheats.drunk) this.camera.rotation.z += Math.sin(this.time * 1.3) * 0.08;
    this.camera.fov = cam.fov;
    if (this.debugCam) { const d = this.debugCam; this.camera.position.set(d.pos.x, d.pos.y, d.pos.z); this.camera.lookAt(d.look.x, d.look.y, d.look.z); this.camera.fov = 60; }
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------- first person
  buildViewmodel() {
    this.vm = buildViewmodel(this.vmCamera, this.vmScene);
    this.vm.kick = 0; this.vm.swayX = 0; this.vm.swayY = 0; this.vm.lastYaw = 0; this.vm.lastPitch = 0; this.vm.flashT = 0;
    this.vm.right.add(this.vm.tip);
    this._invQ = new THREE.Quaternion();
    this.viewmodel = this.vm.group;
  }

  fpMuzzle() {
    const p = this.player, G = this.vm.guns[p.weapon];
    const cp = this.camera.position;
    if (!G) return cp.clone();
    this.vm.tip.position.set(0, BORE[p.weapon] || 0.05, G.muzzle);
    this.vm.group.updateMatrixWorld(true);
    // the gun lives in its own camera space: map the tip through the screen into the world
    const v = this.vm.tip.getWorldPosition(new THREE.Vector3()).project(this.vmCamera);
    v.z = 0.5;
    this.camera.updateMatrixWorld();
    v.unproject(this.camera).sub(cp).normalize();
    return v.multiplyScalar(0.7).add(cp);
  }

  // called by the player on every shot to kick the view model
  vmShot() {
    const vm = this.vm, w = this.player.weapon;
    vm.kick = Math.min(1.2, vm.kick + (w === 'shotgun' || w === 'rpg' ? 1 : w === 'pistol' ? 0.6 : w === 'minigun' ? 0.15 : 0.3));
    vm.flashT = w === 'rpg' ? 0.09 : 0.05;
    vm.flash.rotation.z = Math.random() * Math.PI;
    const s = w === 'shotgun' || w === 'rpg' ? 1.8 : w === 'pistol' ? 0.9 : 1.1;
    vm.flash.scale.setScalar(s * (0.8 + Math.random() * 0.4));
  }

  updateFirstPerson(dt) {
    const cam = this.cam, p = this.player, v = p.vehicle;
    let ex, ey, ez, fov = 75;
    if (v) {
      const T = v.T;
      const sh = Math.sin(v.h), ch = Math.cos(v.h);
      // driver seat: left of centre, a little behind the middle, just under the roof
      const side = v.isHeli ? 0.45 : T.style === 'bike' ? 0 : T.wid * 0.22;
      const back = v.isHeli ? -2.3 : T.style === 'bike' ? 0.25 : T.style === 'bus' ? -T.len * 0.42 : T.len * 0.08;
      const lift = T.style === 'monster' ? 1.5 : 0;
      const up = v.isHeli ? 2.3 : T.style === 'bike' ? 1.55 : T.style === 'bus' ? 2.5 : T.style === 'tank' ? 3.1 : T.style === 'van' ? 1.9 : Math.max(T.hgt * 0.85, 1.12) + lift;
      ex = v.pos.x + ch * side - sh * back;
      ez = v.pos.z - sh * side - ch * back;
      ey = v.pos.y + up;
      if (v.parts.rider) v.parts.rider.visible = false;
      if (cam.idle > 1.0 && (v.speed > 3 || v.isHeli)) {
        const reversing = v.forwardSpeed < -2 && !v.isHeli;
        cam.yaw = smoothAngle(cam.yaw, reversing ? v.h + Math.PI : v.h, v.isHeli ? 1.5 : 4, dt);
        cam.pitch = smoothDamp(cam.pitch, v.isHeli ? 0.25 : 0.04, 2, dt);
      }
      fov = 75 + clamp(v.speed - 15, 0, 50) * 0.3 + (v.input.nitro && p.nitro > 0 ? 8 : 0);
    } else {
      const moving = Math.hypot(p.vx, p.vz);
      const bob = p.grounded ? Math.sin(p.phase * 2) * 0.035 * Math.min(1, moving / 5) : 0;
      ex = p.pos.x + Math.sin(cam.yaw) * 0.15;
      ez = p.pos.z + Math.cos(cam.yaw) * 0.15;
      ey = p.pos.y + (p.swimming ? 0.55 : 1.68) + bob;
      const Gv = this.vm.guns[p.weapon];
      fov = 75 + ((Gv ? Gv.adsFov : 65) - 75) * p.adsK + p.sprintK * 6;
      p.group.visible = false;
    }
    cam.pitch = clamp(cam.pitch, -1.35, 1.35);
    const cp = Math.cos(cam.pitch);
    const fx = Math.sin(cam.yaw) * cp, fy = -Math.sin(cam.pitch), fz = Math.cos(cam.yaw) * cp;
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * 0.3;
      ex += rand(-s, s); ey += rand(-s, s); ez += rand(-s, s);
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    }
    cam.fov = smoothDamp(cam.fov, fov, 6, dt);
    this.camera.near = 0.1;
    this.camera.position.set(ex, ey, ez);
    this.camera.lookAt(ex + fx, ey + fy, ez + fz);
    if (v && !v.isHeli) this.camera.rotateZ(-v.rollVis * 0.6);
    this.camera.fov = cam.fov;
    this.camera.updateProjectionMatrix();

    // hands and gun
    const vm = this.vm;
    this.viewmodel.visible = !v && p.chuteState !== 'open' && !p.dead;
    if (!this.viewmodel.visible) return;
    const melee = p.weapon === 'fist';
    const G = vm.guns[p.weapon];
    for (const [k, gg] of Object.entries(vm.guns)) gg.g.visible = k === p.weapon;
    vm.rHand.visible = !melee;
    vm.rightFist.visible = melee;
    vm.leftFree.visible = melee;
    const twoHanded = !melee && p.weapon !== 'pistol';
    vm.leftSupport.visible = twoHanded;
    const moving = Math.hypot(p.vx, p.vz);
    const sway = p.grounded ? Math.min(1, moving / 5) : 0;
    const ads = p.adsK;
    const bobK = sway * (1 - ads * 0.85) * (p.sprinting ? 2 : 1);
    const bx = Math.cos(p.phase) * 0.012 * bobK, by = Math.abs(Math.sin(p.phase)) * 0.012 * bobK;
    // breathing and mouse-look lag
    const t = this.time;
    const breathe = Math.sin(t * 1.6) * 0.003 * (1 - ads * 0.7);
    const dYaw = wrapAngle(cam.yaw - vm.lastYaw), dPitch = cam.pitch - vm.lastPitch;
    vm.lastYaw = cam.yaw; vm.lastPitch = cam.pitch;
    vm.swayX = smoothDamp(vm.swayX, clamp(dYaw * 1.5, -0.04, 0.04) * (1 - ads * 0.8), 10, dt);
    vm.swayY = smoothDamp(vm.swayY, clamp(-dPitch * 1.5, -0.04, 0.04) * (1 - ads * 0.8), 10, dt);
    vm.kick = Math.max(0, vm.kick - dt * 7);
    const kick = vm.kick;
    const sprint = p.sprintK;
    if (melee) {
      // fists come up when you throw a punch and drop out of view again after a moment
      const guard = clamp(1.5 - (performance.now() - p.lastShot) / 1000, 0, 1);
      vm.guard = smoothDamp(vm.guard || 0, guard, 8, dt);
      const low = (1 - vm.guard) * 0.3;
      vm.right.position.set(0.2 + bx, -0.22 + by + breathe - low, -0.42);
      vm.right.rotation.set(0.1, 0, 0);
      if (p.punchT > 0) vm.right.position.z -= Math.sin((0.3 - p.punchT) / 0.3 * Math.PI) * 0.22;
      vm.leftFree.position.set(-0.2 + bx, -0.22 + by + breathe - low, -0.44);
      vm.leftFree.rotation.set(0.1, 0, 0);
    } else {
      const hp = G.hipPos;
      const x = hp[0] + (0 - hp[0]) * ads, y = hp[1] + (-G.sightY - hp[1]) * ads, z = hp[2] + (-G.ads - hp[2]) * ads;
      // reload: gun tilts and drops, magazine comes out and goes back in
      let rl = 0, rr = 0;
      if (p.reloadT > 0) { rr = 1 - p.reloadT / p.reloadDur; rl = Math.sin(Math.PI * rr); }
      vm.right.position.set(
        x + bx - vm.swayX - rl * 0.03 - sprint * 0.06,
        y + by + breathe + vm.swayY - rl * 0.07 - sprint * 0.05,
        z + kick * (0.04 + (1 - ads) * 0.03) + rl * 0.04,
      );
      vm.right.rotation.set(kick * 0.12 + rl * 0.35 - sprint * 0.5, -0.04 * (1 - ads) + sprint * 0.7, rl * 0.7 + sprint * 0.2);
      // magazine / pump / warhead animation
      if (G.mag) G.mag.position.y = rr > 0.15 && rr < 0.65 ? -Math.sin((rr - 0.15) / 0.5 * Math.PI) * 0.22 : 0;
      if (G.warhead) G.warhead.visible = !(p.clip.rpg === 0 && p.reloadT <= 0) && !(rr > 0.1 && rr < 0.55);
      if (G.pump) G.pump.position.z = p.pumpT > 0 ? Math.sin((1 - p.pumpT / 0.5) * Math.PI) * 0.08 : rl > 0 && p.weapon === 'shotgun' ? Math.abs(Math.sin(rr * Math.PI * 6)) * 0.05 : 0;
      if (G.support) {
        const sup = G.support;
        // during a reload the support hand fetches a new magazine
        const mag = rr > 0.1 && rr < 0.7 ? Math.sin((rr - 0.1) / 0.6 * Math.PI) : 0;
        vm.leftSupport.position.set(sup[0] - mag * 0.05, sup[1] - mag * 0.2, sup[2] + mag * 0.12 + (G.pump && G.pump.position.z ? G.pump.position.z : 0));
      }
      if (G.barrels && this.input.mouse.left && p.reloadT <= 0) G.barrels.rotation.z += dt * 40;
    }
    // muzzle flash
    vm.flashT -= dt;
    const fl = vm.flashT > 0 && !melee;
    vm.flash.visible = fl;
    if (G) vm.flash.position.set(0, BORE[p.weapon] || 0.05, G.muzzle - 0.05);
    vm.light.position.copy(vm.flash.position);
    vm.light.intensity = fl ? 3 : 0;
    // light the gun like the world around it (sun direction in camera space)
    this.vmHemi.color.copy(this.hemi.color); this.vmHemi.groundColor.copy(this.hemi.groundColor);
    this.vmHemi.intensity = this.hemi.intensity + (this.scene.environmentIntensity || 0) * 0.6;
    this.vmSun.color.copy(this.sun.color); this.vmSun.intensity = this.sun.intensity * 0.8;
    this.vmSun.position.subVectors(this.sun.position, this.sun.target.position).normalize()
      .applyQuaternion(this._invQ.copy(this.camera.quaternion).invert());
    this.vmScene.environment = this.scene.environment;
    this.vmScene.environmentIntensity = (this.scene.environmentIntensity || 0) * 0.7;
    // forearms always reach back to the shoulders
    vm.group.updateMatrixWorld(true);
    vm.rArm.lookAt(vm.shoulderR);
    vm.lArm.lookAt(vm.shoulderL);
    vm.lFreeArm.lookAt(vm.shoulderL);
  }

  // ---------------------------------------------------------------- audio
  updateAudio(dt) {
    const a = this.audio, p = this.player, v = p.vehicle;
    if (!a.ctx) return;
    if (v && !v.dead) {
      if (v.isHeli) {
        a.setEngine(false, 0, 0);
        a.setRotor(v.rotorSpeed);
        a.setScreech(0);
      } else {
        const sp = Math.abs(v.forwardSpeed);
        const gearTop = v.T.maxSpeed / 4;
        const gear = Math.min(3, Math.floor(sp / gearTop));
        const rpm = clamp((sp - gear * gearTop) / gearTop * 0.7 + 0.2 + gear * 0.08, 0.1, 1.1);
        const kind = v.T.style === 'bike' ? 'bike' : v.type === 'tank' ? 'tank' : ['pickup', 'monster', 'bus', 'van'].includes(v.type) ? 'truck' : 'car';
        a.setEngine(true, v.grounded ? rpm : 1, Math.abs(v.input.throttle), kind);
        const drift = v.grounded && v.drifting > 3.5 ? Math.min(1, (v.drifting - 3.5) / 8) : 0;
        a.setScreech(drift * 0.12);
        if (drift > 0.1 && Math.random() < 0.6) {
          const sh = Math.sin(v.h), ch = Math.cos(v.h);
          for (const s of [-1, 1]) this.fx.tireSmoke(v.pos.x - sh * v.T.len * 0.35 + ch * s * v.T.wid * 0.45, v.pos.y + 0.3, v.pos.z - ch * v.T.len * 0.35 - sh * s * v.T.wid * 0.45);
        }
        // rotor sound from nearby helicopters
        let rot = 0;
        for (const o of this.vehicles) if (o.isHeli && !o.removed) rot = Math.max(rot, o.rotorSpeed * (1 - dist2(o.pos.x, o.pos.z, v.pos.x, v.pos.z) / 250));
        a.setRotor(Math.max(0, rot) * 0.6);
      }
    } else {
      a.setEngine(false, 0, 0); a.setScreech(0);
      let rot = 0;
      const pp = p.worldPos;
      for (const o of this.vehicles) if (o.isHeli && !o.removed) rot = Math.max(rot, o.rotorSpeed * (1 - dist2(o.pos.x, o.pos.z, pp.x, pp.z) / 250));
      a.setRotor(Math.max(0, rot) * 0.7);
    }
    // sirens
    let siren = 0;
    const pp = p.worldPos;
    for (const o of this.vehicles) {
      if (!o.siren || o.removed) continue;
      siren = Math.max(siren, 1 - dist2(o.pos.x, o.pos.z, pp.x, pp.z) / 180);
    }
    a.setSiren(Math.max(0, siren));
    a.updateMusic();
  }

  // ------------------------------------------------------------------ loop
  loop() {
    requestAnimationFrame(this.loop);
    const raw = Math.min(0.05, this.clock.getDelta());
    if (!(raw > 0)) return;
    this.frame = (this.frame || 0) + 1;
    if (!this.started || this.paused) {
      if (!this.started) {
        // attract mode: slow orbit over Dallas
        const t = performance.now() / 1000;
        this.camera.position.set(-2200 + Math.cos(t * 0.05) * 420, 170, -600 + Math.sin(t * 0.05) * 420);
        this.camera.lookAt(-2200, 60, -600);
        this.world.update(t, raw);
        this.updateSkyOnly();
      }
      this.gfx.render(this.camera.position, performance.now() / 1000);
      this.input.endFrame();
      return;
    }
    const input = this.input, p = this.player;

    // the big map and the cheat console pause the world
    if (this.hud.mapOpen || this.consoleOpen) {
      if (input.pressed('KeyM') || input.pressed('Escape')) { if (this.hud.mapOpen) { this.hud.toggleMap(); this.input.lock(); } }
      if (this.hud.mapOpen) this.hud.drawMap();
      this.audio.setEngine(false, 0, 0); this.audio.setScreech(0);
      this.gfx.render(this.camera.position, performance.now() / 1000);
      input.endFrame();
      return;
    }

    // slow motion
    let targetScale = 1;
    const pv = p.vehicle;
    if (p.dead) targetScale = 0.35;
    else if (pv && !pv.grounded && !pv.isHeli && pv.airTime > 0.45 && pv.pos.y - this.world.groundHeight(pv.pos.x, pv.pos.z, pv.pos.y, 0) > 4) targetScale = 0.4;
    else if (this.cheats.slowmo) targetScale = 0.5;
    this.timeScale = smoothDamp(this.timeScale, targetScale, 6, raw);
    const dt = raw * this.timeScale;
    this.time += dt;

    // global keys
    if (input.pressed('KeyM')) { if (!this.hud.toggleMap()) this.input.lock(); }
    if (input.pressed('KeyT') || input.pressed('Backquote')) this.openConsole();
    if (input.pressed('KeyH')) this.showHelp();
    if (input.pressed('KeyP')) { this.setPaused(true); if (document.pointerLockElement) document.exitPointerLock(); }
    if (input.pressed('KeyR') && pv) { const st = this.audio.nextStation(); this.audio.setMusicAudible(true); this.hud.radio(st); }

    if (this.respawnAt && this.time > this.respawnAt) { this.respawnAt = 0; this.respawn(); }
    if (this.bustSeen && this.time - this.bustSeen > 0.5) { this.bustAcc = 0; this.bustSeen = 0; }

    p.update(dt, input, this.cam);
    const pp = p.worldPos;
    for (const v of this.vehicles) {
      if (v.removed) continue;
      if (v.ai) v.ai.update(dt);
      v.update(dt, this.world);
      if (v.ai && v.ai.honk > 0) { v.ai.honk -= dt; }
    }
    if (p.vehicle) p.pos.copy(p.vehicle.pos);
    resolveVehicleCollisions(this.vehicles.filter((v) => !v.removed && Math.abs(v.pos.x - pp.x) < 300 && Math.abs(v.pos.z - pp.z) < 300), this);
    for (const ped of this.peds) if (!ped.removed) ped.update(dt, this.world);
    this.population.update(dt);
    this.wanted.update(dt);
    this.missions.update(dt);
    this.updateRockets(dt);
    this.updatePickups(dt);
    this.updateArmageddon(dt);
    this.fx.update(dt, this.camera.position);
    this.world.update(this.time, dt);
    this.updateSky(dt);
    this.updateCamera(raw);
    this.updateHeadlight();
    this.updateAudio(dt);
    this.gfx.setHurt(p.dead ? 0.6 : clamp((35 - p.health) / 35, 0, 1));
    this.hud.update(raw);
    if (this.frame % 900 === 0) this.persist();
    this.gfx.render(this.camera.position, this.time);
    input.endFrame();
  }

  updateSkyOnly() {
    if (!this._skyInit) { this._skyInit = true; this.updateSky(0); }
  }

  updateHeadlight() {
    const v = this.player.vehicle;
    const L = this.headlight;
    if (v && !v.isHeli && !v.dead && this.night > 0.2) {
      const sh = Math.sin(v.h), ch = Math.cos(v.h);
      L.position.set(v.pos.x + sh * v.T.len * 0.5, v.pos.y + 0.9, v.pos.z + ch * v.T.len * 0.5);
      L.target.position.set(v.pos.x + sh * 30, v.pos.y - 1, v.pos.z + ch * 30);
      L.intensity = 400 * this.night;
    } else L.intensity = 0;
  }

  showHelp() {
    this.hud.help(`<b>F</b> steal/enter/exit • <b>Shift</b> sprint / nitro • <b>Space</b> jump / handbrake<br>
      <b>LMB</b> shoot • <b>RMB</b> aim down sights • <b>R</b> reload (radio in cars) • <b>1-6</b> weapons • <b>E</b> horn/siren<br>
      <b>M</b> map + GPS • <b>V</b> camera • <b>T</b> cheats • <b>P</b> pause<br>
      Cheats: HESOYAM, TOOLUP, PAINKILLER, LAWYERUP, FUGITIVE, SKYFALL, COMET, BUZZOFF, RHINO, MONSTER, ROCKET, CATCHME, HOPTOIT, FLOATER, SLOWMO, MAKEITRAIN, TIMEWARP, HIGHEX, HOTHANDS, SPEEDFREAK, SLIPPERY, FULLCLIP, RIOT, ARMAGEDDON`, 12);
  }
}

function smoothAngleMix(a, b, t) { return a + wrapAngle(b - a) * t; }
function showFatal(msg) {
  const el = document.getElementById('fatal');
  if (!el || !el.hidden) return;
  el.querySelector('p').textContent = msg;
  el.hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}
function tick() { return new Promise((r) => setTimeout(r, 0)); }

// ------------------------------------------------------------------- boot
const game = new Game();
window.__game = game;
const playBtn = document.getElementById('play');
const loading = document.getElementById('loading');
const qBtn = document.getElementById('quality');
qBtn.textContent = `GRAPHICS: ${game.low ? 'LOW' : 'HIGH'}`;
qBtn.addEventListener('click', () => {
  try { localStorage.setItem('gt-quality', game.low ? 'high' : 'low'); } catch (e) { /* storage unavailable */ }
  location.reload();
});
window.addEventListener('error', (e) => { if (!game.started) showFatal(e.message); });
window.addEventListener('unhandledrejection', (e) => { if (!game.started) showFatal(String(e.reason && e.reason.message || e.reason)); });
game.init((msg) => { loading.textContent = msg; }).then(() => {
  loading.textContent = 'Ready. Click PLAY — best with headphones.';
  playBtn.disabled = false;
  playBtn.textContent = 'PLAY';
  if (params.has('autostart')) game.start();
}).catch((e) => {
  console.error(e);
  loading.textContent = 'Error: ' + e.message;
});
playBtn.addEventListener('click', () => game.start());
