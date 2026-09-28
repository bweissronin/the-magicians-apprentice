import * as THREE from 'three';
import { WATER_LEVEL } from './world.js';

// Spells that touch the world, not just creatures:
//   Frost   freezes water into an ice floe you can walk on (chain a few into a bridge) — and cools
//           imp lava, as Earth does.
//   Fire    scorches grass (a smouldering mark with a few flames), boils water into steam, and
//           melts ice floes.
//   Radiance wakes glowing flowers round its pool of light; they linger a while after it fades.
const FLOE_LIFE = 15, SCORCH_LIFE = 22, BLOOM_LIFE = 30;

export class SpellWorld {
  constructor(game) {
    this.game = game;
    this.floes = []; this.scorches = []; this.blooms = [];
    this.floeGeo = new THREE.CylinderGeometry(1, 1.05, 0.3, 7);
    this.floeMat = new THREE.MeshStandardMaterial({ color: '#dff4ff', roughness: 0.25, metalness: 0.05, emissive: '#6fb8e8', emissiveIntensity: 0.15, flatShading: true });
    this.scorchGeo = new THREE.CircleGeometry(1, 20);
    this.stemGeo = new THREE.ConeGeometry(0.08, 0.9, 5).translate(0, 0.45, 0);
    this.headGeo = new THREE.IcosahedronGeometry(0.3, 0);
  }

  get magic() { return this.game.magic; }
  // Water only exists in the valley's own terrain.
  inValley() { return this.magic.arena === this.magic.valleyArena; }

  onLand(el, p) {
    const m = this.magic, h = m.arena.height(p.x, p.z);
    const water = this.inValley() && h < WATER_LEVEL - 0.25;
    if (el === 'frost') {
      m.smother(p.x, p.z, 2.5);
      if (water) this.freeze(p.x, p.z);
    } else if (el === 'fire') {
      const floe = this.floes.find((f) => Math.hypot(f.x - p.x, f.z - p.z) < f.r + 1);
      if (floe) floe.t = Math.min(floe.t, 0.6); // it melts away
      if (water || floe) this.steam(p.x, p.z);
      else this.scorch(p.x, p.z, h);
    } else if (el === 'radiance') {
      this.bloom(p.x, p.z);
    }
  }

  freeze(x, z) {
    const r = 3.2 + Math.random() * 0.6, mesh = new THREE.Mesh(this.floeGeo, this.floeMat);
    mesh.scale.set(r, 1, r); mesh.rotation.y = Math.random() * 6;
    mesh.position.set(x, WATER_LEVEL, z);
    mesh.receiveShadow = true;
    this.magic.scene.add(mesh);
    this.floes.push({ x, z, r, t: FLOE_LIFE, mesh });
    this.magic.particles.burst(new THREE.Vector3(x, WATER_LEVEL + 0.4, z), { count: 40, color: '#e8f8ff', speed: 5, size: 0.45, life: 0.8 });
    this.game.audio.tone(1500, 0.5, { type: 'triangle', vol: 0.05, slide: 0.6, wet: 0.6 });
  }

  // A walkable surface for the player (see main.js player.surfaces).
  floeAt(x, z) {
    let h = -Infinity;
    for (const f of this.floes) if (f.t > 0.4 && Math.hypot(x - f.x, z - f.z) < f.r * 0.95) h = WATER_LEVEL + 0.15;
    return h;
  }

  steam(x, z) {
    this.magic.particles.burst(new THREE.Vector3(x, WATER_LEVEL + 0.5, z), { count: 50, color: '#f4f8ff', speed: 2.5, size: 0.9, life: 1.6, gravity: -2.5, spread: 1.4 });
    this.game.audio.noise(1.2, { freq: 3500, q: 0.4, vol: 0.12, type: 'highpass', wet: 0.3 });
  }

