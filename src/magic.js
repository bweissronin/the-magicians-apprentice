import * as THREE from 'three';
import { heightAt, WORLD_RADIUS, WATER_LEVEL } from './world.js';
import { makeCreature, setFlash } from './creatures.js';
import { CREATURES, RANK, EL, resolveHit, elementVerdict, elderChance } from './bestiary.js';

const WISP_COLOR = new THREE.Color('#c04dff');
const TMP = new THREE.Vector3();

// Per-attunement bolt behaviour. Earth arcs under gravity and never homes.
const BOLTS = {
  arcane:   { mana: 8,  cd: 0.28, speed: 42, homing: 10, size: 0.22, dmg: 1 },
  radiance: { mana: 10, cd: 0.5,  speed: 26, homing: 5,  size: 0.3,  dmg: 1 },
  earth:    { mana: 12, cd: 0.7,  speed: 24, homing: 0,  size: 0.34, dmg: 2, arc: true },
  frost:    { mana: 9,  cd: 0.34, speed: 34, homing: 8,  size: 0.24, dmg: 1 },
  fire:     { mana: 10, cd: 0.36, speed: 38, homing: 8,  size: 0.26, dmg: 1 },
};
const TAG_TEXT = { weak: 'Weak!', resisted: 'Resisted', passes: 'Passes through', absorbed: 'Heals it!', dazzled: 'Dazzled!', core: 'Core strike!', shatter: 'Shatter!', shock: 'Thermal shock!' };
const TAG_COLOR = { weak: '#ffe08a', resisted: '#9aa4b8', passes: '#9aa4b8', absorbed: '#ff6a1c', dazzled: '#ffd36b', core: '#ffb347', shatter: '#bfefff', shock: '#ff9a5a' };

// Spells (the attuned bolt, blink, nova, fireball, Earthen Stair) and the creatures they fight.
// Creatures follow the elemental "locks and keys" rules in bestiary.js: wards, weaknesses,
// armour, freezing, dazzling, light pools and ranks.
export class Magic {
  constructor(scene, particles, state, audio) {
    this.scene = scene;
    this.particles = particles;
    this.state = state;
    this.audio = audio;
    this.bolts = [];
    this.wisps = [];
    this.pools = [];      // Radiance light pools
    this.lavaPools = [];  // pools left by imps killed raw
    this.pillars = [];    // Earthen Stair
    this.cooldowns = { bolt: 0, blink: 0, nova: 0, fireball: 0, earthstair: 0 };
    this.boltGeo = new THREE.IcosahedronGeometry(1, 1);
    this.rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.boltMats = Object.fromEntries(Object.keys(BOLTS).map((k) => [k, new THREE.MeshBasicMaterial({ color: EL[k].core })]));
    this.rockMat = new THREE.MeshStandardMaterial({ color: '#9a7a58', roughness: 0.8, emissive: '#dca468', emissiveIntensity: 0.25, flatShading: true });
    this.spawnTimer = 4;
    this.strict = false;  // "Scholar" setting: resisted elements do nothing
    this.poolLights(scene);
    // Where creatures live and what they look like. Realms swap this out (see setArena).
    this.valleyArena = {
      radius: WORLD_RADIUS, height: heightAt,
      safe: (p) => Math.hypot(p.x, p.z) < 36,           // tower grounds are warded
      spawn: (pp) => {
        const a = Math.random() * Math.PI * 2, r = 35 + Math.random() * 35;
        const x = pp.x + Math.cos(a) * r, z = pp.z + Math.sin(a) * r;
        return Math.hypot(x, z) < 40 || Math.hypot(x, z) > WORLD_RADIUS ? null : { x, z };
      },
      cap: (night) => Math.round(2 + night * 7), interval: null,
      home: { x: 0, z: 0 },
    };
    this.valleyTheme = { name: 'Shadow Wisp', kind: 'shade', emissive: '#8a2be2', particle: '#c04dff' };
    this.arena = this.valleyArena; this.theme = this.valleyTheme;
    this.target = null;        // currently locked creature
    this.manualLock = false;   // true when the player picked it with Tab
    this.reticle = this.buildReticle();
    scene.add(this.reticle);
    this.poolGeo = new THREE.CircleGeometry(1, 40);
  }

  // Radiance pools light the ground with a point light. Adding or removing a light changes the
  // scene's light count, and three.js then recompiles every lit material — a freeze of a second
  // or more. So each scene keeps a fixed set of pool lights, dark until a pool borrows one.
  poolLights(scene) {
    if (!scene.userData.poolLights) {
      scene.userData.poolLights = Array.from({ length: 3 }, () => {
        const l = new THREE.PointLight('#ffd36b', 0, 12, 1.6);
        l.userData.free = true;
        scene.add(l);
        return l;
      });
    }
    return scene.userData.poolLights;
  }

  // Move all creature and spell activity into a different scene (a realm) or back to the valley.
  setArena(scene, particles, arena, theme) {
    this.onLeave?.();
    for (const w of this.wisps) this.scene.remove(w.mesh);
    for (const b of this.bolts) this.scene.remove(b.mesh);
    for (const p of [...this.pools, ...this.lavaPools, ...this.pillars]) this.scene.remove(p.mesh);
    for (const p of this.pools) this.freeLight(p);
    this.wisps.length = 0; this.bolts.length = 0; this.pools.length = 0; this.lavaPools.length = 0; this.pillars.length = 0;
    this.scene.remove(this.reticle);
    this.scene = scene; this.particles = particles;
    this.poolLights(scene); // made while the gate's fade is still up, not mid-fight
    this.arena = arena || this.valleyArena; this.theme = theme || this.valleyTheme;
    this.scene.add(this.reticle);
    this.target = null; this.spawnTimer = 2;
  }

  get element() { return this.state.element; }

  // ---------------- Fireball (Pyromancy mastery): the heavy Fire attack ----------------
  castFireball(player) {
    if (this.cooldowns.fireball > 0) return 'cd';
    const forge = this.state.hasBoon('pyromancy'); // Heart of the Forge: cheaper, wider, hotter
    if (!this.state.spendMana(forge ? 12 : 20)) return 'mana';
    this.cooldowns.fireball = 1.4;
    const from = player.staffTip();
    const t = this.isTargetable(this.target, player) ? this.target : null;
    if (t) player.facing = Math.atan2(t.mesh.position.x - player.pos.x, t.mesh.position.z - player.pos.z);
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0.05, Math.cos(player.facing)).normalize();
    const vel = (t ? t.mesh.position.clone().sub(from).normalize() : fwd).multiplyScalar(30);
    const mesh = new THREE.Mesh(this.fireGeo ||= new THREE.SphereGeometry(0.45, 16, 12), this.fireMat ||= new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
    mesh.position.copy(from);
    this.scene.add(mesh);
    if (forge) mesh.scale.setScalar(1.5);
    this.bolts.push({ mesh, vel, life: 1.8, target: t, dmg: forge ? 3 : 2, fire: true, el: 'fire', radius: forge ? 11 : 5.5, homing: 8, speed: 30 });
    player.castT = 0.35;
    this.audio.play('nova');
    this.state.stats.spells++;
    return true;
  }

