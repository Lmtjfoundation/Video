// First-person hands and weapons. Each gun is modelled with its grip at the
// origin and the barrel pointing down -z; `sightY` is the height of the sight
// line above the grip (used to line the sights up with the screen centre when
// aiming), `support` is where the left hand holds it and `muzzle` is the tip.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const phys = (o) => new THREE.MeshPhysicalMaterial(o);
const MAT = {
  steel: phys({ color: 0x2a2c30, metalness: 0.85, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  blued: phys({ color: 0x15171b, metalness: 0.8, roughness: 0.4 }),
  polymer: phys({ color: 0x1d1e20, metalness: 0.0, roughness: 0.62 }),
  tan: phys({ color: 0x8a7556, metalness: 0.0, roughness: 0.7 }),
  wood: phys({ color: 0x5e3519, metalness: 0.0, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  olive: phys({ color: 0x4a5231, metalness: 0.1, roughness: 0.7 }),
  brass: phys({ color: 0xc9a14a, metalness: 1, roughness: 0.25 }),
  sight: new THREE.MeshBasicMaterial({ color: 0x7dff6a }),
  skin: new THREE.MeshStandardMaterial({ color: 0x9a6a4a, roughness: 0.55 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x222325, roughness: 0.8 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x3a3f35, roughness: 0.9 }),
  cuff: new THREE.MeshStandardMaterial({ color: 0x2c3029, roughness: 0.95 }),
};

const boxCache = new Map();
function box(g, m, w, h, d, x, y, z, rx = 0) {
  const key = `${w},${h},${d}`;
  let geo = boxCache.get(key);
  if (!geo) {
    // softened edges catch highlights the way machined parts do
    geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.28);
    boxCache.set(key, geo);
  }
  const b = new THREE.Mesh(geo, m);
  b.position.set(x, y, z); b.rotation.x = rx;
  g.add(b); return b;
}
function cyl(g, m, r, len, x, y, z, seg = 16, r2 = r) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, seg), m);
  c.rotation.x = Math.PI / 2; c.position.set(x, y, z);
  g.add(c); return c;
}

// --------------------------------------------------------------------- hands
// Hand wrapped around a vertical grip: palm, four curled fingers and a thumb.
function hand(glove, open = false) {
  const h = new THREE.Group();
  const m = glove ? MAT.glove : MAT.skin;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.085, 0.075), m);
  palm.position.set(0.022, -0.005, 0.02);
  h.add(palm);
  const fg = new THREE.CapsuleGeometry(0.0095, 0.03, 3, 8);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set(0.02, 0.025 - i * 0.021, -0.012);
    const a = new THREE.Mesh(fg, m); a.rotation.z = Math.PI / 2; a.position.x = -0.02;
    const b = new THREE.Mesh(fg, m); b.rotation.x = Math.PI / 2; b.position.set(-0.042, 0, -0.02);
    f.add(a);
    if (!open) f.add(b);
    f.rotation.y = open ? -0.4 : 0;
    h.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.04, 3, 8), m);
  thumb.rotation.set(Math.PI / 2, 0, 0.5);
  thumb.position.set(-0.012, 0.035, -0.02);
  h.add(thumb);
  return h;
}

// forearm running from the wrist back towards the shoulder (+z)
function arm(side) {
  const a = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.034, 0.42, 14), MAT.sleeve);
  fore.rotation.x = Math.PI / 2;
  fore.position.set(0, 0, 0.3);
  // a few creases in the sleeve
  for (const z of [0.2, 0.3, 0.4]) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.038 + z * 0.02, 0.004, 6, 16), MAT.cuff);
    c.position.z = z; a.add(c);
  }
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.05, 14), MAT.cuff);
  cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0, 0.08);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.06, 12), MAT.skin);
  wrist.rotation.x = Math.PI / 2; wrist.position.set(0, 0, 0.045);
  a.add(fore, cuff, wrist);
  a.rotation.y = side * 0.35;
  a.rotation.x = 0.25;
  return a;
}

