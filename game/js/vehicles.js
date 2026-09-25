// Vehicles: procedural models, arcade driving physics, helicopters, tanks,
// damage/fire/explosions and vehicle-vs-vehicle collisions.
import * as THREE from 'three';
import { GeoBuilder, mat } from './geo.js';
import { clamp, lerp, rand, pick, wrapAngle, smoothDamp } from './util.js';

export const VEHICLE_TYPES = {
  sedan: { name: 'Oceanic LX', style: 'sedan', len: 4.6, wid: 1.9, hgt: 1.5, maxSpeed: 42, accel: 14, brake: 32, steer: 1.0, grip: 7, mass: 1.2, hp: 900, wheelR: 0.36, colors: ['#8a1c1c', '#1c3f8a', '#e8e8e8', '#2b2b2b', '#6b7a8a', '#3a6b3a', '#b8a888', '#5a2a6a'] },
  sports: { name: 'Comet X', style: 'sports', len: 4.4, wid: 2.0, hgt: 1.2, maxSpeed: 70, accel: 30, brake: 42, steer: 1.15, grip: 9, mass: 1.0, hp: 800, wheelR: 0.36, colors: ['#ff2a2a', '#ffcc00', '#00c2ff', '#ff6a00', '#111111', '#b400ff', '#00d27a'] },
  muscle: { name: 'Dominator Bayou', style: 'muscle', len: 4.9, wid: 2.0, hgt: 1.35, maxSpeed: 58, accel: 25, brake: 34, steer: 0.95, grip: 5.5, mass: 1.4, hp: 1000, wheelR: 0.38, colors: ['#1a1a1a', '#b01e1e', '#1e4db0', '#e8a000', '#3a3a3a', '#6a0dad'] },
  pickup: { name: 'Bison Lone Star', style: 'pickup', len: 5.4, wid: 2.1, hgt: 1.9, maxSpeed: 44, accel: 16, brake: 30, steer: 0.9, grip: 6.5, mass: 1.8, hp: 1300, wheelR: 0.45, colors: ['#8b0000', '#f0f0f0', '#1a1a1a', '#2f4f4f', '#8b6b3a', '#1c3f8a'] },
  police: { name: 'Police Cruiser', style: 'police', len: 4.9, wid: 1.95, hgt: 1.55, maxSpeed: 60, accel: 24, brake: 38, steer: 1.05, grip: 8, mass: 1.5, hp: 1200, wheelR: 0.37, colors: ['#111111'] },
  taxi: { name: 'Downtown Cab', style: 'taxi', len: 4.7, wid: 1.9, hgt: 1.5, maxSpeed: 42, accel: 14, brake: 32, steer: 1.0, grip: 7, mass: 1.2, hp: 900, wheelR: 0.36, colors: ['#ffc81a'] },
  van: { name: 'Gumbo Delivery', style: 'van', len: 5.4, wid: 2.1, hgt: 2.5, maxSpeed: 36, accel: 11, brake: 26, steer: 0.85, grip: 6, mass: 2.0, hp: 1300, wheelR: 0.4, colors: ['#f0f0f0', '#e0c080', '#3a6ea5', '#6b8e23'] },
  bus: { name: 'Transit Bus', style: 'bus', len: 11, wid: 2.6, hgt: 3.2, maxSpeed: 30, accel: 8, brake: 20, steer: 0.7, grip: 6, mass: 5, hp: 2500, wheelR: 0.55, colors: ['#e8e8e8', '#f2a900', '#2f6fb0'] },
  bike: { name: 'Hellcat 1000', style: 'bike', len: 2.2, wid: 0.8, hgt: 1.2, maxSpeed: 68, accel: 32, brake: 40, steer: 1.4, grip: 8, mass: 0.5, hp: 500, wheelR: 0.34, colors: ['#ff2a2a', '#111111', '#00a8ff', '#ffcc00', '#39ff14'] },
  monster: { name: 'Mardi Monster', style: 'monster', len: 5.6, wid: 3.2, hgt: 3.4, maxSpeed: 48, accel: 22, brake: 34, steer: 0.9, grip: 6, mass: 6, hp: 4000, wheelR: 1.15, step: 2.6, crusher: true, colors: ['#7a3fbf', '#2fa84f', '#e8c33a'] },
  tank: { name: 'Gator M1 Tank', style: 'tank', len: 7.8, wid: 3.6, hgt: 2.8, maxSpeed: 22, accel: 9, brake: 26, steer: 0.7, grip: 14, mass: 20, hp: 12000, wheelR: 0.5, step: 1.5, crusher: true, colors: ['#4b5a32'] },
  heli: { name: 'Hornet Heli', style: 'heli', kind: 'heli', len: 10, wid: 2.4, hgt: 3, maxSpeed: 55, accel: 20, mass: 3, hp: 1500, wheelR: 0, colors: ['#1a1a1a', '#b01e1e', '#1e4db0', '#f0f0f0'] },
  policeHeli: { name: 'Police Eye', style: 'heli', kind: 'heli', len: 10, wid: 2.4, hgt: 3, maxSpeed: 55, accel: 20, mass: 3, hp: 1500, wheelR: 0, colors: ['#1c2c5a'], police: true },
};

