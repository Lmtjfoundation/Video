// DOM HUD: minimap with GPS route, full map, wanted stars, money, messages.
import { WEAPONS } from './player.js';
import { STATIONS } from './audio.js';
import { WORLD_BOUNDS, HWY_HALF, ROAD_HALF } from './world.js';
import { formatMoney, dist2, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const MAP_SCALE = 0.5; // pixels per metre in the prerendered map

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), minimap: $('minimap'), hp: $('hpBar'), arm: $('armBar'), nitro: $('nitroBar'),
      stars: $('stars'), weapon: $('weapon'), money: $('money'), moneyDelta: $('moneyDelta'), timer: $('timer'), race: $('race'),
      zone: $('zone'), speedo: $('speedo'), help: $('help'), hint: $('hint'), radio: $('radio'), objective: $('objective'),
      big: $('big'), bigSub: $('bigSub'), stunt: $('stunt'), card: $('missionCard'), cross: $('crosshair'), hit: $('hitmarker'), damage: $('damage'),
      map: $('mapOverlay'), mapCanvas: $('mapCanvas'),
    };
    this.mm = this.el.minimap.getContext('2d');
    this.shownMoney = game.player.money;
    this.hintT = 0; this.helpT = 0; this.bigT = 0; this.radioT = 0; this.stuntT = 0; this.cardT = 0; this.zoneT = 0; this.hitT = 0;
    this.lastZone = '';
    this.waypoint = null;
    this.route = null; this.routeT = 0;
    this.buildStaticMap();
    this.mapOpen = false;
    this.el.mapCanvas.addEventListener('pointerdown', (e) => this.mapClick(e));
    document.getElementById('mapClose').addEventListener('click', () => this.game.input.down.add('KeyM'));
    this.el.mapCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.weaponChanged();
  }

  show() { this.el.hud.classList.remove('hidden'); }

  // ------------------------------------------------------------ static map
  buildStaticMap() {
    const w = this.game.world;
    const W = Math.ceil((WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) * MAP_SCALE);
    const H = Math.ceil((WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) * MAP_SCALE);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const X = (x) => (x - WORLD_BOUNDS.minX) * MAP_SCALE, Z = (z) => (z - WORLD_BOUNDS.minZ) * MAP_SCALE;
    g.fillStyle = '#3d4d3a'; g.fillRect(0, 0, W, H);
    // subtle terrain noise
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * W, Math.random() * H, 6, 6); }
    for (const wt of w.waters) { g.fillStyle = '#3f86b8'; g.fillRect(X(wt.minX), Z(wt.minZ), (wt.maxX - wt.minX) * MAP_SCALE, (wt.maxZ - wt.minZ) * MAP_SCALE); }
    for (const city of w.cities) {
      g.fillStyle = '#4b5057';
      g.fillRect(X(city.cx - city.half), Z(city.cz - city.half), city.half * 2 * MAP_SCALE, city.half * 2 * MAP_SCALE);
      for (const b of city.blocks) {
        g.fillStyle = b.special === 'park' || ['reunion', 'fountain', 'fairpark', 'jackson', 'westin', 'skyview', 'capitol', 'megaramp'].includes(b.special) ? '#4f7a3a' : '#646a72';
        g.fillRect(X(b.x - 41), Z(b.z - 41), 82 * MAP_SCALE, 82 * MAP_SCALE);
      }
    }
    // roads
    g.lineCap = 'round';
    for (const e of w.edges) {
      const A = w.nodes[e.a], B = w.nodes[e.b];
      g.strokeStyle = e.kind === 'hwy' ? '#e0b64a' : '#d9dde2';
      g.lineWidth = (e.kind === 'hwy' ? HWY_HALF * 1.2 : ROAD_HALF * 0.9) * MAP_SCALE * 2;
      g.beginPath(); g.moveTo(X(A.x), Z(A.z)); g.lineTo(X(B.x), Z(B.z)); g.stroke();
    }
    this.staticMap = c;
    this.mapX = X; this.mapZ = Z;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, p = g.player, el = this.el;
    // money counter
    const diff = p.money - this.shownMoney;
    if (Math.abs(diff) > 0.5) {
      const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * dt * 4);
      this.shownMoney = Math.abs(step) > Math.abs(diff) ? p.money : this.shownMoney + step;
      if (!this.deltaShown || Math.sign(diff) !== this.deltaSign) {
        el.moneyDelta.textContent = (diff > 0 ? '+' : '-') + formatMoney(Math.abs(diff));
        el.moneyDelta.style.color = diff > 0 ? '#7fd477' : '#ff6b6b';
        el.moneyDelta.style.opacity = 1;
        this.deltaShown = true; this.deltaSign = Math.sign(diff);
      }
    } else if (this.deltaShown) { this.deltaShown = false; setTimeout(() => { if (!this.deltaShown) el.moneyDelta.style.opacity = 0; }, 1200); }
    el.money.textContent = formatMoney(this.shownMoney);
    // bars
    el.hp.firstChild.style.width = clamp(p.health, 0, 100) + '%';
    el.hp.classList.toggle('low', p.health < 25);
    el.arm.firstChild.style.width = clamp(p.armor, 0, 100) + '%';
    el.nitro.firstChild.style.width = (p.nitro * 100) + '%';
    // stars
    const lvl = g.wanted.level;
    const spans = el.stars.children;
    for (let i = 0; i < 5; i++) spans[i].classList.toggle('on', i < lvl);
    el.stars.classList.toggle('searching', lvl > 0 && !g.wanted.seen);
    el.stars.style.visibility = lvl > 0 || g.wanted.flashT > 0 ? 'visible' : 'hidden';
    // weapon ammo
    const ammo = p.weapons[p.weapon];
    el.weapon.lastChild.textContent = ammo === Infinity || p.weapon === 'fist' ? '' : (g.cheats.infiniteAmmo ? '∞' : ammo);
    // timer
    const t = g.missions.timer;
    if (t !== null && g.missions.state === 'active') {
      el.timer.classList.remove('hidden');
      const s = Math.max(0, Math.ceil(t));
      el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      el.timer.classList.toggle('warn', s <= 15);
    } else el.timer.classList.add('hidden');
    // zone
    const z = g.world.zoneName(p.worldPos.x, p.worldPos.z);
    const key = z.district + '|' + z.city;
    if (key !== this.lastZone) {
      this.lastZone = key;
      el.zone.querySelector('.district').textContent = z.district;
      el.zone.querySelector('.city').textContent = z.city || '';
      el.zone.querySelector('.city').style.color = z.color;
      this.zoneT = 5;
      if (z.city && z.city !== this.lastCity) {
        this.lastCity = z.city;
        if (g.started && g.time > 3) this.bigMessage(z.city, z.color, 2.2, 'small', 'WELCOME TO');
      }
      if (!z.city) this.lastCity = null;
    }
    this.zoneT -= dt;
    el.zone.style.opacity = this.zoneT > 0 || p.vehicle ? 1 : 0;
    // speedo
    if (p.vehicle) {
      el.speedo.classList.remove('hidden');
      const v = p.vehicle;
      el.speedo.querySelector('.num').textContent = Math.round(v.speed * 2.237);
      el.speedo.querySelector('.alt').textContent = v.isHeli ? `ALT ${Math.round(v.pos.y)} m` : v.health < v.T.hp * 0.3 ? 'ENGINE DAMAGED' : '';
    } else el.speedo.classList.add('hidden');
    // crosshair
    const armed = !WEAPONS[p.weapon].melee || (p.vehicle && (p.vehicle.type === 'tank' || p.vehicle.type === 'heli'));
    el.cross.classList.toggle('hidden', p.dead || (!armed && !p.vehicle) || (p.vehicle && !armed));
    el.cross.classList.toggle('aim', p.aiming && !p.vehicle);
    // timers for transient elements
    if ((this.hintT -= dt) <= 0) el.hint.classList.add('hidden');
    if ((this.helpT -= dt) <= 0) el.help.classList.add('hidden');
    if ((this.bigT -= dt) <= 0) { el.big.style.opacity = 0; el.bigSub.textContent = ''; }
    if ((this.radioT -= dt) <= 0) el.radio.style.opacity = 0;
    if ((this.stuntT -= dt) <= 0) el.stunt.style.opacity = 0;
    if ((this.cardT -= dt) <= 0) el.card.classList.add('hidden');
    if ((this.hitT -= dt) <= 0) el.hit.style.opacity = 0;
    if (this.dmgT > 0) { this.dmgT -= dt; el.damage.style.opacity = Math.min(0.9, this.dmgT * 2); }
    else el.damage.style.opacity = p.health < 25 && !p.dead ? 0.45 : 0;
    // GPS
    this.routeT -= dt;
    const target = g.missions.gps || this.waypoint;
    if (target) {
      if (this.routeT <= 0) {
        this.routeT = 1.2;
        const w = g.world;
        const a = w.nearestNode(p.worldPos.x, p.worldPos.z), b = w.nearestNode(target.x, target.z);
        const path = w.findPath(a, b);
        this.route = path ? [{ x: p.worldPos.x, z: p.worldPos.z }, ...path.map((id) => w.nodes[id]), target] : [target];
      }
      if (this.waypoint && dist2(p.worldPos.x, p.worldPos.z, this.waypoint.x, this.waypoint.z) < 20) { this.waypoint = null; this.route = null; g.audio.checkpoint(); }
    } else this.route = null;
    this.drawMinimap();
    if (this.mapOpen) this.drawMap();
  }

  // -------------------------------------------------------------- minimap
  drawMinimap() {
    const g = this.game, ctx = this.mm, p = g.player;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const cx = W / 2, cy = H * 0.62;
    const pp = p.worldPos;
    const yaw = g.cam.yaw;
    const speed = p.vehicle ? p.vehicle.speed : 0;
    const alt = p.vehicle && p.vehicle.isHeli ? p.vehicle.pos.y : 0;
    const zoom = clamp(1.6 - speed * 0.02 - alt * 0.004, 0.45, 1.6); // screen px per metre
    ctx.save();
    ctx.fillStyle = '#35423a'; ctx.fillRect(0, 0, W, H);
    ctx.translate(cx, cy);
    // world -> screen: rotate so camera forward is up
    ctx.rotate(Math.PI + yaw);
    ctx.scale(zoom, zoom);
    ctx.save();
    ctx.scale(1 / MAP_SCALE, 1 / MAP_SCALE);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.staticMap, -this.mapX(pp.x), -this.mapZ(pp.z));
    ctx.restore();
    const toL = (x, z) => [x - pp.x, z - pp.z];
    // GPS route
    if (this.route && this.route.length > 1) {
      ctx.strokeStyle = g.missions.gps ? '#f2c230' : '#c060ff';
      ctx.lineWidth = 7 / zoom;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.route.forEach((n, i) => { const [x, z] = toL(n.x, n.z); if (i) ctx.lineTo(x, z); else ctx.moveTo(x, z); });
      ctx.stroke();
    }
    ctx.restore();

    // blips (drawn upright)
    const R = Math.max(W, H);
    const blip = (x, z, draw, clampEdge = false) => {
      let dx = x - pp.x, dz = z - pp.z;
      // camera frame: forward (sin yaw, cos yaw) is up; right (-cos yaw, sin yaw)
      let sx = (dx * -Math.cos(yaw) + dz * Math.sin(yaw)) * zoom;
      let sy = -(dx * Math.sin(yaw) + dz * Math.cos(yaw)) * zoom;
      const mx = W / 2 - 10, myTop = cy - 10, myBot = H - cy - 10;
      if (Math.abs(sx) > mx || sy < -myTop || sy > myBot) {
        if (!clampEdge) return;
        const k = Math.min(mx / Math.abs(sx || 1e-6), sy < 0 ? myTop / -sy : myBot / (sy || 1e-6));
        sx *= k; sy *= k;
      }
      draw(cx + sx, cy + sy);
    };
    const dot = (col, r = 5) => (x, y) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke(); };
    const icon = (txt, col, size = 18) => (x, y) => { ctx.font = `bold ${size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText(txt, x + 1, y + 1); ctx.fillStyle = col; ctx.fillText(txt, x, y); };
    for (const l of g.world.labels) if (l.icon) blip(l.x, l.z, icon(l.text, l.color, 20));
    if (g.missions.state === 'idle') {
      for (const mk of g.missions.markers) blip(mk.p.x, mk.p.z, (x, y) => {
        ctx.fillStyle = mk.m.color; ctx.fillRect(x - 10, y - 10, 20, 20); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(x - 10, y - 10, 20, 20);
        ctx.fillStyle = '#000'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(mk.m.letter, x, y + 1);
      }, true);
    }
    for (const pk of g.pickups) if (pk.active) blip(pk.x, pk.z, dot(pk.color, 4));
    const flash = Math.floor(performance.now() / 250) % 2;
    for (const v of g.vehicles) {
      if (v.removed || v === p.vehicle) continue;
      if (v.isPolice && (v.siren || v.isHeli) && !v.dead) blip(v.pos.x, v.pos.z, dot(flash ? '#ff3030' : '#3070ff', v.isHeli ? 7 : 6), g.wanted.level > 0);
      else if (v.missionVehicle) blip(v.pos.x, v.pos.z, dot('#4de1ff', 6));
    }
    for (const pd of g.peds) {
      if (!pd.alive) continue;
      if (pd.state === 'attack' || pd.hostile) blip(pd.pos.x, pd.pos.z, dot(pd.kind === 'cop' || pd.kind === 'swat' ? (flash ? '#ff3030' : '#3070ff') : '#ff4040', 4));
    }
    if (g.missions.gps) blip(g.missions.gps.x, g.missions.gps.z, dot('#f2c230', 8), true);
    if (this.waypoint) blip(this.waypoint.x, this.waypoint.z, dot('#c060ff', 8), true);
    // player arrow
    ctx.save();
    ctx.translate(cx, cy);
    const ph = p.vehicle ? p.vehicle.h : p.h;
    ctx.rotate(-(ph - yaw));
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // wanted ring
    if (g.wanted.level > 0) {
      ctx.strokeStyle = flash ? 'rgba(255,40,40,0.8)' : 'rgba(40,90,255,0.8)';
      ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);
    }
    // north
    blip(pp.x, pp.z - 100000, icon('N', '#fff', 18), true);
    void R;
  }

  // ------------------------------------------------------------------ big map
  toggleMap() {
    this.mapOpen = !this.mapOpen;
    this.el.map.classList.toggle('hidden', !this.mapOpen);
    if (this.mapOpen) {
      const c = this.el.mapCanvas;
      c.width = window.innerWidth * devicePixelRatio; c.height = window.innerHeight * devicePixelRatio;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    return this.mapOpen;
  }

  mapTransform() {
    const c = this.el.mapCanvas;
    const W = c.width, H = c.height;
    const sm = this.staticMap;
    const k = Math.min(W / sm.width, H / sm.height) * 0.96;
    const ox = (W - sm.width * k) / 2, oy = (H - sm.height * k) / 2;
    return { k, ox, oy };
  }

  mapClick(e) {
    const { k, ox, oy } = this.mapTransform();
    const x = (e.clientX * devicePixelRatio - ox) / k / MAP_SCALE + WORLD_BOUNDS.minX;
    const z = (e.clientY * devicePixelRatio - oy) / k / MAP_SCALE + WORLD_BOUNDS.minZ;
    if (e.button === 2) { this.waypoint = null; this.route = null; }
    else { this.waypoint = { x, z }; this.routeT = 0; }
    this.game.audio.ui();
  }

  drawMap() {
    const g = this.game, c = this.el.mapCanvas, ctx = c.getContext('2d');
    const { k, ox, oy } = this.mapTransform();
    ctx.fillStyle = '#0a0f16'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(this.staticMap, ox, oy, this.staticMap.width * k, this.staticMap.height * k);
    const S = (x, z) => [ox + this.mapX(x) * k, oy + this.mapZ(z) * k];
    const dpr = devicePixelRatio;
    if (this.route) {
      ctx.strokeStyle = g.missions.gps ? '#f2c230' : '#c060ff'; ctx.lineWidth = 4 * dpr; ctx.beginPath();
      this.route.forEach((n, i) => { const [x, y] = S(n.x, n.z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // greedy label placement: big names, then icons, then landmarks if there is room
    const placed = [];
    const fits = (x, y, w, h) => {
      for (const r of placed) if (x - w / 2 < r.x + r.w / 2 && x + w / 2 > r.x - r.w / 2 && y - h / 2 < r.y + r.h / 2 && y + h / 2 > r.y - r.h / 2) return false;
      placed.push({ x, y, w, h });
      return true;
    };
    const labels = [...g.world.labels].sort((a, b) => (b.big ? 2 : b.icon ? 1 : 0) - (a.big ? 2 : a.icon ? 1 : 0));
    for (const l of labels) {
      let [x, y] = S(l.x, l.z);
      if (l.big) {
        ctx.font = `${34 * dpr}px Anton, Impact, sans-serif`;
        fits(x, y, ctx.measureText(l.text).width, 38 * dpr);
        ctx.fillStyle = '#000'; ctx.fillText(l.text, x + 2, y + 2); ctx.fillStyle = l.color; ctx.fillText(l.text, x, y);
      } else if (l.icon) {
        ctx.font = `bold ${16 * dpr}px Arial`;
        fits(x, y, 16 * dpr, 16 * dpr);
        ctx.fillStyle = l.color; ctx.fillText(l.text, x, y);
      } else {
        ctx.font = `${11 * dpr}px Oswald, Arial`;
        const w = ctx.measureText(l.text).width + 4 * dpr;
        if (!fits(x, y, w, 13 * dpr)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(l.text, x + 1, y + 1);
        ctx.fillStyle = l.color || 'rgba(255,255,255,0.9)'; ctx.fillText(l.text, x, y);
      }
    }
    for (const mk of g.missions.markers) {
      const [x, y] = S(mk.p.x, mk.p.z);
      const s = 11 * dpr;
      ctx.fillStyle = mk.m.color; ctx.fillRect(x - s, y - s, s * 2, s * 2);
      ctx.fillStyle = '#000'; ctx.font = `bold ${15 * dpr}px Arial`; ctx.fillText(mk.m.letter, x, y + 1);
      if (g.missions.completed.has(mk.m.id)) { ctx.fillStyle = '#fff'; ctx.fillText('✓', x + s * 1.6, y); }
    }
    if (this.waypoint) { const [x, y] = S(this.waypoint.x, this.waypoint.z); ctx.fillStyle = '#c060ff'; ctx.beginPath(); ctx.arc(x, y, 8 * dpr, 0, 7); ctx.fill(); }
    const pp = g.player.worldPos;
    const [px, py] = S(pp.x, pp.z);
    ctx.save(); ctx.translate(px, py);
    const ph = g.player.vehicle ? g.player.vehicle.h : g.player.h;
    ctx.rotate(Math.PI - ph);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * dpr;
    const a = 12 * dpr;
    ctx.beginPath(); ctx.moveTo(0, -a); ctx.lineTo(a * 0.7, a * 0.8); ctx.lineTo(0, a * 0.4); ctx.lineTo(-a * 0.7, a * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // --------------------------------------------------------------- messages
  hint(text) { this.el.hint.textContent = text; this.el.hint.classList.remove('hidden'); this.hintT = 0.15; }
  help(html, dur = 6) { this.el.help.innerHTML = html; this.el.help.classList.remove('hidden'); this.helpT = dur; }
  objective(text) { if (this.el.objective.textContent !== text) this.el.objective.textContent = text; }
  bigMessage(text, color = '#fff', dur = 3, size = '', sub = '') {
    const el = this.el.big;
    el.textContent = text; el.style.color = color; el.className = size; el.style.opacity = 1;
    this.el.bigSub.textContent = sub;
    if (sub) { this.el.bigSub.style.top = 'calc(38% - 40px)'; } else this.el.bigSub.style.top = '';
    this.bigT = dur;
  }
  stunt(title, sub) { this.el.stunt.innerHTML = `${title}<small>${sub}</small>`; this.el.stunt.style.opacity = 1; this.stuntT = 2.5; }
  radio(st) {
    this.el.radio.querySelector('.name').textContent = st.name;
    this.el.radio.querySelector('.name').style.color = st.color;
    this.el.radio.querySelector('.sub').textContent = st.sub;
    this.el.radio.style.opacity = 1; this.radioT = 2.5;
  }
  vehicleName(name) {
    this.el.zone.querySelector('.veh').textContent = name;
    this.zoneT = 4;
  }
  flashDamage() { this.dmgT = 0.5; }
  hitMarker(kill) { this.el.hit.classList.toggle('kill', !!kill); this.el.hit.style.opacity = 1; this.hitT = 0.12; }
  weaponChanged() {
    const p = this.game.player, W = WEAPONS[p.weapon];
    this.el.weapon.innerHTML = `${W.icon} ${W.name}<small></small>`;
  }
  setRace(text) { this.el.race.classList.toggle('hidden', !text); this.el.race.textContent = text || ''; }
  missionIntro(def) {
    const c = this.el.card;
    c.querySelector('.city').textContent = def.city;
    c.querySelector('.title').textContent = def.title;
    c.querySelector('.title').style.color = def.color;
    c.querySelector('.desc').textContent = def.desc;
    c.classList.remove('hidden');
    this.cardT = 4;
  }
  missionResult(passed, title, sub) {
    this.bigMessage(passed ? 'MISSION PASSED' : 'MISSION FAILED', passed ? '#f2c230' : '#ff4b4b', 4, 'small', '');
    this.el.bigSub.textContent = passed ? `${title}  ${sub}` : sub;
    this.el.bigSub.style.top = 'calc(38% + 80px)';
  }
}
