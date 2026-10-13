import { H, W } from './constants';
import { fmt, flattenSegment, samplePath, type Point } from './geometry';

/* ═══════════════════ Outer boundary · parsing · corner rounding ═══════════════════
 * Architecture note: everything works on `Ring`s (closed point loops) and `CompoundPath`s
 * (lists of rings). `outerBoundary()` is the single entry point that later union / subtract /
 * intersect operations can build on: shapes → rings → planar arrangement → faces.
 */

export type V = { x: number; y: number };
export type Ring = V[];
export type CompoundPath = Ring[];
export type ParsedShape = { nodes: Point[]; closed: boolean; source: 'polygon' | 'polyline' | 'path' | 'points' };

/* ───────────────────────────── parsing ───────────────────────────── */

const NUM_RE = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

function parseLen(token: string, size: number, axis: 'x' | 'y'): number {
  const m = token.trim().match(new RegExp(`^(${NUM_RE})(%|px|rem|em|vw|vh)?$`, 'i'));
  if (!m) throw new Error(/calc|var|min|max|clamp/i.test(token) ? 'calc() and other CSS functions are not supported inside polygon()' : `Cannot read "${token.trim()}"`);
  const v = parseFloat(m[1]), unit = (m[2] ?? '').toLowerCase();
  if (unit === '%') return v / 100 * size;
  if (unit === 'rem' || unit === 'em') return v * 16;
  if (unit === 'vw') return v / 100 * (axis === 'x' ? size : W);
  if (unit === 'vh') return v / 100 * (axis === 'y' ? size : H);
  return v;
}

/** `0 0, 85% 0, …` (CSS) or `0,0 10,10 …` (SVG points). Percentages resolve against W × H. */
export function parsePointList(text: string): Point[] {
  const s = text.trim();
  if (!s) return [];
  const cssLike = /[%a-z]/i.test(s) || s.split(',').every(part => part.trim().split(/\s+/).length === 2);
  const pts: Point[] = [];
  if (cssLike) {
    for (const part of s.split(',')) {
      const t = part.trim().split(/\s+/);
      if (t.length !== 2) throw new Error(`Expected "x y" but found "${part.trim()}"`);
      pts.push({ x: parseLen(t[0], W, 'x'), y: parseLen(t[1], H, 'y'), mode: 'corner' });
    }
  } else {
    const t = s.split(/[\s,]+/).filter(Boolean);
    if (t.length % 2) throw new Error('Odd number of coordinates');
    for (let i = 0; i < t.length; i += 2) pts.push({ x: parseLen(t[i], W, 'x'), y: parseLen(t[i + 1], H, 'y'), mode: 'corner' });
  }
  return pts;
}

