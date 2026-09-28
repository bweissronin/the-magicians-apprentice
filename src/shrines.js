import * as THREE from 'three';
import { heightAt } from './world.js';
import { SHRINES } from './data.js';
import { runeCircleTexture } from './textures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clay, addRim, stoneBlockTexture, PALETTE } from './style.js';

// Standing-stone circle around a floating obelisk. Its colour shifts to gold once solved.
export class Shrines {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.list = SHRINES.map((def) => this.build(def));
  }

  build(def) {
    const g = new THREE.Group();
    const y = heightAt(def.x, def.z);
    g.position.set(def.x, y, def.z);
    const color = new THREE.Color(def.color);
    const map = stoneBlockTexture('#e3d6bd').clone(); map.needsUpdate = true; map.repeat.set(4, 0.4);
    const stone = addRim(new THREE.MeshStandardMaterial({ map, roughness: 0.7 }), 0.22);
    const plain = clay('#d8ccb6', { roughness: 0.6, key: 'shrineStone' });

    const dais = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.2, 0.6, 12), stone); dais.position.y = 0.1;
    const dais2 = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.5, 12), stone); dais2.position.y = 0.6;
    g.add(dais, dais2);

    const stones = [];
    const glyphMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const h = 3 + (i % 2) * 0.9;
      const s = new THREE.Mesh(new RoundedBoxGeometry(0.95, h, 0.7, 4, 0.18), plain);
      s.position.set(Math.cos(a) * 5, h / 2 + 0.2, Math.sin(a) * 5);
      s.rotation.y = -a + Math.PI / 2; s.rotation.z = (Math.random() - 0.5) * 0.08;
      const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.9), glyphMat);
      glyph.position.set(0, 0.3, 0.31);
      s.add(glyph);
      g.add(s); stones.push(s);
    }
    if (def.puzzle !== 'lights') {
      // Lintel across two stones for a trilithon silhouette.
      const lintel = new THREE.Mesh(new RoundedBoxGeometry(3.6, 0.55, 0.8, 4, 0.2), plain);
      lintel.position.set(Math.cos(0.3 + Math.PI / 6) * 5.2, 4.2, Math.sin(0.3 + Math.PI / 6) * 5.2);
      lintel.rotation.y = -(0.3 + Math.PI / 6) + Math.PI / 2;
      g.add(lintel);
    }
    const obelisk = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5, roughness: 0.2 }));
    obelisk.scale.set(0.7, 2.0, 0.7); obelisk.position.y = 3.2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 8, 48), glyphMat); ring.position.y = 3.2;
    const circle = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshBasicMaterial({
      map: runeCircleTexture('#' + color.getHexString()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    circle.rotation.x = -Math.PI / 2; circle.position.y = 0.87;
    const light = new THREE.PointLight(color, 10, 16, 2); light.position.y = 3.2;
    g.add(obelisk, ring, circle, light);
    g.traverse((o) => { if (o.isMesh && o !== circle) { o.castShadow = true; o.receiveShadow = true; } });

    // A beam of light rises from solved shrines — visible across the valley.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.2, 80, 16, 1, true), new THREE.MeshBasicMaterial({
      color: '#ffd36b', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    beam.position.y = 42; beam.visible = false;
    g.add(beam);
    this.scene.add(g);

    return {
      def, group: g, obelisk, ring, circle, light, beam, glyphMat, x: def.x, z: def.z, y,
      solved: false, colliders: stones.map((s) => ({ x: def.x + s.position.x, z: def.z + s.position.z, radius: 0.7 })),
    };
  }

  // Walkable top of the two-tier stone dais (radii match the meshes built above).
  // Returns the dais surface height at (x, z), or -Infinity when not over a shrine.
  surfaceAt(x, z) {
    let best = -Infinity;
    for (const s of this.list) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > 6.2) continue;
      const tier = (rTop, rBot, top, bottom) => d <= rTop ? top : d >= rBot ? -Infinity : top + (bottom - top) * ((d - rTop) / (rBot - rTop));
      best = Math.max(best, s.y + tier(5.5, 6.2, 0.4, -0.2), s.y + tier(3.2, 3.5, 0.85, 0.35));
    }
    return best;
  }

  get colliders() { return this.list.flatMap((s) => s.colliders); }

  markSolved(id, burst = true) {
    const s = this.list.find((x) => x.def.id === id);
    if (!s || s.solved) return;
    s.solved = true;
    const gold = new THREE.Color('#ffd36b');
    s.obelisk.material.color.copy(gold); s.obelisk.material.emissive.copy(gold);
    s.glyphMat.color.copy(gold); s.glyphMat.emissive.copy(gold);
    s.light.color.copy(gold);
    s.beam.visible = true;
    if (burst) {
      const p = new THREE.Vector3(s.x, s.y + 3, s.z);
      this.particles.burst(p, { count: 160, color: '#ffd36b', speed: 12, size: 0.8, life: 2, gravity: -1 });
      this.particles.ring(new THREE.Vector3(s.x, s.y, s.z), { count: 120, color: s.def.color, speed: 12 });
    }
  }

  nearest(p, range) {
    let best = null, bd = range;
    for (const s of this.list) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  update(dt, elapsed, playerPos) {
    for (const s of this.list) {
      s.obelisk.rotation.y += dt * 0.8;
      s.obelisk.position.y = 3.2 + Math.sin(elapsed * 1.4 + s.x) * 0.25;
      s.ring.rotation.x = Math.PI / 2 + Math.sin(elapsed * 0.7) * 0.4;
      s.ring.rotation.y += dt * 0.6;
      s.circle.rotation.z += dt * (s.solved ? 0.3 : 0.1);
      const near = Math.hypot(s.x - playerPos.x, s.z - playerPos.z) < 50;
      if (near && Math.random() < dt * 6) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 3;
        this.particles.spawn(s.x + Math.cos(a) * r, s.y + 1, s.z + Math.sin(a) * r, 0, 1.2 + Math.random(), 0,
          s.solved ? new THREE.Color('#ffd36b') : s.obelisk.material.emissive, 0.3, 2.5, 0, 0.2);
      }
    }
  }
}