function fist() {
  const g = new THREE.Group();
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.035, 0.08, 2, 0.012), MAT.glove);
  back.position.set(0, 0.012, 0);
  g.add(back);
  // curled fingers: one rounded row per finger
  const fg = new THREE.CapsuleGeometry(0.011, 0.03, 3, 8);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(fg, MAT.glove);
    f.rotation.x = Math.PI / 2;
    f.position.set(-0.03 + i * 0.02, -0.012, -0.04);
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.04, 3, 8), MAT.glove);
  thumb.rotation.z = Math.PI / 2; thumb.position.set(0, -0.03, -0.02);
  g.add(thumb);
  return g;
}

// ------------------------------------------------------------------- weapons
function pistol() {
  const g = new THREE.Group();
  // slide with serrations and ejection port
  box(g, MAT.steel, 0.03, 0.034, 0.19, 0, 0.055, -0.075);
  for (let i = 0; i < 7; i++) box(g, MAT.blued, 0.032, 0.026, 0.003, 0, 0.056, 0.005 - i * 0.007);
  box(g, MAT.blued, 0.031, 0.012, 0.035, 0.001, 0.068, -0.07);
  cyl(g, MAT.blued, 0.007, 0.01, 0, 0.05, -0.172, 10);
  // frame, dust cover, trigger guard
  box(g, MAT.polymer, 0.028, 0.024, 0.16, 0, 0.028, -0.065);
  box(g, MAT.polymer, 0.028, 0.008, 0.055, 0, 0.004, -0.06);
  box(g, MAT.polymer, 0.028, 0.03, 0.008, 0, 0.015, -0.088);
  box(g, MAT.blued, 0.006, 0.02, 0.006, 0, 0.012, -0.055);
  // grip with texture panels and the magazine base
  const grip = box(g, MAT.polymer, 0.03, 0.11, 0.045, 0, -0.035, 0.005, -0.22);
  box(g, MAT.blued, 0.031, 0.07, 0.03, 0, -0.035, 0.005, -0.22);
  box(g, MAT.polymer, 0.034, 0.012, 0.05, 0, -0.092, 0.018, -0.22);
  grip.userData.mag = true;
  // sights with tritium dots
  box(g, MAT.blued, 0.006, 0.01, 0.008, 0, 0.077, -0.162);
  box(g, MAT.blued, 0.024, 0.01, 0.01, 0, 0.077, 0.008);
  box(g, MAT.sight, 0.003, 0.003, 0.002, 0, 0.08, -0.167);
  const mag = new THREE.Group();
  box(mag, MAT.blued, 0.024, 0.09, 0.028, 0, -0.04, 0.005, -0.22);
  g.add(mag);
  return { g, sightY: 0.078, muzzle: -0.18, support: null, hipPos: [0.14, -0.16, -0.4], ads: 0.34, adsFov: 60, mag };
}

function smg() {
  const g = new THREE.Group();
  // receiver
  box(g, MAT.steel, 0.04, 0.055, 0.26, 0, 0.045, -0.09);
  box(g, MAT.blued, 0.042, 0.01, 0.2, 0, 0.076, -0.09);
  // barrel shroud with cooling holes, barrel and muzzle
  cyl(g, MAT.blued, 0.018, 0.12, 0, 0.05, -0.28, 14);
  for (let i = 0; i < 4; i++) cyl(g, MAT.polymer, 0.0185, 0.008, 0, 0.05, -0.24 - i * 0.025, 14);
  cyl(g, MAT.steel, 0.011, 0.05, 0, 0.05, -0.355, 12);
  // handguard / foregrip
  box(g, MAT.polymer, 0.045, 0.035, 0.1, 0, 0.018, -0.19);
  box(g, MAT.polymer, 0.028, 0.07, 0.03, 0, -0.03, -0.2, 0.15);
  // pistol grip + trigger guard
  box(g, MAT.polymer, 0.032, 0.1, 0.042, 0, -0.035, 0.005, -0.25);
  box(g, MAT.polymer, 0.03, 0.008, 0.06, 0, -0.005, -0.05);
  // curved magazine
  const mag = new THREE.Group();
  for (let i = 0; i < 5; i++) box(mag, MAT.blued, 0.024, 0.035, 0.034, 0, -0.005 - i * 0.03, -0.1 - i * 0.006, 0.12);
  g.add(mag);
  // rear end cap and cocking handle
  box(g, MAT.polymer, 0.042, 0.05, 0.02, 0, 0.045, 0.05);
  box(g, MAT.blued, 0.012, 0.012, 0.03, -0.024, 0.06, -0.19);
  // rear/front sights
  box(g, MAT.blued, 0.016, 0.02, 0.012, 0, 0.09, 0.02);
  box(g, MAT.blued, 0.004, 0.022, 0.008, 0, 0.088, -0.2);
  box(g, MAT.sight, 0.003, 0.003, 0.002, 0, 0.098, -0.205);
  return { g, sightY: 0.096, muzzle: -0.38, support: [0, -0.02, -0.2], hipPos: [0.15, -0.17, -0.4], ads: 0.36, adsFov: 55, mag };
}

