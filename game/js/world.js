// World generation: three cities (Dallas, New Orleans, Atlanta), the interstates
// between them, water, landmarks, collision data, and the road graph used by AI.
import * as THREE from 'three';
import { GeoBuilder, mat } from './geo.js';
import * as TX from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, clamp, pointSegDist, dist2 } from './util.js';

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export const PITCH = 100;       // distance between road centrelines
export const ROAD_HALF = 9;     // half width of city roads
export const BLOCK_HALF = 41;   // half width of a block slab (incl. sidewalk)
export const LOT_HALF = 37;     // half width of buildable lot
export const HWY_HALF = 15;

export const WORLD_BOUNDS = { minX: -3300, maxX: 3300, minZ: -1500, maxZ: 2350 };

// ---- City definitions ------------------------------------------------------
const CITY_DEFS = [
  {
    key: 'dallas', name: 'DALLAS', tagline: 'BIG D • EVERYTHING IS BIGGER', cx: -2200, cz: -600, seed: 1011,
    maxH: 175, falloff: 2.6, color: '#ffb347',
    district(i, j) {
      if (j <= 1) return { name: 'Uptown', maxH: 120, styles: ['glass', 'office', 'res'] };
      if (i >= 6 && j <= 5) return { name: 'Deep Ellum', maxH: 22, styles: ['brick'], small: true, neon: true };
      if (i >= 5 && j >= 6) return { name: 'Fair Park', maxH: 18, styles: ['res', 'brick'], small: true };
      if (i <= 3 && j >= 6) return { name: 'Oak Cliff', maxH: 20, styles: ['res', 'brick'], small: true };
      if (i <= 1) return { name: 'West End', maxH: 60, styles: ['brick', 'office'] };
      return { name: 'Downtown Dallas', maxH: 999 };
    },
    special: {
      '1,4': 'reunion', '3,3': 'bofa_dallas', '4,3': 'renaissance', '3,2': 'fountain', '2,4': 'park',
      '6,6': 'fairpark', '7,7': 'megaramp', '3,1': 'park', '0,2': 'hospital', '5,2': 'police', '1,6': 'safehouse',
      '4,5': 'bank', '5,4': 'parking', '2,6': 'parking', '6,2': 'parking',
    },
  },
  {
    key: 'nola', name: 'NEW ORLEANS', tagline: 'LAISSEZ LES BONS TEMPS ROULER', cx: 0, cz: 1300, seed: 2022,
    maxH: 150, falloff: 3.4, color: '#b48cff',
    district(i, j) {
      if (i >= 5 && j >= 2 && j <= 5) return { name: 'French Quarter', maxH: 14, styles: ['pastel'], small: true, balconies: true, neon: true };
      if (i >= 5 && j <= 1) return { name: 'Marigny', maxH: 12, styles: ['pastel', 'res'], small: true, balconies: true };
      if (j <= 1) return { name: 'Tremé', maxH: 14, styles: ['res', 'pastel'], small: true };
      if (i <= 2 && j >= 5) return { name: 'Garden District', maxH: 14, styles: ['res', 'pastel'], small: true, balconies: true };
      if (j >= 6) return { name: 'Warehouse District', maxH: 30, styles: ['brick'] };
      if (i <= 1) return { name: 'Mid-City', maxH: 24, styles: ['res', 'brick'], small: true };
      return { name: 'Central Business District', maxH: 999 };
    },
    special: {
      '2,4': 'superdome', '5,3': 'cathedral', '5,4': 'jackson', '3,3': 'shell', '4,1': 'cemetery',
      '1,2': 'hospital', '3,5': 'police', '6,6': 'safehouse', '1,6': 'parking', '6,1': 'parking', '0,3': 'park',
    },
  },
  {
    key: 'atlanta', name: 'ATLANTA', tagline: 'THE A • WELCOME TO THE TRAP', cx: 2200, cz: -600, seed: 3033,
    maxH: 200, falloff: 2.2, color: '#ff6b6b',
    district(i, j) {
      if (j === 0) return { name: 'Buckhead', maxH: 140, styles: ['glass', 'dark'] };
      if (j <= 2) return { name: 'Midtown', maxH: 999 };
      if (i >= 6) return { name: 'Old Fourth Ward', maxH: 24, styles: ['brick'], small: true, neon: true };
      if (i <= 1 && j >= 5) return { name: 'West End', maxH: 18, styles: ['res', 'brick'], small: true };
      if (j >= 6) return { name: 'Summerhill', maxH: 20, styles: ['res'], small: true };
      return { name: 'Downtown Atlanta', maxH: 999 };
    },
    special: {
      '3,1': 'bofa_atl', '4,4': 'westin', '1,4': 'mbstadium', '2,3': 'skyview', '4,5': 'capitol', '4,3': 'truist',
      '6,1': 'park', '6,4': 'hospital', '2,5': 'police', '5,6': 'safehouse', '3,6': 'parking', '0,1': 'parking', '7,3': 'parking',
    },
  },
];

// Highways as polylines (the intermediate points become graph nodes).
const HIGHWAYS = [
  { name: 'Interstate 20', pts: [[-1800, -600], [-900, -600], [0, -600], [900, -600], [1800, -600]] },
  { name: 'Interstate 49', pts: [[-2200, -200], [-2200, 150], [-1500, 800], [-950, 1300], [-400, 1300]] },
  { name: 'Interstate 59', pts: [[2200, -200], [2200, 150], [1500, 800], [950, 1300], [400, 1300]] },
  { name: 'Causeway', pts: [[0, 900], [0, 300], [0, -600]], bridge: true },
];

const WATERS = [
  { name: 'Mississippi River', minX: -1500, maxX: 1500, minZ: 1770, maxZ: 1990 },
  { name: 'Lake Pontchartrain', minX: -520, maxX: 520, minZ: 440, maxZ: 830 },
  { name: 'Trinity River', minX: -2720, maxX: -2665, minZ: -1350, maxZ: 250 },
];

