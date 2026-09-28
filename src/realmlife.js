import * as THREE from 'three';
import { clay } from './style.js';
import { prop } from './assets.js';
import { smoothstep, lerp } from './util.js';
import { landKit as K } from './realmlands.js';

// The living layer of each realm: things that move, drift, gallop and howl, plus the ghoulish
// (or fiery, or frozen) clutter that makes the wilds feel inhabited.
//   shape(h, x, z)  terrain it needs (swamp hollows)      slow(x, z)  swamp water
//   roads()         extra polylines added to the realm's paths (a ring road for the carriage)
//   build(ctx)      static set dressing + animated actors   tick(dt, t, ctx, player)
// Actors are only animated when the player is within ~110 m.

const TAU = Math.PI * 2;
const near = (o, p, d = 110) => Math.abs(o.x - p.x) < d && Math.abs(o.z - p.z) < d;
const ghostMat = (c, o = 0.5, e = 0.8) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: e, transparent: true, opacity: o, depthWrite: false, roughness: 0.6 });

// A closed, gently wandering loop road at radius r.
function ringRoad(r, wob, seed, n = 72) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, rr = r + Math.sin(a * 3 + seed) * wob + Math.sin(a * 7 + seed * 2) * wob * 0.4; pts.push([Math.sin(a) * rr, Math.cos(a) * rr]); }
  return pts;
}
// Position and heading at arc-length s along a polyline (wraps for loops).
function along(pts, s) {
  if (!pts.len) { pts.len = [0]; for (let i = 1; i < pts.length; i++) pts.len.push(pts.len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
  const L = pts.len.at(-1); s = ((s % L) + L) % L;
  let i = 1; while (pts.len[i] < s) i++;
  const [ax, az] = pts[i - 1], [bx, bz] = pts[i], t = (s - pts.len[i - 1]) / (pts.len[i] - pts.len[i - 1]);
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, a: Math.atan2(bx - ax, bz - az), L };
}

// ---------------------------------------------------------------- creatures
// A four-legged beast facing +Z. Legs pivot at the hip so they can gallop or walk.
function quadruped({ mat, bodyR = 0.36, bodyL = 1.2, legLen = 1.0, legR = 0.08, neckUp = 0.9, headL = 0.55, antlers = null, ears = true, tailDown = true, hornMat = mat }) {
  const g = new THREE.Group(), by = legLen + bodyR * 0.8;
  g.add(K.M(new THREE.CapsuleGeometry(bodyR, bodyL, 6, 12).rotateX(Math.PI / 2), mat, 0, by, 0));
  const neckTop = [0, by + neckUp, bodyL / 2 + 0.35];
  g.add(new THREE.Mesh(K.taperGeo([[0, by + 0.1, bodyL / 2 - 0.05], [0, by + neckUp * 0.6, bodyL / 2 + 0.22], neckTop], bodyR * 0.62, bodyR * 0.42, 8, 7), mat));
  const head = new THREE.Group(); head.position.set(...neckTop);
  head.add(K.M(new THREE.CapsuleGeometry(bodyR * 0.42, headL, 4, 8).rotateX(Math.PI / 2 - 0.5), mat, 0, -0.05, headL * 0.35));
  if (ears) for (const s of [-1, 1]) head.add(K.M(new THREE.ConeGeometry(0.06, 0.2, 5), mat, s * 0.1, 0.18, -0.02));
  if (antlers) for (const s of [-1, 1]) {
    head.add(new THREE.Mesh(K.taperGeo([[s * 0.08, 0.1, 0], [s * 0.35, 0.5, -0.1], [s * 0.5, 0.95, -0.05], [s * 0.45, 1.25, 0.1]], 0.05, 0.02, 8, 5), hornMat));
    head.add(new THREE.Mesh(K.taperGeo([[s * 0.3, 0.45, -0.08], [s * 0.2, 0.75, 0.15]], 0.035, 0.015, 4, 5), hornMat));
    head.add(new THREE.Mesh(K.taperGeo([[s * 0.47, 0.85, -0.06], [s * 0.7, 1.05, 0.05]], 0.03, 0.012, 4, 5), hornMat));
  }
  g.add(head);
  const legs = [];
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz], i) => {
    const hip = new THREE.Group(); hip.position.set(sx * bodyR * 0.62, by - 0.1, sz * bodyL * 0.42);
    hip.add(K.M(new THREE.CylinderGeometry(legR, legR * 0.75, legLen, 6).translate(0, -legLen / 2, 0), mat));
    g.add(hip); legs.push({ hip, ph: [0, Math.PI, Math.PI / 2, Math.PI * 1.5][i] });
  });
  const tail = new THREE.Mesh(K.taperGeo([[0, by + 0.1, -bodyL / 2 - 0.2], [0, by - (tailDown ? 0.4 : -0.2), -bodyL / 2 - 0.5], [0, by - (tailDown ? 0.8 : -0.1), -bodyL / 2 - 0.55]], 0.08, 0.02, 6, 5), mat);
  g.add(tail);
  return { g, legs, head, tail };
}
const stride = (q, t, amp) => q.legs.forEach(({ hip, ph }) => { hip.rotation.x = Math.sin(t + ph) * amp; });