// ------------------------------------------------------------------ materials
const paintCache = new Map();
function paintMat(hex) {
  let m = paintCache.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.55, roughness: 0.32 });
    paintCache.set(hex, m);
  }
  return m;
}
const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.45 });
const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
export const charredMat = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1, metalness: 0.1 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 0.9, roughness: 0.25 });
const redOn = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
const blueOn = new THREE.MeshBasicMaterial({ color: 0x1a4dff });
const lightOff = new THREE.MeshStandardMaterial({ color: 0x552222 });
const lightOffB = new THREE.MeshStandardMaterial({ color: 0x222255 });
const brakeMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0x801010 });
const wheelGeoCache = new Map();

function wheelGeo(r, w) {
  const k = r + ':' + w;
  if (!wheelGeoCache.has(k)) {
    const t = new THREE.CylinderGeometry(r, r, w, 14);
    t.rotateZ(Math.PI / 2);
    const h = new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 8);
    h.rotateZ(Math.PI / 2);
    wheelGeoCache.set(k, [t, h]);
  }
  return wheelGeoCache.get(k);
}

const GLASS = '#1b2633', CHROME = '#c8c8c8', BLACK = '#161616', GRILL = '#222';

// ---------------------------------------------------------------- model build
function buildModel(T, color) {
  const group = new THREE.Group();
  const body = new THREE.Group(); // tilts with suspension
  group.add(body);
  const P = new GeoBuilder(); // paint
  const D = new GeoBuilder(); // details
  const Lm = new GeoBuilder(); // lamps
  const parts = { wheels: [], steer: [] };
  const L = T.len, W = T.wid;
  const hl = '#fff6d8', tl = '#ff2a2a';
  const tails = new GeoBuilder();

  const addWheels = (r, wid, zs, xs, y = r) => {
    const [tg, hg] = wheelGeo(r, wid);
    for (const z of zs) {
      for (const x of xs) {
        const pivot = new THREE.Group();
        pivot.position.set(x, y, z);
        const spin = new THREE.Group();
        spin.add(new THREE.Mesh(tg, tireMat), new THREE.Mesh(hg, hubMat));
        spin.children[0].castShadow = true;
        pivot.add(spin);
        body.add(pivot);
        parts.wheels.push(spin);
        if (z > 0) parts.steer.push(pivot);
      }
    }
  };
  const lamps = (y, zf, zr, xw, h = 0.18) => {
    Lm.box(-xw, y, zf, 0.45, h, 0.08, hl); Lm.box(xw, y, zf, 0.45, h, 0.08, hl);
    tails.box(-xw, y, zr, 0.45, h, 0.08, tl); tails.box(xw, y, zr, 0.45, h, 0.08, tl);
  };

  switch (T.style) {
    case 'sedan': case 'police': case 'taxi': {
      P.box(0, 0.3, 0, W, 0.62, L, color);
      D.box(0, 0.92, -0.2, W * 0.86, 0.52, L * 0.46, GLASS);
      P.box(0, 1.44, -0.25, W * 0.84, 0.08, L * 0.38, color);
      D.box(0, 0.3, L / 2 + 0.05, W * 0.9, 0.28, 0.12, GRILL);
      D.box(0, 0.25, -L / 2 - 0.05, W * 0.9, 0.2, 0.1, BLACK);
      lamps(0.62, L / 2 + 0.02, -L / 2 - 0.02, W / 2 - 0.35);
      if (T.style === 'police') {
        D.box(0, 0.45, 0.2, W + 0.02, 0.45, L * 0.52, '#f4f4f4');
        D.box(0, 0.93, -0.2, W * 0.87, 0.02, L * 0.3, GLASS);
        D.box(0, 1.52, -0.25, 1.4, 0.1, 0.35, '#333');
        const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.3), redOn);
        red.position.set(-0.38, 1.66, -0.25);
        const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.3), blueOn);
        blue.position.set(0.38, 1.66, -0.25);
        body.add(red, blue);
        parts.lightbar = [red, blue];
      }
      if (T.style === 'taxi') {
        Lm.box(0, 1.52, -0.25, 0.9, 0.3, 0.35, '#fff3a0');
        D.box(0, 0.62, 0.1, W + 0.02, 0.1, L * 0.7, '#111');
      }
      addWheels(T.wheelR, 0.28, [L * 0.32, -L * 0.3], [-W / 2 + 0.12, W / 2 - 0.12]);
      break;
    }
    case 'sports': {
      P.box(0, 0.22, 0, W, 0.5, L, color);
      P.box(0, 0.72, L * 0.25, W * 0.9, 0.08, L * 0.4, color);
      D.box(0, 0.72, -0.35, W * 0.8, 0.38, L * 0.34, GLASS);
      P.box(0, 1.1, -0.45, W * 0.72, 0.05, L * 0.22, color);
      D.box(0, 1.0, -L / 2 + 0.2, W * 0.95, 0.06, 0.4, BLACK);
      D.box(-W * 0.35, 0.72, -L / 2 + 0.3, 0.08, 0.28, 0.1, BLACK);
      D.box(W * 0.35, 0.72, -L / 2 + 0.3, 0.08, 0.28, 0.1, BLACK);
      D.box(0, 0.2, L / 2 + 0.03, W * 0.8, 0.2, 0.08, GRILL);
      lamps(0.5, L / 2 + 0.02, -L / 2 - 0.02, W / 2 - 0.4, 0.12);
      addWheels(T.wheelR, 0.34, [L * 0.33, -L * 0.3], [-W / 2 + 0.12, W / 2 - 0.12]);
      break;
    }
    case 'muscle': {
      P.box(0, 0.3, 0, W, 0.62, L, color);
      D.box(0, 0.92, -0.35, W * 0.84, 0.42, L * 0.38, GLASS);
      P.box(0, 1.34, -0.4, W * 0.82, 0.07, L * 0.3, color);
      D.box(-0.25, 0.925, 0.8, 0.22, 0.01, L * 0.45, '#f0f0f0');
      D.box(0.25, 0.925, 0.8, 0.22, 0.01, L * 0.45, '#f0f0f0');
      D.box(0, 0.92, L * 0.22, 0.7, 0.22, 0.9, BLACK); // hood scoop
      D.box(0, 0.3, L / 2 + 0.05, W * 0.95, 0.3, 0.12, CHROME);
      D.box(0, 0.25, -L / 2 - 0.05, W * 0.95, 0.22, 0.12, CHROME);
      lamps(0.62, L / 2 + 0.02, -L / 2 - 0.02, W / 2 - 0.35);
      addWheels(T.wheelR, 0.36, [L * 0.32, -L * 0.3], [-W / 2 + 0.12, W / 2 - 0.12]);
      break;
    }
    case 'pickup': case 'monster': {
      const lift = T.style === 'monster' ? 1.5 : 0;
      P.box(0, 0.45 + lift, 0.2, W, 0.75, L - 0.4, color);
      P.box(0, 1.2 + lift, 0.55, W * 0.94, 0.6, L * 0.32, color);
      D.box(0, 1.25 + lift, 0.55, W * 0.95, 0.46, L * 0.3, GLASS);
      P.box(0, 1.8 + lift, 0.55, W * 0.94, 0.08, L * 0.3, color);
      D.box(0, 1.2 + lift, -L * 0.28, W * 0.9, 0.08, L * 0.38, '#2a2a2a'); // bed floor
      D.box(0, 0.45 + lift, L / 2 + 0.02, W, 0.5, 0.15, CHROME);
      D.box(0, 0.38 + lift, -L / 2 + 0.2, W, 0.25, 0.12, CHROME);
      lamps(0.9 + lift, L / 2 + 0.07, -L / 2 + 0.2, W / 2 - 0.35);
      if (T.style === 'monster') {
        D.box(0, 1.0, 0, 1.2, 0.8, L * 0.8, '#333');
        Lm.box(0, 2.95 + lift - 0.9, 0.95, W * 0.8, 0.2, 0.15, '#fffbe0');
        // mardi gras beads
        D.box(0, 1.22 + lift, 0.2, W + 0.05, 0.08, 0.08, '#e8c33a');
        addWheels(T.wheelR, 0.9, [L * 0.34, -L * 0.34], [-W / 2 - 0.2, W / 2 + 0.2]);
      } else {
        addWheels(T.wheelR, 0.32, [L * 0.33, -L * 0.3], [-W / 2 + 0.14, W / 2 - 0.14]);
      }
      break;
    }
    case 'van': {
      P.box(0, 0.35, 0, W, 2.0, L, color);
      D.box(0, 1.35, L / 2 - 0.25, W * 0.92, 0.7, 0.55, GLASS);
      D.box(-W / 2 - 0.01, 1.4, L * 0.28, 0.02, 0.6, 1.0, GLASS);
      D.box(W / 2 + 0.01, 1.4, L * 0.28, 0.02, 0.6, 1.0, GLASS);
      D.box(0, 0.35, L / 2 + 0.05, W * 0.95, 0.3, 0.12, GRILL);
      lamps(0.75, L / 2 + 0.02, -L / 2 - 0.02, W / 2 - 0.35);
      addWheels(T.wheelR, 0.3, [L * 0.33, -L * 0.32], [-W / 2 + 0.14, W / 2 - 0.14]);
      break;
    }
    case 'bus': {
      P.box(0, 0.4, 0, W, 2.8, L, color);
      D.box(-W / 2 - 0.01, 1.7, -0.2, 0.02, 1.0, L * 0.8, GLASS);
      D.box(W / 2 + 0.01, 1.7, -0.2, 0.02, 1.0, L * 0.8, GLASS);
      D.box(0, 1.3, L / 2 + 0.01, W * 0.9, 1.6, 0.02, GLASS);
      Lm.box(0, 2.85, L / 2 + 0.02, W * 0.6, 0.3, 0.04, '#ffae00');
      lamps(0.7, L / 2 + 0.02, -L / 2 - 0.02, W / 2 - 0.35);
      addWheels(T.wheelR, 0.4, [L * 0.35, -L * 0.3], [-W / 2 + 0.2, W / 2 - 0.2]);
      break;
    }
    case 'bike': {
      P.box(0, 0.55, 0.1, 0.45, 0.45, 1.3, color);
      P.box(0, 0.78, 0.55, 0.5, 0.3, 0.5, color);
      D.box(0, 0.9, -0.35, 0.35, 0.12, 0.8, BLACK);
      D.box(0, 1.05, 0.75, 0.8, 0.06, 0.06, CHROME);
      D.box(0, 0.3, 0.9, 0.08, 0.6, 0.08, CHROME);
      Lm.box(0, 0.85, 0.82, 0.2, 0.15, 0.06, hl);
      tails.box(0, 0.8, -0.8, 0.2, 0.1, 0.06, tl);
      const [tg, hg] = wheelGeo(T.wheelR, 0.16);
      for (const z of [0.85, -0.75]) {
        const pivot = new THREE.Group(); pivot.position.set(0, T.wheelR, z);
        const spin = new THREE.Group(); spin.add(new THREE.Mesh(tg, tireMat), new THREE.Mesh(hg, hubMat));
        pivot.add(spin); body.add(pivot); parts.wheels.push(spin); if (z > 0) parts.steer.push(pivot);
      }
      // rider
      const rider = new THREE.Group();
      const jacket = new THREE.MeshStandardMaterial({ color: 0x222222 });
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.3), jacket); t.position.set(0, 1.35, -0.15); t.rotation.x = 0.5;
      const hd = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xcc2222, metalness: 0.5, roughness: 0.2 })); hd.position.set(0, 1.78, 0.05);
      const la = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.6), jacket); la.position.set(-0.3, 1.3, 0.3); la.rotation.x = -0.4;
      const ra = la.clone(); ra.position.x = 0.3;
      const ll = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), new THREE.MeshStandardMaterial({ color: 0x223355 })); ll.position.set(-0.22, 0.95, 0.1);
      const rl = ll.clone(); rl.position.x = 0.22;
      rider.add(t, hd, la, ra, ll, rl);
      rider.visible = false;
      body.add(rider);
      parts.rider = rider;
      break;
    }
    case 'tank': {
      P.box(0, 0.6, 0, W * 0.78, 1.0, L, color);
      P.box(0, 1.6, 0.2, W * 0.95, 0.5, L * 0.85, color);
      D.box(-W / 2 + 0.4, 0.0, 0, 0.8, 1.3, L * 1.02, '#1c1c1c');
      D.box(W / 2 - 0.4, 0.0, 0, 0.8, 1.3, L * 1.02, '#1c1c1c');
      Lm.box(-0.9, 1.5, L / 2 + 0.02, 0.3, 0.2, 0.05, hl); Lm.box(0.9, 1.5, L / 2 + 0.02, 0.3, 0.2, 0.05, hl);
      const turret = new THREE.Group();
      turret.position.set(0, 2.1, -0.2);
      const tb = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 3.4), paintMat(color)); tb.position.y = 0.45; tb.castShadow = true;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5, 10), paintMat(color));
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.55, 3.9);
      const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 10), paintMat('#3b4828')); hatch.position.set(0.6, 1.0, -0.6);
      turret.add(tb, barrel, hatch);
      body.add(turret);
      parts.turret = turret;
      // road wheels (visual spin)
      const [tg, hg] = wheelGeo(0.45, 0.3);
      for (const z of [-2.8, -1.4, 0, 1.4, 2.8]) {
        for (const x of [-W / 2 + 0.4, W / 2 - 0.4]) {
          const spin = new THREE.Group(); spin.position.set(x * 1.02, 0.45, z);
          spin.add(new THREE.Mesh(tg, tireMat), new THREE.Mesh(hg, hubMat));
          body.add(spin); parts.wheels.push(spin);
        }
      }
      break;
    }
    case 'heli': {
      P.box(0, 0.8, 0.5, 2.2, 2.0, 4.2, color);
      D.box(0, 1.2, 2.3, 2.0, 1.4, 1.0, GLASS);
      P.box(0, 1.5, -3.3, 0.5, 0.5, 5, color);
      P.box(0, 1.6, -5.6, 0.15, 1.6, 0.9, color);
      P.box(0, 2.8, 0.3, 1.0, 0.3, 1.8, color);
      D.box(-0.9, 0, 0.4, 0.12, 0.12, 4.2, '#444');
      D.box(0.9, 0, 0.4, 0.12, 0.12, 4.2, '#444');
      D.box(-0.9, 0.1, 1.2, 0.08, 0.7, 0.08, '#444'); D.box(0.9, 0.1, 1.2, 0.08, 0.7, 0.08, '#444');
      D.box(-0.9, 0.1, -0.6, 0.08, 0.7, 0.08, '#444'); D.box(0.9, 0.1, -0.6, 0.08, 0.7, 0.08, '#444');
      if (T.police) {
        D.box(0, 1.0, 0.5, 2.22, 0.3, 4.0, '#f4f4f4');
        Lm.box(0, 0.05, 2.3, 0.5, 0.35, 0.5, '#ffffcc');
      } else {
        // rocket pods
        D.box(-1.35, 0.9, 0.8, 0.35, 0.35, 1.6, '#333'); D.box(1.35, 0.9, 0.8, 0.35, 0.35, 1.6, '#333');
        D.box(-1.2, 1.05, 0.8, 0.5, 0.08, 0.4, '#333'); D.box(1.2, 1.05, 0.8, 0.5, 0.08, 0.4, '#333');
      }
      tails.box(0, 1.6, -6.1, 0.2, 0.2, 0.1, tl);
      const rotor = new THREE.Group(); rotor.position.set(0, 3.1, 0.3);
      const bladeM = new THREE.MeshStandardMaterial({ color: 0x222222 });
      const blade = new THREE.BoxGeometry(11, 0.06, 0.35);
      const b1 = new THREE.Mesh(blade, bladeM), b2 = new THREE.Mesh(blade, bladeM); b2.rotation.y = Math.PI / 2;
      rotor.add(b1, b2);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.0, depthWrite: false }));
      rotor.add(disc);
      body.add(rotor);
      const tr = new THREE.Group(); tr.position.set(0.2, 1.8, -5.8);
      const tb1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.18), bladeM); tr.add(tb1);
      body.add(tr);
      parts.rotor = rotor; parts.tailRotor = tr; parts.rotorDisc = disc;
      break;
    }
  }

  const paint = new THREE.Mesh(P.build(), paintMat(color));
  paint.castShadow = true;
  body.add(paint);
  parts.paint = paint;
  if (D.vertexCount) {
    const det = new THREE.Mesh(D.build(), detailMat);
    det.castShadow = true;
    body.add(det);
  }
  if (Lm.vertexCount) body.add(new THREE.Mesh(Lm.build(), lampMat));
  if (tails.vertexCount) {
    const tm = new THREE.Mesh(tails.build(), tailMat);
    body.add(tm);
    parts.tails = tm;
  }
  parts.body = body;
  return { group, parts };
}

