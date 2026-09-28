import * as THREE from 'three';
import { heightAt, WATER_LEVEL, WORLD_RADIUS } from './world.js';

// Life in the valley: flocks wheeling overhead by day (bats round the tower at night),
// butterflies over the flower nodes, rabbits hopping about the meadows, and fish leaping from the
// water. Everything is instanced — a few draw calls in all — and it shies away from the
// apprentice: flocks climb, butterflies scatter, rabbits bolt.
const dummy = new THREE.Object3D();

// A "V" of two wings; scaling it on Y flips the wingtips up and down — a flap.
function wingGeo(span, chord) {
  const g = new THREE.BufferGeometry();
  const v = [0, 0, chord * 0.4, -span, 0.35 * span, -chord * 0.2, 0, 0, -chord * 0.6,
    0, 0, chord * 0.4, 0, 0, -chord * 0.6, span, 0.35 * span, -chord * 0.2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Wildlife {
  constructor(scene, particles, getNodes) {
    this.particles = particles;
    this.getNodes = getNodes;
    this.group = new THREE.Group();
    this.group.userData.noCut = true; // never see-through (cutout.js)
    scene.add(this.group);
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide, ...extra });

    // Flocks: each circles its own slow path round the valley.
    this.flocks = Array.from({ length: 3 }, (_, i) => ({ a: i * 2.1, r: 60 + i * 25, h: 22 + i * 6, speed: 0.05 + i * 0.012, lift: 0, n: 7 }));
    const nb = this.flocks.reduce((t, f) => t + f.n, 0);
    this.birds = new THREE.InstancedMesh(wingGeo(0.9, 0.5), mat('#3a3448'), nb);
    this.birdSeed = Array.from({ length: nb }, () => ({ ox: (Math.random() - 0.5) * 9, oz: (Math.random() - 0.5) * 9, oy: (Math.random() - 0.5) * 3, ph: Math.random() * 6 }));
    this.bats = new THREE.InstancedMesh(wingGeo(0.5, 0.35), mat('#2a1f33'), 10);
    this.batSeed = Array.from({ length: 10 }, () => ({ a: Math.random() * 6, r: 6 + Math.random() * 10, h: 10 + Math.random() * 12, sp: 0.6 + Math.random() * 0.8, ph: Math.random() * 6 }));

    // Butterflies: bright, small, several colours.
    // Unlit, so wings stay bright whichever way they catch the sun.
    this.flies = new THREE.InstancedMesh(wingGeo(0.42, 0.34), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), 28);
    const hues = ['#ffd35c', '#ff8fc8', '#8fd8ff', '#ffffff', '#c7a0ff'];
    this.flySeed = Array.from({ length: 28 }, (_, i) => {
      this.flies.setColorAt(i, new THREE.Color(hues[i % hues.length]));
      return { anchor: null, p: new THREE.Vector3(), v: new THREE.Vector3(), ph: Math.random() * 6, flee: 0 };
    });

    // Rabbits: a round body, head and two ears, merged into one instanced mesh.
    const parts = [
      new THREE.SphereGeometry(0.32, 10, 8).scale(1, 0.85, 1.25).translate(0, 0.3, 0),
      new THREE.SphereGeometry(0.2, 10, 8).translate(0, 0.52, 0.34),
      new THREE.CapsuleGeometry(0.05, 0.28, 3, 6).translate(-0.07, 0.8, 0.3),
      new THREE.CapsuleGeometry(0.05, 0.28, 3, 6).translate(0.07, 0.8, 0.3),
      new THREE.SphereGeometry(0.09, 8, 6).translate(0, 0.32, -0.4),
    ];
    this.rabbits = new THREE.InstancedMesh(mergeAll(parts), mat('#c9a784'), 7);
    this.rabbitSeed = Array.from({ length: 7 }, () => this.rabbitAt());

    // Fish: a small silver-orange body that arcs out of the water now and then.
    this.fish = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8).scale(0.6, 0.6, 1.6), mat('#ff9a4a', { metalness: 0.3, roughness: 0.4 }));
    this.fish.visible = false;
    this.waterSpots = [];
    for (let i = 0; i < 400 && this.waterSpots.length < 40; i++) {
      const a = Math.random() * 6.28, r = Math.random() * WORLD_RADIUS * 0.9, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (heightAt(x, z) < WATER_LEVEL - 0.8) this.waterSpots.push(new THREE.Vector3(x, WATER_LEVEL, z));
    }
    this.jump = null; this.jumpT = 3;

    for (const m of [this.birds, this.bats, this.flies, this.rabbits]) { m.frustumCulled = false; m.castShadow = m === this.rabbits; }
    this.group.add(this.birds, this.bats, this.flies, this.rabbits, this.fish);
  }

  rabbitAt() {
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * 6.28, r = 40 + Math.random() * (WORLD_RADIUS - 60), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (heightAt(x, z) > WATER_LEVEL + 0.5) return { x, z, dir: Math.random() * 6.28, hop: 0, wait: Math.random() * 3, flee: 0 };
    }
    return { x: 60, z: 60, dir: 0, hop: 0, wait: 1, flee: 0 };
  }

  // active: the valley is on screen; night 0..1; player: the apprentice's position.
  update(dt, t, active, night, player) {
    this.group.visible = active;
    if (!active) return;
    const day = night < 0.5;
    this.birds.visible = day; this.bats.visible = !day;
    this.flies.visible = night < 0.35;
    if (day) this.updateBirds(dt, t, player); else this.updateBats(t);
    if (this.flies.visible) this.updateFlies(dt, t, player);
    this.updateRabbits(dt, player, night);
    this.updateFish(dt);
  }

  updateBirds(dt, t, player) {
    let k = 0;
    for (const f of this.flocks) {
      f.a += dt * f.speed;
      const cx = Math.cos(f.a) * f.r, cz = Math.sin(f.a * 1.3) * f.r * 0.8;
      // Run beneath a low flock and it climbs away.
      const near = Math.hypot(player.x - cx, player.z - cz) < 18;
      f.lift = THREE.MathUtils.damp(f.lift, near ? 14 : 0, 1.5, dt);
      const heading = Math.atan2(Math.cos(f.a) * f.r, -Math.sin(f.a * 1.3) * f.r * 0.8 * 1.3);
      for (let i = 0; i < f.n; i++, k++) {
        const b = this.birdSeed[k];
        dummy.position.set(cx + b.ox, f.h + f.lift + b.oy + Math.sin(t * 0.7 + b.ph) * 0.8, cz + b.oz);
        dummy.rotation.set(0, heading, 0);
        dummy.scale.set(1, Math.sin(t * 9 + b.ph), 1);
        dummy.updateMatrix(); this.birds.setMatrixAt(k, dummy.matrix);
      }
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }

  updateBats(t) {
    this.batSeed.forEach((b, i) => {
      const a = b.a + t * b.sp;
      dummy.position.set(Math.cos(a) * b.r + Math.sin(t * 3 + b.ph) * 1.5, b.h + Math.sin(t * 2.3 + b.ph) * 2, Math.sin(a) * b.r);
      dummy.rotation.set(0, -a, 0);
      dummy.scale.set(1, Math.sin(t * 16 + b.ph), 1);
      dummy.updateMatrix(); this.bats.setMatrixAt(i, dummy.matrix);
    });
    this.bats.instanceMatrix.needsUpdate = true;
  }

  updateFlies(dt, t, player) {
    // Every few seconds the butterflies gather at the flowers nearest you, three or four apiece.
    if ((this.regroup = (this.regroup ?? 0) - dt) <= 0) {
      this.regroup = 4;
      this.near = this.getNodes().filter((n) => n.type === 'flower' && n.alive)
        .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z)).slice(0, 8);
    }
    const flowers = this.near || [];
    this.flySeed.forEach((f, i) => {
      const want = flowers[i % Math.max(1, flowers.length)];
      if (want && f.anchor !== want && (!f.anchor || !f.anchor.alive || Math.hypot(f.p.x - player.x, f.p.z - player.z) > 45)) {
        f.anchor = want;
        f.p.set(want.x + (Math.random() - 0.5) * 3, (want.y ?? 0) + 1.2, want.z + (Math.random() - 0.5) * 3);
      }
      if (!f.anchor) return;
      const home = new THREE.Vector3(f.anchor.x + Math.sin(t * 0.7 + f.ph) * 1.6, (f.anchor.y ?? 0) + 1 + Math.sin(t * 1.3 + f.ph) * 0.5, f.anchor.z + Math.cos(t * 0.9 + f.ph) * 1.6);
      const dp = f.p.distanceTo(player);
      if (dp < 3) f.flee = 2.5;
      f.flee = Math.max(0, f.flee - dt);
      if (f.flee > 0) f.v.copy(f.p).sub(player).setY(0).setLength(4).setY(2.5);
      else f.v.lerp(home.sub(f.p).multiplyScalar(1.5), 1 - Math.exp(-dt * 2));
      f.p.addScaledVector(f.v, dt);
      dummy.position.copy(f.p);
      dummy.rotation.set(0, Math.atan2(f.v.x, f.v.z), 0);
      dummy.scale.set(1, Math.sin(t * 22 + f.ph) * 1.4, 1);
      dummy.updateMatrix(); this.flies.setMatrixAt(i, dummy.matrix);
    });
    this.flies.instanceMatrix.needsUpdate = true;
  }

  updateRabbits(dt, player, night) {
    this.rabbitSeed.forEach((r, i) => {
      const d = Math.hypot(player.x - r.x, player.z - r.z);
      if (d < 8 && r.flee <= 0) { r.flee = 2.5; r.dir = Math.atan2(r.x - player.x, r.z - player.z); r.wait = 0; }
      r.flee -= dt;
      if (r.hop <= 0) {
        r.wait -= dt * (night > 0.6 ? 0.3 : 1); // quieter at night
        if (r.wait <= 0) { r.hop = 0.45; if (r.flee <= 0) r.dir += (Math.random() - 0.5) * 1.6; r.wait = r.flee > 0 ? 0 : 0.6 + Math.random() * 2.5; }
      }
      let y = heightAt(r.x, r.z);
      if (r.hop > 0) {
        r.hop -= dt;
        const sp = r.flee > 0 ? 9 : 3.5;
        const nx = r.x + Math.sin(r.dir) * sp * dt, nz = r.z + Math.cos(r.dir) * sp * dt;
        // Turn back from water and the valley's edge.
        if (heightAt(nx, nz) < WATER_LEVEL + 0.4 || Math.hypot(nx, nz) > WORLD_RADIUS - 15) r.dir += Math.PI * 0.8;
        else { r.x = nx; r.z = nz; }
        y = heightAt(r.x, r.z) + Math.sin(Math.max(0, r.hop) / 0.45 * Math.PI) * 0.45;
      }
      dummy.position.set(r.x, y, r.z);
      dummy.rotation.set(0, r.dir, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix(); this.rabbits.setMatrixAt(i, dummy.matrix);
    });
    this.rabbits.instanceMatrix.needsUpdate = true;
  }

  updateFish(dt) {
    if (!this.waterSpots.length) return;
    if (!this.jump) {
      if ((this.jumpT -= dt) > 0) return;
      const at = this.waterSpots[Math.floor(Math.random() * this.waterSpots.length)], a = Math.random() * 6.28;
      this.jump = { at, dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), t: 0 };
      this.particles.ring(at.clone().setY(WATER_LEVEL + 0.05), { count: 18, color: '#dff4ff', speed: 2.5, size: 0.3, life: 0.6, y: 0.05 });
    }
    const j = this.jump;
    j.t += dt / 0.9;
    const u = Math.min(1, j.t);
    this.fish.visible = true;
    this.fish.position.copy(j.at).addScaledVector(j.dir, (u - 0.5) * 2.4).setY(WATER_LEVEL + Math.sin(u * Math.PI) * 1.6);
    this.fish.lookAt(this.fish.position.clone().add(j.dir).setY(this.fish.position.y + Math.cos(u * Math.PI) * 1.2));
    if (u >= 1) {
      this.particles.ring(this.fish.position.clone().setY(WATER_LEVEL + 0.05), { count: 22, color: '#dff4ff', speed: 3, size: 0.32, life: 0.7, y: 0.05 });
      this.fish.visible = false; this.jump = null; this.jumpT = 4 + Math.random() * 8;
    }
  }
}

function mergeAll(geos) {
  // Tiny local merge (position + normal) so the rabbit is a single instanced mesh.
  const pos = [], nor = [];
  for (const g of geos) {
    const gg = g.index ? g.toNonIndexed() : g;
    pos.push(...gg.attributes.position.array); nor.push(...gg.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
