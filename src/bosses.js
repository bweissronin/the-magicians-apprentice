import * as THREE from 'three';
import { EL, ELEMENTS, CREATURES } from './bestiary.js';
import { GUARDIANS } from './story.js';
import { SANCTUMS } from './data.js';

// Guardian fights and the Convergence. Each realm's old ruler squats in the ruin of Aldric's
// tower; its crown stage can't be raised until they are driven out. Every guardian has three
// phases, each asking for a different piece of what the apprentice has learned:
//   Lich King      phylacteries (Radiance) → splits into spirits (light) → bone armour (Earth/Fire, then Arcane)
//   Mountain King  plates (Radiance dazzle, Earth crack) → burrows (jump or stand on a pillar) → core (Frost then Fire)
//   Winter Queen   ice armour (Fire/Earth; Frost heals her) → blizzard (light braziers with Fire) → mirror clones (the real one casts a shadow)
//   Molten Tyrant  lava plates (freeze, then shatter) → heals in lava (smother it with Earth) → bursts into imps (Frost, then Arcane)
// The Unraveller cycles one open ward at a time, borrows the guardians' shields, and finally
// hides behind five ward orbs that must break in the order the Echo Stones foretold.

const $ = (id) => document.getElementById(id);
const ARENA = { x: 0, z: 4 }; // realm-space: between the cornerstone and the portal
export const FINAL_ORDER = ['radiance', 'earth', 'frost', 'fire', 'arcane'];

const DEF = {
  lich: { kind: 'specter', model: 'lich', hpMul: 2.2, scale: 1.25, speed: 0.8, phases: ['The phylacteries shield him — break them with Radiance.', 'He splits into restless spirits! Give them light.', 'Bone armour! Crack it with Earth or Fire, then strike.'] },
  king: { kind: 'golem', model: 'golem', hpMul: 2.4, scale: 2.0, speed: 0.8, phases: ['Plated in heartstone. Dazzle his eyes with Radiance, crack the plates with Earth.', 'He burrows! Shockwaves roll out — jump them, or stand on an Earthen Stair.', 'His core is bare. Frost, then Fire: thermal shock.'] },
  queen: { kind: 'wraith', model: 'queen', hpMul: 2.2, scale: 1.2, speed: 0.9, phases: ['Ice armour. Fire melts it and Earth shatters it — and Frost heals her.', 'A blizzard hides her. Light the watch-fires with Fire to see her.', 'Mirror clones! Only the real Winter Queen casts a shadow.'] },
  tyrant: { kind: 'imp', model: 'tyrant', hpMul: 2.4, scale: 1.3, speed: 0.7, phases: ['Lava plates. Freeze them solid, then shatter them.', 'He heals in the lava! Smother the pools with Earth.', 'He bursts into imps — Frost, then Arcane.'] },
};

export class BossFight {
  // id: a guardian id, or 'unraveller'.
  constructor(game, id) {
    this.game = game; this.id = id; this.phase = 0; this.t = 0; this.adds = []; this.objects = []; this.done = false;
    const g = game, m = g.magic;
    this.final = id === 'unraveller';
    const def = this.def = this.final ? { kind: 'orb', model: 'unraveller', hpMul: 1, scale: 1.3, speed: 0.5 } : DEF[id];
    const c = this.final ? { x: 0, z: 0 } : ARENA;
    const w = this.boss = m.spawnCreature(def.kind, c.x, c.z - 6, {
      rank: 'dread', model: def.model, name: this.final ? 'Veyra, the Unraveller' : GUARDIANS[id].name, scale: def.scale, hpMul: def.hpMul,
      boss: { speed: def.speed, drain: 1.3, preHit: (w, el, o) => this.preHit(w, el, o), minHp: () => this.minHp() },
    });
    if (this.final) { w.hp = w.maxHp = 40; w.orbEl = 'arcane'; w.hover = 2.5; }
    if (id === 'king') { const crown = m.wardCrown('golem', 'dread', w.creature); w.mesh.add(crown); }
    w.spawn = 0.2;
    this.enterPhase(1);
    $('bossbar').classList.remove('hidden');
    g.audio.play('ascend');
    g.player.shake = 0.8;
  }

