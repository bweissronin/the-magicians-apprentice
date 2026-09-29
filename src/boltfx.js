import * as THREE from 'three';

// The staff's bolts, made to feel like spells: every element has its own projectile, a glowing
// ribbon trail, a flash at the staff as it leaves and a proper impact (a flash, a shockwave, and
// the element's own aftermath: arcane motes, sun-rays, flying rubble, ice spikes, a fireball).
// All of it is additive glow and small shared meshes, so no lights are added (a light-count
// change would recompile every shader; see lightbank.js). Everything lives under one root that
// follows the active scene and is kept out of the ambient-occlusion pass.

// ---------------------------------------------------------------- textures (drawn once)
const canvasTex = (size, draw) => {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const TEX = {};
const glowTex = () => (TEX.glow ||= canvasTex(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.7)'); r.addColorStop(0.6, 'rgba(255,255,255,0.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
}));
const starTex = () => (TEX.star ||= canvasTex(256, (g, s) => {
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0, len = long ? s * 0.5 : s * 0.3, w = long ? 7 : 4;
    const lg = g.createLinearGradient(0, 0, len, 0); lg.addColorStop(0, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.fill(); g.rotate(Math.PI / 4);
  }
  const r = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.18); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(-s / 2, -s / 2, s, s);
}));
const ringTex = () => (TEX.ring ||= canvasTex(256, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.72, 'rgba(255,255,255,0.9)'); r.addColorStop(0.8, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
}));
const runeTex = () => (TEX.rune ||= canvasTex(256, (g, s) => {
  g.translate(s / 2, s / 2); g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, s * 0.42, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(0, 0, s * 0.33, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 6; i++) { g.save(); g.rotate((i / 6) * Math.PI * 2); g.beginPath(); g.moveTo(0, -s * 0.33); g.lineTo(s * 0.06, -s * 0.4); g.lineTo(-s * 0.06, -s * 0.4); g.closePath(); g.stroke(); g.restore(); }
  g.lineWidth = 3; g.beginPath(); for (let i = 0; i <= 3; i++) { const a = (i / 3) * Math.PI * 2 - Math.PI / 2; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3); } g.stroke();
}));
const flakeTex = () => (TEX.flake ||= canvasTex(128, (g, s) => {
  g.translate(s / 2, s / 2); g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 6; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s * 0.44); g.moveTo(0, -s * 0.26); g.lineTo(s * 0.12, -s * 0.36); g.moveTo(0, -s * 0.26); g.lineTo(-s * 0.12, -s * 0.36); g.stroke(); g.rotate(Math.PI / 3); }
}));

const add = (color, map, opacity = 1) => new THREE.SpriteMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
// Normal-blended: saturated colour that reads against bright daylight ground, under the additive glow.
const body = (color, map, opacity = 1) => new THREE.SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, fog: false });
const bodyMesh = (color, opacity = 1, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side, fog: false });
const addMesh = (color, opacity = 1, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side, fog: false });

// ---------------------------------------------------------------- per-element looks
export const LOOK = {
  arcane:   { core: '#f5ecff', body: '#7a3cff', glow: '#9b6bff', trail: '#8f5cff', trailW: 0.7, halo: 6.5 },
  radiance: { core: '#fffbe8', body: '#ffb81c', glow: '#ffcf5a', trail: '#ffc23a', trailW: 0.95, halo: 9 },
  earth:    { core: '#ffc27a', body: '#9a6a3c', glow: '#e08a3a', trail: '#a88458', trailW: 0.8, halo: 3.6 },
  frost:    { core: '#ffffff', body: '#35b6ff', glow: '#7fdcff', trail: '#59c8ff', trailW: 0.6, halo: 6 },
  fire:     { core: '#fff3c8', body: '#ff4a00', glow: '#ff6a14', trail: '#ff6a14', trailW: 1.05, halo: 8 },
};