  explode(p, radius = 5.5, dmg = 2) {
    const big = radius > 6;
    this.particles.burst(p, { count: big ? 160 : 90, color: '#ff8a3c', speed: big ? 16 : 10, size: 0.8, life: 1, gravity: 2 });
    this.particles.burst(p, { count: 40, color: '#ffe08a', speed: 5, size: 0.5, life: 0.7 });
    this.particles.ring(p.clone().setY(p.y - 0.8), { count: big ? 110 : 60, color: '#ff6a1c', speed: big ? 17 : 9, size: 0.6, life: 0.7 });
    for (const w of [...this.wisps]) if (!w.dying && w.mesh.position.distanceTo(p) < radius) this.hitWisp(w, dmg, 'fire');
    this.onExplode?.(p);
  }

  // ---------------- Targeting ----------------
  // A camera-facing reticle: two counter-rotating rings plus four inward chevrons.
  buildReticle() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: '#ff5a7a', transparent: true, opacity: 0.95, depthTest: false });
    const soft = new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.8, depthTest: false });
    const outer = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.045, 6, 48, Math.PI * 1.7), mat);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.03, 6, 40, Math.PI * 1.4), soft);
    const chevrons = new THREE.Group();
    const tri = new THREE.ConeGeometry(0.16, 0.3, 3);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(tri, mat);
      const a = (i / 4) * Math.PI * 2;
      c.position.set(Math.cos(a) * 1.32, Math.sin(a) * 1.32, 0);
      c.rotation.z = a + Math.PI / 2; // point inward
      chevrons.add(c);
    }
    g.add(outer, inner, chevrons);
    g.traverse((o) => { o.renderOrder = 999; });
    g.userData = { outer, inner, chevrons };
    g.visible = false;
    return g;
  }

  isTargetable(w, player, range = 38) {
    return w && !w.dying && this.wisps.includes(w) && w.mesh.position.distanceTo(player.pos) < range;
  }

  // Tab: cycle through nearby creatures, nearest first.
  cycleTarget(player) {
    const list = this.wisps.filter((w) => this.isTargetable(w, player, 35))
      .sort((a, b) => a.mesh.position.distanceTo(player.pos) - b.mesh.position.distanceTo(player.pos));
    if (!list.length) { this.target = null; this.manualLock = false; return null; }
    const i = list.indexOf(this.target);
    this.target = list[(i + 1) % list.length];
    this.manualLock = true;
    this.audio.play('ui');
    return this.target;
  }

  updateReticle(dt, elapsed, camera, player, active) {
    const r = this.reticle;
    const t = active ? this.updateTarget(player) : null;
    r.visible = !!t;
    if (!t) return;
    r.position.copy(t.mesh.position);
    if (t.creature.grounded) r.position.y += (t.creature.height || 2) * 0.55 * t.mesh.scale.y;
    r.quaternion.copy(camera.quaternion); // billboard
    const ud = r.userData;
    ud.outer.rotation.z += dt * 1.6;
    ud.inner.rotation.z -= dt * 2.4;
    const pulse = 1 + Math.sin(elapsed * 6) * 0.08;
    ud.chevrons.scale.setScalar(pulse);
    // Manual locks glow gold; automatic threat locks glow red.
    ud.outer.material.color.set(this.manualLock ? '#ffd36b' : '#ff5a7a');
    ud.inner.material.color.set(EL[this.element].color);
    const d = camera.position.distanceTo(t.mesh.position);
    r.scale.setScalar(Math.max(0.7, d * 0.05) * (t.rank === 'common' ? 1 : 1.3));
  }

  // Keep the lock valid; auto-acquire the nearest creature that is hunting the player.
  updateTarget(player) {
    if (!this.isTargetable(this.target, player)) { this.target = null; this.manualLock = false; }
    if (!this.target) {
      let best = null, bd = 28;
      for (const w of this.wisps) {
        if (!w.chasing || w.dying) continue;
        const d = w.mesh.position.distanceTo(player.pos);
        if (d < bd) { bd = d; best = w; }
      }
      this.target = best;
    }
    return this.target;
  }
  aimPoint(w) {
    const p = w.mesh.position.clone();
    if (w.creature.grounded) p.y += (w.creature.height || 2) * 0.5 * w.mesh.scale.y;
    return p;
  }

  // ---------------- The attuned bolt ----------------
  castBolt(player) {
    if (this.cooldowns.bolt > 0) return false;
    const el = this.element, B = BOLTS[el];
    if (!this.state.spendMana(B.mana)) return 'mana';
    const rank = this.state.up('bolt');
    this.cooldowns.bolt = B.cd * (rank >= 3 ? 0.6 : rank >= 1 ? 0.8 : 1); // Empowered Bolt
    this.boltMax = this.cooldowns.bolt;
    const from = player.staffTip();
    // Locked target first; otherwise snap to the nearest creature inside a forward cone.
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    let target = this.isTargetable(this.target, player) ? this.target : null, best = Infinity;
    if (target) player.facing = Math.atan2(target.mesh.position.x - player.pos.x, target.mesh.position.z - player.pos.z);
    for (const w of target ? [] : this.wisps) {
      if (w.dying) continue;
      const to = w.mesh.position.clone().sub(from);
      const d = to.length();
      if (d > 32) continue;
      const cos = to.clone().setY(0).normalize().dot(fwd);
      if (cos > 0.8 && d < best) { best = d; target = w; }
    }
    let vel;
    if (B.arc) {
      // Earth: a lobbed stone. Solve a ballistic arc toward the target (or ~18 m ahead).
      const aim = target ? this.aimPoint(target) : from.clone().addScaledVector(fwd, 18).setY(this.arena.height(from.x + fwd.x * 18, from.z + fwd.z * 18));
      const flat = aim.clone().sub(from).setY(0), dist = Math.max(2, flat.length()), T = Math.max(0.35, dist / B.speed);
      vel = flat.normalize().multiplyScalar(dist / T); vel.y = (aim.y - from.y) / T + 0.5 * 20 * T;
    } else {
      // With nothing to hit, Frost, Fire and Radiance come down on a spot ~14 m ahead, so you can
      // aim them at the world (freeze the pond, scorch a meadow — see spellworld.js).
      const ahead = !target && ['frost', 'fire', 'radiance'].includes(el) ? from.clone().addScaledVector(fwd, 14).setY(this.surfaceAt(from.x + fwd.x * 14, from.z + fwd.z * 14)) : null;
      vel = (target ? this.aimPoint(target).sub(from).normalize() : ahead ? ahead.sub(from).normalize() : fwd.clone().setY(0.02).normalize()).multiplyScalar(B.speed);
    }
    const mesh = new THREE.Mesh(B.arc ? this.rockGeo : this.boltGeo, B.arc ? this.rockMat : this.boltMats[el]);
    mesh.scale.setScalar(B.size);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.bolts.push({ mesh, vel, life: B.arc ? 2.4 : 1.6, target: B.homing ? target : null, dmg: B.dmg * (rank >= 2 ? 2 : 1), el, homing: B.homing, speed: B.speed, arc: B.arc });
    player.castT = 0.25;
    this.audio.play(el === 'earth' ? 'quarry' : el === 'frost' ? 'attune' : 'bolt');
    this.state.stats.spells++;
    return true;
  }

  castBlink(player) {
    if (this.cooldowns.blink > 0) return 'cd';
    const br = this.state.up('blink');
    if (!this.state.spendMana([22, 14, 8][br])) return 'mana';
    this.cooldowns.blink = br >= 2 ? 0.6 : 1.2; // Swift Blink
    const start = player.pos.clone();
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    const dist = br >= 1 ? 14 : 11;
    const end = start.clone().addScaledVector(fwd, dist);
    const r = Math.hypot(end.x, end.z);
    if (r > this.arena.radius) end.multiplyScalar(this.arena.radius / r);
    end.y = player.groundAt(end.x, end.z);
    const bc = new THREE.Color('#7fe3ff');
    for (let t = 0; t <= 1; t += 0.05) {
      const p = start.clone().lerp(end, t); p.y += 1 + Math.random();
      this.particles.spawn(p.x, p.y, p.z, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), bc, 0.5, 0.8, 0, 1);
    }
    this.particles.burst(start.clone().setY(start.y + 1), { count: 40, color: '#b89bff', speed: 5, size: 0.4, life: 0.8 });
    player.pos.copy(end);
    player.vel.set(0, 0, 0);
    this.particles.burst(end.clone().setY(end.y + 1), { count: 50, color: '#7fe3ff', speed: 6, size: 0.45, life: 0.9 });
    this.audio.play('blink');
    this.state.stats.spells++;
    return true;
  }

  castNova(player) {
    if (this.cooldowns.nova > 0) return 'cd';
    if (!this.state.spendMana(45)) return 'mana';
    this.cooldowns.nova = 6;
    const c = player.pos.clone(); c.y += 1;
    this.particles.ring(player.pos, { count: 200, color: '#ffe08a', speed: 22, size: 0.9, life: 1.2, y: 1 });
    this.particles.burst(c, { count: 120, color: '#ffffff', speed: 14, size: 0.6, life: 1.2 });
    // Starlight answers to no ward, but guardians and Dread foes only feel a fraction of it.
    for (const w of [...this.wisps]) if (w.mesh.position.distanceTo(c) < 22) this.hitWisp(w, w.rank === 'common' ? 99 : Math.ceil(w.maxHp * 0.25), 'nova');
    player.shake = 0.5;
    this.audio.play('nova');
    this.state.stats.spells++;
    return true;
  }

  // ---------------- Earthen Stair (Geomancy mastery) ----------------
  // A stone pillar rises ahead. Placed near the last one, the next stands a step higher, so
  // three make a stair; pillars are walkable, block creatures and crust over lava.
  castStair(player) {
    if (this.cooldowns.earthstair > 0) return 'cd';
    if (!this.state.spendMana(18)) return 'mana';
    this.cooldowns.earthstair = 0.6;
    const max = this.state.up('stair') ? 4 : 3, life = this.state.up('stair') ? 30 : 20;
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    const onPillar = this.pillarAt(player.pos.x, player.pos.z, player.pos.y);
    const x = player.pos.x + fwd.x * 3.1, z = player.pos.z + fwd.z * 3.1;
    const ground = this.arena.height(x, z);
    const last = this.pillars[this.pillars.length - 1];
    let top = ground + 1.2;
    if (last && Math.hypot(last.x - player.pos.x, last.z - player.pos.z) < 5) top = Math.max(top, last.top + 1.2);
    if (onPillar > -Infinity) top = Math.max(top, onPillar + 1.2);
    top = Math.min(top, ground + 4.8);
    while (this.pillars.length >= max) this.removePillar(this.pillars[0]);
    const h = top - ground + 1.5; // sunk a little below the ground so slopes never show a gap
    const mesh = new THREE.Mesh(this.pillarGeo ||= new THREE.CylinderGeometry(1, 1.15, 1, 7, 3), this.pillarMat ||= new THREE.MeshStandardMaterial({ color: '#8a6e50', roughness: 0.85, flatShading: true }));
    mesh.scale.set(1.25, 0.01, 1.25);
    mesh.position.set(x, ground - 1.5, z);
    mesh.castShadow = mesh.receiveShadow = true;
    const cap = new THREE.Mesh(this.capGeo ||= new THREE.CylinderGeometry(1.02, 1, 0.12, 7), this.capMat ||= new THREE.MeshStandardMaterial({ color: '#dca468', emissive: '#ffb347', emissiveIntensity: 0.4, roughness: 0.6, flatShading: true }));
    cap.position.y = 0.5; mesh.add(cap);
    this.scene.add(mesh);
    const p = { x, z, top, ground, h, mesh, t: life, rise: 0, collider: { x, z, radius: 1.35, top } };
    this.pillars.push(p);
    this.particles.ring(new THREE.Vector3(x, ground + 0.2, z), { count: 60, color: '#b89a74', speed: 6, size: 0.6, life: 0.8 });
    player.shake = Math.max(player.shake, 0.3);
    this.audio.play('quarry');
    this.state.stats.spells++;
    return true;
  }
  removePillar(p) {
    this.particles.burst(new THREE.Vector3(p.x, p.top - 0.5, p.z), { count: 50, color: '#8a6e50', speed: 5, size: 0.6, life: 1, gravity: 8 });
    this.scene.remove(p.mesh);
    this.pillars.splice(this.pillars.indexOf(p), 1);
  }
  // Walkable top of a pillar under (x, z), if the player at height y could step onto it.
  pillarAt(x, z, y = Infinity) {
    let h = -Infinity;
    for (const p of this.pillars) if (p.rise >= 1 && Math.hypot(x - p.x, z - p.z) < 1.3 && p.top <= y + 0.75) h = Math.max(h, p.top);
    return h;
  }
  get pillarColliders() { return this.pillars.map((p) => p.collider); }

  // ---------------- Light & lava pools ----------------
  addPool(p) {
    const wide = this.state.up('radiance') >= 2 ? 1.5 : 1, r = 4 * wide, life = this.state.perk('specter') ? 8 : 4;
    const mesh = new THREE.Mesh(this.poolGeo, this.poolMat ||= new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.scale.setScalar(r);
    const y = this.surfaceAt(p.x, p.z) + 0.08;
    mesh.position.set(p.x, y, p.z);
    // Borrow a waiting light (with more than three pools out, the newest simply go unlit).
    const light = this.poolLights(this.scene).find((l) => l.userData.free);
    if (light) { light.userData.free = false; light.position.set(p.x, y + 2, p.z); light.distance = r * 3; light.intensity = 12; }
    this.scene.add(mesh); this.onAddFx?.(mesh);
    this.pools.push({ x: p.x, z: p.z, r, t: life, life, mesh, light });
    this.particles.ring(new THREE.Vector3(p.x, y + 0.2, p.z), { count: 50, color: '#ffe08a', speed: r * 1.4, size: 0.5, life: 0.7 });
  }
  freeLight(p) {
    if (!p.light) return;
    p.light.intensity = 0; p.light.userData.free = true; p.light = null;
  }
  // Where a spell meets the world: the ground, or the water's surface in the valley.
  surfaceAt(x, z) {
    const h = this.arena.height(x, z);
    return this.arena === this.valleyArena ? Math.max(h, WATER_LEVEL) : h;
  }
  lightAt(x, z) {
    return this.pools.some((p) => Math.hypot(x - p.x, z - p.z) < p.r) || !!this.arena.lightAt?.(x, z);
  }
  addLavaPool(x, z) {
    const mesh = new THREE.Mesh(this.poolGeo, this.lavaPoolMat ||= new THREE.MeshStandardMaterial({ color: '#ff5a0a', emissive: '#ff6a1c', emissiveIntensity: 2.4, roughness: 0.4 }));
    mesh.rotation.x = -Math.PI / 2; mesh.scale.setScalar(2.2);
    mesh.position.set(x, this.arena.height(x, z) + 0.06, z);
    this.scene.add(mesh);
    this.lavaPools.push({ x, z, r: 2.2, t: 10, mesh });
    this.particles.burst(mesh.position, { count: 70, color: '#ff8a3c', speed: 7, size: 0.6, life: 1, gravity: 4 });
  }
  lavaPoolAt(x, z) { return this.lavaPools.some((p) => Math.hypot(x - p.x, z - p.z) < p.r); }
  smother(x, z, r) {
    for (const p of [...this.lavaPools]) {
      if (Math.hypot(x - p.x, z - p.z) > r + p.r) continue;
      this.scene.remove(p.mesh); this.lavaPools.splice(this.lavaPools.indexOf(p), 1);
      this.particles.burst(p.mesh.position.clone().setY(p.mesh.position.y + 0.5), { count: 60, color: '#6a5a50', speed: 4, size: 0.9, life: 1.4, gravity: -1 });
      this.onText?.(p.mesh.position, 'Smothered', '#dca468');
    }
  }

  // ---------------- Creatures ----------------
  // Spawn one creature. opts: { rank, rise, name, haunt, boss, hpMul }.
  spawnCreature(kind, x, z, opts = {}) {
    const def = CREATURES[kind], rank = RANK[opts.rank || 'common'];
    const creature = makeCreature(opts.model || kind, opts);
    const g = creature.group;
    g.userData.noCut = true; // creatures are never see-through (cutout.js)
    const hover = creature.grounded ? 0 : (creature.hover ?? 1.6);
    g.position.set(x, this.arena.height(x, z) + (opts.rise || creature.grounded ? 0 : 2.5), z);
    if (opts.rise) this.particles.burst(g.position.clone().setY(g.position.y + 0.3), { count: 40, color: this.theme.particle, speed: 4, size: 0.5, life: 1, gravity: -2, up: 2 });
    g.scale.setScalar(0.01);
    this.scene.add(g);
    const hp = Math.max(1, Math.round(def.hp * rank.hp * (opts.hpMul || 1)));
    const w = {
      mesh: g, creature, kind, rank: rank.id, name: opts.name || (rank.id === 'elder' ? def.elder.name : def.name), haunt: opts.haunt || null, boss: opts.boss || null,
      hp, maxHp: hp, hover, t: Math.random() * 10, spawn: 0, hitCd: 0, vel: new THREE.Vector3(), dying: 0,
      armour: !!(def.plated || def.armoured), armourT: 0, frozen: 0, chill: 0, dazzled: 0, solid: 0, stagger: 0, stun: 0, slam: 0, wasSolid: false, split: !!opts.split,
      scale: rank.scale * (opts.scale || 1),
    };
    if (w.armour) this.setArmour(w, true);
    if (rank.id !== 'common') g.add(this.wardCrown(kind, rank.id, creature));
    this.wisps.push(w);
    if (!this.state.beast(kind).seen && !def.hidden && !opts.boss) this.onFirstSight?.(w);
    return w;
  }

  spawnWisp(playerPos) {
    const spot = this.arena.spawn(playerPos);
    if (!spot) return;
    const kind = this.theme.kind;
    const home = this.arena.home || { x: 0, z: 0 };
    const chance = elderChance({ dist: Math.hypot(spot.x - home.x, spot.z - home.z), night: this.arena.nightly ? this.night : 0, movedOn: this.arena.movedOn?.(), haunt: !!this.arena.hauntAt?.(spot.x, spot.z) });
    this.spawnCreature(kind, spot.x, spot.z, { rank: Math.random() < chance ? 'elder' : 'common', rise: spot.rise });
  }

  // Elder and Dread foes wear a slowly turning crown of their ward sigils.
  wardCrown(kind, rank, creature) {
    const def = CREATURES[kind], g = new THREE.Group();
    const cols = def.wards.length ? def.wards.map((e) => EL[e].color) : ['#c04dff'];
    const n = rank === 'dread' ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, gem = new THREE.Mesh(this.gemGeo ||= new THREE.OctahedronGeometry(0.13), new THREE.MeshBasicMaterial({ color: cols[i % cols.length] }));
      gem.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55); g.add(gem);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 6, 32), new THREE.MeshBasicMaterial({ color: rank === 'dread' ? '#ff5a7a' : '#ffd36b' }));
    ring.rotation.x = Math.PI / 2; g.add(ring);
    g.position.y = creature.grounded ? (creature.height || 2.5) + 0.5 : 1.35;
    g.userData.crown = true;
    return g;
  }

  setArmour(w, on) {
    w.armour = on;
    if (w.creature.setArmour) { w.creature.setArmour(on); return; }
    // Generic ice armour (wraiths): a shell of crystalline shards around the body.
    if (!w.iceShell) {
      const shell = new THREE.Group(), m = this.iceArmourMat ||= new THREE.MeshStandardMaterial({ color: '#c9f0ff', emissive: '#4fb8ff', emissiveIntensity: 0.5, roughness: 0.1, transparent: true, opacity: 0.55, flatShading: true });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, s = new THREE.Mesh(this.shardGeo ||= new THREE.OctahedronGeometry(0.28, 0), m);
        s.position.set(Math.cos(a) * 0.55, (i % 3) * 0.35 - 0.3, Math.sin(a) * 0.55); s.scale.set(0.7, 1.6, 0.5); s.rotation.set(0.3, a, 0.2);
        shell.add(s);
      }
      w.mesh.add(shell); w.iceShell = shell;
    }
    w.iceShell.visible = on;
  }

  freezeShell(w, on) {
    if (on && !w.frozenShell) {
      const m = new THREE.Mesh(this.frozenGeo ||= new THREE.IcosahedronGeometry(1, 1), this.frozenMat ||= new THREE.MeshStandardMaterial({ color: '#dff6ff', emissive: '#6fd8ff', emissiveIntensity: 0.6, roughness: 0.05, transparent: true, opacity: 0.45, flatShading: true, depthWrite: false }));
      const s = w.creature.grounded ? 1.9 : 1.1; m.scale.set(s, s * 1.2, s);
      m.position.y = w.creature.grounded ? 1.6 : 0;
      w.mesh.add(m); w.frozenShell = m;
    }
    if (w.frozenShell) w.frozenShell.visible = on;
  }

  // el: the element that struck ('arcane' … 'fire', or 'nova' for raw starlight).
  hitWisp(w, dmg = 1, el = 'arcane', at = null) {
    if (w.dying) return;
    let outcome = { mult: 1, tag: 'neutral', effects: [] };
    // A ward totem shields its haunt; crystal golems throw Radiance back while their facets hold.
    if (w.shielded && el !== 'nova') { this.onText?.(w.mesh.position, 'Shielded', '#b89bff'); w.flash = 0.06; return; }
    if (w.crystal && w.armour && el === 'radiance') {
      const drained = Math.min(this.state.mana, 10); this.state.mana -= drained;
      this.onText?.(w.mesh.position, 'Reflected!', '#c9a8ff', true);
      this.particles.burst(w.mesh.position.clone().setY(w.mesh.position.y + 2), { count: 30, color: '#c9a8ff', speed: 8, size: 0.4, life: 0.6 });
      this.onPlayerHit?.(drained, w);
      return;
    }
    if (el !== 'nova') {
      outcome = resolveHit(w, el, { strict: this.strict, perks: { golem: this.state.perk('golem'), wraith: this.state.perk('wraith'), bones: this.state.perk('bones') } });
      // The journal learns the truth about an element the first time it is tried.
      const b = this.state.beast(w.kind);
      if (!b.tried[el] && !CREATURES[w.kind].hidden) { b.tried[el] = elementVerdict(w.kind, el); this.onLearn?.(w, el, b.tried[el]); }
    }
    // Boss phases can override the rules (phylactery shields, burrowing, clones…); effects still apply.
    const ov = w.boss?.preHit?.(w, el, outcome);
    if (ov) outcome = { ...outcome, ...ov };
    // A Dread's ward shifts, halfway down, to whatever element was hurting it.
    if (w.wardEl && el === w.wardEl && outcome.mult > 0) { outcome = { ...outcome, mult: this.strict ? 0 : 0.25, tag: 'resisted' }; }
    const fx = outcome.effects;
    if (fx.includes('thaw')) { w.frozen = 0; this.freezeShell(w, false); }
    if (fx.includes('chill')) { w.chill++; if (w.chill >= 3) { w.chill = 0; w.frozen = 4; this.freezeShell(w, true); this.onText?.(w.mesh.position, 'Frozen!', '#bfefff'); } }
    if (fx.includes('knockdown') || fx.includes('stagger')) w.stagger = Math.max(w.stagger, fx.includes('knockdown') ? 1 : 0.6);
    if (fx.includes('knockdown')) { const away = w.mesh.position.clone().sub(at || w.mesh.position).setY(0); if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5); w.vel.addScaledVector(away.normalize(), 7); }
    if (fx.includes('solidify')) w.solid = Math.max(w.solid, 4);
    if (fx.includes('breakArmour') && w.armour) {
      this.setArmour(w, false);
      w.armourT = w.rank !== 'common' ? (w.kind === 'golem' ? 6 : 3) : 0;
      this.particles.burst(w.mesh.position.clone().setY(w.mesh.position.y + (w.creature.grounded ? 1.8 : 0)), { count: 50, color: w.kind === 'golem' ? '#6d6a72' : '#c9f0ff', speed: 7, size: 0.7, life: 1, gravity: 10 });
      this.onText?.(w.mesh.position, w.kind === 'golem' ? 'Plates cracked!' : 'Armour shattered!', '#ffe08a');
    }
    if (fx.includes('dazzle')) w.dazzled = 3;
    if (fx.includes('stun')) w.stun = 3;
    let amount = outcome.mult < 0 ? -1 : dmg * outcome.mult;
    if (outcome.tag === 'shock') amount = w.boss ? Math.ceil(w.maxHp * 0.3) : w.hp;
    if (amount < 0) { w.hp = Math.min(w.maxHp, w.hp + 1); this.onText?.(w.mesh.position, TAG_TEXT.absorbed, TAG_COLOR.absorbed); this.audio.play('error'); return; }
    // Forgiving wards chip in quarter-points; the pips show whole hearts.
    w.hp -= amount;
    // Bosses can't be burst through a phase: health stops at the next phase's threshold.
    const floor = w.boss?.minHp?.();
    if (floor !== undefined) w.hp = Math.max(w.hp, floor);
    if (w.shiftWard && !w.wardEl && w.hp > 0 && w.hp < w.maxHp / 2 && EL[el]) { w.wardEl = el; this.onText?.(w.mesh.position, `Its ward shifts to ${EL[el].name}!`, EL[el].color, true); }
    w.flash = amount > 0 ? 0.18 : 0.06;
    if (outcome.tag !== 'neutral' && TAG_TEXT[outcome.tag]) this.onText?.(w.mesh.position, TAG_TEXT[outcome.tag], TAG_COLOR[outcome.tag], outcome.tag === 'weak' || outcome.tag === 'shock' || outcome.tag === 'shatter');
    this.onHit?.(w.mesh.position.clone(), amount, w.hp <= 0.001, outcome.tag);
    this.particles.burst(w.mesh.position, { count: amount > 0.5 ? 20 : 8, color: el === 'nova' ? '#ffe08a' : EL[el]?.color || this.theme.particle, speed: 5, size: 0.4, life: 0.6 });
    if (w.hp <= 0.001) this.kill(w, el, outcome);
  }

  kill(w, el, outcome) {
    w.dying = 0.001;
    this.audio.play('wispDie');
    this.particles.burst(w.mesh.position, { count: 70, color: '#e6a8ff', speed: 8, size: 0.6, life: 1.2, gravity: -1 });
    this.state.stats.wisps++;
    const wasFrozen = w.frozen > 0 || outcome.tag === 'shatter' || outcome.tag === 'shock';
    // An imp killed raw bursts into a lava pool; frozen, it shatters clean.
    if (w.kind === 'imp' && !wasFrozen && el !== 'frost') this.addLavaPool(w.mesh.position.x, w.mesh.position.z);
    let essence = Math.random() < 0.5 ? 1 : 0;
    if (this.state.hasSpell('siphon')) {
      // Soul Siphon (Necromancy mastery): the banished spirit feeds your mana.
      essence = 2;
      this.state.mana = Math.min(this.state.maxMana, this.state.mana + (this.state.hasBoon('necromancy') ? 30 : 15));
      this.particles.burst(w.mesh.position, { count: 30, color: '#7dff9b', speed: 3, size: 0.4, life: 0.8, gravity: -2 });
    }
    const rank = RANK[w.rank];
    let reagent = rank.reagent;
    const pristine = rank.pristine && Math.random() < rank.pristine;
    if (pristine) reagent += 2;
    if (w.kind === 'imp' && wasFrozen && this.state.perk('imp')) reagent += 1;
    const b = this.state.beast(w.kind);
    b.kills++; b.ranks[w.rank] = true;
    this.onWispKilled?.(w, { reagent, essence, pristine, perkNow: b.kills === CREATURES[w.kind].perk.at });
  }

  update(dt, elapsed, player, night, paused) {
    this.night = night;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.updateBolts(dt);
    this.updatePools(dt, elapsed, player);
    // Creatures: more (and bolder) at night. None during pause/cutscenes.
    if (!paused) {
      const cap = this.arena.cap(night);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.wisps.filter((w) => !w.boss && !w.haunt).length < cap) {
        this.spawnWisp(player.pos);
        this.spawnTimer = this.arena.interval ?? 6 - night * 3;
      }
    }
    for (let i = this.wisps.length - 1; i >= 0; i--) this.updateCreature(this.wisps[i], i, dt, elapsed, player, night, paused);
  }

  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      // Homing: steer toward a locked target so aimed bolts reliably connect.
      if (b.target && !b.target.dying && b.homing) {
        const want = this.aimPoint(b.target).sub(b.mesh.position).normalize().multiplyScalar(b.speed);
        b.vel.lerp(want, 1 - Math.exp(-dt * b.homing));
      }
      if (b.arc) { b.vel.y -= 20 * dt; b.mesh.rotation.x += dt * 8; b.mesh.rotation.z += dt * 5; }
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;
      const col = this.boltCol?.[b.el] || (this.boltCol ||= Object.fromEntries(Object.keys(BOLTS).map((k) => [k, new THREE.Color(EL[k].color)])))[b.el];
      this.particles.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, col, b.arc ? 0.4 : 0.55, 0.35, b.arc ? 3 : 0, 2);
      let hit = null;
      // A locked bolt only strikes its target (it passes through others); free bolts hit anything.
      const candidates = b.target && !b.target.dying ? [b.target] : this.wisps;
      for (const w of candidates) {
        if (!w.dying && this.aimPoint(w).distanceTo(p) < (w.creature.grounded ? 1.6 * w.scale : 1.0 * w.scale)) { hit = w; break; }
      }
      // A locked, homing bolt skims over humps of ground on its way in rather than dying in them.
      const gh = this.arena.height(p.x, p.z);
      if (b.target && !b.target.dying && b.homing && p.y < gh + 0.3) { p.y = gh + 0.3; b.vel.y = Math.max(b.vel.y, 0); }
      let ground = p.y < gh || p.y < this.surfaceAt(p.x, p.z); // the valley's water counts as a surface
      if (!ground && this.pillars.length) ground = this.pillars.some((pl) => Math.hypot(p.x - pl.x, p.z - pl.z) < 1.2 && p.y < pl.top);
      if (hit) this.hitWisp(hit, b.dmg || 1, b.el, p.clone().sub(b.vel.clone().setLength(1)));
      if (b.fire && (hit || ground || b.life <= 0)) this.explode(p, b.radius, b.dmg);
      if (hit || ground || b.life <= 0) {
        this.impact(b, p, !!hit || ground);
        this.scene.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }
  }

  // Where a bolt lands: Radiance pools, Earth's splash and smothering.
  impact(b, p, landed) {
    this.particles.burst(p, { count: 24, color: EL[b.el].color, speed: 5, size: 0.4, life: 0.5 });
    if (landed) this.audio.play('impact');
    if (!landed) return;
    this.onImpact?.(b.el, p);
    this.onLand?.(b.el, p);
    const gp = { x: p.x, z: p.z };
    if (b.el === 'radiance') this.addPool(gp);
    if (b.el === 'earth') {
      this.particles.ring(new THREE.Vector3(p.x, this.arena.height(p.x, p.z) + 0.2, p.z), { count: 40, color: '#b89a74', speed: 7, size: 0.6, life: 0.6 });
      this.smother(p.x, p.z, 3);
      // Bedrock (Geomancy sanctum boon): the stone knocks down everything around it.
      const r = this.state.hasBoon('geomancy') ? 4.5 : 0;
      if (r) for (const w of this.wisps) if (!w.dying && w.mesh.position.distanceTo(p) < r) { w.stagger = Math.max(w.stagger, 1.2); w.vel.add(w.mesh.position.clone().sub(p).setY(0).setLength(6)); }
    }
  }

  updatePools(dt, elapsed, player) {
    for (const p of [...this.pools]) {
      p.t -= dt;
      p.mesh.material.opacity = 0.35 + 0.12 * Math.sin(elapsed * 5);
      p.mesh.scale.setScalar(p.r * Math.min(1, (p.life - p.t) * 5) * (p.t < 0.6 ? p.t / 0.6 : 1));
      if (Math.random() < dt * 20) this.particles.spawn(p.x + (Math.random() - 0.5) * p.r * 1.6, p.mesh.position.y + 0.1, p.z + (Math.random() - 0.5) * p.r * 1.6, 0, 1.2, 0, this.poolCol ||= new THREE.Color('#fff2b0'), 0.25, 0.9, 0, 0.2);
      if (p.light) p.light.intensity = 12 * Math.min(1, p.t / 0.6);
      if (p.t <= 0) { this.scene.remove(p.mesh); this.freeLight(p); this.pools.splice(this.pools.indexOf(p), 1); }
    }
    for (const p of [...this.lavaPools]) {
      p.t -= dt;
      if (p.t < 1) p.mesh.scale.setScalar(p.r * Math.max(0.01, p.t));
      if (Math.random() < dt * 6) this.particles.spawn(p.x + (Math.random() - 0.5) * 3, p.mesh.position.y + 0.1, p.z + (Math.random() - 0.5) * 3, 0, 2, 0, this.emberCol ||= new THREE.Color('#ff8a3c'), 0.4, 0.7, 0, 1);
      if (p.t <= 0) { this.scene.remove(p.mesh); this.lavaPools.splice(this.lavaPools.indexOf(p), 1); }
    }
    for (const p of [...this.pillars]) {
      p.t -= dt;
      p.rise = Math.min(1, p.rise + dt * 3);
      const e = 1 - Math.pow(1 - p.rise, 3);
      p.mesh.scale.y = Math.max(0.01, p.h * e);
      p.mesh.position.y = p.ground - 1.5 + p.h * e / 2;
      p.mesh.children[0].position.y = 0.5 - 0.06 / p.h;
      if (p.t < 2) p.mesh.rotation.z = Math.sin(elapsed * 30) * 0.015 * (2 - p.t);
      if (p.t <= 0) this.removePillar(p);
    }
  }

  updateCreature(w, i, dt, elapsed, player, night, paused) {
    const m = w.mesh, def = CREATURES[w.kind];
    w.t += dt;
    if (w.dying) {
      w.dying += dt;
      m.scale.setScalar(Math.max(0.001, (1 - w.dying * 3) * w.scale));
      if (w.dying > 0.35) { this.scene.remove(m); this.wisps.splice(i, 1); }
      return;
    }
    if (w.spawn < 1) { w.spawn = Math.min(1, w.spawn + dt); m.scale.setScalar(w.spawn * w.scale); }
    for (const k of ['frozen', 'dazzled', 'solid', 'stagger', 'stun']) if (w[k] > 0) w[k] = Math.max(0, w[k] - dt);
    if (w.frozenShell?.visible && w.frozen <= 0) this.freezeShell(w, false);
    // Armour regrowth (Elder golems and wraiths).
    if (!w.armour && w.armourT > 0) { w.armourT -= dt; if (w.armourT <= 0) { this.setArmour(w, true); this.onText?.(m.position, w.kind === 'golem' ? 'Plates regrown' : 'Refrozen', '#9aa4b8'); } }
    // Spirits: solid while standing in light.
    if (def.intangible) {
      if (this.lightAt(m.position.x, m.position.z)) w.solid = Math.max(w.solid, 0.3);
      const solid = w.solid > 0;
      if (w.creature.setSolid) w.creature.setSolid(solid);
      else m.traverse((o) => { if (o.material?.transparent !== undefined && o.userData.baseOp === undefined && o.material) o.userData.baseOp = o.material.opacity; if (o.material && o.userData.baseOp !== undefined) o.material.opacity = solid ? Math.min(1, o.userData.baseOp + 0.35) : o.userData.baseOp; });
      // Grave Warden (Elder spirit): leaves the light hurt → splits in two.
      if (w.wasSolid && !solid && w.rank === 'elder' && !w.split && w.hp < w.maxHp) {
        w.split = true;
        for (let k = 0; k < 2; k++) {
          const c = this.spawnCreature(w.kind, m.position.x + (k ? 1.5 : -1.5), m.position.z, { rank: 'common', split: true, haunt: w.haunt });
          c.hp = c.maxHp = Math.max(1, Math.ceil(w.hp / 2));
        }
        this.onText?.(m.position, 'It splits!', '#8dffb0', true);
        w.dying = 0.001; w.noReward = true;
        return;
      }
      w.wasSolid = solid;
    }
    const aim = this.aimPoint(w);
    const toP = player.pos.clone().add(TMP.set(0, 1.3, 0)).sub(aim);
    const d = toP.length();
    // Despawn far-away ordinary creatures and dawn-burnt wisps (bosses and haunt foes stay).
    if (!w.boss && !w.haunt && (d > 110 || (this.arena === this.valleyArena && night < 0.2 && this.wisps.length > 2 && Math.random() < dt * 0.05))) { w.dying = 0.001; w.noReward = true; return; }
    const held = w.frozen > 0 || w.stun > 0;
    const chase = d < 20 + night * 10 + (w.haunt || w.boss ? 14 : 0) && !this.arena.safe(player.pos) && !held;
    w.chasing = chase && !paused;
    const desired = new THREE.Vector3();
    const speed = (w.creature.grounded ? 2.2 : 3.2 + night * 1.6) * (w.boss?.speed || 1);
    if (held) desired.set(0, 0, 0);
    else if (w.kind === 'imp' && w.rank !== 'common' && w.hp < w.maxHp / 2 && this.arena.lavaNear) {
      // Forge Imp: flee to the nearest lava and heal there.
      const lv = this.arena.lavaNear(m.position.x, m.position.z);
      if (lv) {
        desired.set(lv.x - m.position.x, 0, lv.z - m.position.z);
        if (desired.length() < 1.5) { desired.set(0, 0, 0); w.healT = (w.healT || 0) + dt; if (w.healT > 1.5) { w.healT = 0; w.hp = Math.min(w.maxHp, w.hp + 1); this.onText?.(m.position, '+1', '#ff8a3c'); } }
        else desired.setLength(speed * 1.3);
      }
    } else if (w.static) desired.set(0, 0, 0);
    else if (w.goalFn && d > 6 && (w.goal = w.goalFn())) desired.set(w.goal.x - m.position.x, 0, w.goal.z - m.position.z).setLength(speed * 0.8);
    else if (chase && !paused) desired.copy(toP).setY(0).normalize().multiplyScalar(speed);
    else desired.set(Math.sin(w.t * 0.4 + i) * 2, 0, Math.cos(w.t * 0.33 + i * 2) * 2);
    if (w.stagger > 0) desired.multiplyScalar(0.1);
    else if (w.chill > 0) desired.multiplyScalar(1 - w.chill * 0.2);
    // Winter's Crown (Cryomancy sanctum boon): foes near you are slowed by half.
    if (d < 9 && this.state.hasBoon('cryomancy')) {
      desired.multiplyScalar(0.5);
      if (Math.random() < dt * 4) this.particles.spawn(m.position.x, m.position.y + 1, m.position.z, 0, -0.5, 0, this.chillCol ||= new THREE.Color('#dff6ff'), 0.3, 0.8, 0, 0.3);
    }
    w.vel.lerp(desired, 1 - Math.exp(-dt * (held ? 8 : 2)));
    m.position.addScaledVector(w.vel, dt);
    // Earthen Stair pillars are walls to anything that isn't flying over them.
    for (const p of this.pillars) {
      const dx = m.position.x - p.x, dz = m.position.z - p.z, dd = Math.hypot(dx, dz);
      if (dd < 1.8 && dd > 0.001) { m.position.x = p.x + dx / dd * 1.8; m.position.z = p.z + dz / dd * 1.8; }
    }
    const ground = this.arena.height(m.position.x, m.position.z);
    const gy = w.creature.grounded ? ground : ground + w.hover + (held ? 0 : Math.sin(w.t * 2.3) * 0.4);
    m.position.y += (gy - m.position.y) * Math.min(1, dt * (w.creature.grounded ? 12 : 3));
    if (!held) m.lookAt(player.pos.x, m.position.y, player.pos.z);
    w.slam = Math.max(0, (w.slam || 0) - dt * 2);
    if (!held) w.creature.tick(dt, w.t, w);
    // Hit flash plus a quick recoil squash.
    if (w.flash > 0) { w.flash -= dt; setFlash(w.creature, true); }
    else setFlash(w.creature, false);
    if (w.spawn >= 1) { const f = Math.max(0, w.flash || 0); m.scale.set((1 + f * 1.2) * w.scale, (1 - f * 0.8) * w.scale, (1 + f * 1.2) * w.scale); }
    m.traverse((o) => { if (o.userData.crown) o.rotation.y += dt * 0.8; });
    // Visibility rules: Hollow Wisps hide away from crystals; wraiths hide in blizzards.
    let vis = true;
    if (w.kind === 'shade' && w.rank === 'elder') vis = d < 6 || !!this.arena.nearCrystal?.(m.position.x, m.position.z) || Math.hypot(m.position.x, m.position.z) < 45;
    if (w.kind === 'wraith' && this.arena.blizzard?.() && !this.state.hasKey('sight')) vis = d < 14;
    if (w.dark) vis = d < 5 || this.lightAt(m.position.x, m.position.z);
    if (w.hidden) vis = false;
    m.visible = vis;
    // Trail: specter mist, imp embers, wraith frost, shadow smoke, golem grit — shed from the body.
    if (vis && Math.random() < dt * (w.creature.grounded ? 6 : 18)) {
      const c = (this.trailCols ||= {})[w.kind] ||= new THREE.Color(w.creature.trail || this.theme.particle);
      const y = w.creature.grounded ? m.position.y + 0.3 : m.position.y - 0.6 - Math.random() * 0.6;
      this.particles.spawn(m.position.x + (Math.random() - 0.5) * 0.6, y, m.position.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, c, 0.45, 1.0, w.creature.grounded ? 2 : -0.3, 1);
    }
    w.hitCd = Math.max(0, w.hitCd - dt);
    const reach = w.creature.grounded ? 2.6 * w.scale : 1.4 * w.scale;
    if (w.creature.grounded && d < reach + 1.2 && !held && w.stagger <= 0) w.slam = Math.min(1, w.slam + dt * 5);
    const canHit = !paused && d < reach && w.hitCd <= 0 && !held && w.stagger <= 0 && !w.static && !w.hidden && !(player.grace > 0);
    if (canHit && this.state.hasBuff('ward')) {
      // Wisp Ward: the creature rebounds off a shimmering shield instead of draining mana.
      w.hitCd = 1.2;
      w.vel.copy(toP).setY(0).normalize().multiplyScalar(-8);
      this.particles.burst(player.pos.clone().setY(player.pos.y + 1.2), { count: 30, color: '#c58bff', speed: 5, size: 0.4, life: 0.6 });
    } else if (canHit) {
      w.hitCd = w.creature.grounded ? 2.2 : 1.5;
      // Dusk Ward (wisp perk): studied wisps no longer drain you.
      const base = w.kind === 'shade' && this.state.perk('shade') ? 0 : w.creature.grounded ? 24 : 18;
      const drained = Math.min(this.state.mana, base * (w.rank === 'common' ? 1 : w.rank === 'elder' ? 1.3 : 1.6) * (w.boss?.drain || 1));
      this.state.mana -= drained;
      const kb = toP.clone().setY(0).normalize().multiplyScalar(w.creature.grounded ? 14 : 9);
      player.vel.x += kb.x; player.vel.z += kb.z; player.vel.y = w.creature.grounded ? 6 : 4;
      player.shake = w.creature.grounded ? 0.6 : 0.35;
      if (w.creature.grounded) this.particles.ring(new THREE.Vector3(m.position.x, ground + 0.2, m.position.z), { count: 50, color: '#b89a74', speed: 9, size: 0.7, life: 0.6 });
      this.audio.play('drain');
      this.particles.burst(player.pos.clone().setY(player.pos.y + 1.2), { count: 25, color: WISP_COLOR, speed: 4, size: 0.4, life: 0.7 });
      this.onPlayerHit?.(drained, w);
    }
  }
}