  scorch(x, z, h) {
    const mesh = new THREE.Mesh(this.scorchGeo, new THREE.MeshBasicMaterial({ color: '#2a1a12', transparent: true, opacity: 0.7, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.scale.setScalar(1.6 + Math.random() * 0.6);
    mesh.position.set(x, h + 0.04, z);
    this.magic.scene.add(mesh);
    this.scorches.push({ x, z, y: h, t: SCORCH_LIFE, mesh, flame: 3.5 });
  }

  bloom(x, z) {
    const m = this.magic, cols = ['#ffd84a', '#ff7ac8', '#5fd8ff', '#b58cff'];
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, d = 1 + Math.random() * 3.2, bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
      const y = m.arena.height(bx, bz);
      if (this.inValley() && y < WATER_LEVEL) continue;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.stemGeo, new THREE.MeshStandardMaterial({ color: '#5fb870' })));
      const head = new THREE.Mesh(this.headGeo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], emissive: cols[i % cols.length], emissiveIntensity: 0.7 }));
      head.position.y = 0.95; g.add(head);
      g.position.set(bx, y, bz); g.scale.setScalar(0.01);
      m.scene.add(g);
      this.blooms.push({ g, t: BLOOM_LIFE, delay: Math.random() * 0.6, s: 0.9 + Math.random() * 0.6 });
    }
  }

  update(dt, elapsed) {
    const m = this.magic;
    for (const f of [...this.floes]) {
      f.t -= dt;
      // Melting: the floe shrinks and sinks over its last seconds.
      const k = Math.min(1, f.t / 3);
      f.mesh.scale.set(f.r * (0.4 + 0.6 * k), 1, f.r * (0.4 + 0.6 * k));
      f.mesh.position.y = WATER_LEVEL - (1 - k) * 0.3;
      if (f.t < 3 && Math.random() < dt * 3) m.particles.spawn(f.x + (Math.random() - 0.5) * f.r, WATER_LEVEL + 0.2, f.z + (Math.random() - 0.5) * f.r, 0, 0.6, 0, this.dripCol ||= new THREE.Color('#dff4ff'), 0.25, 0.8, 0, 0.3);
      if (f.t <= 0) { f.mesh.removeFromParent(); this.floes.splice(this.floes.indexOf(f), 1); }
    }
    for (const s of [...this.scorches]) {
      s.t -= dt; s.flame -= dt;
      if (s.flame > 0 && Math.random() < dt * 25) {
        m.particles.spawn(s.x + (Math.random() - 0.5) * 2, s.y + 0.2, s.z + (Math.random() - 0.5) * 2, 0, 1.6 + Math.random(), 0, this.fireCol ||= new THREE.Color('#ff8a3c'), 0.45, 0.6, 0, 1);
      } else if (s.t > SCORCH_LIFE - 8 && Math.random() < dt * 3) {
        m.particles.spawn(s.x + (Math.random() - 0.5) * 1.5, s.y + 0.3, s.z + (Math.random() - 0.5) * 1.5, 0, 0.8, 0, this.smokeCol ||= new THREE.Color('#6a625e'), 0.6, 1.8, -0.3, 0.3);
      }
      s.mesh.material.opacity = 0.7 * Math.min(1, s.t / 5);
      if (s.t <= 0) { s.mesh.removeFromParent(); s.mesh.material.dispose(); this.scorches.splice(this.scorches.indexOf(s), 1); }
    }
    for (const b of [...this.blooms]) {
      b.t -= dt; b.delay -= dt;
      const grow = b.delay > 0 ? 0.01 : Math.min(1, (BLOOM_LIFE - b.t - Math.max(0, b.delay)) * 2);
      const fade = Math.min(1, b.t / 2);
      b.g.scale.setScalar(Math.max(0.01, b.s * grow * fade));
      b.g.rotation.z = Math.sin(elapsed * 2 + b.s * 9) * 0.08;
      if (b.t <= 0) { b.g.removeFromParent(); this.blooms.splice(this.blooms.indexOf(b), 1); }
    }
  }

  // Leaving an arena clears what was made in it.
  clear() {
    for (const x of [...this.floes, ...this.scorches]) x.mesh.removeFromParent();
    for (const b of this.blooms) b.g.removeFromParent();
    this.floes.length = 0; this.scorches.length = 0; this.blooms.length = 0;
  }
}