const SHARED = {};
const shared = () => {
  if (SHARED.ready) return SHARED;
  SHARED.ready = true;
  SHARED.ico = new THREE.IcosahedronGeometry(1, 1);
  SHARED.rock = new THREE.DodecahedronGeometry(1, 0);
  SHARED.shard = new THREE.OctahedronGeometry(1, 0).scale(0.42, 0.42, 1.9);
  SHARED.ring = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
  SHARED.spike = new THREE.ConeGeometry(0.28, 1, 5).translate(0, 0.5, 0);
  SHARED.sphere = new THREE.SphereGeometry(1, 20, 14);
  SHARED.plane = new THREE.PlaneGeometry(1, 1);
  SHARED.rockMat = new THREE.MeshStandardMaterial({ color: '#8a6a4c', roughness: 0.85, emissive: '#ff7a2a', emissiveIntensity: 0.35, flatShading: true });
  SHARED.debrisMat = new THREE.MeshStandardMaterial({ color: '#9a7a58', roughness: 0.9, flatShading: true });
  SHARED.iceMat = new THREE.MeshStandardMaterial({ color: '#8fdcff', emissive: '#2aa8ff', emissiveIntensity: 0.6, roughness: 0.08, transparent: true, opacity: 0.9, flatShading: true });
  return SHARED;
};

// ---------------------------------------------------------------- ribbon trail
// A camera-facing strip through the bolt's recent positions, fading from the head to the tail.
class Ribbon {
  constructor(color, width, n = 22) {
    this.n = n; this.width = width; this.pts = []; this.fade = 1;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n * 2), 1));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uFade: { value: 1 } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uFade; varying float vA; void main(){ gl_FragColor = vec4(mix(uColor, vec3(1.0), vA * vA * 0.55), vA * 0.9 * uFade); }',
    }));
    this.mesh.frustumCulled = false;
  }
  push(p) { this.pts.unshift(p.clone()); if (this.pts.length > this.n) this.pts.pop(); }
  update(camera) {
    const pos = this.mesh.geometry.attributes.position, al = this.mesh.geometry.attributes.alpha, P = this.pts, n = P.length;
    const eye = camera.position, side = new THREE.Vector3(), dir = new THREE.Vector3(), view = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const p = P[Math.min(i, n - 1)] || new THREE.Vector3();
      const q = P[Math.min(i + 1, n - 1)] || p;
      dir.subVectors(i + 1 < n ? p : P[Math.max(0, i - 1)] || p, i + 1 < n ? q : p);
      view.subVectors(eye, p);
      side.crossVectors(dir, view).normalize();
      const k = n > 1 ? Math.min(1, i / (n - 1)) : 1, w = this.width * (1 - k) * (i < n ? 1 : 0);
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      const a = i < n ? 1 - k : 0; al.setX(i * 2, a); al.setX(i * 2 + 1, a);
    }
    pos.needsUpdate = true; al.needsUpdate = true;
    this.mesh.material.uniforms.uFade.value = this.fade;
  }
}