type Arc = [number, number, number, number, number, number];
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number): Arc[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = phiDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = co * (rx * y1p) / ry, cyp = co * -(ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const delta = dth / segs, t = (4 / 3) * Math.tan(delta / 4);
  const out: Arc[] = [];
  const pt = (a: number): [number, number] => [cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp];
  const dv = (a: number): [number, number] => [-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp];
  for (let i = 0; i < segs; i++) {
    const a0 = th1 + i * delta, a1 = a0 + delta;
    const p0 = pt(a0), p1 = pt(a1), d0 = dv(a0), d1 = dv(a1);
    out.push([p0[0] + t * d0[0], p0[1] + t * d0[1], p1[0] - t * d1[0], p1[1] - t * d1[1], p1[0], p1[1]]);
  }
  if (out.length) { const l = out[out.length - 1]; l[4] = x2; l[5] = y2; }
  return out;
}

/** Full SVG path data parser: M L H V C S Q T A Z (absolute + relative) → editable nodes with handles. */
export function parsePathData(d: string): ParsedShape[] {
  const src = d.trim();
  let i = 0;
  const ws = () => { while (i < src.length && /[\s,]/.test(src[i])) i++; };
  const num = (): number => {
    ws();
    const m = src.slice(i).match(new RegExp(`^${NUM_RE}`));
    if (!m) throw new Error(`Bad number near "${src.slice(i, i + 12)}"`);
    i += m[0].length; return parseFloat(m[0]);
  };
  const flag = (): number => { ws(); const c = src[i]; if (c !== '0' && c !== '1') throw new Error('Bad arc flag'); i++; return Number(c); };
  const more = () => { ws(); return i < src.length && !/[A-Za-z]/.test(src[i]); };

  const out: ParsedShape[] = [];
  let nodes: Point[] = [], closed = false, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  let lastC = null as V | null, lastQ = null as V | null;
  const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
  const flush = () => {
    if (nodes.length >= 2) {
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (nodes.length > 2 && dist(first, last) < 1e-6) { if (last.in) { first.in = last.in; first.mode = 'free'; } nodes.pop(); closed = true; }
      out.push({ nodes, closed, source: 'path' });
    }
    nodes = []; closed = false;
  };
  const start = (x: number, y: number) => { flush(); nodes = [{ x, y, mode: 'corner' }]; sx = x; sy = y; };
  const ensure = () => { if (!nodes.length) { nodes = [{ x: cx, y: cy, mode: 'corner' }]; } };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    ensure();
    const last = nodes[nodes.length - 1];
    if (dist({ x: x1, y: y1 }, last) > 1e-9) { last.out = { x: x1, y: y1 }; last.mode = 'free'; }
    const nn: Point = { x, y, mode: 'corner' };
    if (dist({ x: x2, y: y2 }, nn) > 1e-9) { nn.in = { x: x2, y: y2 }; nn.mode = 'free'; }
    nodes.push(nn); cx = x; cy = y; lastC = { x: x2, y: y2 };
  };

  while (i < src.length) {
    ws();
    if (i >= src.length) break;
    if (/[A-Za-z]/.test(src[i])) { cmd = src[i++]; if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(cmd)) throw new Error(`Unknown path command "${cmd}"`); }
    else if (!cmd) throw new Error('Path data must start with M');
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'Z') {
      if (nodes.length) { cx = sx; cy = sy; const first = nodes[0], last = nodes[nodes.length - 1];
        if (nodes.length > 2 && dist(first, last) < 1e-6) { if (last.in) { first.in = last.in; first.mode = 'free'; } nodes.pop(); }
        closed = true; flush(); nodes = []; }
      lastC = lastQ = null; continue;
    }
    if (C === 'M') {
      const x = num() + ox, y = num() + oy; start(x, y); cx = x; cy = y; cmd = rel ? 'l' : 'L'; lastC = lastQ = null;
      while (more()) { const lx = num() + (rel ? cx : 0), ly = num() + (rel ? cy : 0); nodes.push({ x: lx, y: ly, mode: 'corner' }); cx = lx; cy = ly; }
      continue;
    }
    if (!nodes.length) ensure();
    if (C === 'L') { const x = num() + ox, y = num() + oy; nodes.push({ x, y, mode: 'corner' }); cx = x; cy = y; lastC = lastQ = null; }
    else if (C === 'H') { const x = num() + ox; nodes.push({ x, y: cy, mode: 'corner' }); cx = x; lastC = lastQ = null; }
    else if (C === 'V') { const y = num() + oy; nodes.push({ x: cx, y, mode: 'corner' }); cy = y; lastC = lastQ = null; }
    else if (C === 'C') { const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy; cubic(x1, y1, x2, y2, x, y); lastQ = null; }
    else if (C === 'S') {
      const x2 = num() + ox, y2 = num() + oy, x = num() + ox, y = num() + oy;
      const c1 = lastC ? { x: 2 * cx - lastC.x, y: 2 * cy - lastC.y } : { x: cx, y: cy };
      cubic(c1.x, c1.y, x2, y2, x, y); lastQ = null;
    } else if (C === 'Q' || C === 'T') {
      let qx: number, qy: number;
      if (C === 'Q') { qx = num() + ox; qy = num() + oy; } else { const q = lastQ ? { x: 2 * cx - lastQ.x, y: 2 * cy - lastQ.y } : { x: cx, y: cy }; qx = q.x; qy = q.y; }
      const x = num() + ox, y = num() + oy;
      cubic(cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
      lastQ = { x: qx, y: qy }; lastC = null;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), fa = flag(), fs = flag(), x = num() + ox, y = num() + oy;
      for (const seg of arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y)) cubic(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
      lastC = lastQ = null;
    }
  }
  flush();
  return out;
}