// -------------------------------------------------------------------- Vehicle
let VID = 1;
export class Vehicle {
  constructor(game, type, x, z, h, opts = {}) {
    this.id = VID++;
    this.game = game;
    this.type = type;
    this.T = VEHICLE_TYPES[type];
    this.color = opts.color || pick(this.T.colors);
    const { group, parts } = buildModel(this.T, this.color);
    this.group = group;
    this.parts = parts;
    this.pos = group.position;
    this.pos.set(x, opts.y || 0, z);
    this.h = h;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.grounded = true;
    this.health = this.T.hp;
    this.dead = false;
    this.onFire = false;
    this.burnTimer = 0;
    this.driver = null;          // 'player' | 'ai' | null
    this.ai = null;
    this.isPolice = type === 'police' || type === 'policeHeli';
    this.siren = false;
    this.input = { throttle: 0, steer: 0, handbrake: false, nitro: false, lift: 0, yaw: 0, pitch: 0 };
    this.steerVis = 0;
    this.pitchVis = 0; this.rollVis = 0;
    this.yawRate = 0;
    this.airTime = 0;
    this.maxAir = 0;
    this.drifting = 0;
    this.rotorSpeed = opts.rotorOn ? 1 : 0;
    this.turretYaw = h;
    this.inWater = false;
    this.wreckTimer = 0;
    this.crushed = false;
    this.persistent = !!opts.persistent;
    this.circles = [];
    this.radius = Math.max(this.T.len, this.T.wid) / 2;
    const n = Math.max(1, Math.round(this.T.len / this.T.wid));
    for (let i = 0; i < n; i++) {
      this.circles.push(n === 1 ? 0 : -this.T.len / 2 + this.T.wid / 2 + i * (this.T.len - this.T.wid) / (n - 1));
    }
    this.cr = this.T.wid / 2 + 0.05;
    this.isHeli = this.T.kind === 'heli';
    group.rotation.order = 'YXZ';
    this.syncVisual(0);
    game.scene.add(group);
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h); }

  remove() {
    this.game.scene.remove(this.group);
    this.removed = true;
  }

  damage(amount, source) {
    if (this.dead) return;
    if (this.type === 'tank') amount *= source === 'explosion' ? 0.25 : 0.05;
    if (this.driver === 'player' && this.game.cheats.godmode) amount = 0;
    this.health -= amount;
    if (source === 'player' || source === 'explosion-player') this.lastHitByPlayer = true;
    if (this.health <= this.T.hp * 0.12 && !this.onFire) {
      this.onFire = true;
      this.burnTimer = 0;
    }
    if (this.health <= 0) this.explode();
  }

  explode() {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.onFire = true;
    this.parts.paint.material = charredMat;
    if (this.parts.lightbar) for (const l of this.parts.lightbar) l.material = lightOff;
    this.vy = 7 + Math.random() * 4;
    this.grounded = false;
    this.game.explosion(this.pos.x, this.pos.y + 1, this.pos.z, this.isHeli ? 1.6 : 1.2, this.lastHitByPlayer ? 'player' : 'world', this);
    this.game.onVehicleDestroyed(this);
  }

  // ------------------------------------------------------------------ update
  update(dt, world) {
    if (this.isHeli) this.updateHeli(dt, world);
    else this.updateCar(dt, world);
    // fire & smoke
    const fx = this.game.fx;
    const hp = this.health / this.T.hp;
    const hoodX = this.pos.x + Math.sin(this.h) * this.T.len * 0.35, hoodZ = this.pos.z + Math.cos(this.h) * this.T.len * 0.35;
    if (this.onFire) {
      this.burnTimer += dt;
      if (!this.dead) {
        this.health -= this.T.hp * 0.12 * dt / 4;
        if (this.health <= 0) this.explode();
      }
      if (Math.random() < dt * 30 && (!this.dead || this.burnTimer < 25)) {
        fx.fire(hoodX + rand(-0.5, 0.5), this.pos.y + this.T.hgt * 0.8, hoodZ + rand(-0.5, 0.5), this.dead ? 1.4 : 1);
      }
    } else if (hp < 0.4 && Math.random() < dt * (hp < 0.25 ? 20 : 8)) {
      fx.smoke(hoodX, this.pos.y + this.T.hgt * 0.7, hoodZ, hp < 0.25 ? 0.25 : 0.45);
    }
    if (this.dead) {
      this.wreckTimer += dt;
    }
    this.syncVisual(dt);
  }

  updateCar(dt, world) {
    const T = this.T;
    const inp = (this.driver && !this.dead && !this.inWater) ? this.input : NO_INPUT;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    // right vector = (-cos h, sin h)
    let vf = this.vx * sh + this.vz * ch;
    let vl = -this.vx * ch + this.vz * sh;
    let yawRate = 0;
    const nitro = inp.nitro && this.driver === 'player' && this.game.player.nitro > 0;

    if (this.grounded) {
      const max = T.maxSpeed * (nitro ? 1.35 : 1) * (this.inWater ? 0.1 : 1) * (this.game.cheats.fastCars && this.driver === 'player' ? 1.5 : 1);
      const thr = inp.throttle;
      if (thr > 0) {
        if (vf < -0.5) vf += T.brake * thr * dt;
        else {
          const r = clamp(vf / max, 0, 1.2);
          vf += T.accel * thr * (1 - r * r) * dt * (this.game.cheats.fastCars && this.driver === 'player' ? 1.6 : 1);
        }
      } else if (thr < 0) {
        if (vf > 0.5) vf += T.brake * thr * dt;
        else if (vf > -T.maxSpeed * 0.3) vf += T.accel * 0.6 * thr * dt;
      } else {
        const roll = 3 * dt;
        vf = Math.abs(vf) < roll ? 0 : vf - Math.sign(vf) * roll;
      }
      if (nitro) {
        vf += 22 * dt;
        this.game.player.nitro = Math.max(0, this.game.player.nitro - dt * 0.28);
        if (Math.random() < 0.8) {
          const bx = this.pos.x - sh * (T.len / 2 + 0.2), bz = this.pos.z - ch * (T.len / 2 + 0.2);
          this.game.fx.nitroFlame(bx, this.pos.y + 0.45, bz, -sh * 10 + this.vx, -ch * 10 + this.vz);
        }
      }
      if (vf > max * 1.02) vf -= (vf - max) * 2 * dt;
      // steering
      const spd = Math.abs(vf);
      const speedFactor = clamp(spd / 4, 0, 1);
      const rate = T.steer * 2.1 / (1 + spd * 0.028);
      yawRate = -inp.steer * rate * speedFactor * Math.sign(vf || 1);
      if (inp.handbrake) yawRate *= 1.45;
      this.h += yawRate * dt;
      const grip = inp.handbrake ? 1.2 : T.grip * (this.game.cheats.drift ? 0.25 : 1);
      vl *= Math.exp(-grip * dt);
      if (inp.handbrake) vf = Math.abs(vf) < 7 * dt ? 0 : vf - Math.sign(vf) * 7 * dt;
      this.drifting = Math.abs(vl);
      const s2 = Math.sin(this.h), c2 = Math.cos(this.h);
      this.vx = s2 * vf - c2 * vl;
      this.vz = c2 * vf + s2 * vl;
    } else {
      this.vy -= 24 * dt * (this.game.cheats.moonGravity ? 0.3 : 1);
      // a little air control
      this.h += -inp.steer * 0.8 * dt;
      yawRate = -inp.steer * 0.8;
      this.drifting = 0;
    }
    this.yawRate = smoothDamp(this.yawRate, yawRate, 8, dt);

    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.pos.y += this.vy * dt;

    // ground
    const step = T.step || 1.1;
    const gh = world.groundHeight(this.pos.x, this.pos.z, this.pos.y - (this.grounded ? 0 : 0), step);
    if (this.grounded) {
      if (gh >= this.pos.y - 0.4) {
        const newVy = dt > 0 ? (gh - this.pos.y) / dt : 0;
        this.vy = clamp(newVy, -8, 40);
        this.pos.y = gh;
        this.airTime = 0;
      } else {
        this.grounded = false;
        this.airStartY = this.pos.y;
        this.maxAir = 0;
      }
    } else {
      this.airTime += dt;
      this.maxAir = Math.max(this.maxAir, this.pos.y - gh);
      if (this.pos.y <= gh) {
        const impact = -this.vy;
        this.pos.y = gh;
        if (T.style === 'monster' && impact > 6) {
          this.vy = impact * 0.35;
        } else {
          this.vy = 0;
          this.grounded = true;
        }
        if (impact > 20 && !this.game.cheats.godmode) this.damage((impact - 20) * 15 / Math.sqrt(T.mass), 'fall');
        if (this.driver === 'player') this.game.onPlayerLanded(this, impact);
      }
    }

    // water
    this.inWater = world.isWater(this.pos.x, this.pos.z) && this.pos.y < 0;
    if (this.inWater) {
      this.vx *= Math.exp(-2 * dt); this.vz *= Math.exp(-2 * dt);
      if (!this.dead) {
        this.health -= this.T.hp * 0.25 * dt;
        if (this.health <= 0) { this.health = 0; this.dead = true; this.game.onVehicleDestroyed(this, true); }
      }
      this.pos.y = Math.max(this.pos.y - dt * 0.6, -2.6);
    }

    // buildings
    const out = this._out || (this._out = {});
    let hit = false, nx = 0, nz = 0;
    for (const off of this.circles) {
      const cx = this.pos.x + Math.sin(this.h) * off, cz = this.pos.z + Math.cos(this.h) * off;
      world.collideCircle(cx, cz, this.pos.y, this.cr, step, out);
      if (out.hit) {
        this.pos.x += out.x - cx; this.pos.z += out.z - cz;
        hit = true; nx += out.nx; nz += out.nz;
        this.lastWallKind = out.kind;
      }
    }
    if (hit) {
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        this.vx -= 1.25 * vn * nx; this.vz -= 1.25 * vn * nz;
        // scrape
        this.vx *= 0.92; this.vz *= 0.92;
        const impact = -vn;
        if (impact > 7) {
          this.damage(Math.min(T.hp * 0.3, (impact - 7) * 11 / Math.sqrt(T.mass)) * (T.crusher ? 0.3 : 1), 'crash');
          this.game.onVehicleCrash(this, impact, this.pos.x - nx * this.cr, this.pos.z - nz * this.cr);
        }
      }
    }
    this.moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
  }

  updateHeli(dt, world) {
    const T = this.T;
    const inp = (this.driver && !this.dead) ? this.input : NO_INPUT;
    const want = this.driver && !this.dead ? 1 : 0;
    this.rotorSpeed = lerp(this.rotorSpeed, want, 1 - Math.exp(-(want ? 0.8 : 0.3) * dt));
    const power = this.rotorSpeed > 0.75 ? 1 : 0;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    const thrust = T.accel * (this.game.cheats.fastCars && this.driver === 'player' ? 1.6 : 1);
    if (power) {
      this.vx += sh * inp.pitch * thrust * dt;
      this.vz += ch * inp.pitch * thrust * dt;
      // strafe with steer when holding handbrake? keep simple: yaw only
      this.vy += (inp.lift * 16 - this.vy * 1.8) * dt;
    } else {
      this.vy -= 18 * dt;
    }
    this.vx *= Math.exp(-0.7 * dt);
    this.vz *= Math.exp(-0.7 * dt);
    const yaw = this.dead ? 4 : -inp.yaw * 1.5;
    this.h += yaw * dt * (this.dead ? 1 : power);
    this.yawRate = smoothDamp(this.yawRate, yaw, 5, dt);
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y > 900) { this.pos.y = 900; this.vy = Math.min(this.vy, 0); }
    const gh = world.groundHeight(this.pos.x, this.pos.z, this.pos.y, 0.8);
    if (this.pos.y <= gh) {
      const impact = -this.vy;
      this.pos.y = gh;
      if (this.dead && !this.crashedDown) {
        this.crashedDown = true;
        this.game.explosion(this.pos.x, this.pos.y + 1, this.pos.z, 1.3, 'world', this);
      }
      if (impact > 12 && !this.dead) this.damage((impact - 12) * 120, 'crash');
      this.vy = Math.max(0, this.vy);
      this.vx *= Math.exp(-4 * dt); this.vz *= Math.exp(-4 * dt);
      this.grounded = true;
    } else {
      this.grounded = this.pos.y - gh < 0.2;
    }
    if (world.isWater(this.pos.x, this.pos.z) && this.pos.y < 0.5 && !this.dead) {
      this.dead = true; this.health = 0; this.game.onVehicleDestroyed(this, true);
    }
    // buildings
    const out = this._out || (this._out = {});
    world.collideCircle(this.pos.x, this.pos.z, this.pos.y, 3.2, 0.3, out);
    if (out.hit) {
      this.pos.x = out.x; this.pos.z = out.z;
      const vn = this.vx * out.nx + this.vz * out.nz;
      if (vn < 0) {
        this.vx -= 1.5 * vn * out.nx; this.vz -= 1.5 * vn * out.nz;
        if (-vn > 8) {
          this.damage((-vn - 8) * 60, 'crash');
          this.game.onVehicleCrash(this, -vn, this.pos.x, this.pos.z);
        }
      }
    }
    this.pitchTarget = this.dead ? 0.3 : inp.pitch * 0.28 + clamp(this.forwardSpeed / T.maxSpeed, -0.2, 0.2) * 0.4;
    this.drifting = 0;
    this.moved = 1;
  }

  syncVisual(dt) {
    const g = this.group;
    const T = this.T;
    let pitch, roll;
    if (this.isHeli) {
      pitch = this.pitchTarget || 0;
      roll = clamp(-this.yawRate * 0.12, -0.35, 0.35);
      if (this.parts.rotor) {
        this.parts.rotor.rotation.y += this.rotorSpeed * 30 * dt;
        this.parts.tailRotor.rotation.x += this.rotorSpeed * 40 * dt;
        this.parts.rotorDisc.material.opacity = this.rotorSpeed * 0.25;
      }
    } else {
      const vf = this.forwardSpeed;
      if (this.grounded) pitch = -Math.atan2(this.vy, Math.max(Math.abs(vf), 1)) * 0.8;
      else pitch = -Math.atan2(this.vy, Math.max(Math.abs(vf), 4)) * 0.6;
      roll = clamp(this.yawRate * Math.abs(vf) * 0.006, -0.1, 0.1);
      if (T.style === 'bike') roll = clamp(this.yawRate * Math.abs(vf) * 0.03, -0.7, 0.7);
      for (const w of this.parts.wheels) w.rotation.x += vf * dt / (T.wheelR || 0.4);
      this.steerVis = smoothDamp(this.steerVis, -this.input.steer * 0.5 * (this.driver ? 1 : 0), 10, dt);
      for (const s of this.parts.steer) s.rotation.y = this.steerVis;
      if (this.parts.turret) this.parts.turret.rotation.y = wrapAngle(this.turretYaw - this.h);
      if (this.parts.tails && !this.dead) {
        const braking = this.driver && ((this.input.throttle < 0 && vf > 1) || this.input.handbrake);
        this.parts.tails.material = braking ? brakeMat : tailMat;
      }
    }
    if (this.parts.lightbar && !this.dead) {
      const on = this.siren;
      const blink = Math.floor(performance.now() / 140) % 2 === 0;
      this.parts.lightbar[0].material = on && blink ? redOn : lightOff;
      this.parts.lightbar[1].material = on && !blink ? blueOn : lightOffB;
    }
    if (this.parts.rider) this.parts.rider.visible = !!this.driver;
    this.pitchVis = dt ? smoothDamp(this.pitchVis, pitch, 10, dt) : pitch;
    this.rollVis = dt ? smoothDamp(this.rollVis, roll, 8, dt) : roll;
    g.rotation.set(this.pitchVis, this.h, this.rollVis);
    if (this.crushed) g.scale.y = 0.45;
  }
}

