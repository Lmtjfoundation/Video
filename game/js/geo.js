// GeoBuilder: accumulates boxes/quads into one BufferGeometry with vertex colours
// and world-scaled UVs. Merging keeps draw calls low for whole city blocks.
import * as THREE from 'three';

const tmpColor = new THREE.Color();

export class GeoBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
  }

  get vertexCount() { return this.pos.length / 3; }

  // p0..p3: bottom-left, bottom-right, top-right, top-left as seen from outside.
  quad(p0, p1, p2, p3, n, uvs, color) {
    const base = this.pos.length / 3;
    tmpColor.set(color);
    for (const p of [p0, p1, p2, p3]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    for (const u of uvs) this.uv.push(u[0], u[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Axis-aligned box. (cx, y0, cz) is the bottom centre.
  // opts.tileW/tileH scale side UVs in metres; opts.topTile maps the roof.
  box(cx, y0, cz, w, h, d, color, opts = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const y1 = y0 + h;
    const tw = opts.tileW || 0, th = opts.tileH || 0;
    const side = (len) => {
      if (!tw) return [[0, 0], [0, 0], [0, 0], [0, 0]];
      const u = len / tw, v = h / th;
      const vo = (opts.vOffset || 0);
      return [[0, vo], [u, vo], [u, vo + v], [0, vo + v]];
    };
    const flat = [[0.005, 0.005], [0.005, 0.005], [0.005, 0.005], [0.005, 0.005]];
    const topC = opts.topColor || color;
    const sideC = color;
    if (!opts.noSides) {
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], side(d), sideC);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side(d), sideC);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side(w), sideC);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], side(w), sideC);
    }
    if (!opts.noTop) {
      let uvs = flat;
      if (opts.topTile) {
        const t = opts.topTile;
        uvs = [[x0 / t, -z1 / t], [x1 / t, -z1 / t], [x1 / t, -z0 / t], [x0 / t, -z0 / t]];
      }
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], uvs, topC);
    }
    if (opts.bottom) {
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], flat, color);
    }
  }

  // Append an arbitrary THREE geometry (transformed) with a flat colour.
  addGeometry(geom, matrix, color) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    g.applyMatrix4(matrix);
    const p = g.attributes.position, n = g.attributes.normal;
    const base = this.pos.length / 3;
    tmpColor.set(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      this.uv.push(0.005, 0.005);
      this.idx.push(base + i);
    }
    g.dispose();
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const count = this.pos.length / 3;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.clone().compose(_p, _q, _s);
}