function crow() {
  const g = new THREE.Group(), m = clay('#141216', { roughness: 0.5, key: 'crow' });
  g.add(K.M(new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.9, 1.6), m));
  g.add(K.M(new THREE.SphereGeometry(0.1, 8, 6), m, 0, 0.1, 0.22));
  g.add(K.M(new THREE.ConeGeometry(0.03, 0.14, 4).rotateX(Math.PI / 2), clay('#3a3430', { key: 'beak' }), 0, 0.09, 0.34));
  const wing = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.1), new THREE.Vector3(0.55, 0.02, -0.05), new THREE.Vector3(0.1, 0, -0.2)]); wing.computeVertexNormals();
  const wm = new THREE.MeshStandardMaterial({ color: '#141216', side: THREE.DoubleSide });
  const wl = new THREE.Mesh(wing, wm), wr = new THREE.Mesh(wing, wm); wr.scale.x = -1;
  g.add(wl, wr);
  return { g, wl, wr };
}

// ================================================================ Hollow Crypt
const SWAMPS = [{ x: -44, z: -104, r: 16 }, { x: 132, z: -40, r: 14 }, { x: -136, z: 58, r: 15 }, { x: 62, z: 138, r: 13 }, { x: -20, z: 150, r: 12 }];
const CRYPT_ROAD = ringRoad(82, 6, 1.3);