// ---------------------------------------------------------------- the module
export class BoltFX {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'boltFx';
    this.live = [];     // transient effects: { t, life, update(k, dt), dispose() }
    this.camera = null;
    shared();
  }

  setScene(scene) {
    this.clear();
    scene.add(this.root);
  }

  clear() {
    for (const e of this.live) e.dispose?.();
    this.live.length = 0;
    for (const c of [...this.root.children]) this.root.remove(c);
  }

  // ---------------- the projectile
  bolt(el, size0) {
    const size = size0 * 1.35; // a touch larger than the hit radius, so it reads at a distance
    const S = shared(), L = LOOK[el], g = new THREE.Group(), parts = { spin: [] };
    const shell = new THREE.Sprite(body(L.body, glowTex(), 0.95)); shell.scale.setScalar(size * L.halo * 0.55); g.add(shell);
    const halo = new THREE.Sprite(add(L.glow, glowTex(), 0.9)); halo.scale.setScalar(size * L.halo); g.add(halo); parts.halo = halo;
    if (el === 'earth') {
      const rock = new THREE.Mesh(S.rock, S.rockMat); rock.scale.setScalar(size * 1.15); rock.castShadow = true; g.add(rock); parts.rock = rock;
      const heart = new THREE.Sprite(add('#ffb35a', glowTex(), 0.85)); heart.scale.setScalar(size * 2.2); g.add(heart);
    } else if (el === 'frost') {
      const shard = new THREE.Mesh(S.shard, S.iceMat); shard.scale.setScalar(size * 1.5); g.add(shard); parts.aim = [shard];
      for (const s of [-1, 1]) { const m = new THREE.Mesh(S.shard, S.iceMat); m.scale.setScalar(size * 0.8); m.position.set(s * size * 0.9, -size * 0.3, -size * 0.8); g.add(m); parts.aim.push(m); }
      const core = new THREE.Sprite(add('#ffffff', glowTex(), 1)); core.scale.setScalar(size * 2.4); g.add(core);
    } else {
      const core = new THREE.Mesh(S.ico, new THREE.MeshBasicMaterial({ color: L.body, fog: false })); core.scale.setScalar(size * 0.9); g.add(core); parts.core = core;
      const inner = new THREE.Sprite(add(L.core, glowTex(), 1)); inner.scale.setScalar(size * 2.6); g.add(inner);
    }
    if (el === 'arcane') {
      // A rune circle turning behind the orb, and two motes orbiting it.
      const rune = new THREE.Sprite(add('#c9a8ff', runeTex(), 0.95)); rune.scale.setScalar(size * 4.2); g.add(rune); parts.rune = rune;
      parts.motes = [0, 1].map(() => { const m = new THREE.Sprite(add('#ffffff', starTex(), 1)); m.scale.setScalar(size * 1.6); g.add(m); return m; });
    } else if (el === 'radiance') {
      const star = new THREE.Sprite(add('#fff0b8', starTex(), 1)); star.scale.setScalar(size * 9); g.add(star); parts.star = star;
      const star2 = new THREE.Sprite(add('#ffd36b', starTex(), 0.7)); star2.scale.setScalar(size * 6); g.add(star2); parts.star2 = star2;
    } else if (el === 'fire') {
      // Flame shells that flicker at different rates round a white-hot core.
      parts.flames = ['#ff3c0a', '#ff7a1c', '#ffb347'].map((c, i) => { const f = new THREE.Sprite(add(c, glowTex(), 0.75)); f.scale.setScalar(size * (5 - i * 1.1)); g.add(f); return f; });
    }
    const ribbon = new Ribbon(L.trail, L.trailW * (0.6 + size * 1.6), el === 'earth' ? 14 : 26);
    this.root.add(g, ribbon.mesh);
    return { group: g, parts, ribbon, el, size, t: 0 };
  }

  updateBolt(v, dt, vel) {
    v.t += dt;
    const { parts: P, group: g, size, t } = v;
    if (P.aim && vel.lengthSq() > 0.01) { const d = vel.clone().normalize(); for (const m of P.aim) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d); }
    if (P.rock) { P.rock.rotation.x += dt * 9; P.rock.rotation.z += dt * 6; }
    if (P.core) P.core.rotation.y += dt * 6;
    P.halo.material.opacity = 0.75 + Math.sin(t * 30) * 0.15;
    if (P.rune) { P.rune.material.rotation += dt * 5; P.rune.scale.setScalar(size * (4.2 + Math.sin(t * 12) * 0.3)); }
    if (P.motes) P.motes.forEach((m, i) => { const a = t * 14 + i * Math.PI; m.position.set(Math.cos(a) * size * 2, Math.sin(a * 1.3) * size * 1.2, Math.sin(a) * size * 2); m.material.rotation += dt * 8; });
    if (P.star) { P.star.material.rotation += dt * 2.5; P.star2.material.rotation -= dt * 4; P.star.scale.setScalar(size * (9 + Math.sin(t * 20) * 1.2)); }
    if (P.flames) P.flames.forEach((f, i) => { f.scale.setScalar(size * (5 - i * 1.1) * (0.85 + Math.random() * 0.35)); f.material.rotation = Math.random() * 6; });
    v.ribbon.push(g.position);
    if (this.camera) v.ribbon.update(this.camera);
  }

  // The bolt is spent: the orb goes, its trail fades out over a moment.
  release(v) {
    this.root.remove(v.group);
    const r = v.ribbon;
    this.live.push({ t: 0, life: 0.25, update: (k) => { r.fade = 1 - k; if (this.camera) r.update(this.camera); }, dispose: () => { this.root.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); } });
  }

  // A bolt that runs out of range without hitting anything: it bursts into sparks and is gone.
  fizzle(el, p, particles) {
    const L = LOOK[el], pop = new THREE.Sprite(add(L.glow, starTex(), 1)); pop.position.copy(p); this.root.add(pop);
    this.live.push({ t: 0, life: 0.3, update: (k) => { pop.scale.setScalar(0.5 + k * 3); pop.material.opacity = 1 - k; pop.material.rotation = k * 3; }, dispose: () => { this.root.remove(pop); pop.material.dispose(); } });
    particles?.burst(p, { count: 18, color: L.trail, speed: 4, size: 0.3, life: 0.6, gravity: 2 });
  }

  // ---------------- leaving the staff
  muzzle(el, p) {
    const L = LOOK[el];
    const flash = new THREE.Sprite(add(L.glow, el === 'radiance' || el === 'arcane' ? starTex() : glowTex(), 1));
    flash.position.copy(p); this.root.add(flash);
    this.live.push({ t: 0, life: 0.22, update: (k) => { flash.scale.setScalar(0.3 + k * 1.8); flash.material.opacity = 0.9 * (1 - k); flash.material.rotation = k * 2; }, dispose: () => { this.root.remove(flash); flash.material.dispose(); } });
  }

  // ---------------- the hit
  // p: where it struck; ground: the ground height there (null if it struck in the air).
  impact(el, p, ground, particles) {
    if (el !== 'earth' && el !== 'fire') this.onShake?.(0.1);
    const S = shared(), L = LOOK[el], big = el === 'fire' || el === 'earth' ? 1.4 : el === 'radiance' ? 1.25 : 1;
    // A flash at the point of impact.
    const puff = new THREE.Sprite(body(L.body, glowTex(), 0.9)); puff.position.copy(p); this.root.add(puff);
    this.live.push({ t: 0, life: 0.45, update: (k) => { puff.scale.setScalar((1.2 + (1 - (1 - k) ** 3) * 4) * big); puff.material.opacity = 0.9 * (1 - k) ** 1.6; }, dispose: () => { this.root.remove(puff); puff.material.dispose(); } });
    const flash = new THREE.Sprite(add(L.core, glowTex(), 1)); flash.position.copy(p); this.root.add(flash);
    const flare = new THREE.Sprite(add(L.glow, starTex(), 1)); flare.position.copy(p); this.root.add(flare);
    this.live.push({ t: 0, life: 0.3, update: (k) => {
      const e = 1 - (1 - k) ** 3;
      flash.scale.setScalar((0.7 + e * 2.4) * big); flash.material.opacity = 0.75 * (1 - k) ** 2;
      flare.scale.setScalar((1.6 + e * 4.2) * big); flare.material.opacity = 0.85 * (1 - k) ** 2; flare.material.rotation = k * 1.5;
    }, dispose: () => { this.root.remove(flash, flare); flash.material.dispose(); flare.material.dispose(); } });
    // A shockwave: flat on the ground, or a ring facing you in the air.
    const onGround = ground !== null && p.y - ground < 1.6;
    const wave = onGround ? new THREE.Mesh(S.ring, bodyMesh(L.body, 1, THREE.DoubleSide)) : new THREE.Sprite(body(L.body, ringTex(), 1));
    wave.position.copy(p); if (onGround) wave.position.y = ground + 0.12; this.root.add(wave);
    const R = (el === 'fire' ? 5.5 : el === 'earth' ? 4.5 : el === 'radiance' ? 4 : 3) * (onGround ? 1 : 0.6);
    this.live.push({ t: 0, life: 0.5, update: (k) => { const e = 1 - (1 - k) ** 2; wave.scale.setScalar(0.3 + e * R); wave.material.opacity = (1 - k) * 0.9; }, dispose: () => { this.root.remove(wave); wave.material.dispose(); } });

    const P = particles, col = (c) => new THREE.Color(c);
    if (el === 'arcane') {
      // Motes of starlight scattering, then drifting down.
      P?.burst(p, { count: 46, color: '#d8c2ff', speed: 9, size: 0.35, life: 0.9, gravity: 3 });
      P?.burst(p, { count: 18, color: '#ffffff', speed: 3, size: 0.55, life: 0.6 });
    } else if (el === 'radiance') {
      // Shafts of light striking up out of the spot.
      for (let i = 0; i < 6; i++) {
        const shaft = new THREE.Mesh(S.plane, addMesh('#ffe7a0', 0.8, THREE.DoubleSide));
        const a = (i / 6) * Math.PI, h = 4 + Math.random() * 3;
        shaft.position.set(p.x, (onGround ? ground : p.y) + h / 2, p.z); shaft.rotation.y = a; shaft.scale.set(0.35, h, 1);
        this.root.add(shaft);
        this.live.push({ t: -i * 0.03, life: 0.6, update: (k) => { shaft.scale.x = 0.35 * (1 - k) + 0.05; shaft.material.opacity = Math.sin(Math.PI * Math.max(0, k)) * 0.8; }, dispose: () => { this.root.remove(shaft); shaft.material.dispose(); } });
      }
      P?.burst(p, { count: 40, color: '#fff2b0', speed: 6, size: 0.4, life: 1.1, gravity: -2 });
    } else if (el === 'earth') {
      // Rubble thrown out of the crater, bouncing once and settling.
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(S.rock, S.debrisMat), s = 0.12 + Math.random() * 0.22;
        m.scale.setScalar(s); m.position.copy(p); m.castShadow = true; this.root.add(m);
        const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 5, v = new THREE.Vector3(Math.cos(a) * sp, 5 + Math.random() * 5, Math.sin(a) * sp), spin = new THREE.Vector3(Math.random() * 12, Math.random() * 12, 0);
        const floor = onGround ? ground : p.y - 3;
        this.live.push({ t: 0, life: 1.4, update: (k, dt) => {
          v.y -= 22 * dt; m.position.addScaledVector(v, dt); m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt;
          if (m.position.y < floor + s) { m.position.y = floor + s; v.y = Math.abs(v.y) * 0.35; v.x *= 0.6; v.z *= 0.6; spin.multiplyScalar(0.5); }
          if (k > 0.75) m.scale.setScalar(s * (1 - k) / 0.25);
        }, dispose: () => this.root.remove(m) });
      }
      P?.ring(new THREE.Vector3(p.x, (onGround ? ground : p.y) + 0.3, p.z), { count: 50, color: '#c9ab82', speed: 8, size: 0.9, life: 0.9, y: 0.4 });
      P?.burst(p, { count: 30, color: '#8a6e50', speed: 4, size: 1, life: 1.3, gravity: -0.6 });
      this.onShake?.(0.35);
    } else if (el === 'frost') {
      // Ice spikes erupting out of the ground (or a burst of shards in the air), then melting away.
      const base = onGround ? ground : p.y - 0.4;
      const n = onGround ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(S.spike, S.iceMat), a = (i / n) * Math.PI * 2 + Math.random() * 0.4, r = i === 0 ? 0 : 0.6 + Math.random() * 0.9, h = i === 0 ? 2.4 : 1 + Math.random() * 1.3;
        m.position.set(p.x + Math.cos(a) * r, base, p.z + Math.sin(a) * r);
        m.rotation.set((Math.random() - 0.5) * 0.7 + (i ? Math.sin(a) * 0.5 : 0), 0, (Math.random() - 0.5) * 0.7 - (i ? Math.cos(a) * 0.5 : 0));
        m.castShadow = true; this.root.add(m);
        this.live.push({ t: -i * 0.02, life: 1.3, update: (k) => { const grow = Math.min(1, k * 7), melt = k > 0.7 ? (1 - k) / 0.3 : 1; m.scale.set(melt, h * grow * (0.3 + 0.7 * melt), melt); }, dispose: () => this.root.remove(m) });
      }
      P?.burst(p, { count: 36, color: '#dff7ff', speed: 7, size: 0.35, life: 1, gravity: 4 });
      P?.burst(p, { count: 20, color: '#9fe8ff', speed: 2, size: 1.1, life: 1.2, gravity: -0.4 });
    } else if (el === 'fire') {
      // A fireball that swells and burns out, embers flung wide and a column of smoke.
      const ball = new THREE.Mesh(S.sphere, bodyMesh('#ff5a0a', 0.85)); ball.position.copy(p); this.root.add(ball);
      const heart = new THREE.Mesh(S.sphere, addMesh('#ffe08a', 1)); heart.position.copy(p); this.root.add(heart);
      this.live.push({ t: 0, life: 0.55, update: (k) => { const e = 1 - (1 - k) ** 3; ball.scale.setScalar(0.4 + e * 2.8); ball.material.opacity = (1 - k) * 0.85; heart.scale.setScalar(0.3 + e * 1.4); heart.material.opacity = (1 - k) ** 2; }, dispose: () => { this.root.remove(ball, heart); ball.material.dispose(); heart.material.dispose(); } });
      P?.burst(p, { count: 60, color: '#ffb347', speed: 11, size: 0.4, life: 1, gravity: 6 });
      P?.burst(p, { count: 26, color: '#4a3c36', speed: 2.5, size: 1.4, life: 1.8, gravity: -1.2 });
      this.onShake?.(0.25);
    }
    void col;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      if (e.t < 0) continue;
      const k = Math.min(1, e.t / e.life);
      e.update(k, dt);
      if (k >= 1) { e.dispose?.(); this.live.splice(i, 1); }
    }
  }
}