const NO_INPUT = { throttle: 0, steer: 0, handbrake: true, nitro: false, lift: 0, yaw: 0, pitch: 0 };

// ------------------------------------------------------------- collisions
export function resolveVehicleCollisions(list, game) {
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const a = list[i];
    if (a.removed) continue;
    for (let j = i + 1; j < n; j++) {
      const b = list[j];
      if (b.removed) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const lim = a.radius + b.radius + 0.5;
      if (dx * dx + dz * dz > lim * lim) continue;
      if (Math.abs(a.pos.y - b.pos.y) > Math.max(a.T.hgt, b.T.hgt) * 0.9) continue;
      // circle vs circle over each body's circles
      let hit = false, nx = 0, nz = 0, pen = 0;
      const sa = Math.sin(a.h), ca = Math.cos(a.h), sb = Math.sin(b.h), cb = Math.cos(b.h);
      for (const oa of a.circles) {
        const ax = a.pos.x + sa * oa, az = a.pos.z + ca * oa;
        for (const ob of b.circles) {
          const bx = b.pos.x + sb * ob, bz = b.pos.z + cb * ob;
          const ddx = bx - ax, ddz = bz - az;
          const r = a.cr + b.cr;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < r * r) {
            const d = Math.sqrt(d2) || 0.01;
            const p = r - d;
            if (p > pen) { pen = p; nx = ddx / d; nz = ddz / d; hit = true; }
          }
        }
      }
      if (!hit) continue;
      // crushers drive over normal cars
      const rvx = a.vx - b.vx, rvz = a.vz - b.vz;
      const rel = Math.hypot(rvx, rvz);
      if (a.T.crusher && !b.T.crusher && !b.isHeli && rel > 3) { crush(b, a, game); continue; }
      if (b.T.crusher && !a.T.crusher && !a.isHeli && rel > 3) { crush(a, b, game); continue; }
      const ma = a.T.mass * (a.dead ? 1.5 : 1), mb = b.T.mass * (b.dead ? 1.5 : 1);
      const ia = 1 / ma, ib = 1 / mb;
      // separate
      const corr = pen / (ia + ib);
      a.pos.x -= nx * corr * ia; a.pos.z -= nz * corr * ia;
      b.pos.x += nx * corr * ib; b.pos.z += nz * corr * ib;
      const vrel = rvx * nx + rvz * nz; // positive = approaching
      if (vrel > 0) {
        const jimp = (1 + 0.25) * vrel / (ia + ib);
        a.vx -= jimp * ia * nx; a.vz -= jimp * ia * nz;
        b.vx += jimp * ib * nx; b.vz += jimp * ib * nz;
        if (vrel > 5) {
          const dmg = Math.min(700, (vrel - 5) * 20);
          const aByPlayer = a.driver === 'player', bByPlayer = b.driver === 'player';
          a.damage(dmg * mb / (ma + mb) * 1.4, bByPlayer ? 'player' : 'crash');
          b.damage(dmg * ma / (ma + mb) * 1.4, aByPlayer ? 'player' : 'crash');
          game.onVehicleCollision(a, b, vrel, (a.pos.x + b.pos.x) / 2, (a.pos.z + b.pos.z) / 2);
        }
      }
    }
  }
}

function crush(victim, crusher, game) {
  if (!victim.crushed) {
    victim.crushed = true;
    victim.damage(victim.T.hp * 0.95, crusher.driver === 'player' ? 'player' : 'crash');
    victim.vx *= 0.2; victim.vz *= 0.2;
    game.onCrush(victim, crusher);
  }
  crusher.pos.y = Math.max(crusher.pos.y, victim.pos.y + 0.6);
  crusher.vy = Math.max(crusher.vy, 3);
  crusher.grounded = false;
}