function shotgun() {
  const g = new THREE.Group();
  box(g, MAT.steel, 0.042, 0.06, 0.2, 0, 0.04, -0.07);        // receiver
  box(g, MAT.brass, 0.012, 0.012, 0.03, 0.021, 0.045, -0.08); // shell in the port
  cyl(g, MAT.blued, 0.013, 0.5, 0, 0.062, -0.42, 14);          // barrel
  cyl(g, MAT.blued, 0.012, 0.42, 0, 0.03, -0.37, 14);          // magazine tube
  box(g, MAT.blued, 0.03, 0.02, 0.02, 0, 0.046, -0.64);        // barrel clamp
  // pump forend (moves when racked)
  const pump = new THREE.Group();
  const fe = cyl(pump, MAT.wood, 0.024, 0.16, 0, 0.03, -0.3, 16);
  for (let i = 0; i < 6; i++) cyl(pump, MAT.blued, 0.0245, 0.005, 0, 0.03, -0.24 - i * 0.024, 16);
  fe.userData.pump = true;
  g.add(pump);
  // wooden stock and grip
  box(g, MAT.wood, 0.036, 0.09, 0.05, 0, -0.03, 0.02, -0.35);
  const stock = box(g, MAT.wood, 0.04, 0.07, 0.3, 0, -0.01, 0.2, -0.12);
  stock.scale.y = 1.2;
  box(g, MAT.polymer, 0.042, 0.1, 0.02, 0, -0.03, 0.35, -0.12);
  box(g, MAT.polymer, 0.03, 0.008, 0.06, 0, 0.0, -0.03);
  // bead sight
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), MAT.brass);
  bead.position.set(0, 0.078, -0.66); g.add(bead);
  return { g, sightY: 0.08, muzzle: -0.67, support: [0, 0.0, -0.3], hipPos: [0.15, -0.16, -0.36], ads: 0.3, adsFov: 58, pump };
}

function rpg() {
  const g = new THREE.Group();
  cyl(g, MAT.olive, 0.045, 1.0, 0, 0.1, -0.2, 20);                 // launch tube
  cyl(g, MAT.wood, 0.05, 0.2, 0, 0.1, -0.05, 20);                  // heat shield
  cyl(g, MAT.olive, 0.055, 0.14, 0, 0.1, 0.34, 20, 0.045);          // flared rear
  // warhead
  const wh = new THREE.Group();
  cyl(wh, MAT.olive, 0.042, 0.12, 0, 0.1, -0.76, 18);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.24, 18), MAT.olive);
  cone.rotation.x = -Math.PI / 2; cone.position.set(0, 0.1, -0.94); wh.add(cone);
  cyl(wh, MAT.olive, 0.065, 0.08, 0, 0.1, -0.8, 18);
  g.add(wh);
  box(g, MAT.polymer, 0.03, 0.1, 0.04, 0, 0.0, 0.0, -0.2);        // pistol grip
  box(g, MAT.polymer, 0.03, 0.1, 0.04, 0, 0.0, -0.25, -0.1);      // fore grip
  box(g, MAT.blued, 0.02, 0.06, 0.05, -0.05, 0.16, -0.1);          // optic
  return { g, sightY: 0.1, muzzle: -1.05, support: [0, 0.0, -0.25], hipPos: [0.2, -0.2, -0.38], ads: 0.34, adsFov: 50, warhead: wh };
}