const CRYPT_LIFE = {
  shape(h, x, z) {
    for (const s of SWAMPS) { const d = Math.hypot(x - s.x, z - s.z); h = lerp(h, -1.1 + Math.sin(x * 0.7) * 0.15, 1 - smoothstep(s.r - 3, s.r + 3, d)); }
    return h;
  },
  slow: (x, z) => SWAMPS.some((s) => Math.hypot(x - s.x, z - s.z) < s.r - 1.5),
  roads: () => [CRYPT_ROAD],
  build(ctx) {
    const { rand, add, heightAt, open } = ctx;
    const bark = clay('#2e2622', { roughness: 0.8, key: 'deadBark' }), stone = clay('#8a8599', { roughness: 0.7, key: 'grave' }), dark = clay('#5d5868', { roughness: 0.75, key: 'graveDark' });
    const wood = clay('#3a2e24', { key: 'yoke' }), rope = clay('#8a7a5a', { key: 'rope' }), soul = K.glowM('#7dff9b', 1.8), earth = clay('#2a2420', { roughness: 0.95, key: 'pitEarth' });
    // --- Swamps: black water, reeds, glowing lily pads, drowned trees, drifting wisps.
    const water = new THREE.MeshStandardMaterial({ color: '#142018', roughness: 0.06, metalness: 0.25, transparent: true, opacity: 0.9 });
    const reedGeo = new THREE.ConeGeometry(0.04, 1.6, 4).translate(0, 0.8, 0), reedM = clay('#4a5a3a', { key: 'reed' });
    const padGeo = new THREE.CircleGeometry(0.35, 10, 0.3, TAU - 0.6).rotateX(-Math.PI / 2);
    ctx.wisps = [];
    SWAMPS.forEach((sw) => {
      const pool = K.M(new THREE.CircleGeometry(sw.r + 0.5, 40), water, sw.x, -0.62, sw.z); pool.rotation.x = -Math.PI / 2; pool.receiveShadow = true; ctx.scene.add(pool); ctx.aoHide(pool);
      const reeds = new THREE.InstancedMesh(reedGeo, reedM, 90), pads = new THREE.InstancedMesh(padGeo, K.glowM('#4aff8a', 0.5), 30), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < 90; i++) { const a = rand() * TAU, r = sw.r - 2 + rand() * 4.5, s = 0.6 + rand() * 0.8; reeds.setMatrixAt(i, m4.compose(new THREE.Vector3(sw.x + Math.sin(a) * r, -0.7, sw.z + Math.cos(a) * r), q.setFromEuler(e.set((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3)), new THREE.Vector3(s, s, s))); }
      for (let i = 0; i < 30; i++) { const a = rand() * TAU, r = rand() * (sw.r - 2); pads.setMatrixAt(i, m4.compose(new THREE.Vector3(sw.x + Math.sin(a) * r, -0.6, sw.z + Math.cos(a) * r), q.setFromEuler(e.set(0, rand() * TAU, 0)), new THREE.Vector3(1, 1, 1).multiplyScalar(0.6 + rand() * 0.8))); }
      ctx.scene.add(reeds, pads);
      for (let i = 0; i < 5; i++) {
        const a = rand() * TAU, r = rand() * (sw.r - 3), x = sw.x + Math.sin(a) * r, z = sw.z + Math.cos(a) * r;
        const t = K.deadTree(rand, 0.7 + rand() * 0.5, bark); t.position.set(x, -1.2, z); t.rotation.set((rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4); add(K.shadowAll(t), 0);
        for (let k = 0; k < 4; k++) { const ra = (k / 4) * TAU; t.add(new THREE.Mesh(K.taperGeo([[0, 0.8, 0], [Math.cos(ra) * 0.9, 0.3, Math.sin(ra) * 0.9], [Math.cos(ra) * 1.4, -0.4, Math.sin(ra) * 1.4]], 0.18, 0.05, 6, 5), bark)); }
      }
      for (let i = 0; i < 6; i++) { const w = K.M(new THREE.SphereGeometry(0.16, 8, 6), soul); w.userData.dynamic = true; ctx.scene.add(w); ctx.wisps.push({ w, sw, ph: rand() * TAU, r: rand() * sw.r }); }
      ctx.light('#5dff8a', 8, 22, sw.x, 1.5, sw.z);
    });
    // --- Graves scattered across the whole moor, not only in cemeteries.
    let placed = 0;
    for (let tries = 0; placed < 320 && tries < 4000; tries++) {
      const r = 58 + Math.sqrt(rand()) * 110, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 1)) continue;
      const g = K.gravestone(rand, stone, dark); g.position.set(x, heightAt(x, z) - 0.05, z); g.rotation.y += rand() * 6; add(K.shadowAll(g), 0.45);
      ctx.graves.push({ x, z: z + 1 }); placed++;
    }
    // --- Open graves with their coffins, shovels and spoil.
    for (let i = 0; i < 14; i++) {
      const r = 60 + rand() * 100, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 3)) continue;
      const g = new THREE.Group();
      g.add(K.M(new THREE.BoxGeometry(1.2, 0.1, 2.2), new THREE.MeshBasicMaterial({ color: '#07080a' }), 0, 0.03, 0));
      g.add(K.M(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2).scale(0.9, 0.5, 1.3), earth, 1.5, 0, 0));
      const coffin = new THREE.Group(); coffin.add(K.M(K.rbox(0.8, 0.4, 2.0, 0.06), wood, 0, 0.2, 0)); coffin.add(K.M(K.rbox(0.85, 0.08, 2.05, 0.03), clay('#2a2018', { key: 'coffinLid' }), 0.1, 0.45, 0.1));
      coffin.position.set(-1.5, 0, 0.3); coffin.rotation.set(0, 0.3, 0.1); g.add(coffin);
      const sh = new THREE.Group(); sh.add(K.M(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), wood, 0, 0.8, 0)); sh.add(K.M(K.rbox(0.35, 0.45, 0.05, 0.03), clay('#4a4458', { key: 'inIron' }), 0, 0, 0)); sh.position.set(1.8, 0.2, 0.9); sh.rotation.z = 0.35; g.add(sh);
      g.position.set(x, heightAt(x, z), z); g.rotation.y = rand() * 6; add(K.shadowAll(g), 1.2);
    }
    // --- Gallows and scarecrows.
    for (let i = 0; i < 3; i++) {
      const r = 70 + rand() * 80, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 4)) continue;
      const g = new THREE.Group();
      g.add(K.M(K.rbox(3.4, 0.8, 2.4, 0.06), wood, 0, 0.4, 0));
      g.add(K.M(K.rbox(0.25, 4.2, 0.25, 0.04), wood, -1.2, 2.9, 0)); g.add(K.M(K.rbox(2.2, 0.25, 0.25, 0.04), wood, -0.2, 4.9, 0));
      const brace = K.M(K.rbox(0.18, 1.2, 0.18, 0.03), wood, -0.8, 4.4, 0); brace.rotation.z = -0.8; g.add(brace);
      g.add(K.M(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 4), rope, 0.6, 4.1, 0)); g.add(K.M(new THREE.TorusGeometry(0.16, 0.03, 4, 10), rope, 0.6, 3.3, 0));
      for (let k = 0; k < 4; k++) g.add(K.M(K.rbox(0.9, 0.12, 0.35, 0.03), wood, 2.2 + k * 0.1, 0.1 + k * 0.2, 0.9 - k * 0.35));
      g.position.set(x, heightAt(x, z), z); g.rotation.y = rand() * 6; add(K.shadowAll(g), 1.9);
    }
    for (let i = 0; i < 7; i++) {
      const r = 62 + rand() * 100, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 2)) continue;
      const g = new THREE.Group();
      g.add(K.M(new THREE.CylinderGeometry(0.06, 0.07, 2.6, 5), wood, 0, 1.3, 0)); g.add(K.M(K.rbox(1.8, 0.1, 0.1, 0.02), wood, 0, 1.9, 0));
      g.add(K.M(new THREE.SphereGeometry(0.3, 10, 8), clay('#8a7a52', { key: 'sack' }), 0, 2.45, 0));
      g.add(K.M(new THREE.ConeGeometry(0.45, 0.5, 10), clay('#3a302a', { key: 'hat' }), 0, 2.8, 0));
      for (const s of [-1, 1]) g.add(K.M(new THREE.SphereGeometry(0.05, 6, 4), K.glowM('#7dff9b', 2.4), s * 0.1, 2.5, 0.26));
      const coat = K.M(new THREE.ConeGeometry(0.5, 1.3, 8, 1, true), clay('#3a3240', { side: THREE.DoubleSide, key: 'coat' }), 0, 1.4, 0); g.add(coat);
      g.position.set(x, heightAt(x, z), z); g.rotation.set((rand() - 0.5) * 0.2, rand() * 6, (rand() - 0.5) * 0.2); add(K.shadowAll(g), 0.4);
    }
    // --- The ghost carriage: a spectral coach and two phantom horses thundering round the ring road.
    const gm = ghostMat('#9dffc0', 0.5, 0.9), gmDark = ghostMat('#2a4a38', 0.7, 0.4), glass = K.glowM('#7dff9b', 2.4);
    const carriage = new THREE.Group();
    const coach = new THREE.Group(); coach.position.z = -1.6;
    coach.add(K.M(K.rbox(1.6, 1.3, 2.4, 0.12), gmDark, 0, 1.55, 0));
    coach.add(K.M(new THREE.CylinderGeometry(0.9, 0.9, 2.5, 16, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), gmDark, 0, 2.2, 0));
    for (const s of [-1, 1]) { coach.add(K.M(K.rbox(0.05, 0.6, 0.8, 0.02), glass, s * 0.82, 1.7, 0)); coach.add(K.M(new THREE.SphereGeometry(0.12, 8, 6), glass, s * 0.95, 2.2, 1.25)); }
    const wheels = [];
    [[-0.95, 0.8], [0.95, 0.8], [-0.95, -0.8], [0.95, -0.8]].forEach(([x, z]) => {
      const w = new THREE.Group(); w.add(K.M(new THREE.TorusGeometry(0.55, 0.06, 6, 20).rotateY(Math.PI / 2), gm));
      for (let k = 0; k < 6; k++) { const sp = K.M(new THREE.CylinderGeometry(0.025, 0.025, 1.05, 4), gm); sp.rotation.x = (k / 6) * Math.PI; w.add(sp); }
      w.position.set(x, 0.6, z); coach.add(w); wheels.push(w);
    });
    const driver = new THREE.Group();
    driver.add(K.M(new THREE.ConeGeometry(0.35, 1.0, 10), gmDark, 0, 0.5, 0)); driver.add(K.M(new THREE.SphereGeometry(0.22, 10, 8), gmDark, 0, 1.1, 0));
    for (const s of [-1, 1]) driver.add(K.M(new THREE.SphereGeometry(0.04, 6, 4), glass, s * 0.07, 1.12, 0.18));
    driver.position.set(0, 2.2, 1.4); coach.add(driver);
    carriage.add(coach);
    const horses = [-0.55, 0.55].map((x) => { const h = quadruped({ mat: gm, bodyR: 0.34, bodyL: 1.1, legLen: 1.0 }); h.g.position.set(x, 0, 1.4); carriage.add(h.g); return h; });
    carriage.add(K.M(K.rbox(0.08, 0.08, 2.2, 0.02), gm, 0, 1.0, 0.3));
    ctx.scene.add(carriage);
    ctx.carriage = { g: carriage, wheels, horses, s: 0 };
    // --- A procession of hooded mourners with candles, pacing the road to the mausoleums.
    const mourners = [], robe = clay('#1e1a24', { roughness: 0.9, key: 'mournRobe' });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Group();
      m.add(K.M(new THREE.ConeGeometry(0.4, 1.5, 10), robe, 0, 0.75, 0)); m.add(K.M(new THREE.SphereGeometry(0.22, 10, 8), robe, 0, 1.55, -0.02)); m.add(K.M(new THREE.ConeGeometry(0.16, 0.4, 8), robe, 0, 1.75, -0.12));
      const c = K.M(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6), clay('#efe6cc', { key: 'wax' }), 0.12, 1.1, 0.3); m.add(c);
      const f = K.M(new THREE.ConeGeometry(0.05, 0.14, 6), K.glowM('#ffd27a', 3), 0.12, 1.3, 0.3); f.userData.flicker = true; m.add(f);
      ctx.scene.add(m); mourners.push(m);
    }
    ctx.procession = { mourners, path: ctx.landPaths[0], s: 40 };
    // --- Crows circling the bone fields and perched about the moor.
    ctx.crows = [];
    for (let i = 0; i < 10; i++) { const c = crow(); ctx.scene.add(c.g); ctx.crows.push({ ...c, cx: 42, cz: -128, r: 10 + rand() * 12, h: 10 + rand() * 8, ph: rand() * TAU, sp: 0.4 + rand() * 0.3 }); }
    for (let i = 0; i < 8; i++) { const c = crow(); ctx.scene.add(c.g); ctx.crows.push({ ...c, cx: -72, cz: 116, r: 8 + rand() * 10, h: 20 + rand() * 8, ph: rand() * TAU, sp: 0.35 + rand() * 0.3 }); }
    ctx.carriageWarn = 0;
  },
  tick(dt, t, ctx, player) {
    const c = ctx.carriage;
    c.s += dt * 9;
    const p = along(CRYPT_ROAD, c.s), y = ctx.heightAt(p.x, p.z);
    c.g.position.set(p.x, y, p.z); c.g.rotation.y = p.a;
    if (near(c.g.position, player.pos)) {
      c.wheels.forEach((w) => { w.rotation.x += dt * 9 / 0.55; });
      c.horses.forEach((h, i) => stride(h, t * 11 + i, 0.8));
      if (Math.random() < dt * 30) ctx.fx.spawn(p.x + (Math.random() - 0.5) * 1.5, y + 0.5 + Math.random(), p.z + (Math.random() - 0.5) * 1.5, 0, 0.6, 0, new THREE.Color('#8dffb0'), 0.6, 1.4, 0, 0.5);
      ctx.carriageWarn -= dt;
      if (ctx.carriageWarn <= 0 && Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 22) { ctx.carriageWarn = 60; ctx.hazardHit('A ghost carriage thunders past…', '#9dffc0'); }
    }
    const pr = ctx.procession;
    if (pr.path && near(pr.mourners[0].position, player.pos, 140)) {
      pr.s += dt * 0.9;
      const L = along(pr.path, 0).L, span = L - 60;
      pr.mourners.forEach((m, i) => {
        let s = 40 + ((pr.s - i * 2.2) % (span * 2)); if (s > 40 + span) s = 40 + span * 2 - (s - 40);
        const q = along(pr.path, s); m.position.set(q.x + Math.cos(q.a) * 0.8, ctx.heightAt(q.x, q.z) + Math.abs(Math.sin(t * 2 + i)) * 0.04, q.z - Math.sin(q.a) * 0.8);
        m.rotation.y = q.a + (((pr.s - i * 2.2) % (span * 2)) > span ? Math.PI : 0);
      });
    }
    ctx.wisps.forEach((o) => { if (!near(o.w.position.x ? o.w.position : o.sw, player.pos)) return; const a = t * 0.3 + o.ph; o.w.position.set(o.sw.x + Math.sin(a) * o.r * 0.8, 0.3 + Math.sin(t * 1.3 + o.ph) * 0.5 + 0.6, o.sw.z + Math.cos(a * 1.3) * o.r * 0.8); });
    ctx.crows.forEach((c) => { const a = t * c.sp + c.ph; c.g.position.set(c.cx + Math.sin(a) * c.r, c.h + Math.sin(t + c.ph) * 0.8, c.cz + Math.cos(a) * c.r); c.g.rotation.y = a + Math.PI / 2; const f = Math.sin(t * 9 + c.ph) * 0.6; c.wl.rotation.z = f; c.wr.rotation.z = -f; });
    // Swamp mist around the player when near a bog.
    for (const sw of SWAMPS) if (Math.hypot(sw.x - player.pos.x, sw.z - player.pos.z) < sw.r + 25 && Math.random() < dt * 10) {
      const a = Math.random() * TAU, r = Math.random() * sw.r;
      ctx.fx.spawn(sw.x + Math.sin(a) * r, -0.3, sw.z + Math.cos(a) * r, 0.3, 0.05, 0.1, new THREE.Color('#2a4a38'), 2.2, 5, 0, 0.1);
    }
  },
};