/** Accepts polygon(), polyline(), path(), SVG attributes, bare path data or bare point lists. Several shapes allowed. */
export function parseShapeInput(text: string): ParsedShape[] {
  const src = text.trim();
  if (!src) throw new Error('Paste a polygon(), polyline(), SVG path or a list of points');
  const found: { index: number; shape: () => ParsedShape[] }[] = [];
  let m: RegExpExecArray | null;
  const poly = /polygon\(\s*(?:(?:nonzero|evenodd)\s*,\s*)?([^)]*)\)/gi;
  while ((m = poly.exec(src))) { const body = m[1]; found.push({ index: m.index, shape: () => [{ nodes: parsePointList(body), closed: true, source: 'polygon' }] }); }
  const line = /polyline\(\s*([^)]*)\)/gi;
  while ((m = line.exec(src))) { const body = m[1]; found.push({ index: m.index, shape: () => [{ nodes: parsePointList(body), closed: false, source: 'polyline' }] }); }
  const pts = /\bpoints\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = pts.exec(src))) {
    const body = m[2] ?? m[3]; const tag = src.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    const closed = !/polyline[^<]*$/.test(tag);
    found.push({ index: m.index, shape: () => [{ nodes: parsePointList(body), closed, source: closed ? 'polygon' : 'polyline' }] });
  }
  const pathFn = /path\(\s*(?:(?:nonzero|evenodd)\s*,\s*)?("([^"]*)"|'([^']*)')\s*\)/gi;
  while ((m = pathFn.exec(src))) { const body = m[2] ?? m[3]; found.push({ index: m.index, shape: () => parsePathData(body) }); }
  const dAttr = /(?:^|[\s<"'])d\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = dAttr.exec(src))) { const body = m[2] ?? m[3]; found.push({ index: m.index, shape: () => parsePathData(body) }); }
  let shapes: ParsedShape[];
  if (found.length) shapes = found.sort((a, b) => a.index - b.index).flatMap(f => f.shape());
  else if (/^[Mm]/.test(src)) shapes = parsePathData(src);
  else shapes = [{ nodes: parsePointList(src.replace(/^[\w-]+\s*:\s*/, '')), closed: true, source: 'points' }];
  shapes = shapes.filter(s => s.nodes.length >= 2);
  if (!shapes.length) throw new Error('No usable shape found (need at least two points)');
  return shapes;
}

/* ───────────────────────────── planar arrangement ───────────────────────────── */

const key = (p: V) => `${Math.round(p.x * 1e4)}_${Math.round(p.y * 1e4)}`;
const cross = (a: V, b: V, c: V) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function signedArea(ring: Ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

function ringSegments(ring: Ring, closed: boolean): [V, V][] {
  const segs: [V, V][] = [], n = ring.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) segs.push([a, b]);
  }
  return segs;
}

/** Parameter t on (a,b) where it meets (c,d); returns every t in [0,1] (two for collinear overlap). */
export function splitParams(a: V, b: V, c: V, d: V): number[] {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x, ac = { x: c.x - a.x, y: c.y - a.y };
  const len2 = r.x * r.x + r.y * r.y;
  if (Math.abs(den) < 1e-12 * Math.sqrt(len2 * (s.x * s.x + s.y * s.y) || 1)) {
    if (Math.abs(ac.x * r.y - ac.y * r.x) / Math.sqrt(len2) > 1e-7) return [];
    return [(ac.x * r.x + ac.y * r.y) / len2, ((d.x - a.x) * r.x + (d.y - a.y) * r.y) / len2].filter(t => t > 1e-9 && t < 1 - 1e-9);
  }
  const t = (ac.x * s.y - ac.y * s.x) / den, u = (ac.x * r.y - ac.y * r.x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
  return t > 1e-9 && t < 1 - 1e-9 ? [t] : [];
}

/** True if a closed ring crosses itself. */
export function selfIntersects(ring: Ring) {
  const n = ring.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = ring[i], b = ring[(i + 1) % n], c = ring[j], d = ring[(j + 1) % n];
    const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
    if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return true;
  }
  return false;
}

/**
 * Outer boundary of any set of polygons / polylines.
 * Segments are split at every crossing, assembled into a planar graph and the outside face of each
 * connected component is walked. Holes and interior structure vanish; dangling edges are trimmed.
 */