const BILLBOARDS = [
  [{ text: 'LONE STAR LAWYERS', size: 60, color: '#ffd23f' }, { text: 'WRECKED? CALL 1-800-SUE-EM', size: 34 }],
  [{ text: 'VOODOO VODKA', size: 72, color: '#b48cff', glow: '#b48cff' }, { text: 'IT PUTS A SPELL ON YOU', size: 30 }],
  [{ text: 'PEACH FUZZ', size: 70, color: '#ffae6b' }, { text: 'CAR INSURANCE • WE DON\'T ASK', size: 30 }],
  [{ text: 'BIG TEX BBQ', size: 70, color: '#ff5533' }, { text: 'BRISKET SO GOOD IT\'S ILLEGAL', size: 30 }],
  [{ text: 'BEIGNET BONANZA', size: 62, color: '#fff' }, { text: 'POWDERED SUGAR • 24/7', size: 32, color: '#f7d774' }],
  [{ text: 'TRAP HOUSE RECORDS', size: 56, color: '#ff4d6d' }, { text: 'NOW SIGNING: YOU', size: 36 }],
  [{ text: 'BEAVER\'S MEGA STOP', size: 58, color: '#ffcf33' }, { text: '240 GAS PUMPS • 1 BATHROOM', size: 30 }],
  [{ text: 'GATOR TOURS', size: 72, color: '#8fd16a' }, { text: 'MOST CUSTOMERS RETURN', size: 32 }],
];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.grid = new Map();
    this.cell = 40;
    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();
    this.waters = WATERS;
    this.bridges = [];
    this.ramps = [];
    this.cities = [];
    this.hwySegs = [];
    this.sidewalkBlocks = [];
    this.parkingSpots = [];
    this.spawns = { hospitals: [], police: [], safehouses: [], helipads: [], pickups: [], special: [], bank: null, policeHelipads: [] };
    this.animated = [];
    this.nightBasic = [];     // basic materials whose colour scales with night
    this.nightEmissive = [];  // standard materials whose emissiveIntensity scales
    this.wetMats = [];        // materials that get glossier in the rain
    this.treeList = [];
    this.lampList = [];
    this.labels = [];         // for the big map
    this.time = 0;
  }

  build() {
    TX.buildFacades();
    this.makeMaterials();
    this.buildGround();
    for (const def of CITY_DEFS) this.buildCity(def);
    this.buildHighways();
    this.buildWater();
    this.buildCountryside();
    this.buildTrees();
    this.buildLamps();
    this.buildStreetFurniture();
    this.placePickups();
  }

  // ---------------------------------------------------------------- materials
  makeMaterials() {
    this.facadeMats = {};
    for (const [name, st] of Object.entries(TX.FACADE_STYLES)) {
      const glassy = name === 'glass' || name === 'dark';
      const m = new THREE.MeshStandardMaterial({
        map: st.map, emissiveMap: st.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0,
        normalMap: st.normalMap, normalScale: new THREE.Vector2(glassy ? 0.6 : 1.2, glassy ? 0.6 : 1.2),
        roughnessMap: st.ormMap, metalnessMap: st.ormMap,
        vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: glassy ? 1.4 : 1,
      });
      this.facadeMats[name] = m;
      this.nightEmissive.push({ m, k: 0.65 });
    }
    this.detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.nightBasic.push({ m: this.lightsMat, day: 0.45, night: 1.2 });
    const conc = TX.concreteTexture();
    this.slabMat = this.pbrMat(conc, { vertexColors: true }, 0.2);
    this.parkMat = new THREE.MeshStandardMaterial({ map: TX.parkTexture(), roughness: 1 });
    this.parkingMat = this.pbrMat(TX.parkingTexture(), {}, 0.7);
    this.helipadMat = new THREE.MeshStandardMaterial({ map: TX.helipadTexture(), roughness: 0.8 });
    this.roadMat = this.pbrMat(TX.cityRoadTexture(), {}, 0.75);
    this.roadMat.polygonOffset = true; this.roadMat.polygonOffsetFactor = -1;
    this.hwyMat = this.pbrMat(TX.highwayTexture(), {}, 0.75);
    this.hwyMat.polygonOffset = true; this.hwyMat.polygonOffsetFactor = -2;
    this.asphaltMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.95 });
    this.wetMats.push({ m: this.asphaltMat, base: 0.95, wet: 0.7 });
    this.asphaltMat.polygonOffset = true; this.asphaltMat.polygonOffsetFactor = -2;
    this.whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7 });
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xd4a73a, metalness: 0.9, roughness: 0.25, emissive: 0xffb830, emissiveIntensity: 0 });
    this.nightEmissive.push({ m: this.goldMat, k: 0.6 });
    this.glassGreenMat = new THREE.MeshStandardMaterial({ color: 0x5f8f86, metalness: 0.6, roughness: 0.2 });
    this.darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x44474d, metalness: 0.6, roughness: 0.4 });
    this.rampMat = this.makeRampMat();
  }

  // Standard material that picks up the normal / roughness maps generated with a texture.
  // `wet` is how much the surface roughness drops when it rains (puddles, sheen).
  pbrMat(map, opts = {}, wet = 0) {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 1, ...opts });
    const { normalMap, roughMap } = map.userData;
    if (normalMap) { normalMap.repeat.copy(map.repeat); m.normalMap = normalMap; m.normalScale.set(1, 1); }
    if (roughMap) { roughMap.repeat.copy(map.repeat); m.roughnessMap = roughMap; }
    if (wet) this.wetMats.push({ m, base: 1, wet });
    return m;
  }

  setWet(k) {
    for (const { m, base, wet } of this.wetMats) m.roughness = base * (1 - wet * k);
  }

  makeRampMat() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#111';
    g.beginPath(); g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(64, 48); g.lineTo(32, 16); g.lineTo(0, 48); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  }

  // ------------------------------------------------------------------- ground
  buildGround() {
    const w = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX + 3000, h = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ + 3000;
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateX(-Math.PI / 2);
    const tex = TX.grassTexture();
    tex.repeat.set(w / 16, h / 16);
    const m = new THREE.Mesh(g, this.pbrMat(tex, {}, 0.3));
    m.position.set((WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) / 2, -0.12, (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) / 2);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  // --------------------------------------------------------------- colliders
  addCollider(minX, maxX, minZ, maxZ, top, kind = 'building') {
    const c = { minX, maxX, minZ, maxZ, top, kind };
    const id = this.colliders.length;
    this.colliders.push(c);
    const s = this.cell;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++) {
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const k = ix * 100000 + iz;
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(id);
      }
    }
    return c;
  }
  addBoxCollider(x, z, w, d, top, kind) { return this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, top, kind); }

  cellItems(x, z) {
    return this.grid.get(Math.floor(x / this.cell) * 100000 + Math.floor(z / this.cell));
  }

  // --------------------------------------------------------------- road graph
  node(x, z, kind) {
    const k = Math.round(x) + ',' + Math.round(z);
    let id = this.nodeMap.get(k);
    if (id === undefined) {
      id = this.nodes.length;
      this.nodes.push({ id, x, z, kind, adj: [] });
      this.nodeMap.set(k, id);
    }
    return id;
  }
  edge(a, b, kind, lanes) {
    const A = this.nodes[a], B = this.nodes[b];
    const len = dist2(A.x, A.z, B.x, B.z);
    const id = this.edges.length;
    this.edges.push({ id, a, b, kind, lanes, len, speed: kind === 'hwy' ? 32 : 15 });
    A.adj.push({ to: b, edge: id });
    B.adj.push({ to: a, edge: id });
  }

  // --------------------------------------------------------------------- city
  buildCity(def) {
    const city = { ...def, half: 4 * PITCH + ROAD_HALF, blocks: [] };
    this.cities.push(city);
    const rng = mulberry32(def.seed);
    const B = { detail: new GeoBuilder(), lights: new GeoBuilder(), slab: new GeoBuilder() };
    for (const k of Object.keys(TX.FACADE_STYLES)) B[k] = new GeoBuilder();

    // road surface
    const size = 8 * PITCH + ROAD_HALF * 2;
    const rg = new THREE.PlaneGeometry(size, size);
    rg.rotateX(-Math.PI / 2);
    const uv = rg.attributes.uv, pos = rg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + 4 * PITCH) / PITCH, -(pos.getZ(i) + 4 * PITCH) / PITCH);
    }
    const road = new THREE.Mesh(rg, this.roadMat);
    road.position.set(def.cx, 0.02, def.cz);
    road.receiveShadow = true;
    this.scene.add(road);

    // road graph for the grid
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const id = this.node(def.cx + (i - 4) * PITCH, def.cz + (j - 4) * PITCH, 'city');
        this.nodes[id].city = def.key;
      }
    }
    const nid = (i, j) => this.nodeMap.get(Math.round(def.cx + (i - 4) * PITCH) + ',' + Math.round(def.cz + (j - 4) * PITCH));
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        if (i < 8) this.edge(nid(i, j), nid(i + 1, j), 'city', [4.5]);
        if (j < 8) this.edge(nid(i, j), nid(i, j + 1), 'city', [4.5]);
      }
    }

    // parking along the curbs + lamps
    for (let line = 0; line <= 8; line++) {
      for (let seg = 0; seg < 8; seg++) {
        for (const vertical of [false, true]) {
          const fixed = (line - 4) * PITCH;
          const s0 = (seg - 4) * PITCH;
          for (let s = 16; s <= 84; s += 34) {
            for (const side of [-1, 1]) {
              const along = s0 + s;
              const off = side * 10.8;
              const x = def.cx + (vertical ? fixed + off : along);
              const z = def.cz + (vertical ? along : fixed + off);
              this.lampList.push({ x, z, h: vertical ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0) });
            }
          }
          if (rng() < 0.55) {
            const side = rng() < 0.5 ? -1 : 1;
            const along = s0 + 20 + rng() * 60;
            const x = def.cx + (vertical ? fixed + side * 7.6 : along);
            const z = def.cz + (vertical ? along : fixed + side * 7.6);
            // face the direction of travel on that side of the road
            const h = vertical ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
            this.parkingSpots.push({ x, z, h, city: def.key });
          }
        }
      }
    }

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) this.buildBlock(city, i, j, rng, B);
    }

    // commit merged geometry
    for (const [k, b] of Object.entries(B)) {
      if (b.vertexCount === 0) continue;
      const matl = k === 'detail' ? this.detailMat : k === 'lights' ? this.lightsMat : k === 'slab' ? this.slabMat : this.facadeMats[k];
      const mesh = new THREE.Mesh(b.build(), matl);
      mesh.castShadow = k !== 'lights' && k !== 'slab';
      mesh.receiveShadow = k !== 'lights';
      this.scene.add(mesh);
    }
    this.labels.push({ text: def.name, x: def.cx, z: def.cz - 470, big: true, color: def.color });
  }

  blockCenter(city, i, j) {
    return [city.cx + (i - 4 + 0.5) * PITCH, city.cz + (j - 4 + 0.5) * PITCH];
  }

  buildBlock(city, i, j, rng, B) {
    const [bx, bz] = this.blockCenter(city, i, j);
    B.slab.box(bx, 0, bz, BLOCK_HALF * 2, 0.25, BLOCK_HALF * 2, '#b3b0aa', { tileW: 4, tileH: 1, topTile: 4 });
    const district = city.district(i, j);
    const block = { x: bx, z: bz, city: city.key, i, j, district: district.name };
    city.blocks.push(block);
    this.sidewalkBlocks.push(block);
    const special = city.special[`${i},${j}`];
    if (special) { block.special = special; this.buildSpecial(special, city, bx, bz, rng, B, block); return; }
    if (rng() < 0.06) { this.buildPark(bx, bz, rng); block.special = 'park'; return; }
    this.buildBuildings(city, bx, bz, rng, B, district);
  }

  styleFor(h, district, rng) {
    if (district.styles) return district.styles[Math.floor(rng() * district.styles.length)];
    if (h > 90) return rng() < 0.5 ? 'glass' : rng() < 0.5 ? 'dark' : 'office';
    if (h > 35) return rng() < 0.6 ? 'office' : 'brick';
    return rng() < 0.5 ? 'brick' : 'res';
  }

  tintFor(style, rng) {
    const P = {
      glass: ['#ffffff', '#dfe9f2', '#cfe0e8', '#e8f0f0', '#b8d6e0'],
      dark: ['#ffffff', '#c8d4e0', '#9fb4c8'],
      office: ['#ffffff', '#efe6d6', '#dcd6cc', '#f2e8dc', '#c8c0b4'],
      brick: ['#ffffff', '#d8a890', '#c89080', '#e0c0a0', '#b0806a'],
      res: ['#ffffff', '#f4e4c8', '#e4f0e0', '#f0d8c8', '#dce4f0'],
      pastel: ['#ffd7e0', '#fff1b8', '#c8f0d8', '#c8dcff', '#ffcfa8', '#e8d0ff', '#f7f7f7', '#ffb8b8'],
    };
    const arr = P[style];
    return arr[Math.floor(rng() * arr.length)];
  }

  addBuilding(B, x, z, w, h, d, style, rng, opts = {}) {
    const st = TX.FACADE_STYLES[style];
    const tint = opts.tint || this.tintFor(style, rng);
    const y0 = opts.y0 || 0;
    B[style].box(x, y0, z, w, h, d, tint, { tileW: st.tileW, tileH: st.tileH });
    this.addBoxCollider(x, z, w, d, y0 + h);
    const top = y0 + h;
    // roof clutter
    if (h > 20 && rng() < 0.8) {
      const mw = w * (0.2 + rng() * 0.3), md = d * (0.2 + rng() * 0.3);
      B.detail.box(x + (rng() - 0.5) * (w - mw) * 0.6, top, z + (rng() - 0.5) * (d - md) * 0.6, mw, 2 + rng() * 3, md, '#6b6d70');
    }
    if (h > 25) {
      // parapet
      B.detail.box(x, top, z - d / 2 + 0.3, w, 1.1, 0.6, '#77777a');
      B.detail.box(x, top, z + d / 2 - 0.3, w, 1.1, 0.6, '#77777a');
      B.detail.box(x - w / 2 + 0.3, top, z, 0.6, 1.1, d, '#77777a');
      B.detail.box(x + w / 2 - 0.3, top, z, 0.6, 1.1, d, '#77777a');
    }
    if (h > 100 && rng() < 0.5) {
      const ah = 12 + rng() * 25;
      B.detail.box(x, top, z, 0.8, ah, 0.8, '#aaaaaa');
      B.lights.box(x, top + ah, z, 1.4, 1.4, 1.4, '#ff2020');
    }
    if (opts.balconies) this.addBalconies(B, x, z, w, h, d, rng);
    if (opts.neon && rng() < 0.55) this.addNeon(x, z, w, h, d, rng);
    // rooftop crown lights on tall towers
    if (h > 110 && rng() < 0.6) {
      const col = ['#4de1ff', '#ff4df0', '#ffffff', '#6aff6a', '#ffb347'][Math.floor(rng() * 5)];
      B.lights.box(x, top - 1.2, z - d / 2 - 0.15, w + 0.3, 0.6, 0.3, col, { noTop: true });
      B.lights.box(x, top - 1.2, z + d / 2 + 0.15, w + 0.3, 0.6, 0.3, col, { noTop: true });
      B.lights.box(x - w / 2 - 0.15, top - 1.2, z, 0.3, 0.6, d + 0.3, col, { noTop: true });
      B.lights.box(x + w / 2 + 0.15, top - 1.2, z, 0.3, 0.6, d + 0.3, col, { noTop: true });
    }
    return top;
  }

  addBalconies(B, x, z, w, h, d, rng) {
    const iron = '#1e2a22';
    for (let y = 3.6; y < h - 1; y += 3.8) {
      const o = 1.3;
      B.detail.box(x, y, z - d / 2 - o / 2, w + o * 2, 0.18, o, iron);
      B.detail.box(x, y, z + d / 2 + o / 2, w + o * 2, 0.18, o, iron);
      B.detail.box(x - w / 2 - o / 2, y, z, o, 0.18, d, iron);
      B.detail.box(x + w / 2 + o / 2, y, z, o, 0.18, d, iron);
      // railings
      B.detail.box(x, y + 0.18, z - d / 2 - o, w + o * 2, 1.0, 0.06, iron, { noTop: false });
      B.detail.box(x, y + 0.18, z + d / 2 + o, w + o * 2, 1.0, 0.06, iron);
      B.detail.box(x - w / 2 - o, y + 0.18, z, 0.06, 1.0, d + o * 2, iron);
      B.detail.box(x + w / 2 + o, y + 0.18, z, 0.06, 1.0, d + o * 2, iron);
      if (rng() < 0.5) {
        // hanging plants / mardi gras beads
        const c = ['#7a3fbf', '#2fa84f', '#e8c33a'][Math.floor(rng() * 3)];
        B.lights.box(x, y - 0.25, z + d / 2 + o, w + o * 2, 0.12, 0.08, c);
      }
    }
  }

  addNeon(x, z, w, h, d, rng) {
    const signs = [['BOURBON ST', '#ff3df0'], ['LIVE JAZZ', '#3df0ff'], ['HURRICANES', '#ff7a1a'], ['OYSTERS', '#5dff6a'],
      ['BLUES BAR', '#3d7aff'], ['DAIQUIRIS', '#ff3d6e'], ['BBQ', '#ffb000'], ['TATTOO', '#ff2a2a'], ['KARAOKE', '#c43dff']];
    const [txt, col] = signs[Math.floor(rng() * signs.length)];
    const key = 'neon:' + txt;
    if (!this._neonCache) this._neonCache = {};
    let m = this._neonCache[key];
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: TX.neonTexture(txt, col), transparent: false });
      this.nightBasic.push({ m, day: 0.55, night: 1.4 });
      this._neonCache[key] = m;
    }
    const sw = Math.min(w * 0.8, 9), sh = sw * 160 / 512;
    const face = Math.floor(rng() * 4);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), m);
    const y = Math.min(h - sh / 2 - 0.5, 4.5 + rng() * 2);
    if (face === 0) { plane.position.set(x, y, z + d / 2 + 1.5); }
    else if (face === 1) { plane.position.set(x, y, z - d / 2 - 1.5); plane.rotation.y = Math.PI; }
    else if (face === 2) { plane.position.set(x + w / 2 + 1.5, y, z); plane.rotation.y = Math.PI / 2; }
    else { plane.position.set(x - w / 2 - 1.5, y, z); plane.rotation.y = -Math.PI / 2; }
    this.scene.add(plane);
  }

  buildBuildings(city, bx, bz, rng, B, district) {
    const dn = Math.hypot(bx - city.cx, bz - city.cz) / 400;
    let tall = city.maxH * Math.exp(-dn * dn * city.falloff) * (0.5 + rng() * 0.7);
    tall = Math.min(tall, district.maxH);
    const L = LOT_HALF;
    const opts = { balconies: district.balconies, neon: district.neon };
    if (district.small || tall < 22) {
      // rows of small buildings around the block edge
      const n = 3;
      const w = (L * 2) / n;
      for (let k = 0; k < n; k++) {
        const x = bx - L + w * (k + 0.5);
        for (const s of [-1, 1]) {
          const hh = Math.max(6, Math.min(district.maxH, 6 + rng() * Math.max(8, tall)));
          const d = 22 + rng() * 6;
          const bw = w - 1.2 - (district.balconies ? 2.6 : 0);
          const bd = d - (district.balconies ? 2.6 : 0);
          this.addBuilding(B, x, bz + s * (L - d / 2), bw, hh, bd, this.styleFor(hh, district, rng), rng, opts);
        }
      }
      // middle side buildings
      for (const s of [-1, 1]) {
        if (rng() < 0.7) {
          const hh = Math.max(6, Math.min(district.maxH, 6 + rng() * Math.max(8, tall)));
          const bw = 16 - (district.balconies ? 2.6 : 0);
          this.addBuilding(B, bx + s * (L - 9), bz, bw, hh, 14, this.styleFor(hh, district, rng), rng, opts);
        }
      }
    } else if (tall > 75) {
      const podH = 8 + rng() * 10;
      const pstyle = this.styleFor(podH, district, rng);
      this.addBuilding(B, bx, bz, L * 2, podH, L * 2, pstyle === 'glass' ? 'office' : pstyle, rng);
      const tw = 28 + rng() * 26, td = 28 + rng() * 26;
      const tx = bx + (rng() - 0.5) * (L * 2 - tw) * 0.7, tz = bz + (rng() - 0.5) * (L * 2 - td) * 0.7;
      const style = this.styleFor(tall, district, rng);
      const top = this.addBuilding(B, tx, tz, tw, tall - podH, td, style, rng, { y0: podH });
      // setback crown
      if (rng() < 0.5) {
        this.addBuilding(B, tx, tz, tw * 0.65, 8 + rng() * 20, td * 0.65, style, rng, { y0: top });
      }
    } else {
      const quad = rng() < 0.6;
      if (quad) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const hh = Math.max(8, tall * (0.45 + rng() * 0.65));
          const w = L - 1.5 - rng() * 6, d = L - 1.5 - rng() * 6;
          this.addBuilding(B, bx + sx * L / 2, bz + sz * L / 2, w, hh, d, this.styleFor(hh, district, rng), rng, opts);
        }
      } else {
        const alongX = rng() < 0.5;
        for (const s of [-1, 1]) {
          const hh = Math.max(8, tall * (0.5 + rng() * 0.6));
          const w = alongX ? L * 2 - 2 : L - 3, d = alongX ? L - 3 : L * 2 - 2;
          this.addBuilding(B, bx + (alongX ? 0 : s * L / 2), bz + (alongX ? s * L / 2 : 0), w, hh, d, this.styleFor(hh, district, rng), rng, opts);
        }
      }
    }
  }

  // ------------------------------------------------------------ special blocks
  buildPark(bx, bz, rng, opts = {}) {
    const g = new THREE.PlaneGeometry(LOT_HALF * 2 + 2, LOT_HALF * 2 + 2);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.parkMat);
    m.position.set(bx, 0.27, bz);
    m.receiveShadow = true;
    this.scene.add(m);
    const n = opts.trees ?? 14;
    for (let k = 0; k < n; k++) {
      let x = bx + (rng() - 0.5) * 68, z = bz + (rng() - 0.5) * 68;
      if (Math.abs(x - bx) < 6 || Math.abs(z - bz) < 6) continue;
      if (opts.clear && Math.hypot(x - bx, z - bz) < opts.clear) continue;
      this.treeList.push({ x, z, s: 0.8 + rng() * 0.6, kind: opts.palms ? 'palm' : rng() < 0.3 ? 'pine' : 'oak' });
    }
    if (!opts.noFountain) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, 0.8, 20), this.whiteMat);
      f.position.set(bx, 0.4, bz);
      this.scene.add(f);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0x3c7fa0, roughness: 0.1, metalness: 0.3 }));
      w.position.set(bx, 0.82, bz);
      this.scene.add(w);
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 4, 16), new THREE.MeshStandardMaterial({ color: 0xcfefff, transparent: true, opacity: 0.6 }));
      jet.position.set(bx, 2.8, bz);
      this.scene.add(jet);
      this.addBoxCollider(bx, bz, 12, 12, 0.8, 'low');
    }
  }

  buildParking(bx, bz, city) {
    const g = new THREE.PlaneGeometry(LOT_HALF * 2, LOT_HALF * 2);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.parkingMat);
    m.position.set(bx, 0.27, bz);
    this.scene.add(m);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 5; k++) {
        this.parkingSpots.push({ x: bx - 30 + k * 15, z: bz - 20 + r * 20, h: Math.PI * (r % 2), city: city.key, lot: true });
      }
    }
  }

  signPlane(tex, w, h, x, y, z, rotY, basic = true) {
    const m = basic ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    if (basic) this.nightBasic.push({ m, day: 0.9, night: 1.2 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    this.scene.add(p);
    return p;
  }

  helipad(x, y, z, list) {
    const g = new THREE.PlaneGeometry(16, 16);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.helipadMat);
    m.position.set(x, y + 0.05, z);
    this.scene.add(m);
    (list || this.spawns.helipads).push({ x, y, z });
  }

  buildSpecial(type, city, bx, bz, rng, B, block) {
    const S = this.scene;
    const L = LOT_HALF;
    switch (type) {
      case 'park': this.buildPark(bx, bz, rng, { palms: city.key === 'nola' }); break;
      case 'parking': this.buildParking(bx, bz, city); break;

      case 'hospital': {
        this.addBuilding(B, bx, bz - 8, 60, 34, 48, 'office', rng, { tint: '#ffffff' });
        const cross = TX.crossTexture();
        for (const [ox, oz, r] of [[0, 16.1, 0], [0, -32.1, Math.PI], [30.1, -8, Math.PI / 2], [-30.1, -8, -Math.PI / 2]]) {
          this.signPlane(cross, 8, 8, bx + ox, 28, bz + oz, r);
        }
        this.signPlane(TX.textTexture([{ text: 'MERCY GENERAL', size: 64, color: '#e22' }], { bg: '#fff', h: 128 }), 22, 5.5, bx, 8, bz + 16.1, 0, false);
        this.helipad(bx, 34.3, bz - 8);
        this.spawns.hospitals.push({ x: bx, z: bz + 30, city: city.key, h: 0 });
        this.labels.push({ text: '✚', x: bx, z: bz, color: '#ff4b4b', icon: true });
        break;
      }
      case 'police': {
        this.addBuilding(B, bx, bz - 10, 64, 20, 44, 'brick', rng, { tint: '#c8d0e0' });
        this.signPlane(TX.textTexture([{ text: 'POLICE', size: 90, color: '#fff' }, { text: 'PROTECT • SERVE • PURSUE', size: 28, color: '#9cf' }], { bg: '#123a8a', h: 200 }), 20, 7.5, bx, 12, bz + 12.1, 0, false);
        B.lights.box(bx - 10, 20, bz + 12, 2, 1, 1, '#ff2020');
        B.lights.box(bx + 10, 20, bz + 12, 2, 1, 1, '#2040ff');
        this.helipad(bx, 20.3, bz - 10, this.spawns.policeHelipads);
        this.spawns.police.push({ x: bx, z: bz + 30, city: city.key, h: 0 });
        for (let k = 0; k < 4; k++) this.parkingSpots.push({ x: bx - 24 + k * 16, z: bz + 22, h: Math.PI / 2, city: city.key, police: true, lot: true });
        this.labels.push({ text: '★', x: bx, z: bz, color: '#6aa2ff', icon: true });
        break;
      }
      case 'safehouse': {
        this.addBuilding(B, bx - 12, bz - 16, 36, 9, 30, 'brick', rng, { tint: '#9a8a80' });
        const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshStandardMaterial({ color: 0x777c80, metalness: 0.5, roughness: 0.4 }));
        door.position.set(bx - 12, 3, bz - 0.9);
        S.add(door);
        this.signPlane(TX.textTexture([{ text: 'SAFEHOUSE', size: 70, color: '#7fff7f' }], { bg: '#111', h: 110 }), 10, 2.2, bx - 12, 7.6, bz - 0.85, 0);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(22, 22).rotateX(-Math.PI / 2), this.asphaltMat);
        pad.position.set(bx + 18, 0.28, bz + 14);
        S.add(pad);
        this.helipad(bx + 18, 0.3, bz + 14);
        this.spawns.safehouses.push({ x: bx - 12, z: bz + 8, city: city.key, doorZ: bz - 1 });
        this.spawns.special.push({ type: city.key === 'dallas' ? 'pickup' : city.key === 'nola' ? 'muscle' : 'sports', x: bx - 22, z: bz + 20, h: 0 });
        this.spawns.special.push({ type: 'heli', x: bx + 18, y: 0.3, z: bz + 14, h: 0 });
        this.labels.push({ text: '⌂', x: bx, z: bz, color: '#7fff7f', icon: true });
        break;
      }
      case 'bank': {
        this.addBuilding(B, bx, bz - 6, 64, 26, 50, 'office', rng, { tint: '#e8e2d0' });
        for (let k = -3; k <= 3; k++) {
          B.detail.box(bx + k * 8, 0, bz + 21, 2.2, 22, 2.2, '#f0ebdc');
        }
        B.detail.box(bx, 22, bz + 21, 62, 4, 4, '#e8e2d0');
        this.signPlane(TX.textTexture([{ text: 'FEDERAL RESERVE', size: 56, color: '#d4a73a' }, { text: 'OF DALLAS', size: 36, color: '#fff' }], { bg: '#1a1a1a', h: 160 }), 22, 7, bx, 23.5, bz + 23.2, 0, false);
        this.spawns.bank = { x: bx, z: bz + 30 };
        this.labels.push({ text: '$', x: bx, z: bz, color: '#3f3', icon: true });
        break;
      }

      // ---- Dallas landmarks
      case 'reunion': {
        this.buildPark(bx, bz, rng, { trees: 8, noFountain: true, clear: 16 });
        const shaftM = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.6 });
        for (const [ox, oz] of [[0, 0], [3.2, 1.8], [-3.2, 1.8], [0, -3.6]]) {
          const s = new THREE.Mesh(new THREE.CylinderGeometry(ox === 0 && oz === 0 ? 3 : 2.2, 2.6, 150, 28), shaftM);
          s.position.set(bx + ox, 75, bz + oz);
          s.castShadow = true;
          S.add(s);
        }
        const ball = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 16), new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.5, roughness: 0.4 }));
        ball.position.set(bx, 162, bz);
        S.add(ball);
        const lattice = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(15.4, 2)), new THREE.LineBasicMaterial({ color: 0xfff2c0 }));
        lattice.position.copy(ball.position);
        S.add(lattice);
        const pts = [];
        const ico = new THREE.IcosahedronGeometry(15.5, 3);
        const p = ico.attributes.position;
        for (let k = 0; k < p.count; k += 3) pts.push(p.getX(k), p.getY(k), p.getZ(k));
        const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const lights = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffe9a0, size: 1.4 }));
        lights.position.copy(ball.position);
        S.add(lights);
        this.animated.push((t) => { lattice.rotation.y = t * 0.05; lights.rotation.y = -t * 0.08; lights.material.color.setHSL((t * 0.03) % 1, 0.8, 0.7); });
        this.addBoxCollider(bx, bz, 10, 10, 177, 'tower');
        this.labels.push({ text: 'Reunion Tower', x: bx, z: bz });
        break;
      }
      case 'bofa_dallas': {
        const h = 205;
        this.addBuilding(B, bx, bz, 44, 14, 60, 'office', rng);
        this.addBuilding(B, bx, bz, 38, h, 38, 'dark', rng, { tint: '#9ab0a8' });
        const g = '#3dff6a', e = 0.9;
        for (const [ox, oz] of [[-19, -19], [19, -19], [-19, 19], [19, 19]]) B.lights.box(bx + ox, 14, bz + oz, e, h - 14, e, g);
        for (let y = 60; y <= h; y += 72.5) {
          B.lights.box(bx, y, bz - 19.2, 38.6, e, e, g); B.lights.box(bx, y, bz + 19.2, 38.6, e, e, g);
          B.lights.box(bx - 19.2, y, bz, e, e, 38.6, g); B.lights.box(bx + 19.2, y, bz, e, e, 38.6, g);
        }
        B.lights.box(bx, h, bz - 19.2, 38.6, e, e, g); B.lights.box(bx, h, bz + 19.2, 38.6, e, e, g);
        B.lights.box(bx - 19.2, h, bz, e, e, 38.6, g); B.lights.box(bx + 19.2, h, bz, e, e, 38.6, g);
        this.labels.push({ text: 'Bank of America Plaza', x: bx, z: bz });
        break;
      }
      case 'renaissance': {
        const h = 175;
        this.addBuilding(B, bx, bz, 40, h, 40, 'glass', rng, { tint: '#b8d0e0' });
        const col = new THREE.Color('#9fe8ff');
        for (const face of [0, 1, 2, 3]) {
          for (const dir of [1, -1]) {
            const len = Math.hypot(40, 40);
            const m4 = new THREE.Matrix4();
            const ang = Math.atan2(40, 40) * dir;
            const rot = face * Math.PI / 2;
            const off = 20.3;
            const cx = bx + Math.sin(rot) * off, cz = bz + Math.cos(rot) * off;
            m4.compose(new THREE.Vector3(cx, h - 22, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, ang)), new THREE.Vector3(1, 1, 1));
            B.lights.addGeometry(new THREE.BoxGeometry(len, 0.9, 0.4), m4, col);
          }
        }
        this.labels.push({ text: 'Renaissance Tower', x: bx, z: bz });
        break;
      }
      case 'fountain': {
        this.buildPark(bx, bz, rng, { trees: 6, noFountain: true, clear: 28 });
        const prism = new THREE.Mesh(new THREE.CylinderGeometry(9, 27, 165, 4, 1), this.glassGreenMat);
        prism.rotation.y = Math.PI / 4 + 0.3;
        prism.position.set(bx, 82.5, bz);
        prism.castShadow = true;
        S.add(prism);
        this.addBoxCollider(bx, bz, 34, 34, 120, 'tower');
        this.addBoxCollider(bx, bz, 18, 18, 165, 'tower');
        this.labels.push({ text: 'Fountain Place', x: bx, z: bz });
        break;
      }
      case 'fairpark': {
        this.buildPark(bx, bz, rng, { trees: 6, noFountain: true, clear: 30 });
        this.buildBigTex(bx - 18, bz + 10);
        this.buildFerris(bx + 14, bz - 14, 28, Math.PI / 2, '#ff3b3b', 'Texas Star');
        this.spawns.special.push({ type: 'monster', x: bx - 18, z: bz + 28, h: 0 });
        this.labels.push({ text: 'Fair Park', x: bx, z: bz + 30 });
        break;
      }
      case 'megaramp': {
        this.buildPark(bx, bz, rng, { trees: 0, noFountain: true });
        this.addRamp(bx, bz + 30, Math.PI, 60, 17, 26, 'MEGA RAMP');
        this.spawns.special.push({ type: 'sports', x: bx - 12, z: bz + 38, h: Math.PI });
        this.labels.push({ text: 'MEGA RAMP', x: bx, z: bz, color: '#ffd23f' });
        break;
      }

      // ---- New Orleans landmarks
      case 'superdome': {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(36, 37, 16, 40), new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.6, metalness: 0.3 }));
        drum.position.set(bx, 8, bz);
        drum.castShadow = true;
        const domeG = new THREE.SphereGeometry(36, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        domeG.scale(1, 0.33, 1);
        const dome = new THREE.Mesh(domeG, new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.5, metalness: 0.4 }));
        dome.position.set(bx, 16, bz);
        dome.castShadow = true;
        S.add(drum, dome);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(36.6, 0.5, 6, 60), new THREE.MeshBasicMaterial({ color: 0xffd54a }));
        ring.rotation.x = Math.PI / 2; ring.position.set(bx, 15.6, bz);
        this.nightBasic.push({ m: ring.material, day: 0.4, night: 1.3 });
        S.add(ring);
        this.addBoxCollider(bx, bz, 60, 60, 22, 'dome');
        this.addBoxCollider(bx, bz, 30, 30, 27, 'dome');
        this.labels.push({ text: 'Superdome', x: bx, z: bz });
        break;
      }
      case 'cathedral': {
        const cz = bz - 8;
        const body = new THREE.Mesh(new THREE.BoxGeometry(24, 18, 44), this.whiteMat);
        body.position.set(bx, 9, cz); body.castShadow = true;
        S.add(body);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 17, 8, 4, 1), new THREE.MeshStandardMaterial({ color: 0x5c5f66 }));
        roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 1.8); roof.position.set(bx, 22, cz);
        S.add(roof);
        const spire = (x, z, h, r) => {
          const t = new THREE.Mesh(new THREE.BoxGeometry(r * 2, h, r * 2), this.whiteMat);
          t.position.set(x, h / 2, z); t.castShadow = true;
          const c = new THREE.Mesh(new THREE.ConeGeometry(r * 1.2, h * 0.5, 20), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.4 }));
          c.position.set(x, h + h * 0.25, z);
          S.add(t, c);
          this.addBoxCollider(x, z, r * 2, r * 2, h);
        };
        spire(bx, cz + 22, 30, 3.5); spire(bx - 10, cz + 21, 20, 2.5); spire(bx + 10, cz + 21, 20, 2.5);
        this.addBoxCollider(bx, cz, 24, 44, 18);
        this.signPlane(TX.textTexture([{ text: 'ST. LOUIS CATHEDRAL', size: 44, color: '#333' }], { bg: '#f4f1ea', h: 90 }), 14, 2.5, bx, 5, cz + 22.1 + 3.6, 0, false);
        this.labels.push({ text: 'St. Louis Cathedral', x: bx, z: bz });
        break;
      }
      case 'jackson': {
        this.buildPark(bx, bz, rng, { palms: true, trees: 10, noFountain: true, clear: 10 });
        const ped = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 6), this.whiteMat);
        ped.position.set(bx, 2, bz);
        const horse = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 4.6), new THREE.MeshStandardMaterial({ color: 0x2f3a33, metalness: 0.6 }));
        horse.position.set(bx, 5.4, bz); horse.rotation.x = -0.35;
        const rider = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.9), horse.material);
        rider.position.set(bx, 7.2, bz - 0.5);
        S.add(ped, horse, rider);
        this.addBoxCollider(bx, bz, 4, 6, 4);
        this.labels.push({ text: 'Jackson Square', x: bx, z: bz + 20 });
        break;
      }
      case 'shell': {
        this.addBuilding(B, bx, bz, 40, 12, 60, 'office', rng, { tint: '#ffffff' });
        this.addBuilding(B, bx, bz, 34, 180, 34, 'office', rng, { tint: '#ffffff' });
        this.labels.push({ text: 'One Shell Square', x: bx, z: bz });
        break;
      }
      case 'cemetery': {
        const wallC = '#d8d2c4';
        B.detail.box(bx, 0, bz - L, L * 2, 2.5, 1, wallC); B.detail.box(bx, 0, bz + L, L * 2, 2.5, 1, wallC);
        B.detail.box(bx - L, 0, bz, 1, 2.5, L * 2, wallC); B.detail.box(bx + L, 0, bz, 1, 2.5, L * 2, wallC);
        this.addBoxCollider(bx, bz - L, L * 2, 1, 2.5); this.addBoxCollider(bx, bz + L, L * 2, 1, 2.5);
        this.addBoxCollider(bx - L, bz, 1, L * 2, 2.5); this.addBoxCollider(bx + L, bz, 1, L * 2, 2.5);
        for (let x = -30; x <= 30; x += 7.5) {
          for (let z = -30; z <= 30; z += 9) {
            if (Math.abs(x) < 4) continue;
            const h = 2 + rng() * 2;
            B.detail.box(bx + x, 0, bz + z, 3, h, 5, rng() < 0.3 ? '#cfc6b4' : '#ecebe6');
            B.detail.box(bx + x, h, bz + z, 3.4, 0.4, 5.4, '#bdb5a5');
            this.addBoxCollider(bx + x, bz + z, 3, 5, h + 0.4);
          }
        }
        this.labels.push({ text: 'St. Louis Cemetery No. 1', x: bx, z: bz });
        break;
      }

      // ---- Atlanta landmarks
      case 'bofa_atl': {
        const h = 220;
        this.addBuilding(B, bx, bz, 40, h, 40, 'dark', rng, { tint: '#d8c8b8' });
        this.addBuilding(B, bx, bz, 30, 14, 30, 'dark', rng, { y0: h, tint: '#d8c8b8' });
        const pyr = new THREE.Mesh(new THREE.ConeGeometry(21, 26, 4, 1), this.goldMat);
        pyr.rotation.y = Math.PI / 4; pyr.position.set(bx, h + 14 + 13, bz);
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 30, 20), this.goldMat);
        spire.position.set(bx, h + 14 + 26 + 15, bz);
        S.add(pyr, spire);
        this.labels.push({ text: 'Bank of America Plaza', x: bx, z: bz });
        break;
      }
      case 'westin': {
        this.buildPark(bx, bz, rng, { trees: 5, noFountain: true, clear: 24 });
        const h = 200, r = 19;
        const base = TX.FACADE_STYLES.glass;
        const map = base.map.clone(); map.needsUpdate = true;
        const em = base.emissiveMap.clone(); em.needsUpdate = true;
        const nm = base.normalMap.clone(); nm.needsUpdate = true;
        const orm = base.ormMap.clone(); orm.needsUpdate = true;
        map.repeat.set(2 * Math.PI * r / base.tileW, h / base.tileH);
        for (const t of [em, nm, orm]) t.repeat.copy(map.repeat);
        const m = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0, color: 0xe8f4ff, normalMap: nm, roughnessMap: orm, metalnessMap: orm, metalness: 1, roughness: 1 });
        this.nightEmissive.push({ m, k: 0.65 });
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 36, 1, true), m);
        cyl.position.set(bx, h / 2, bz); cyl.castShadow = true;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(r + 2, r + 2, 8, 36), this.darkMetalMat);
        cap.position.set(bx, h + 4, bz);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 2.1, 0.5, 6, 48), new THREE.MeshBasicMaterial({ color: 0x4de1ff }));
        ring.rotation.x = Math.PI / 2; ring.position.set(bx, h + 4, bz);
        this.nightBasic.push({ m: ring.material, day: 0.4, night: 1.3 });
        S.add(cyl, cap, ring);
        this.addBoxCollider(bx, bz, r * 1.6, r * 1.6, h + 8, 'tower');
        this.labels.push({ text: 'Westin Peachtree', x: bx, z: bz });
        break;
      }
      case 'truist': {
        const h = 190;
        this.addBuilding(B, bx, bz, 42, 16, 60, 'office', rng);
        const top = this.addBuilding(B, bx, bz, 34, h, 34, 'office', rng, { tint: '#e8d0c0' });
        this.addBuilding(B, bx, bz, 24, 10, 24, 'office', rng, { y0: top, tint: '#e8d0c0' });
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(6, 17, 14, 4), this.goldMat);
        crown.rotation.y = Math.PI / 4; crown.position.set(bx, top + 17, bz);
        S.add(crown);
        this.labels.push({ text: 'Truist Plaza', x: bx, z: bz });
        break;
      }
      case 'mbstadium': {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(34, 38, 32, 8), new THREE.MeshStandardMaterial({ color: 0x8a939c, metalness: 0.7, roughness: 0.35 }));
        body.position.set(bx, 16, bz); body.rotation.y = Math.PI / 8; body.castShadow = true;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(34, 6, 8), this.darkMetalMat);
        roof.position.set(bx, 35, bz); roof.rotation.y = Math.PI / 8;
        const halo = new THREE.Mesh(new THREE.TorusGeometry(35, 1.2, 8, 64), new THREE.MeshBasicMaterial({ color: 0xff2244 }));
        halo.rotation.x = Math.PI / 2; halo.position.set(bx, 26, bz);
        S.add(body, roof, halo);
        this.animated.push((t) => { halo.material.color.setHSL((t * 0.07) % 1, 1, 0.55); });
        this.addBoxCollider(bx, bz, 64, 64, 32, 'dome');
        this.labels.push({ text: 'Mercedes-Benz Stadium', x: bx, z: bz });
        break;
      }
      case 'skyview': {
        this.buildPark(bx, bz, rng, { trees: 10, noFountain: false });
        this.buildFerris(bx + 20, bz + 22, 20, 0, '#ffffff', 'SkyView');
        this.labels.push({ text: 'Centennial Olympic Park', x: bx, z: bz });
        break;
      }
      case 'capitol': {
        this.buildPark(bx, bz, rng, { trees: 10, noFountain: true, clear: 32 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(56, 18, 30), this.whiteMat);
        body.position.set(bx, 9, bz); body.castShadow = true;
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 10, 20), this.whiteMat);
        drum.position.set(bx, 23, bz);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(8.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.goldMat);
        dome.position.set(bx, 28, bz); dome.scale.y = 1.3;
        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, 6, 18), this.goldMat);
        lantern.position.set(bx, 41, bz);
        S.add(body, drum, dome, lantern);
        for (let k = -3; k <= 3; k++) B.detail.box(bx + k * 3.5, 0, bz + 16, 1.6, 16, 1.6, '#f7f5f0');
        this.addBoxCollider(bx, bz, 56, 30, 18);
        this.labels.push({ text: 'Georgia State Capitol', x: bx, z: bz });
        break;
      }
      default:
        this.buildBuildings(city, bx, bz, rng, B, city.district(block.i, block.j));
    }
  }

  buildBigTex(x, z) {
    const S = this.scene;
    const grp = new THREE.Group();
    const M = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    const box = (w, h, d, px, py, pz, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(px, py, pz); b.castShadow = true; grp.add(b); return b; };
    const jeans = M(0x2b4c8c), shirt = M(0xc0392b), skin = M(0xe0b08a), hat = M(0xf6f1e4), boots = M(0x5a3620);
    box(1.8, 2, 3, -1.4, 1, 0.4, boots); box(1.8, 2, 3, 1.4, 1, 0.4, boots);
    box(2, 7.5, 2, -1.4, 5.7, 0, jeans); box(2, 7.5, 2, 1.4, 5.7, 0, jeans);
    box(5.4, 7, 3, 0, 12.8, 0, shirt);
    box(1.6, 6.5, 1.6, -3.5, 12.5, 0, shirt); const armR = box(1.6, 6.5, 1.6, 3.5, 12.5, 0.8, shirt);
    const hand = box(1.4, 1.4, 1.4, 3.5, 9.4, 1.8, skin);
    box(3, 3.2, 3, 0, 18, 0, skin);
    box(7.5, 0.4, 7.5, 0, 19.8, 0, hat); box(3.6, 2.2, 3.6, 0, 21, 0, hat);
    grp.position.set(x, 0.25, z);
    S.add(grp);
    this.addBoxCollider(x, z, 7, 4, 22, 'statue');
    this.animated.push((t) => { hand.position.y = 9.4 + Math.sin(t * 2) * 0.5; armR.rotation.z = Math.sin(t * 2) * 0.15; });
    this.labels.push({ text: 'Big Tex', x, z });
  }

  buildFerris(x, z, r, rotY, color, name) {
    const S = this.scene;
    const pivot = new THREE.Group();
    pivot.position.set(x, r + 4, z);
    pivot.rotation.y = rotY;
    const wheel = new THREE.Group();
    pivot.add(wheel);
    const mat = new THREE.MeshBasicMaterial({ color });
    this.nightBasic.push({ m: mat, day: 0.7, night: 1.3 });
    for (const off of [-1.2, 1.2]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35, 12, 64), mat);
      rim.position.z = off;
      wheel.add(rim);
    }
    const spokeG = new THREE.BoxGeometry(0.25, r * 2, 0.25);
    const cabs = [];
    const cabM = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.5 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (k < 8) {
        const s = new THREE.Mesh(spokeG, mat);
        s.rotation.z = a;
        wheel.add(s);
      }
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2, 2.6), cabM);
      cab.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      wheel.add(cab);
      cabs.push(cab);
    }
    const legM = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.5 });
    for (const side of [-1, 1]) {
      for (const lean of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, r + 6, 0.8), legM);
        leg.position.set(lean * (r * 0.28), -(r + 4) / 2, side * 2.2);
        leg.rotation.z = lean * 0.28;
        pivot.add(leg);
      }
    }
    S.add(pivot);
    this.addBoxCollider(x, z, 6, 6, 3, 'low');
    this.animated.push((t) => {
      wheel.rotation.z = t * 0.12;
      for (const c of cabs) c.rotation.z = -wheel.rotation.z;
    });
    this.labels.push({ text: name, x, z });
  }

  // ------------------------------------------------------------------ ramps
  addRamp(x, z, h, len, height, width, label) {
    // (x,z) is the start (low end); heading h points up the ramp.
    const fx = Math.sin(h), fz = Math.cos(h);
    this.ramps.push({ x, z, h, fx, fz, len, height, width, label });
    const g = new THREE.BufferGeometry();
    const w = width / 2;
    // local: x across, z along, y up
    const v = [
      [-w, 0, 0], [w, 0, 0], [w, height, len], [-w, height, len], // slope
      [-w, 0, len], [w, 0, len],
    ];
    const tris = [
      [0, 1, 2], [0, 2, 3],         // top slope
      [4, 3, 2], [4, 2, 5],         // back face
      [0, 3, 4], [1, 5, 2],         // sides
    ];
    const pos = [], uvs = [];
    for (const t of tris) {
      for (const i of t) { pos.push(...v[i]); uvs.push((v[i][0] + w) / 4, v[i][2] / 4); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.rampMat);
    m.material.side = THREE.DoubleSide;
    m.position.set(x, 0.05, z);
    m.rotation.y = h;
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    // support struts under the back
    if (height > 3) {
      for (const sx of [-w + 0.5, w - 0.5]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, height, 0.5), this.darkMetalMat);
        p.position.set(x + fx * (len - 0.3) + Math.cos(h) * sx, height / 2, z + fz * (len - 0.3) - Math.sin(h) * sx);
        this.scene.add(p);
      }
    }
    if (label) this.labels.push({ text: '⤴', x, z, color: '#ffd23f', icon: true });
  }

  rampHeightAt(r, x, z) {
    const dx = x - r.x, dz = z - r.z;
    const s = dx * r.fx + dz * r.fz;           // along
    const t = dx * r.fz - dz * r.fx;           // across
    if (s < 0 || s > r.len || Math.abs(t) > r.width / 2) return -1;
    return r.height * s / r.len;
  }

  // ---------------------------------------------------------------- highways
  buildHighways() {
    for (const hw of HIGHWAYS) {
      const ids = hw.pts.map(([x, z]) => this.node(x, z, 'hwy'));
      for (let k = 0; k < ids.length - 1; k++) {
        const A = this.nodes[ids[k]], B = this.nodes[ids[k + 1]];
        this.edge(ids[k], ids[k + 1], 'hwy', [4, 10.5]);
        this.hwySegs.push({ ax: A.x, az: A.z, bx: B.x, bz: B.z, name: hw.name, bridge: hw.bridge });
        const len = dist2(A.x, A.z, B.x, B.z);
        const g = new THREE.PlaneGeometry(HWY_HALF * 2, len);
        g.rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 20);
        const m = new THREE.Mesh(g, this.hwyMat);
        const h = Math.atan2(B.x - A.x, B.z - A.z);
        m.position.set((A.x + B.x) / 2, 0.03, (A.z + B.z) / 2);
        m.rotation.y = h;
        m.receiveShadow = true;
        this.scene.add(m);
        // guard rails
        const railG = new THREE.BoxGeometry(0.3, 0.8, len);
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(railG, this.darkMetalMat);
          rail.position.set((A.x + B.x) / 2 + Math.cos(h) * side * (HWY_HALF + 0.5), 0.5, (A.z + B.z) / 2 - Math.sin(h) * side * (HWY_HALF + 0.5));
          rail.rotation.y = h;
          if (hw.bridge) this.scene.add(rail);
        }
        if (hw.bridge) this.bridges.push({ ax: A.x, az: A.z, bx: B.x, bz: B.z, half: HWY_HALF + 1 });
      }
      // joints
      for (const id of ids) {
        const n = this.nodes[id];
        if (n.kind !== 'hwy') continue;
        const c = new THREE.Mesh(new THREE.CircleGeometry(HWY_HALF, 24).rotateX(-Math.PI / 2), this.asphaltMat);
        c.position.set(n.x, 0.025, n.z);
        this.scene.add(c);
      }
    }
    // bridge pylons over the lake
    for (const b of this.bridges) {
      for (let t = 0; t <= 1; t += 0.04) {
        const x = b.ax + (b.bx - b.ax) * t, z = b.az + (b.bz - b.az) * t;
        if (!this.inWaterRect(x, z)) continue;
        const p = new THREE.Mesh(new THREE.BoxGeometry(HWY_HALF * 2 + 2, 3, 1.5), this.whiteMat);
        p.position.set(x, -1.4, z);
        this.scene.add(p);
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(HWY_HALF * 2 + 2, 1, dist2(b.ax, b.az, b.bx, b.bz)), new THREE.MeshStandardMaterial({ color: 0xb5b2aa }));
      deck.position.set((b.ax + b.bx) / 2, -0.5, (b.az + b.bz) / 2);
      deck.rotation.y = Math.atan2(b.bx - b.ax, b.bz - b.az);
      this.scene.add(deck);
    }
    this.labels.push({ text: 'I-20', x: -450, z: -640, color: '#9cf' });
    this.labels.push({ text: 'I-49', x: -1860, z: 450, color: '#9cf' });
    this.labels.push({ text: 'I-59', x: 1860, z: 450, color: '#9cf' });
    this.labels.push({ text: 'Causeway', x: 40, z: 620, color: '#9cf' });
  }

  inWaterRect(x, z) {
    for (const w of this.waters) if (x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ) return w;
    return null;
  }

  isWater(x, z) {
    const w = this.inWaterRect(x, z);
    if (!w) return false;
    for (const b of this.bridges) {
      if (pointSegDist(x, z, b.ax, b.az, b.bx, b.bz).d < b.half) return false;
    }
    return true;
  }

  buildWater() {
    const tex = TX.waterTexture();
    for (const w of this.waters) {
      const W = w.maxX - w.minX, D = w.maxZ - w.minZ;
      const t = tex.clone(); t.needsUpdate = true;
      t.repeat.set(W / 40, D / 40);
      const m = new THREE.MeshStandardMaterial({ map: t, color: 0x6fa8c8, roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.92 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), m);
      mesh.position.set((w.minX + w.maxX) / 2, -0.05, (w.minZ + w.maxZ) / 2);
      this.scene.add(mesh);
      // muddy bank
      const bank = new THREE.Mesh(new THREE.PlaneGeometry(W + 16, D + 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 1 }));
      bank.position.set(mesh.position.x, -0.09, mesh.position.z);
      this.scene.add(bank);
      this.animated.push((time) => { t.offset.set(time * 0.01, time * 0.006); });
      this.labels.push({ text: w.name, x: (w.minX + w.maxX) / 2, z: (w.minZ + w.maxZ) / 2, color: '#8fd3ff' });
    }
    this.buildRiverboat();
  }

  buildRiverboat() {
    const g = new THREE.Group();
    const white = this.whiteMat;
    const red = new THREE.MeshStandardMaterial({ color: 0xb02020 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 44), white); hull.position.y = 1;
    const d1 = new THREE.Mesh(new THREE.BoxGeometry(11, 3, 34), white); d1.position.y = 4;
    const d2 = new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 22), white); d2.position.y = 6.8;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.5, 44.2), red); trim.position.y = 2.4;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 10, 16), red);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 3, -24);
    for (const sx of [-2, 2]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 10, 20), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      st.position.set(sx, 11, 8);
      g.add(st);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2), new THREE.MeshBasicMaterial({ map: TX.textTexture([{ text: 'NATCHEZ QUEEN', size: 60, color: '#b02020' }], { bg: '#fff', h: 110 }) }));
    sign.position.set(6.1, 5, 0); sign.rotation.y = Math.PI / 2;
    g.add(hull, d1, d2, trim, wheel, sign);
    g.position.set(0, 0, 1880);
    this.scene.add(g);
    this.riverboat = g;
    this.animated.push((t) => {
      const x = Math.sin(t * 0.01) * 1300;
      const dir = Math.cos(t * 0.01) > 0 ? 1 : -1;
      g.position.x = x;
      g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      wheel.rotation.x = t * 2;
    });
  }

  // ------------------------------------------------------------ countryside
  distToHighway(x, z) {
    let best = Infinity;
    for (const s of this.hwySegs) {
      const d = pointSegDist(x, z, s.ax, s.az, s.bx, s.bz).d;
      if (d < best) best = d;
    }
    return best;
  }

  inCity(x, z, pad = 0) {
    for (const c of this.cities) {
      if (Math.abs(x - c.cx) < c.half + pad && Math.abs(z - c.cz) < c.half + pad) return c;
    }
    return null;
  }

  buildCountryside() {
    const rng = mulberry32(777);
    // Ramps along the highways (off to the side, so traffic ignores them)
    const rampSpots = [
      [-1300, -600 + 24, Math.PI / 2, 40, 7, 10],
      [1200, -600 - 24, -Math.PI / 2, 40, 7, 10],
      [300, -600 + 24, Math.PI / 2, 26, 4, 8],
      [24, 150, Math.PI, 32, 6, 10],
    ];
    for (const r of rampSpots) this.addRamp(r[0], r[1], r[2], r[3], r[4], r[5], 'Stunt jump');
    // diagonal highway ramps
    for (const [ax, az, bx, bz] of [[-2200, 150, -1500, 800], [2200, 150, 1500, 800]]) {
      const h = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2 + Math.cos(h) * 26, mz = (az + bz) / 2 - Math.sin(h) * 26;
      this.addRamp(mx, mz, h, 40, 8, 10, 'Stunt jump');
    }

    // Billboards
    let bi = 0;
    for (const s of this.hwySegs) {
      const len = dist2(s.ax, s.az, s.bx, s.bz);
      const h = Math.atan2(s.bx - s.ax, s.bz - s.az);
      for (let d = 200; d < len - 150; d += 420) {
        const t = d / len;
        const side = bi % 2 ? 1 : -1;
        const x = s.ax + (s.bx - s.ax) * t + Math.cos(h) * side * 40;
        const z = s.az + (s.bz - s.az) * t - Math.sin(h) * side * 40;
        if (this.isWater(x, z) || this.inCity(x, z, 20)) continue;
        this.billboard(x, z, h + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI, BILLBOARDS[bi % BILLBOARDS.length]);
        bi++;
      }
    }

    // Welcome signs
    const welcome = [
      [-1770, -630, -Math.PI / 2 + Math.PI, 'dallas'], [-2170, -170, 0, 'dallas'],
      [1770, -570, Math.PI / 2 + Math.PI, 'atlanta'], [2230, -170, 0, 'atlanta'],
      [-430, 1270, -Math.PI / 2, 'nola'], [430, 1330, Math.PI / 2, 'nola'], [30, 870, Math.PI, 'nola'],
    ];
    for (const [x, z, h, key] of welcome) {
      const c = this.cities.find((cc) => cc.key === key);
      const tex = TX.textTexture([{ text: 'WELCOME TO', size: 40, color: '#fff' }, { text: c.name, size: 80, color: c.color, stroke: '#000' }, { text: c.tagline, size: 26, color: '#eee' }], { bg: ['#1b2a4a', '#0b1020'], border: c.color });
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), this.darkMetalMat);
      post.position.set(x, 3, z);
      this.scene.add(post);
      this.signPlane(tex, 12, 6, x, 7, z, h, false).material.side = THREE.DoubleSide;
    }

    // Truck stop on I-20
    this.truckStop(0 + 60, -600 - 60);
    this.truckStop(-1500 + 60, 800 + 40, "BEAVER'S");

    // Oil pumpjacks around Dallas
    for (let k = 0; k < 7; k++) {
      const x = -2200 + (rng() - 0.5) * 1100, z = -600 + (rng() < 0.5 ? -1 : 1) * (480 + rng() * 350);
      if (this.distToHighway(x, z) < 40 || this.isWater(x, z)) continue;
      this.pumpjack(x, z, rng() * Math.PI);
    }

    // Military depot east of Atlanta (tank spawn!)
    const fx = 2760, fz = -300;
    const fenceM = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.6 });
    for (const [x, z, w, d] of [[fx, fz - 40, 80, 1], [fx - 40, fz, 1, 80], [fx + 40, fz, 1, 80], [fx + 20, fz + 40, 40, 1]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), fenceM);
      f.position.set(x, 2, z);
      this.scene.add(f);
      this.addBoxCollider(x, z, w, d, 4, 'fence');
    }
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), this.asphaltMat);
    pad.position.set(fx, 0.02, fz);
    this.scene.add(pad);
    const hangar = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 30, 36, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x5b6b4a, roughness: 0.8 }));
    hangar.rotation.z = Math.PI / 2; hangar.rotation.y = Math.PI / 2; hangar.position.set(fx + 15, 0, fz - 20);
    this.scene.add(hangar);
    this.addBoxCollider(fx + 15, fz - 20, 30, 28, 13);
    this.spawns.special.push({ type: 'tank', x: fx - 10, z: fz + 10, h: Math.PI });
    this.spawns.special.push({ type: 'heli', x: fx - 15, y: 0, z: fz - 20, h: 0 });
    this.labels.push({ text: 'Fort McPeach Depot', x: fx, z: fz - 60, color: '#b5d68a' });
    // road stub from the depot to I-20 (visual only)
    const stub = new THREE.Mesh(new THREE.PlaneGeometry(12, 300).rotateX(-Math.PI / 2), this.asphaltMat);
    stub.position.set(fx - 20, 0.02, fz - 190);
    this.scene.add(stub);

    // Cypress swamp shacks near the bayou
    for (let k = 0; k < 10; k++) {
      const x = -1100 + rng() * 2200, z = 1000 + rng() * 700;
      if (this.inCity(x, z, 40) || this.distToHighway(x, z) < 40 || this.isWater(x, z)) continue;
      const shack = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 }));
      shack.position.set(x, 2, z); shack.rotation.y = rng() * 3;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.5, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0x7a7a7a, metalness: 0.4 }));
      roof.position.set(x, 5.2, z); roof.rotation.y = shack.rotation.y + Math.PI / 4;
      this.scene.add(shack, roof);
      this.addBoxCollider(x, z, 7, 7, 4);
    }
  }

  billboard(x, z, h, lines) {
    const tex = TX.textTexture(lines, { bg: ['#222', '#000'], border: '#fff', w: 512, h: 256 });
    for (const sx of [-5, 5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 0.6), this.darkMetalMat);
      post.position.set(x + Math.cos(h) * sx, 5, z - Math.sin(h) * sx);
      this.scene.add(post);
    }
    const p = this.signPlane(tex, 18, 9, x, 13, z, h, false);
    p.material.side = THREE.DoubleSide;
    this.addBoxCollider(x, z, 2, 2, 8, 'post');
  }

  truckStop(x, z, brand = 'FUEL') {
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 18), new THREE.MeshStandardMaterial({ color: 0xe23b2e }));
    canopy.position.set(x, 6, z);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(40, 18).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff7d8 }));
    under.position.set(x, 5.38, z);
    this.nightBasic.push({ m: under.material, day: 0.6, night: 1.2 });
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(80, 60).rotateX(-Math.PI / 2), this.asphaltMat);
    lot.position.set(x, 0.02, z - 10);
    this.scene.add(canopy, under, lot);
    for (let k = -1; k <= 1; k++) {
      for (const pz of [-4, 4]) {
        const pump = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.6), this.whiteMat);
        pump.position.set(x + k * 12, 1, z + pz);
        this.scene.add(pump);
        this.addBoxCollider(x + k * 12, z + pz, 1, 0.6, 2, 'pump');
      }
    }
    for (const px of [-19, 19]) for (const pz of [-8, 8]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), this.whiteMat);
      col.position.set(x + px, 3, z + pz); this.scene.add(col);
    }
    const store = new THREE.Mesh(new THREE.BoxGeometry(30, 7, 14), new THREE.MeshStandardMaterial({ color: 0xdcc9a0 }));
    store.position.set(x, 3.5, z - 30);
    store.castShadow = true;
    this.scene.add(store);
    this.addBoxCollider(x, z - 30, 30, 14, 7);
    this.signPlane(TX.textTexture([{ text: brand, size: 90, color: '#ffcf33', stroke: '#000' }, { text: 'GAS • JERKY • FIREWORKS', size: 28 }], { bg: '#b01e14', h: 200 }), 14, 5.5, x, 10, z - 22.9, 0);
    this.gasStations = this.gasStations || [];
    this.gasStations.push({ x, z });
  }

  pumpjack(x, z, h) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.4 });
    const y = new THREE.MeshStandardMaterial({ color: 0xe8b82a });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 10), m); base.position.y = 0.5;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6, 0.8), m); post.position.set(0, 3.5, 0);
    const beamPivot = new THREE.Group(); beamPivot.position.set(0, 6.5, 0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 10), y);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1.4), y); head.position.set(0, -1, 5);
    beamPivot.add(beam, head);
    g.add(base, post, beamPivot);
    g.position.set(x, 0, z); g.rotation.y = h;
    this.scene.add(g);
    this.addBoxCollider(x, z, 5, 5, 7);
    const phase = Math.random() * 6;
    this.animated.push((t) => { beamPivot.rotation.x = Math.sin(t * 1.4 + phase) * 0.35; });
  }

  // ---------------------------------------------------------------- vegetation
  buildTrees() {
    const rng = mulberry32(4242);
    // countryside forest
    let tries = 0;
    while (tries++ < (this.treeTries || 5000)) {
      const x = WORLD_BOUNDS.minX + rng() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX);
      const z = WORLD_BOUNDS.minZ + rng() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);
      if (this.inCity(x, z, 30)) continue;
      if (this.distToHighway(x, z) < 26) continue;
      if (this.inWaterRect(x, z)) continue;
      if (Math.abs(x - 2760) < 50 && Math.abs(z + 300) < 50) continue;
      let blocked = false;
      for (const r of this.ramps) if (dist2(x, z, r.x, r.z) < r.len + 20) { blocked = true; break; }
      if (blocked) continue;
      for (const gs of this.gasStations || []) if (dist2(x, z, gs.x, gs.z) < 60) blocked = true;
      if (blocked) continue;
      const kind = z > 700 ? (rng() < 0.55 ? 'cypress' : 'oak') : x > 1000 ? (rng() < 0.7 ? 'pine' : 'oak') : rng() < 0.6 ? 'oak' : 'pine';
      this.treeList.push({ x, z, s: 0.8 + rng() * 0.8, kind });
    }
    // street trees
    for (const b of this.sidewalkBlocks) {
      if (b.special === 'park') continue;
      for (let k = 0; k < 4; k++) {
        const side = Math.floor(rng() * 4);
        const along = (rng() - 0.5) * 60;
        const off = 39.5;
        const x = b.x + (side === 0 ? along : side === 1 ? along : side === 2 ? off : -off);
        const z = b.z + (side === 0 ? off : side === 1 ? -off : along);
        this.treeList.push({ x, z, s: 0.55 + rng() * 0.25, kind: b.city === 'nola' ? (rng() < 0.5 ? 'palm' : 'oak') : 'oak', street: true });
      }
    }

    const byKind = {};
    for (const t of this.treeList) (byKind[t.kind] ||= []).push(t);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x4e3a2c, roughness: 0.95 });
    const trunkG = new THREE.CylinderGeometry(0.2, 0.42, 1, 10, 2, true); trunkG.translate(0, 0.5, 0);
    { // gnarly trunk
      const p = trunkG.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
        const k = 1 + Math.sin(a * 3 + y * 7) * 0.12;
        p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
      }
      trunkG.computeVertexNormals();
    }
    const leaf = TX.leafTexture();
    leaf.repeat.set(3, 3);
    leaf.userData.normalMap.repeat.set(3, 3);
    const foliage = (hex) => new THREE.MeshStandardMaterial({ color: hex, map: leaf, normalMap: leaf.userData.normalMap, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const canopy = {
      oak: [treeCanopy('oak'), foliage(0x4f7a34), 5],
      pine: [treeCanopy('pine'), foliage(0x35593a), 4],
      palm: [treeCanopy('palm'), foliage(0x5d8c3a), 9],
      cypress: [treeCanopy('cypress'), foliage(0x5b7440), 6],
    };
    const dummy = new THREE.Object3D();
    // one instanced mesh per kind per 400 m chunk so off-screen chunks are frustum culled
    const CH = 400;
    for (const [kind, list] of Object.entries(byKind)) {
      const [geo, m, trunkH] = canopy[kind];
      const chunks = new Map();
      for (const t of list) {
        const k = Math.floor(t.x / CH) + ',' + Math.floor(t.z / CH);
        if (!chunks.has(k)) chunks.set(k, []);
        chunks.get(k).push(t);
      }
      for (const chunk of chunks.values()) {
        const inst = new THREE.InstancedMesh(geo, m, chunk.length);
        const trunks = new THREE.InstancedMesh(trunkG, trunkM, chunk.length);
        chunk.forEach((t, i) => {
          dummy.position.set(t.x, 0, t.z);
          dummy.rotation.set(0, (t.x * 13.1) % 6.28, 0);
          dummy.scale.set(t.s, t.s, t.s);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
          dummy.scale.set(t.s * (kind === 'palm' ? 0.7 : 1), t.s * trunkH, t.s * (kind === 'palm' ? 0.7 : 1));
          dummy.updateMatrix();
          trunks.setMatrixAt(i, dummy.matrix);
          this.addBoxCollider(t.x, t.z, 0.8 * t.s, 0.8 * t.s, trunkH * t.s, 'tree');
        });
        for (const o of [inst, trunks]) {
          o.castShadow = true;
          o.computeBoundingSphere();
          this.scene.add(o);
        }
      }
    }
  }

  buildLamps() {
    const n = this.lampList.length;
    const poleG = new THREE.CylinderGeometry(0.1, 0.16, 7.5, 10, 1, true).translate(0, 3.75, 0);
    // curved mast arm and a cobra-head luminaire
    const arc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 7.2, 0), new THREE.Vector3(0, 7.9, 0.4), new THREE.Vector3(0, 7.6, 2.0));
    const armG = new THREE.TubeGeometry(arc, 8, 0.06, 6);
    const headG = new THREE.SphereGeometry(0.5, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.55, 0.35, 1).rotateX(Math.PI).translate(0, 7.62, 2.3);
    const poleM = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.4 });
    const headM = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    this.nightBasic.push({ m: headM, day: 0.5, night: 1.6 });
    const d = new THREE.Object3D();
    // 300 m chunks so lamps behind the camera or across town are culled
    const chunks = new Map();
    for (const l of this.lampList) {
      const k = Math.floor(l.x / 300) + ',' + Math.floor(l.z / 300);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(l);
    }
    for (const list of chunks.values()) {
      const poles = new THREE.InstancedMesh(poleG, poleM, list.length);
      const arms = new THREE.InstancedMesh(armG, poleM, list.length);
      const heads = new THREE.InstancedMesh(headG, headM, list.length);
      list.forEach((l, i) => {
        d.position.set(l.x, 0.25, l.z);
        d.rotation.set(0, l.h, 0);
        d.updateMatrix();
        poles.setMatrixAt(i, d.matrix); arms.setMatrixAt(i, d.matrix); heads.setMatrixAt(i, d.matrix);
      });
      for (const m of [poles, arms, heads]) { m.computeBoundingSphere(); this.scene.add(m); }
      poles.castShadow = true;
    }
  }

  // Traffic signals at every intersection plus hydrants, bins, benches and news boxes on the sidewalks.
  buildStreetFurniture() {
    const rng = mulberry32(909);
    const d = new THREE.Object3D();
    const metal = new THREE.MeshStandardMaterial({ color: 0x3b3e42, metalness: 0.7, roughness: 0.45 });
    // --- traffic signals: pole + mast arm + head, arm along local +x, lenses facing local +z
    const signals = [];
    for (const def of CITY_DEFS) {
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
        const x = def.cx + (i - 4) * PITCH, z = def.cz + (j - 4) * PITCH;
        const phase = rng();
        // corners: (+,+) over the N-S road, (-,-) too, (+,-) and (-,+) over the E-W road
        if (i > 0 && j > 0) signals.push({ x: x - 10.6, z: z - 10.6, h: 0, phase });
        if (i < 8 && j < 8) signals.push({ x: x + 10.6, z: z + 10.6, h: Math.PI, phase });
        if (i > 0 && j < 8) signals.push({ x: x - 10.6, z: z + 10.6, h: -Math.PI / 2, phase: phase + 0.5 });
        if (i < 8 && j > 0) signals.push({ x: x + 10.6, z: z - 10.6, h: Math.PI / 2, phase: phase + 0.5 });
      }
    }
    const poleG = mergeGeometries([
      new THREE.CylinderGeometry(0.11, 0.14, 6.2, 16).translate(0, 3.1, 0),
      new THREE.CylinderGeometry(0.2, 0.24, 0.35, 16).translate(0, 0.17, 0),
      new THREE.CylinderGeometry(0.07, 0.09, 6.5, 12).rotateZ(Math.PI / 2).translate(3.25, 5.9, 0),
      new THREE.CylinderGeometry(0.02, 0.02, 3.2, 4).rotateZ(Math.PI / 2 - 0.25).translate(1.6, 6.3, 0),
      new THREE.BoxGeometry(0.34, 1.05, 0.28).translate(6.0, 5.3, 0),
      new THREE.BoxGeometry(0.5, 1.25, 0.04).translate(6.0, 5.3, -0.16),
      // pedestrian signal box
      new THREE.BoxGeometry(0.3, 0.35, 0.25).translate(0, 2.8, 0.2),
    ]);
    const lensG = new THREE.CircleGeometry(0.11, 14);
    const visorG = new THREE.CylinderGeometry(0.13, 0.13, 0.18, 12, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0.02, 0.09);
    const nS = signals.length;
    const poles = new THREE.InstancedMesh(poleG, metal, nS);
    const lenses = new THREE.InstancedMesh(lensG, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), nS * 3);
    const visors = new THREE.InstancedMesh(visorG, metal, nS * 3);
    const m4 = new THREE.Matrix4(), off = new THREE.Matrix4();
    signals.forEach((sg, i) => {
      d.position.set(sg.x, 0.25, sg.z); d.rotation.set(0, sg.h, 0); d.scale.set(1, 1, 1); d.updateMatrix();
      poles.setMatrixAt(i, d.matrix);
      for (let k = 0; k < 3; k++) {
        off.makeTranslation(6.0, 5.63 - k * 0.33, 0.145);
        m4.multiplyMatrices(d.matrix, off);
        lenses.setMatrixAt(i * 3 + k, m4);
        visors.setMatrixAt(i * 3 + k, m4);
      }
    });
    for (const m of [poles, lenses, visors]) { m.computeBoundingSphere(); this.scene.add(m); }
    poles.castShadow = true;
    const LENS = [[1, 0.12, 0.08], [1, 0.7, 0.1], [0.2, 1, 0.45]];
    const col = new THREE.Color();
    let lastT = -1;
    this.animated.push((t) => {
      if (t - lastT < 0.25) return;
      lastT = t;
      signals.forEach((sg, i) => {
        const ph = (t / 30 + sg.phase) % 1;
        const on = ph < 0.45 ? 2 : ph < 0.52 ? 1 : 0; // green, amber, red
        for (let k = 0; k < 3; k++) {
          const c = LENS[k], lit = k === on ? 1.6 : 0.08;
          lenses.setColorAt(i * 3 + k, col.setRGB(c[0] * lit, c[1] * lit, c[2] * lit));
        }
      });
      lenses.instanceColor.needsUpdate = true;
    });
    this.animated[this.animated.length - 1](0); // create instance colours before shaders compile

    // --- sidewalk props
    const lists = { hydrant: [], bin: [], bench: [], news: [] };
    for (const b of this.sidewalkBlocks) {
      if (b.special === 'park') continue;
      for (let side = 0; side < 4; side++) {
        const kind = pick(['hydrant', 'bin', 'bin', 'bench', 'news', 'hydrant'], rng);
        let along = 4 + rng() * 24;
        if (rng() < 0.5) along = -along;
        const e = 39.2; // just inside the curb
        const x = b.x + (side === 0 ? along : side === 1 ? -along : side === 2 ? e : -e);
        const z = b.z + (side === 0 ? e : side === 1 ? -e : along);
        // face the street
        const h = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
        lists[kind].push({ x, z, h });
      }
    }
    const red = new THREE.MeshStandardMaterial({ color: 0xa8231a, roughness: 0.45, metalness: 0.3 });
    const green = new THREE.MeshStandardMaterial({ color: 0x1f3b2a, roughness: 0.6, metalness: 0.5 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.7 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1f4f9a, roughness: 0.4, metalness: 0.4 });
    const props = {
      hydrant: [[mergeGeometries([
        new THREE.CylinderGeometry(0.14, 0.17, 0.62, 12).translate(0, 0.31, 0),
        new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0),
        new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12).translate(0, 0.05, 0),
        new THREE.CylinderGeometry(0.06, 0.06, 0.42, 12).rotateZ(Math.PI / 2).translate(0, 0.45, 0),
        new THREE.CylinderGeometry(0.075, 0.075, 0.12, 12).rotateX(Math.PI / 2).translate(0, 0.42, 0.14),
        new THREE.CylinderGeometry(0.03, 0.03, 0.06, 6).translate(0, 0.78, 0),
      ]), red]],
      bin: [[mergeGeometries([
        new THREE.CylinderGeometry(0.3, 0.26, 0.95, 16, 1, true).translate(0, 0.5, 0),
        new THREE.CylinderGeometry(0.33, 0.33, 0.06, 16).translate(0, 0.98, 0),
        new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12).translate(0, 0.02, 0),
      ]), green]],
      bench: [
        [mergeGeometries([0, 1, 2].map((k) => new THREE.BoxGeometry(1.8, 0.05, 0.12).translate(0, 0.45, -0.18 + k * 0.14)).concat(
          [0, 1].map((k) => new THREE.BoxGeometry(1.8, 0.12, 0.04).translate(0, 0.65 + k * 0.17, -0.3).rotateX(0)))), wood],
        [mergeGeometries([-0.75, 0.75].flatMap((x) => [
          new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(x, 0.22, 0.12),
          new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(x, 0.45, -0.3),
          new THREE.BoxGeometry(0.06, 0.05, 0.5).translate(x, 0.43, -0.08),
        ])), metal],
      ],
      news: [[mergeGeometries([
        new THREE.BoxGeometry(0.5, 0.75, 0.45).translate(0, 0.55, 0),
        new THREE.BoxGeometry(0.46, 0.3, 0.02).translate(0, 0.72, 0.23),
        new THREE.BoxGeometry(0.06, 0.2, 0.06).translate(-0.2, 0.1, 0),
        new THREE.BoxGeometry(0.06, 0.2, 0.06).translate(0.2, 0.1, 0),
      ]), blue]],
    };
    for (const [kind, parts] of Object.entries(props)) {
      const list = lists[kind];
      if (!list.length) continue;
      for (const [geo, m] of parts) {
        const inst = new THREE.InstancedMesh(geo, m, list.length);
        list.forEach((it, i) => {
          d.position.set(it.x, 0.25, it.z); d.rotation.set(0, it.h, 0); d.updateMatrix();
          inst.setMatrixAt(i, d.matrix);
        });
        inst.castShadow = true;
        inst.computeBoundingSphere();
        this.scene.add(inst);
      }
    }
  }

  placePickups() {
    const rng = mulberry32(55);
    const types = ['health', 'armor', 'smg', 'shotgun', 'rpg', 'pistol', 'health', 'armor', 'cash'];
    for (const city of this.cities) {
      for (let k = 0; k < 9; k++) {
        const b = city.blocks[Math.floor(rng() * city.blocks.length)];
        const side = rng() < 0.5 ? 1 : -1;
        this.spawns.pickups.push({ type: types[k % types.length], x: b.x + (rng() - 0.5) * 60, z: b.z + side * 39.5 });
      }
    }
    // The minigun sits on top of the tallest tower in Atlanta. Bring a helicopter.
    this.spawns.pickups.push({ type: 'minigun', x: 2200 - 50, y: 234, z: -600 - 250 });
    // RPG under the Causeway start
    this.spawns.pickups.push({ type: 'rpg', x: 20, z: 920 });
    this.spawns.pickups.push({ type: 'minigun', x: 2760, z: -280 });
    this.spawns.pickups.push({ type: 'armor', x: 2740, z: -280 });
  }

  // ------------------------------------------------------------------ queries
  groundHeight(x, z, y = 0, step = 0.6) {
    let g = this.isWater(x, z) ? -1.4 : 0;
    for (const r of this.ramps) {
      const h = this.rampHeightAt(r, x, z);
      if (h >= 0 && y + step >= h && h > g) g = h;
    }
    const items = this.cellItems(x, z);
    if (items) {
      for (const id of items) {
        const c = this.colliders[id];
        if (c.kind === 'tree' || c.kind === 'post' || c.kind === 'fence') continue;
        if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && y + step >= c.top && c.top > g) g = c.top;
      }
    }
    return g;
  }

  // Push a circle out of any building taller than y+step. Returns hit info.
  collideCircle(x, z, y, r, step = 0.6, out = {}) {
    out.x = x; out.z = z; out.hit = false; out.nx = 0; out.nz = 0; out.kind = null;
    const s = this.cell;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let ix = Math.floor((x - r) / s); ix <= Math.floor((x + r) / s); ix++) {
      for (let iz = Math.floor((z - r) / s); iz <= Math.floor((z + r) / s); iz++) {
        const items = this.grid.get(ix * 100000 + iz);
        if (!items) continue;
        for (const id of items) {
          if (seen.has(id)) continue;
          seen.add(id);
          const c = this.colliders[id];
          if (y + step >= c.top) continue;
          const cx = clamp(out.x, c.minX, c.maxX), cz = clamp(out.z, c.minZ, c.maxZ);
          let dx = out.x - cx, dz = out.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          let nx, nz, pen;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            nx = dx / d; nz = dz / d; pen = r - d;
          } else {
            // centre inside the box: push along the shallowest axis
            const l = out.x - c.minX, rr = c.maxX - out.x, b = out.z - c.minZ, t = c.maxZ - out.z;
            const m = Math.min(l, rr, b, t);
            if (m === l) { nx = -1; nz = 0; pen = l + r; }
            else if (m === rr) { nx = 1; nz = 0; pen = rr + r; }
            else if (m === b) { nx = 0; nz = -1; pen = b + r; }
            else { nx = 0; nz = 1; pen = t + r; }
          }
          out.x += nx * pen; out.z += nz * pen;
          out.nx += nx; out.nz += nz; out.hit = true; out.kind = c.kind;
        }
      }
    }
    // ramps: sides/back act as walls when you are below the surface
    for (const rp of this.ramps) {
      const dx = out.x - rp.x, dz = out.z - rp.z;
      const sAlong = dx * rp.fx + dz * rp.fz;
      const t = dx * rp.fz - dz * rp.fx;
      const hw = rp.width / 2;
      if (sAlong < -r || sAlong > rp.len + r || Math.abs(t) > hw + r) continue;
      const hAt = rp.height * clamp(sAlong, 0, rp.len) / rp.len;
      if (y + step >= hAt) continue;
      // penetrations
      const penBack = rp.len + r - sAlong;
      const penSide = hw + r - Math.abs(t);
      if (penBack < penSide) {
        out.x += rp.fx * penBack; out.z += rp.fz * penBack; out.nx += rp.fx; out.nz += rp.fz;
      } else {
        const sg = Math.sign(t) || 1;
        out.x += rp.fz * sg * penSide; out.z += -rp.fx * sg * penSide; out.nx += rp.fz * sg; out.nz += -rp.fx * sg;
      }
      out.hit = true; out.kind = 'ramp';
    }
    if (out.hit) {
      const l = Math.hypot(out.nx, out.nz) || 1;
      out.nx /= l; out.nz /= l;
    }
    // world bounds
    out.x = clamp(out.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    out.z = clamp(out.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
    return out;
  }

  // Is a point inside solid geometry?
  solidAt(x, y, z) {
    if (y < 0 && !this.isWater(x, z)) return true;
    const items = this.cellItems(x, z);
    if (!items) return false;
    for (const id of items) {
      const c = this.colliders[id];
      if (y < c.top && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return true;
    }
    return false;
  }

  // Surface normal where a ray (direction d) hit solid geometry at (x, y, z), or null
  // for small props that shouldn't carry decals.
  hitNormal(x, y, z, dx, dy, dz, out) {
    const px = x + dx * 0.06, py = y + dy * 0.06, pz = z + dz * 0.06;
    const items = this.cellItems(px, pz);
    if (items) {
      for (const id of items) {
        const c = this.colliders[id];
        if (!(py < c.top && px >= c.minX && px <= c.maxX && pz >= c.minZ && pz <= c.maxZ)) continue;
        if (c.maxX - c.minX < 1.5 && c.maxZ - c.minZ < 1.5) return null;
        const d = [px - c.minX, c.maxX - px, pz - c.minZ, c.maxZ - pz, c.top - py];
        let k = 0;
        for (let i = 1; i < 5; i++) if (d[i] < d[k]) k = i;
        out.set(k === 0 ? -1 : k === 1 ? 1 : 0, k === 4 ? 1 : 0, k === 2 ? -1 : k === 3 ? 1 : 0);
        return out;
      }
    }
    if (py < 0.05 && !this.isWater(px, pz)) return out.set(0, 1, 0);
    return null;
  }

  // March a ray through the collider grid. Returns hit distance or maxDist.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, step = 1.2) {
    let t = 0;
    while (t < maxDist) {
      t += step;
      if (this.solidAt(ox + dx * t, oy + dy * t, oz + dz * t)) {
        // refine
        let a = t - step, b = t;
        for (let i = 0; i < 5; i++) {
          const m = (a + b) / 2;
          if (this.solidAt(ox + dx * m, oy + dy * m, oz + dz * m)) b = m; else a = m;
        }
        return a;
      }
    }
    return maxDist;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, 3) >= d - 0.5;
  }

  nearestNode(x, z, filter) {
    let best = -1, bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  // Nearest point on any road (edge centreline)
  nearestEdge(x, z) {
    let best = null, bd = Infinity;
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      const r = pointSegDist(x, z, A.x, A.z, B.x, B.z);
      if (r.d < bd) { bd = r.d; best = { edge: e, t: r.t, d: r.d, x: r.x, z: r.z }; }
    }
    return best;
  }

  findPath(from, to) {
    if (from < 0 || to < 0) return null;
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open = [from];
    const T = this.nodes[to];
    const hfn = (id) => { const n = this.nodes[id]; return Math.hypot(n.x - T.x, n.z - T.z); };
    g[from] = 0; f[from] = hfn(from);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open.splice(bi, 1);
      if (cur === to) {
        const path = [];
        for (let c = to; c !== -1; c = prev[c]) path.push(c);
        return path.reverse();
      }
      closed[cur] = 1;
      for (const a of this.nodes[cur].adj) {
        if (closed[a.to]) continue;
        const e = this.edges[a.edge];
        const cost = g[cur] + e.len * (e.kind === 'hwy' ? 0.6 : 1);
        if (cost < g[a.to]) {
          if (g[a.to] === Infinity) open.push(a.to);
          g[a.to] = cost; f[a.to] = cost + hfn(a.to) * 0.6; prev[a.to] = cur;
        }
      }
    }
    return null;
  }

  zoneName(x, z) {
    for (const c of this.cities) {
      if (Math.abs(x - c.cx) < c.half + 5 && Math.abs(z - c.cz) < c.half + 5) {
        const i = clamp(Math.floor((x - c.cx) / PITCH + 4), 0, 7);
        const j = clamp(Math.floor((z - c.cz) / PITCH + 4), 0, 7);
        return { city: c.name, district: c.district(i, j).name, color: c.color, key: c.key };
      }
    }
    const w = this.inWaterRect(x, z);
    if (w) return { city: null, district: w.name, color: '#8fd3ff' };
    let best = null, bd = 60;
    for (const s of this.hwySegs) {
      const d = pointSegDist(x, z, s.ax, s.az, s.bx, s.bz).d;
      if (d < bd) { bd = d; best = s.name; }
    }
    if (best) return { city: null, district: best, color: '#9cf' };
    if (Math.abs(x - 2760) < 60 && Math.abs(z + 300) < 60) return { city: null, district: 'Fort McPeach Depot', color: '#b5d68a' };
    if (z > 750) return { city: null, district: 'Louisiana Bayou', color: '#8fd16a' };
    if (x < -900) return { city: null, district: 'East Texas Piney Woods', color: '#c9a36b' };
    if (x > 900) return { city: null, district: 'Georgia Backwoods', color: '#ff9f6b' };
    return { city: null, district: 'Dixie Flats', color: '#ccc' };
  }

  setNight(n) {
    for (const { m, day, night } of this.nightBasic) {
      if (!m.userData.base) m.userData.base = m.color.clone();
      m.color.copy(m.userData.base).multiplyScalar(day + (night - day) * n);
    }
    for (const { m, k } of this.nightEmissive) m.emissiveIntensity = n * k;
  }

  update(t, dt) {
    this.time = t;
    for (const fn of this.animated) fn(t, dt);
  }
}