// ================================================================ Ember Caldera
const RAIL = [[88, -12], [100, -22], [108, -30], [112, -40]];
const CALDERA_LIFE = {
  build(ctx) {
    const { rand, add, heightAt, open } = ctx;
    const basalt = clay('#5a4a44', { roughness: 0.7, key: 'basalt' }), bone = clay('#d8ccb0', { roughness: 0.75, key: 'dragonBone' }), iron = clay('#2e2a33', { metalness: 0.35, roughness: 0.45, key: 'fIron' });
    // --- Lavafalls pouring down the caldera walls into glowing pools.
    const lm = K.lavaMat();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.4, r = 168, x = Math.sin(a) * r, z = Math.cos(a) * r, top = heightAt(x * 1.08, z * 1.08), bot = heightAt(x * 0.93, z * 0.93);
      const fall = K.M(new THREE.PlaneGeometry(4, Math.max(4, top - bot + 2), 1, 8), lm, x, (top + bot) / 2, z); fall.lookAt(0, (top + bot) / 2, 0); fall.rotateX(-0.35); ctx.scene.add(fall);
      const pool = K.M(new THREE.CircleGeometry(4, 20), lm, x * 0.93, bot + 0.15, z * 0.93); pool.rotation.x = -Math.PI / 2; ctx.scene.add(pool);
      ctx.light('#ff6a1c', 14, 30, x * 0.93, bot + 3, z * 0.93);
    }
    // --- Fire geysers: vents that roar into columns of flame.
    ctx.geysers = [];
    for (let tries = 0; ctx.geysers.length < 9 && tries < 400; tries++) {
      const r = 60 + rand() * 100, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 3)) continue;
      const y = heightAt(x, z);
      add(K.shadowAll(K.M(new THREE.ConeGeometry(1.6, 1.2, 10, 1, true), basalt, x, y + 0.4, z)), 0);
      const col = K.M(new THREE.ConeGeometry(0.9, 9, 12, 1, true).translate(0, 4.5, 0), new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), x, y + 0.8, z);
      col.scale.y = 0.01; ctx.scene.add(col); ctx.aoHide(col);
      ctx.geysers.push({ x, z, y, col, timer: 2 + rand() * 8, on: 0 });
    }
    // --- The dragon's grave: a colossal skeleton half-buried in the ash.
    { let x = -30, z = 95; for (let tries = 0; tries < 50 && !open(x, z, 10); tries++) { const a = rand() * TAU, r = 80 + rand() * 60; x = Math.cos(a) * r; z = Math.sin(a) * r; }
      const d = new THREE.Group(), y = heightAt(x, z);
      const spine = [[0, 1.5, -14], [0, 3.5, -7], [0, 4.5, 0], [0, 3.5, 7], [0, 2, 12], [0, 4, 16]];
      const curve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(...p)));
      for (let i = 0; i < 30; i++) { const p = curve.getPointAt(i / 29), v = K.M(new THREE.SphereGeometry(0.6 - Math.abs(i - 14) * 0.02, 8, 6), bone, p.x, p.y, p.z); v.scale.set(1.4, 1, 0.8); d.add(v); }
      for (let i = 0; i < 8; i++) { const zz = -4 + i * 1.6, s = 1 - Math.abs(i - 3.5) * 0.12; for (const sx of [-1, 1]) d.add(new THREE.Mesh(K.taperGeo([[0, 4.3, zz], [sx * 3.5 * s, 4.5, zz], [sx * 5 * s, 2, zz - 0.3], [sx * 4.5 * s, -0.3, zz - 0.5]], 0.28, 0.12), bone)); }
      for (const sx of [-1, 1]) d.add(new THREE.Mesh(K.taperGeo([[sx * 1, 4, -1], [sx * 6, 7, -2], [sx * 11, 6, -5], [sx * 15, 1, -8]], 0.35, 0.08), bone));
      const sk = prop('titan_skull'); if (sk) { sk.scale.set(2.2, 1.6, 3.2); sk.position.set(0, 3.2, 17.5); sk.rotation.x = 0.3; d.add(sk); }
      for (const sx of [-1, 1]) d.add(new THREE.Mesh(K.taperGeo([[sx * 1, 5, 16], [sx * 1.8, 7, 14], [sx * 1.5, 8.5, 11]], 0.3, 0.05), bone));
      d.position.set(x, y - 0.4, z); d.rotation.y = rand() * TAU; add(K.shadowAll(d), 0);
      ctx.collide(x, z, 4.5);
      ctx.dragon = { x, z };
    }
    // --- The old mine: a rail line with ore carts shuttling toward the Sunken Forge.
    const railCurve = RAIL.map(([x, z]) => [x, z]);
    for (let i = 0; i < railCurve.length - 1; i++) {
      const [ax, az] = railCurve[i], [bx, bz] = railCurve[i + 1], L = Math.hypot(bx - ax, bz - az), a = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k < L; k += 1.2) { const x = ax + (bx - ax) * (k / L), z = az + (bz - az) * (k / L); const tie = K.M(K.rbox(1.8, 0.12, 0.3, 0.03), clay('#3a2a1e', { key: 'tie' }), x, heightAt(x, z) + 0.06, z); tie.rotation.y = a; add(tie, 0); }
      for (const s of [-0.6, 0.6]) { const rail = K.M(K.rbox(0.08, 0.1, L, 0.02), iron, (ax + bx) / 2 + Math.cos(a) * s, heightAt((ax + bx) / 2, (az + bz) / 2) + 0.16, (az + bz) / 2 - Math.sin(a) * s); rail.rotation.y = a; add(rail, 0); }
    }
    ctx.carts = [0, 1].map((i) => {
      const c = new THREE.Group(); c.add(K.M(K.rbox(1.2, 0.7, 1.6, 0.06), iron, 0, 0.6, 0));
      c.add(K.M(new THREE.SphereGeometry(0.6, 8, 6, 0, TAU, 0, Math.PI / 2).scale(0.9, 0.7, 1.2), K.glowM('#ff8a3c', 1.2), 0, 0.9, 0));
      for (const [x, z] of [[-0.6, 0.5], [0.6, 0.5], [-0.6, -0.5], [0.6, -0.5]]) c.add(K.M(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10).rotateZ(Math.PI / 2), iron, x, 0.22, z));
      ctx.scene.add(K.shadowAll(c)); return { c, s: i * 12 };
    });
    // --- Ember birds wheeling above the wastes.
    ctx.birds = [];
    for (let i = 0; i < 14; i++) {
      const b = crow(); b.g.traverse((o) => { if (o.isMesh) o.material = K.glowM(i % 2 ? '#ffb347' : '#ff6a1a', 2); }); b.g.scale.setScalar(1.6);
      ctx.scene.add(b.g); ctx.birds.push({ ...b, cx: (rand() - 0.5) * 200, cz: (rand() - 0.5) * 200, r: 12 + rand() * 20, h: 18 + rand() * 12, ph: rand() * TAU, sp: 0.3 + rand() * 0.3 });
    }
  },
  tick(dt, t, ctx, player) {
    for (const g of ctx.geysers) {
      if (!near(g, player.pos)) continue;
      g.timer -= dt;
      if (g.timer <= 0 && g.on <= 0) { g.on = 2.4; g.timer = 7 + Math.random() * 7; }
      if (g.on > 0) {
        g.on -= dt;
        const k = Math.min(1, g.on * 2) * Math.min(1, (2.4 - g.on) * 4);
        g.col.scale.set(1 + Math.random() * 0.1, Math.max(0.01, k), 1 + Math.random() * 0.1);
        if (Math.random() < dt * 60) ctx.fx.spawn(g.x + (Math.random() - 0.5), g.y + 1 + Math.random() * 7 * k, g.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 4 + Math.random() * 4, (Math.random() - 0.5) * 2, new THREE.Color(Math.random() < 0.5 ? '#ffd27a' : '#ff6a1c'), 0.6, 1, 2, 0.2);
        const d = Math.hypot(player.pos.x - g.x, player.pos.z - g.z);
        if (d < 2.4 && k > 0.5 && !g.hit) { g.hit = true; player.vel.y = 9; player.vel.x += (player.pos.x - g.x) / Math.max(d, 0.3) * 6; player.vel.z += (player.pos.z - g.z) / Math.max(d, 0.3) * 6; player.shake = 0.5; ctx.hazardHit('The geyser erupts beneath you!'); }
      } else { g.col.scale.y = 0.01; g.hit = false; if (Math.random() < dt * 3) ctx.fx.spawn(g.x, g.y + 1, g.z, 0, 1.5, 0, new THREE.Color('#5a4a44'), 0.8, 2, -0.2, 0.2); }
    }
    ctx.carts.forEach((c) => {
      c.s += dt * 3;
      let total = 0; for (let i = 1; i < RAIL.length; i++) total += Math.hypot(RAIL[i][0] - RAIL[i - 1][0], RAIL[i][1] - RAIL[i - 1][1]);
      let s = c.s % (total * 2); if (s > total) s = total * 2 - s;
      const q = along(RAIL, Math.min(s, total - 0.01));
      c.c.position.set(q.x, ctx.heightAt(q.x, q.z) + 0.1, q.z); c.c.rotation.y = q.a;
    });
    ctx.birds.forEach((b) => { if (!near({ x: b.cx, z: b.cz }, player.pos, 150)) return; const a = t * b.sp + b.ph; b.g.position.set(b.cx + Math.sin(a) * b.r, b.h + Math.sin(t + b.ph), b.cz + Math.cos(a) * b.r); b.g.rotation.y = a + Math.PI / 2; const f = Math.sin(t * 6 + b.ph) * 0.5; b.wl.rotation.z = f; b.wr.rotation.z = -f; });
  },
};