export function outerBoundary(items: { ring: Ring; closed: boolean }[]): CompoundPath {
  const segs: [V, V][] = items.flatMap(it => ringSegments(it.ring, it.closed));
  if (!segs.length) return [];
  const verts = new Map<string, number>(), coords: V[] = [];
  const vid = (p: V) => { const k = key(p); let id = verts.get(k); if (id === undefined) { id = coords.length; verts.set(k, id); coords.push({ x: p.x, y: p.y }); } return id; };
  const edges = new Set<string>(), adj: number[][] = [];
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edges.has(k)) return;
    edges.add(k);
    (adj[a] ??= []).push(b); (adj[b] ??= []).push(a);
  };
  segs.forEach(([a, b], si) => {
    const ts = new Set<number>([0, 1]);
    segs.forEach(([c, d], sj) => { if (si !== sj) for (const t of splitParams(a, b, c, d)) ts.add(t); });
    const sorted = [...ts].sort((x, y) => x - y);
    let prev = vid(a);
    for (let k = 1; k < sorted.length; k++) {
      const t = sorted[k];
      const p = t === 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const id = vid(p); addEdge(prev, id); prev = id;
    }
  });
  for (let i = 0; i < coords.length; i++) adj[i] ??= [];

  const seen = new Array(coords.length).fill(false), result: CompoundPath = [];
  for (let s0 = 0; s0 < coords.length; s0++) {
    if (seen[s0] || !adj[s0].length) continue;
    const comp: number[] = [], stack = [s0]; seen[s0] = true;
    while (stack.length) { const v = stack.pop()!; comp.push(v); for (const w of adj[v]) if (!seen[w]) { seen[w] = true; stack.push(w); } }
    let start = comp[0];
    for (const v of comp) if (coords[v].x < coords[start].x - 1e-9 || (Math.abs(coords[v].x - coords[start].x) <= 1e-9 && coords[v].y < coords[start].y)) start = v;
    const path: number[] = [start];
    let cur = start, rev = Math.PI, firstEdge: [number, number] | null = null;
    for (let guard = 0; guard < 200000; guard++) {
      let best = -1, bestDelta = Infinity;
      for (const w of adj[cur]) {
        const a = Math.atan2(coords[w].y - coords[cur].y, coords[w].x - coords[cur].x);
        let delta = (rev - a) % (2 * Math.PI); if (delta < 0) delta += 2 * Math.PI;
        if (delta < 1e-9) delta = 2 * Math.PI;
        if (delta < bestDelta) { bestDelta = delta; best = w; }
      }
      if (best < 0) break;
      if (!firstEdge) firstEdge = [cur, best];
      else if (cur === firstEdge[0] && best === firstEdge[1]) break;
      rev = Math.atan2(coords[cur].y - coords[best].y, coords[cur].x - coords[best].x);
      cur = best; path.push(cur);
      if (cur === start && path.length > 2 && firstEdge) {
        // closed the loop only if the next step would repeat the first edge (checked at loop top)
      }
    }
    if (path.length > 1 && path[path.length - 1] === start) path.pop();
    result.push(cleanRing(path.map(id => coords[id])));
  }
  return result.filter(r => r.length >= 3).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
}

/** Remove duplicate points, collinear points and back-and-forth spikes. */
export function cleanRing(ring: Ring): Ring {
  let pts = ring.slice(), changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    const out: V[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const dup = Math.hypot(b.x - a.x, b.y - a.y) < 1e-7;
      const spike = Math.hypot(a.x - c.x, a.y - c.y) < 1e-7;
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      const flat = Math.abs(cross(a, c, b)) / len < 1e-6 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0;
      if (dup || spike || flat) { changed = true; continue; }
      out.push(b);
    }
    if (out.length === pts.length) break;
    pts = out;
  }
  return pts;
}

/* ───────────────────────────── extraction ───────────────────────────── */

export type Extraction = {
  rings: CompoundPath;            // sharp outline(s) in canvas units
  nodes: Point[];                 // main outline as editable nodes (curves preserved when the input was one simple curve)
  closed: boolean;
  notes: string[];
};
const hasHandles = (nodes: Point[]) => nodes.some(n => n.in || n.out);

export function extractOuterShape(shapes: ParsedShape[]): Extraction {
  const notes: string[] = [];
  const single = shapes.length === 1 ? shapes[0] : null;
  if (single && hasHandles(single.nodes)) {
    const flat = samplePath(single.nodes.map(n => ({ ...n })), true, 24);
    if (!selfIntersects(flat)) {
      notes.push(single.closed ? 'Curved outline kept exactly as drawn.' : 'Open path closed with a straight line.');
      return { rings: [flat], nodes: single.nodes.map(n => ({ ...n })), closed: true, notes };
    }
  }
  const items = shapes.map(s => {
    const ring = s.nodes.some(n => n.in || n.out) ? samplePath(s.nodes.map(n => ({ ...n })), s.closed, 24) : s.nodes.map(n => ({ x: n.x, y: n.y }));
    return { ring, closed: s.closed || shapes.length === 1 };
  });
  if (shapes.length === 1 && !shapes[0].closed) notes.push('Open path closed with a straight line.');
  let rings = outerBoundary(items);
  if (!rings.length || rings[0].length < 3) {
    const all = items.flatMap(it => it.ring);
    rings = all.length >= 3 ? [cleanRing(all)] : [];
    if (rings.length) notes.push('Pieces were not connected, so their points were joined in order.');
  }
  if (!rings.length) throw new Error('Could not find a closed outline');
  const refArea = items[0] ? signedArea(items[0].ring) : 0;
  rings = rings.map(r => (refArea !== 0 && Math.sign(signedArea(r)) !== Math.sign(refArea) ? r.slice().reverse() : r));
  // start the outline at the vertex the user drew first, if it survived
  const first = items[0]?.ring[0];
  if (first) rings = rings.map(r => { const k = r.findIndex(p => Math.hypot(p.x - first.x, p.y - first.y) < 1e-6); return k > 0 ? [...r.slice(k), ...r.slice(0, k)] : r; });
  if (items.length > 1) notes.push(`Merged ${items.length} shapes into one outer boundary.`);
  if (items.length === 1 && selfIntersects(items[0].ring)) notes.push('Crossing edges resolved: interior structure removed.');
  if (rings.length > 1) notes.push(`${rings.length} separate outlines found — the largest is loaded.`);
  return { rings, nodes: rings[0].map(p => ({ x: p.x, y: p.y, mode: 'corner' as const })), closed: true, notes };
}