function minigun() {
  const g = new THREE.Group();
  const barrels = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cyl(barrels, MAT.blued, 0.011, 0.7, Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0, 10);
  }
  for (const z of [-0.3, -0.1]) cyl(barrels, MAT.steel, 0.052, 0.025, 0, 0, z, 18);
  barrels.position.set(0, 0.05, -0.45);
  g.add(barrels);
  cyl(g, MAT.steel, 0.07, 0.22, 0, 0.05, -0.02, 20);            // motor housing
  box(g, MAT.olive, 0.12, 0.1, 0.16, 0, -0.02, 0.1);            // feed + battery
  box(g, MAT.polymer, 0.02, 0.12, 0.02, 0, 0.13, -0.05);        // carry handle posts
  box(g, MAT.polymer, 0.02, 0.02, 0.2, 0, 0.19, -0.02);
  box(g, MAT.polymer, 0.03, 0.1, 0.04, 0, -0.08, 0.05, -0.2);    // grip
  return { g, sightY: 0.2, muzzle: -0.82, support: [0, 0.19, -0.04], hipPos: [0.2, -0.22, -0.4], ads: 0.4, adsFov: 65, barrels };
}

const BUILDERS = { pistol, smg, shotgun, rpg, minigun };

// ----------------------------------------------------------------- assembly
export function buildViewmodel(camera, scene) {
  const vm = new THREE.Group();
  // right hand holds the grip; the gun hangs off it
  const right = new THREE.Group();
  const rArm = arm(1);
  const rHand = hand(true);
  right.add(rArm, rHand);
  vm.add(right);
  // left arm: either holding the support point (child of the right hand) or a free fist
  const leftSupport = new THREE.Group();
  const lArm = arm(-1);
  lArm.rotation.y = -0.9; lArm.rotation.x = 0.35;
  const lHand = hand(true, true);
  lHand.scale.x = -1;
  leftSupport.add(lArm, lHand);
  right.add(leftSupport);
  const leftFree = new THREE.Group();
  const lFreeArm = arm(-1);
  leftFree.add(lFreeArm, fist());
  vm.add(leftFree);
  const rightFist = fist();
  right.add(rightFist);

  const guns = {};
  for (const [name, build] of Object.entries(BUILDERS)) {
    const G = build();
    G.g.visible = false;
    right.add(G.g);
    guns[name] = G;
  }
  // muzzle flash: two crossed additive quads + a light that pops on each shot
  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = gr;
    x.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? 12 : 32;
      x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const fm = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const flash = new THREE.Group();
  const q1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm);
  const q2 = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.3), fm); q2.rotation.y = Math.PI / 2; q2.position.z = -0.1;
  const q3 = q2.clone(); q3.rotation.set(0, Math.PI / 2, Math.PI / 2);
  flash.add(q1, q2, q3);
  flash.visible = false;
  right.add(flash);
  const light = new THREE.PointLight(0xffb060, 0, 14, 1.6);
  right.add(light);

  vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  vm.visible = false;
  camera.add(vm);
  scene.add(camera);
  // shoulder anchors in camera space (the forearms are aimed at these every frame)
  const shoulderR = new THREE.Vector3(0.26, -0.34, 0.02), shoulderL = new THREE.Vector3(-0.26, -0.34, 0.02);
  return { group: vm, right, leftSupport, leftFree, rightFist, rHand, rArm, lArm, lFreeArm, shoulderR, shoulderL, guns, flash, light, tip: new THREE.Object3D() };
}