  get name() { return this.boss.name; }
  minHp() {
    const M = this.boss.maxHp;
    if (this.final) return this.phase === 1 ? M * 0.65 : this.phase === 2 ? M * 0.32 : 1;
    if (this.phase === 1) return M * 0.59;
    if (this.phase === 2) return M * (this.id === 'tyrant' ? 0.24 : 0.29);
    return this.id === 'tyrant' ? 1 : 0;
  }
  alive(list) { return list.filter((a) => !a.dying && this.game.magic.wisps.includes(a)); }
  spawnAdd(kind, x, z, opts = {}) { const a = this.game.magic.spawnCreature(kind, x, z, { rank: 'elder', boss: null, haunt: 'boss', ...opts }); a.spawn = 0.3; this.adds.push(a); return a; }
  ring(n, r, fn) { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; fn(this.boss.mesh.position.x + Math.cos(a) * r, this.boss.mesh.position.z + Math.sin(a) * r, i); } }
  say(text, sub = '') { this.game.ui.banner(this.name, sub || `Phase ${this.phase}`, text, 5000); }

  enterPhase(n) {
    this.phase = n; this.pt = 0;
    const g = this.game, w = this.boss, id = this.id;
    if (this.final) return this.finalPhase(n);
    this.say(this.def.phases[n - 1]);
    if (id === 'lich') {
      if (n === 1) { this.phyl = []; this.ring(3, 7, (x, z) => { const p = this.spawnAdd('phylactery', x, z, { rank: 'common' }); p.static = true; p.support = true; this.phyl.push(p); }); }
      if (n === 2) { w.hidden = true; w.mesh.visible = false; this.spirits = []; this.ring(3, 6, (x, z) => this.spirits.push(this.spawnAdd('specter', x, z))); }
      if (n === 3) { w.hidden = false; w.mesh.visible = true; g.magic.setArmour(w, true); w.armourRegrow = 8; }
    }
    if (id === 'king') {
      if (n === 2) { w.hidden = true; this.burrowT = 7; this.waveT = 0.5; this.waves = []; }
      if (n === 3) { w.hidden = false; w.mesh.visible = true; g.magic.setArmour(w, false); }
    }
    if (id === 'queen') {
      if (n === 2) {
        w.dark = true;
        this.fires = [];
        this.ring(4, 11, (x, z) => {
          const grp = new THREE.Group();
          grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.2, 8), new THREE.MeshStandardMaterial({ color: '#5a6478', roughness: 0.8 })));
          grp.children[0].position.y = 0.6;
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff6a1c', emissiveIntensity: 3 })); f.position.y = 1.5; f.visible = false; grp.add(f);
          const l = new THREE.PointLight('#ff9a3c', 0, 18, 1.5); l.position.y = 2; grp.add(l);
          grp.position.set(x, g.realm.heightAt(x, z), z); g.realm.scene.add(grp); this.objects.push(grp);
          this.fires.push({ x, z, lit: false, f, l, r: 9 });
        });
        g.magic.onImpact = (el, p) => { if (el !== 'fire') return; for (const b of this.fires) if (!b.lit && Math.hypot(p.x - b.x, p.z - b.z) < 3.5) { b.lit = true; b.f.visible = true; b.l.intensity = 20; g.ui.floatText(new THREE.Vector3(b.x, g.realm.heightAt(b.x, b.z) + 2, b.z), 'Lit!', '#ffb347', true); } };
      }
      if (n === 3) {
        w.dark = false;
        this.clones = [];
        this.ring(3, 8, (x, z) => { const c = this.spawnAdd('wraith', x, z, { rank: 'dread', model: 'queen', scale: this.def.scale, name: this.name }); c.clone = true; c.hp = c.maxHp = 1; c.mesh.traverse((o) => { o.castShadow = false; }); this.clones.push(c); });
        w.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      }
    }
    if (id === 'tyrant') {
      if (n === 1) g.magic.setArmour(w, true);
      if (n === 2) { g.magic.setArmour(w, false); this.ring(3, 8, (x, z) => g.magic.addLavaPool(x, z)); g.magic.lavaPools.forEach((p) => { p.t = 1e9; }); w.goalFn = () => g.magic.lavaPools[0] || null; }
      if (n === 3) {
        w.goalFn = null; w.hidden = true; w.mesh.visible = false;
        this.imps = [];
        this.ring(5, 4, (x, z) => this.imps.push(this.spawnAdd('imp', x, z)));
        g.realm.fx.burst(w.mesh.position.clone().setY(w.mesh.position.y + 2), { count: 200, color: '#ff8a3c', speed: 14, size: 1, life: 1.4, gravity: 6 });
      }
    }
  }

  // Phase rules layered over the creature's own wards. Return {mult, tag} to override.
  preHit(w, el, o) {
    const id = this.id;
    if (w.hidden) return { mult: 0, tag: 'passes' };
    if (this.final) return this.finalHit(w, el);
    if (id === 'lich' && this.phase === 1 && this.alive(this.phyl).length) return { mult: 0, tag: 'resisted' };
    if (id === 'lich' && this.phase === 3 && w.armour) {
      if (el === 'earth' || el === 'fire') { this.game.magic.setArmour(w, false); w.armourT = 8; return { mult: 1, tag: 'weak' }; }
      return { mult: 0.25, tag: 'resisted' };
    }
    if (id === 'lich' && this.phase === 3) w.solid = 1; // his bones are solid enough
    if (id === 'king' && this.phase === 3) {
      if (o.tag === 'shock') return null;
      if (el === 'frost') return { mult: 0.25, tag: 'neutral' };
      return { mult: 0.25, tag: 'resisted' };
    }
    if (id === 'queen') {
      if (el === 'frost') return { mult: -1, tag: 'absorbed' };
      if (this.phase === 2 && !this.lightAt(w.mesh.position.x, w.mesh.position.z)) return { mult: 0, tag: 'passes' };
    }
    if (id === 'tyrant' && this.phase === 1 && w.armour) {
      if (w.frozen > 0 && (el === 'arcane' || el === 'earth')) { this.game.magic.setArmour(w, false); this.game.ui.floatText(w.mesh.position.clone(), 'Plates shattered!', '#bfefff', true); return { mult: 2, tag: 'shatter' }; }
      if (el === 'frost') return { mult: 0.25, tag: 'neutral' };
      return { mult: 0.25, tag: 'resisted' };
    }
    return null;
  }
  lightAt(x, z) { return !!this.fires?.some((b) => b.lit && Math.hypot(b.x - x, b.z - z) < b.r); }

  update(dt, t) {
    const g = this.game, w = this.boss, m = g.magic;
    if (this.done) return;
    this.t += dt; this.pt += dt;
    const frac = Math.max(0, w.hp / w.maxHp);
    $('bossbar-name').textContent = this.name;
    $('bossbar-fill').style.width = `${frac * 100}%`;
    $('bossbar-phase').textContent = this.final ? this.finalLabel() : `Phase ${this.phase} of 3 — ${this.def.phases[this.phase - 1]}`;
    if (!m.wisps.includes(w) && !w.dying) return this.fail();
    if (this.final) return this.finalUpdate(dt, t);
    const id = this.id;
    // Phase thresholds.
    if (this.phase === 1 && frac < 0.6 && !(id === 'lich' && this.alive(this.phyl).length)) this.enterPhase(2);
    else if (this.phase === 2 && frac < (id === 'tyrant' ? 0.25 : 0.3)) this.enterPhase(3);
    if (id === 'lich') {
      w.shielded = this.phase === 1 && this.alive(this.phyl).length > 0;
      if (this.phase === 2 && !this.alive(this.spirits).length && this.pt > 2) { w.hp = Math.min(w.hp, w.maxHp * 0.29); this.enterPhase(3); }
      if (this.phase === 3 && !w.armour && w.armourT <= 0) w.armourT = 8;
    }
    if (id === 'king' && this.phase === 2) {
      // Burrowed: shockwaves roll out from where he's hiding; the ground shakes.
      w.mesh.visible = false;
      this.burrowT -= dt; this.waveT -= dt;
      if (this.waveT <= 0) {
        this.waveT = 1.6;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.4, 48), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(w.mesh.position.x, g.realm.heightAt(w.mesh.position.x, w.mesh.position.z) + 0.2, w.mesh.position.z);
        g.realm.scene.add(ring); g.aoHidden.push(ring);
        this.waves.push({ ring, r: 1, hit: false });
        g.player.shake = Math.max(g.player.shake, 0.25);
      }
      for (const wv of [...this.waves]) {
        wv.r += dt * 9; wv.ring.scale.setScalar(wv.r); wv.ring.material.opacity = Math.max(0, 0.7 - wv.r / 40);
        const d = Math.hypot(g.player.pos.x - wv.ring.position.x, g.player.pos.z - wv.ring.position.z);
        const grounded = g.player.onGround && !(m.pillarAt(g.player.pos.x, g.player.pos.z, g.player.pos.y) > -Infinity);
        if (!wv.hit && Math.abs(d - wv.r * 1.1) < 0.8 && grounded) { wv.hit = true; g.state.mana = Math.max(0, g.state.mana - 16); g.player.vel.y = 6; g.player.shake = 0.6; g.ui.toast('The shockwave throws you! −16 mana', '#ffb347', 'Jump it, or stand on an Earthen Stair'); }
        if (wv.r > 40) { g.realm.scene.remove(wv.ring); this.waves.splice(this.waves.indexOf(wv), 1); }
      }
      if (this.burrowT <= 0) { w.hidden = false; w.mesh.visible = true; this.burrowT = 1e9; this.say('He surfaces — strike before he burrows again!', 'Phase 2'); g.realm.fx.burst(w.mesh.position.clone().setY(w.mesh.position.y + 1), { count: 160, color: '#b89a74', speed: 10, size: 1, life: 1.2, gravity: 8 }); }
    }
    if (id === 'queen' && this.phase === 3) {
      // The real queen slips between her clones every few seconds.
      this.swapT = (this.swapT || 6) - dt;
      const clones = this.alive(this.clones);
      if (this.swapT <= 0 && clones.length) { this.swapT = 6; const c = clones[Math.floor(Math.random() * clones.length)], p = w.mesh.position.clone(); w.mesh.position.copy(c.mesh.position); c.mesh.position.copy(p); }
    }
    if (id === 'tyrant' && this.phase === 2) {
      const pool = m.lavaPools.find((p) => Math.hypot(p.x - w.mesh.position.x, p.z - w.mesh.position.z) < p.r + 0.5);
      if (pool) { this.healT = (this.healT || 0) + dt; if (this.healT > 0.5) { this.healT = 0; w.hp = Math.min(w.maxHp * 0.6, w.hp + 1); g.ui.floatText(w.mesh.position.clone(), '+1', '#ff8a3c'); } }
    }
    if (id === 'tyrant' && this.phase === 3 && !this.alive(this.imps).length && this.pt > 1.5) { w.hidden = false; this.win(); }
  }

  onKill(w) {
    if (this.done) return;
    if (w.clone && this.id === 'queen') {
      const g = this.game; g.state.mana = Math.max(0, g.state.mana - 10);
      g.ui.floatText(w.mesh.position.clone(), 'A mirror! −10 mana', '#bfefff', true);
    }
    if (w === this.boss) {
      if (this.final && this.phase < 3) { w.dying = 0; w.hp = 1; return; }
      this.win();
    }
  }

  win() {
    if (this.done) return;
    this.done = true;
    const g = this.game, s = g.state;
    $('bossbar').classList.add('hidden');
    for (const a of this.adds) if (!a.dying) { a.dying = 0.001; a.noReward = true; }
    this.cleanup();
    if (!this.boss.dying) { this.boss.dying = 0.001; this.boss.noReward = true; }
    g.boss = null;
    if (this.final) return g.finale();
    s.guardians.push(this.id);
    s.addXP(900, `${this.name} defeated`);
    g.audio.play('ascend');
    const sanc = SANCTUMS[GUARDIANS[this.id].realm];
    g.ui.banner(`${this.name} Falls`, `${sanc.name} is yours again`, `Its crown stage — ${sanc.stages[4].name} — can now be raised.`, 7000);
    g.realm?.fx.burst(this.boss.mesh.position.clone().setY(this.boss.mesh.position.y + 2), { count: 300, color: GUARDIANS[this.id].color, speed: 16, size: 1, life: 2, gravity: 3 });
    g.save();
  }

  fail() {
    this.done = true;
    $('bossbar').classList.add('hidden');
    for (const a of this.adds) if (!a.dying) { a.dying = 0.001; a.noReward = true; }
    this.cleanup();
    this.game.boss = null;
    this.game.ui.toast(`${this.name} withdraws into the ruin`, '#ff7ad8', 'Challenge again at the cornerstone');
  }

  cleanup() {
    const g = this.game;
    const scene = this.final ? g.scene : g.realm?.scene;
    this.objects.forEach((o) => scene?.remove(o));
    this.waves?.forEach((wv) => scene?.remove(wv.ring));
    g.magic.onImpact = null;
    if (this.id === 'tyrant') g.magic.lavaPools.forEach((p) => { p.t = Math.min(p.t, 2); });
  }

  // ---------------------------------------------------------------- the Unraveller
  finalLabel() {
    if (this.phase === 1) return `Her sigil opens to one element at a time: now ${EL[this.boss.orbEl].name}`;
    if (this.phase === 2) return 'She borrows the guardians\' shields — break them';
    return `Break the ward orbs in the order the Echo Stones foretold: ${FINAL_ORDER.map((e, i) => (i < this.orbIndex ? '✓' : EL[e].glyph)).join(' ')}`;
  }
  finalPhase(n) {
    const g = this.game, w = this.boss;
    if (n === 1) { this.say('"Hold them all, apprentice. It is so easy, until it isn\'t." — Her sigil opens to one element at a time.', 'The Convergence'); this.cycleT = 0; }
    if (n === 2) {
      this.say('She borrows what the guardians knew: phylacteries and plated stone. Break them.', 'The Convergence');
      this.helpers = [];
      this.ring(2, 8, (x, z) => { const p = this.spawnAdd('phylactery', x, z, { rank: 'common' }); p.static = true; this.helpers.push(p); });
      this.ring(2, 10, (x, z) => { const k = this.spawnAdd('golem', x, z, { rank: 'elder' }); this.helpers.push(k); });
    }
    if (n === 3) {
      this.say('"Light, then stone, then frost, then flame — and last, the arcane." The Echo Stones told you the order.', 'All five wards');
      this.orbs = FINAL_ORDER.map((el, i) => {
        const o = this.spawnAdd('orb', 0, 0, { rank: 'common', name: `${EL[el].name} Ward` });
        o.orbEl = el; o.static = true; o.hp = o.maxHp = 2; o.creature.setColor?.(EL[el].color); o.hover = 2.5; o.orbIdx = i;
        return o;
      });
      this.orbIndex = 0;
    }
    void g; void w;
  }
  finalHit(w, el) {
    if (w.orbIdx !== undefined) {
      if (w.orbIdx !== this.orbIndex) { this.resetOrbs(); return { mult: 0, tag: 'resisted' }; }
      if (el !== w.orbEl) return { mult: 0, tag: 'resisted' };
      return null;
    }
    if (w === this.boss) {
      if (this.phase === 1) return el === w.orbEl ? { mult: 2, tag: 'weak' } : { mult: 0, tag: 'resisted' };
      if (this.phase === 2 && this.alive(this.helpers).length) return { mult: 0, tag: 'resisted' };
      if (this.phase === 3) return { mult: 0, tag: 'resisted' };
    }
    return null;
  }
  resetOrbs() {
    const g = this.game;
    g.state.mana = Math.max(0, g.state.mana - 15);
    g.ui.toast('Out of order — the wards knit back together! −15 mana', '#ff7ad8', 'Light, then stone, then frost, then flame, then arcane');
    for (const o of this.orbs) { if (o.dying) { o.dying = 0; o.mesh.scale.setScalar(1); if (!g.magic.wisps.includes(o)) { g.magic.wisps.push(o); g.scene.add(o.mesh); } } o.hp = o.maxHp; }
    this.orbIndex = 0;
  }
  finalUpdate(dt, t) {
    const g = this.game, w = this.boss, frac = w.hp / w.maxHp;
    w.mesh.position.y = g.finalY + 2.5 + Math.sin(t * 1.2) * 0.4;
    if (this.phase === 1) {
      this.cycleT -= dt;
      if (this.cycleT <= 0) {
        const known = ELEMENTS.filter((e) => g.state.knows(e.id)).map((e) => e.id);
        w.orbEl = known[(known.indexOf(w.orbEl) + 1) % known.length]; this.cycleT = 7;
        g.ui.floatText(w.mesh.position.clone(), `Open to ${EL[w.orbEl].name}`, EL[w.orbEl].color, true);
      }
      if (frac < 0.66) this.enterPhase(2);
    } else if (this.phase === 2) {
      w.shielded = false;
      if (!this.alive(this.helpers).length && this.pt > 1) this.enterPhase(3);
    } else if (this.phase === 3) {
      // Orbs circle her; each broken in order advances the count.
      this.orbs.forEach((o, i) => {
        if (o.dying) return;
        const a = t * 0.6 + (i / 5) * Math.PI * 2;
        o.mesh.position.x = w.mesh.position.x + Math.cos(a) * 6; o.mesh.position.z = w.mesh.position.z + Math.sin(a) * 6;
      });
      while (this.orbIndex < 5 && this.orbs[this.orbIndex].dying) this.orbIndex++;
      if (this.orbIndex >= 5) this.win();
    }
    // The fraying: magenta threads peel off her.
    if (Math.random() < dt * 30) g.particles.spawn(w.mesh.position.x + (Math.random() - 0.5) * 2, w.mesh.position.y + Math.random() * 3, w.mesh.position.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, this.fray ||= new THREE.Color('#ff4ad8'), 0.4, 1.6, -0.5, 0.5);
  }
}

// Which guardian bars a realm's crown stage, and whether it can be challenged now.
export function guardianFor(realmId) { return Object.keys(GUARDIANS).find((k) => GUARDIANS[k].realm === realmId); }
export function canChallenge(state, realmId) {
  const gid = guardianFor(realmId);
  return gid && !state.guardians.includes(gid) && state.sanctumStage(realmId) >= 4;
}
export { CREATURES };