// ================================================================ Glacial Hollow
const ELK_TRAIL = ringRoad(118, 14, 4.2, 60);
const GLACIER_LIFE = {
  build(ctx) {
    const { rand, add, heightAt, open } = ctx;
    const hide = clay('#6a5a4a', { key: 'hide' }), fur = clay('#8a7a6a', { roughness: 0.9, key: 'fur' }), snow = clay('#eef6fc', { roughness: 0.85, key: 'snow' }), wood = clay('#4a3a2c', { key: 'boatWood' });
    // --- A herd of spectral ice elk wandering their trail.
    const em = ghostMat('#bfefff', 0.55, 0.9), antler = ghostMat('#ffffff', 0.7, 1.2);
    ctx.elk = [];
    for (let i = 0; i < 6; i++) { const q = quadruped({ mat: em, bodyR: 0.4, bodyL: 1.3, legLen: 1.25, legR: 0.07, neckUp: 0.8, antlers: i % 3 !== 2, hornMat: antler }); ctx.scene.add(q.g); ctx.elk.push({ q, off: i * 3.5 + rand() * 2, side: (rand() - 0.5) * 3 }); }
    ctx.herd = { s: 0 };
    // --- A frozen mammoth, trapped under the ice of the big bay.
    { const x = -118, z = 62, m = new THREE.Group(), ice = new THREE.MeshStandardMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false });
      const q = quadruped({ mat: fur, bodyR: 1.3, bodyL: 2.4, legLen: 1.8, legR: 0.35, neckUp: 0.3, ears: true, tailDown: true });
      q.g.rotation.z = 0.6; m.add(q.g);
      for (const s of [-1, 1]) m.add(new THREE.Mesh(K.taperGeo([[s * 0.4, 3.2, 2.6], [s * 0.7, 2.2, 3.6], [s * 0.5, 2.6, 4.6], [s * 0.1, 3.4, 4.9]], 0.18, 0.06), clay('#efe6d0', { key: 'tusk' })));
      m.position.set(x, -2.4, z); m.rotation.y = 0.8; ctx.scene.add(K.shadowAll(m));
      const sheet = K.M(new THREE.CircleGeometry(5, 24), ice, x, 0.1, z); sheet.rotation.x = -Math.PI / 2; ctx.scene.add(sheet); ctx.aoHide(sheet);
    }
    // --- An ice-fishing camp: tents, drying racks, a sled and a crackling fire.
    { let cx = 30, cz = 120; for (let tries = 0; tries < 60 && !open(cx, cz, 8); tries++) { const a = rand() * TAU, r = 80 + rand() * 60; cx = Math.cos(a) * r; cz = Math.sin(a) * r; }
      const y = heightAt(cx, cz), camp = new THREE.Group();
      [[-3, -2], [3, -1.5], [0, 3.5]].forEach(([x, z], i) => { const t = new THREE.Group(); t.add(K.M(new THREE.ConeGeometry(1.6, 2.8, 8), hide, 0, 1.4, 0)); for (let k = 0; k < 5; k++) t.add(K.M(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 4), wood, Math.sin(k) * 0.2, 1.6, Math.cos(k) * 0.2)); t.add(K.M(new THREE.CircleGeometry(0.5, 3), new THREE.MeshBasicMaterial({ color: '#1a1410' }), 0, 0.5, 1.46)); t.position.set(x, 0, z); t.rotation.y = Math.atan2(-x, -z); camp.add(t); });
      const fire = new THREE.Group(); for (let k = 0; k < 6; k++) { const l = K.M(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 5), wood, 0, 0.1, 0); l.rotation.set(Math.PI / 2 - 0.3, (k / 6) * TAU, 0); fire.add(l); }
      const flame = K.M(new THREE.ConeGeometry(0.35, 0.9, 8), K.glowM('#ffb347', 3), 0, 0.5, 0); flame.userData.flicker = true; fire.add(flame); camp.add(fire);
      for (let k = 0; k < 3; k++) { const h = K.M(new THREE.CircleGeometry(0.4, 12), new THREE.MeshStandardMaterial({ color: '#1f4a6a', roughness: 0.05 }), 5 + k * 1.5, 0.03, 4 - k); h.rotation.x = -Math.PI / 2; camp.add(h); const rod = K.M(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), wood, 5 + k * 1.5, 0.6, 4 - k - 0.3); rod.rotation.x = 0.6; camp.add(rod); }
      const sled = new THREE.Group(); sled.add(K.M(K.rbox(1, 0.2, 2.2, 0.05), wood, 0, 0.35, 0)); for (const s of [-0.45, 0.45]) sled.add(K.M(K.rbox(0.06, 0.08, 2.5, 0.02), clay('#8a9ab0', { key: 'runner' }), s, 0.08, 0.1)); sled.position.set(-5, 0, 3); sled.rotation.y = 0.5; camp.add(sled);
      camp.position.set(cx, y, cz); add(K.shadowAll(camp), 0);
      [[-3, -2], [3, -1.5], [0, 3.5]].forEach(([x, z]) => ctx.collide(cx + x, cz + z, 1.6));
      ctx.light('#ffb347', 16, 18, cx, y + 1.5, cz);
      ctx.camp = { x: cx, y, z: cz };
    }
    // --- Wolves on the ridges, heads raised to howl.
    for (let i = 0; i < 7; i++) {
      const r = 110 + rand() * 45, a = rand() * TAU, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!open(x, z, 1)) continue;
      const w = quadruped({ mat: clay('#4a5060', { roughness: 0.8, key: 'wolf' }), bodyR: 0.28, bodyL: 0.9, legLen: 0.6, legR: 0.06, neckUp: 0.5, tailDown: true });
      w.head.rotation.x = -0.9; w.g.position.set(x, heightAt(x, z), z); w.g.rotation.y = Math.atan2(-x, -z) + (rand() - 0.5);
      add(K.shadowAll(w.g), 0.5);
    }
    // --- Snow devils: spinning columns of snow that drift across the fields.
    ctx.devils = Array.from({ length: 5 }, () => ({ a: rand() * TAU, r: 60 + rand() * 90, sp: (rand() < 0.5 ? 1 : -1) * (0.02 + rand() * 0.03) }));
  },
  tick(dt, t, ctx, player) {
    const h = ctx.herd; h.s += dt * 1.6;
    ctx.elk.forEach((e) => {
      const q = along(ELK_TRAIL, h.s - e.off), x = q.x + Math.cos(q.a) * e.side, z = q.z - Math.sin(q.a) * e.side;
      e.q.g.position.set(x, ctx.heightAt(x, z), z); e.q.g.rotation.y = q.a;
      if (near(e.q.g.position, player.pos)) { stride(e.q, t * 4 + e.off, 0.4); e.q.head.rotation.x = Math.sin(t * 0.7 + e.off) * 0.15; if (Math.random() < dt * 4) ctx.fx.spawn(x, ctx.heightAt(x, z) + 1.4, z, 0, 0.3, 0, new THREE.Color('#dff6ff'), 0.4, 1.4, 0, 0.3); }
    });
    if (ctx.camp && near(ctx.camp, player.pos, 60) && Math.random() < dt * 12) ctx.fx.spawn(ctx.camp.x + (Math.random() - 0.5) * 0.4, ctx.camp.y + 1, ctx.camp.z, 0, 1.4, 0, new THREE.Color(Math.random() < 0.6 ? '#ffb347' : '#6a6a6a'), 0.35, 1.6, -0.3, 0.2);
    ctx.devils.forEach((d) => {
      d.a += d.sp * dt;
      const x = Math.sin(d.a) * d.r, z = Math.cos(d.a) * d.r;
      if (Math.hypot(x - player.pos.x, z - player.pos.z) > 90) return;
      for (let k = 0; k < 3; k++) { const a = t * 6 + k * 2.1, rr = 0.6 + Math.random() * 1.8, y = Math.random() * 8; ctx.fx.spawn(x + Math.sin(a) * rr, ctx.heightAt(x, z) + y, z + Math.cos(a) * rr, Math.cos(a) * 3, 1.2, -Math.sin(a) * 3, new THREE.Color('#ffffff'), 0.3, 0.9, 0, 0.3); }
    });
  },
};

export const LIFE = { necromancy: CRYPT_LIFE, pyromancy: CALDERA_LIFE, cryomancy: GLACIER_LIFE };