export function ringToNodes(ring: Ring): Point[] { return ring.map(p => ({ x: p.x, y: p.y, mode: 'corner' as const })); }

/** SVG path data for a compound outline (straight edges). */
export function ringsToPath(rings: CompoundPath, precision = 1) {
  return rings.map(r => r.map((p, i) => `${i ? 'L' : 'M'} ${fmt(p.x, precision)} ${fmt(p.y, precision)}`).join(' ') + ' Z').join(' ');
}

/* ───────────────────────────── corner rounding ───────────────────────────── */

const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: V) => Math.hypot(a.x, a.y);

/**
 * Mathematically exact fillets. Tangent distance d = r / tan(φ/2) (φ = interior angle) and each arc is a cubic with
 * handle length k = 4/3 · tan(θ/4) · r (θ = arc sweep) — the standard error < 0.03 % approximation of a circular arc.
 * `only` rounds a single node. Neighbours that are curved, or radius that would not fit, are skipped.
 */
export function roundCorners(points: Point[], closed: boolean, radius: number, only?: number): { points: Point[]; rounded: number } {
  if (radius <= 0 || points.length < 3) return { points: points.map(p => ({ ...p })), rounded: 0 };
  const n = points.length, out: Point[] = [];
  let rounded = 0;
  const sharp = (p: Point) => !p.in && !p.out && (p.mode === 'corner' || p.mode === undefined ? true : false);
  for (let i = 0; i < n; i++) {
    const cur = points[i];
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const prev = points[(i - 1 + n) % n], next = points[(i + 1) % n];
    if (!hasPrev || !hasNext || (only !== undefined && only !== i) || !sharp(cur) || prev.out || next.in) { out.push({ ...cur }); continue; }
    const v1 = sub(prev, cur), v2 = sub(next, cur), l1 = len(v1), l2 = len(v2);
    if (l1 < 1e-6 || l2 < 1e-6) { out.push({ ...cur }); continue; }
    const u1 = { x: v1.x / l1, y: v1.y / l1 }, u2 = { x: v2.x / l2, y: v2.y / l2 };
    const cosPhi = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)), phi = Math.acos(cosPhi);
    if (phi < 1e-3 || Math.PI - phi < 1e-3) { out.push({ ...cur }); continue; }
    const share = only === undefined ? 0.5 : 1;
    const dMax = Math.min(l1, l2) * share, dWanted = radius / Math.tan(phi / 2);
    const d = Math.min(dWanted, dMax), r = d * Math.tan(phi / 2);
    const k = (4 / 3) * Math.tan((Math.PI - phi) / 4) * r;
    const t1 = { x: cur.x + u1.x * d, y: cur.y + u1.y * d }, t2 = { x: cur.x + u2.x * d, y: cur.y + u2.y * d };
    out.push({ x: t1.x, y: t1.y, mode: 'free', out: { x: t1.x - u1.x * k, y: t1.y - u1.y * k } });
    out.push({ x: t2.x, y: t2.y, mode: 'free', in: { x: t2.x - u2.x * k, y: t2.y - u2.y * k } });
    rounded++;
  }
  return { points: out, rounded };
}

/** Flatten any node list into a plain ring (curves sampled). */
export function nodesToRing(nodes: Point[], closed: boolean, steps = 16): Ring {
  const out: Ring = [];
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) { const seg = flattenSegment(nodes, i, closed, steps); for (let k = 0; k < seg.length - 1; k++) out.push(seg[k]); }
  if (!closed && nodes.length) out.push({ x: nodes[nodes.length - 1].x, y: nodes[nodes.length - 1].y });
  return out;
}