// ------------------------------------------------------------ vegetation
// Canopy geometry built from several noisy lobes, with darker undersides baked
// into vertex colours so the instanced trees read as leafy volumes.
function lobe(r, x, y, z, rng, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, n = g.attributes.normal;
  // soft, sphere-like normals (plus a little noise) make the foliage look fluffy rather than faceted
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const k = 1 + Math.sin(px * 5.1 + pz * 3.7) * 0.1 + Math.sin(py * 4.3) * 0.08;
    const l = Math.hypot(px, py, pz) || 1;
    n.setXYZ(i, px / l + (rng() - 0.5) * 0.3, py / l + (rng() - 0.5) * 0.3, pz / l + (rng() - 0.5) * 0.3);
    p.setXYZ(i, px * k + x, py * k * 0.85 + y, pz * k + z);
  }
  g.normalizeNormals();
  return g;
}

function shadeCanopy(g, y0, y1, rng, flatNormals = false) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    const v = (0.45 + t * 0.6) * (0.9 + rng() * 0.2);
    col[i * 3] = v * (0.95 + rng() * 0.1); col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (flatNormals) g.computeVertexNormals();
  return g;
}

function treeCanopy(kind) {
  const rng = mulberry32(kind.length * 31);
  const parts = [];
  if (kind === 'oak') {
    parts.push(lobe(2.6, 0, 6.6, 0, rng, 1));
    for (let i = 0; i < 5; i++) {
      const a = i / 6 * Math.PI * 2 + rng();
      parts.push(lobe(1.6 + rng() * 0.8, Math.cos(a) * 2, 5.8 + rng() * 1.8, Math.sin(a) * 2, rng));
    }
    parts.push(lobe(1.8, 0.3, 8.2, -0.2, rng));
    return shadeCanopy(mergeGeometries(parts), 4, 9.5, rng);
  }
  if (kind === 'pine') {
    for (let i = 0; i < 5; i++) {
      const c = new THREE.ConeGeometry(2.8 - i * 0.48, 3.2, 12, 1, true);
      c.translate(0, 4.2 + i * 1.7, 0);
      const p = c.attributes.position;
      for (let j = 0; j < p.count; j++) {
        const k = 1 + (rng() - 0.5) * 0.4;
        p.setX(j, p.getX(j) * k); p.setZ(j, p.getZ(j) * k);
      }
      parts.push(c.toNonIndexed());
    }
    return shadeCanopy(mergeGeometries(parts), 3, 13, rng, true);
  }
  if (kind === 'cypress') {
    for (let i = 0; i < 5; i++) parts.push(lobe(1.9 - Math.abs(i - 2) * 0.25, (rng() - 0.5) * 0.6, 5 + i * 1.3, (rng() - 0.5) * 0.6, rng));
    return shadeCanopy(mergeGeometries(parts), 4, 11, rng);
  }
  // palm: drooping fronds from the crown
  for (let i = 0; i < 10; i++) {
    const f = new THREE.PlaneGeometry(0.9, 4.2, 1, 8);
    f.translate(0, 2.1, 0);
    const p = f.attributes.position;
    for (let j = 0; j < p.count; j++) {
      const t = p.getY(j) / 4.2;
      const x = p.getX(j) * (1 - t * 0.8);
      p.setXYZ(j, x, t * 1.6 - t * t * 3.2, t * 4.2 + Math.abs(x) * 0.4);
    }
    f.rotateY(i / 10 * Math.PI * 2 + rng() * 0.3);
    f.translate(0, 9.1, 0);
    parts.push(f.toNonIndexed());
  }
  const crown = lobe(0.5, 0, 9.0, 0, rng, 0);
  parts.push(crown);
  const g = mergeGeometries(parts);
  return shadeCanopy(g, 7, 10, rng, true);
}
