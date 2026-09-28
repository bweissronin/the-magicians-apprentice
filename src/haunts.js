import * as THREE from 'three';
import { SCHOOLS } from './data.js';
import { CREATURES, EL, ELEMENTS } from './bestiary.js';
import { prop } from './assets.js';

// Haunts: every realm landmark is haunted ground. Walking in wakes a short fight with one twist
// that uses the element rules, ending with a named Dread. Clearing it lights the place for good,
// doubles the harvest around it and unlocks its Echo Stone. The first haunt cleared in a realm
// completes that school's trial.
//
// Twists: lanterns (keep soul-lights lit with Radiance), braziers (keep them lit with Fire),
// alternate (waves switch between two creatures), totem (a ward totem shields every foe until
// struck with the element on its sockets), escort (lead lost miners' spirits to the lift),
// reflect (crystal golems throw Radiance back until their plates crack), slippery (the whole
// haunt is ice), darkness (foes are only visible in light), eruptions (vents blast the ground),
// tremor (the roof keeps falling), lava (imps' lava wells up everywhere).

export const HAUNTS = {
  'necromancy:chapel': { name: 'The Drowned Chapel', twist: 'lanterns', kind: 'specter', dread: 'The Widow of the Drowned Chapel',
    intro: 'Spirits rise from the black water to snuff the chapel lanterns. Keep them lit with Radiance, and fight in their light.' },
  'necromancy:bonefields': { name: 'The Bone Fields', twist: 'alternate', needs: 'earth', kind: 'specter', alt: 'bones', dread: 'The Bone Marshal', dreadKind: 'bones',
    intro: 'The fallen army rises in waves — spirits, then bone soldiers. Radiance for the one, Earth for the other.' },
  'necromancy:mausoleums': { name: 'The Weeping Mausoleums', twist: 'totem', kind: 'specter', dread: 'The Weeping Abbess',
    intro: 'A ward totem shields the mourners. Strike it with the element glowing in its sockets to break the ward.' },
  'necromancy:hill': { name: "Hangman's Hill", twist: 'darkness', kind: 'specter', dread: 'The Hangman',
    intro: 'The hill is dark as a hood. What hunts you here can only be seen in the light — make your own.' },
  'geomancy:mine': { name: 'The Flooded Mine', twist: 'escort', kind: 'golem', dread: 'Old Seam',
    intro: 'Three lost miners wait by the drowned shaft. Walk close and they will follow — lead each one to the lift while the golems wake.' },
  'geomancy:geode': { name: 'The Great Geode', twist: 'reflect', needs: 'earth', kind: 'golem', dread: 'The Geode Warden',
    intro: 'Crystal golems throw Radiance back at you. Crack their facets with Earth first; then the light reaches their core.' },
  'geomancy:cathedral': { name: 'The Fungal Cathedral', twist: 'darkness', kind: 'golem', dread: 'The Mossback',
    intro: 'The mushroom-light gutters out. Golems lumber through the dark — light the way with Radiance.' },
  'geomancy:colossus': { name: 'The Sleeping Colossus', twist: 'tremor', kind: 'golem', dread: "The Colossus's Hand",
    intro: 'The Colossus stirs in its sleep and the roof keeps falling. Watch the dust, keep moving — or raise a stair for cover.' },
  'cryomancy:armada': { name: 'The Frozen Armada', twist: 'slippery', kind: 'wraith', dread: "The Armada's Captain",
    intro: 'Wraith sailors climb from the ships. The bay is glass — you fight while sliding.' },
  'cryomancy:giant': { name: "The Giant's Rest", twist: 'totem', kind: 'wraith', dread: "The Giant's Shade",
    intro: 'The giant\'s ward totem shields his hunters. Break it with the element in its sockets.' },
  'cryomancy:stones': { name: 'The Aurora Stones', twist: 'braziers', needs: 'fire', kind: 'wraith', dread: 'The Keeper of the Long Night',
    intro: 'Wraiths smother the watch-fires among the stones. Keep them burning with Fire, or the night swallows you.' },
  'cryomancy:caves': { name: 'The Hollow Caves', twist: 'darkness', kind: 'wraith', dread: 'The Hollow Voice',
    intro: 'In the caves the wraiths are only seen by light. Throw it where you need it.' },
  'pyromancy:bridges': { name: 'The Salamander Bridges', twist: 'lava', kind: 'imp', dread: 'The Forge-Rat King',
    intro: 'Imps crack the ground and lava wells up around you. Smother it with Earth, freeze the imps before they burst.' },
  'pyromancy:vent': { name: 'The Great Vent', twist: 'eruptions', kind: 'imp', dread: 'The Ashen Bellows',
    intro: 'The vent erupts under your feet. Watch the glow on the ground and move before it blows.' },
  'pyromancy:forge': { name: 'The Sunken Forge', twist: 'totem', kind: 'imp', dread: 'The Master Smith',
    intro: 'The old forge-totem shields its imps. Strike it with the element in its sockets.' },
  'pyromancy:obsidian': { name: 'The Obsidian Forest', twist: 'darkness', kind: 'imp', dread: 'The Glass Widow',
    intro: 'Ash hangs so thick between the glass trees that only light shows what moves in it.' },
};
const WAVES = [[3, 0], [3, 1], [4, 2]]; // [count, of which Elders]

export class Haunts {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.lit = {}; // realm id → lights added for cleared haunts
  }

  cleared(key) { return this.game.state.haunts.includes(key); }
  replacesTrial() { return true; }
  // Inside uncleared haunted ground (for Elder spawns).
  hauntAt(realmId, x, z) {
    const r = this.game.realms.cache[realmId];
    if (!r) return null;
    const L = r.land.landmarks.find((l) => Math.hypot(l.x - x, l.z - z) < l.r + 10);
    return L && !this.cleared(`${realmId}:${L.id}`) ? `${realmId}:${L.id}` : null;
  }
  // Harvest nodes around a cleared haunt yield double.
  clearedNear(realmId, x, z) {
    const r = this.game.realms.cache[realmId];
    return !!r?.land.landmarks.some((L) => Math.hypot(L.x - x, L.z - z) < L.r + 22 && this.cleared(`${realmId}:${L.id}`));
  }
  // Light sources owned by the active haunt (lanterns, braziers).
  lightAt(x, z) {
    const h = this.active;
    return !!h?.lights?.some((l) => l.lit && Math.hypot(l.x - x, l.z - z) < l.r);
  }
  tractionAt(x, z) {
    const h = this.active;
    return h?.cfg.twist === 'slippery' && Math.hypot(h.L.x - x, h.L.z - z) < h.L.r + 6 ? 0.14 : null;
  }

  // Warm lanterns at every landmark whose haunt is cleared (built once per realm visit).
  lightCleared(realm) {
    const done = (this.lit[realm.id] ||= new Set());
    for (const L of realm.land.landmarks) {
      const key = `${realm.id}:${L.id}`;
      if (!this.cleared(key) || done.has(key)) continue;
      done.add(key);
      const l = new THREE.PointLight('#ffe0a0', 26, L.r * 2.4, 1.5);
      l.position.set(L.x, realm.heightAt(L.x, L.z) + 8, L.z); realm.scene.add(l);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 40, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beacon.position.set(L.x, realm.heightAt(L.x, L.z) + 20, L.z); realm.scene.add(beacon); this.game.aoHidden.push(beacon);
    }
  }

  update(dt, t) {
    const g = this.game, r = g.realm;
    if (!r || g.inside) { if (this.active && !r) this.abort(null); return; }
    this.lightCleared(r);
    const p = g.player.pos;
    if (!this.active) {
      if (g.mode !== 'play' || g.cinematic || g.boss) return;
      for (const L of r.land.landmarks) {
        const key = `${r.id}:${L.id}`;
        if (this.cleared(key) || !HAUNTS[key]) continue;
        if (Math.hypot(L.x - p.x, L.z - p.z) >= L.r * 0.8) continue;
        // Some haunts can't be won without an element learned later in the story: they wait.
        const need = HAUNTS[key].needs;
        if (need && !g.state.knows(need)) {
          if (!(this.warned ||= new Set()).has(key)) { this.warned.add(key); g.ui.toast(`${HAUNTS[key].name} is haunted — but it stays quiet`, '#ff7ad8', `Come back once you know ${EL[need].name}`); }
          continue;
        }
        this.start(r, L, key); break;
      }
      return;
    }
    const h = this.active;
    h.t += dt;
    if (Math.hypot(h.L.x - p.x, h.L.z - p.z) > h.L.r + 48) { this.abort('You fled the haunt. It will be waiting.'); return; }
    this.twistTick(h, dt, t);
    // Waves → Dread → done.
    const alive = g.magic.wisps.filter((w) => w.haunt === h.key && !w.dying);
    if (h.phase === 'waves') {
      const blocking = alive.filter((w) => !w.support);
      if (!blocking.length && h.t > h.nextAt && !h.waitEscort) {
        if (h.wave < WAVES.length) this.spawnWave(h);
        else { h.phase = 'dread'; this.spawnDread(h); }
      }
    } else if (h.phase === 'dread' && !alive.some((w) => w.rank === 'dread')) {
      this.clear(h);
    }
  }

  start(realm, L, key) {
    const g = this.game, cfg = HAUNTS[key];
    const h = this.active = { key, L, cfg, realm, wave: 0, phase: 'waves', t: 0, nextAt: 2.5, objects: [], lights: null };
    g.audio.play('drain');
    g.ui.banner(cfg.name, `Haunt · ${realm.def.glyph} ${realm.def.realm}`, cfg.intro, 6500);
    g.player.shake = 0.4;
    this.twistSetup(h);
    realm.fx.ring(new THREE.Vector3(L.x, realm.heightAt(L.x, L.z) + 0.5, L.z), { count: 200, color: '#b02a8a', speed: L.r * 0.9, size: 0.8, life: 1.6 });
  }

  spot(h, rMin = 0.35, rMax = 0.85) {
    const a = Math.random() * Math.PI * 2, rr = h.L.r * (rMin + Math.random() * (rMax - rMin));
    return { x: h.L.x + Math.cos(a) * rr, z: h.L.z + Math.sin(a) * rr };
  }
  spawn(h, kind, rank = 'common', extra = {}) {
    const p = this.spot(h);
    const w = this.game.magic.spawnCreature(kind, p.x, p.z, { rank, rise: true, haunt: h.key, ...extra });
    this.dress(h, w);
    return w;
  }
  // Twist-specific traits on every haunt creature.
  dress(h, w) {
    if (h.cfg.twist === 'reflect' && w.kind === 'golem') { w.crystal = true; const l = new THREE.PointLight('#b48cff', 6, 8, 2); l.position.y = 2.5; w.mesh.add(l); }
    if (h.cfg.twist === 'darkness') w.dark = true;
    if (h.cfg.twist === 'lanterns' || h.cfg.twist === 'braziers') w.goalFn = () => this.nearestLit(h, w);
    if (h.totem && !h.totem.dying) w.shielded = true;
  }
  spawnWave(h) {
    const [n, elders] = WAVES[h.wave];
    const kind = h.cfg.twist === 'alternate' && h.wave % 2 === 1 ? h.cfg.alt : h.cfg.kind;
    for (let i = 0; i < n; i++) this.spawn(h, kind, i < elders ? 'elder' : 'common');
    h.wave++;
    h.nextAt = h.t + 3;
    this.game.ui.toast(`${h.cfg.name}: wave ${h.wave} of ${WAVES.length}`, '#ff7ad8', h.wave === WAVES.length ? 'The Dread is coming' : '');
  }
  spawnDread(h) {
    const g = this.game, kind = h.cfg.dreadKind || h.cfg.kind, p = this.spot(h, 0.1, 0.3);
    const w = g.magic.spawnCreature(kind, p.x, p.z, { rank: 'dread', rise: true, haunt: h.key, name: h.cfg.dread });
    w.shiftWard = true; // halfway down, its ward shifts to whatever just hurt it
    this.dress(h, w);
    g.audio.play('ascend');
    g.ui.banner(h.cfg.dread, `Dread · ${CREATURES[kind].name}`, 'Halfway down, its ward shifts to match your attack — change elements, or combo.', 4500);
    g.state.beast(kind).ranks.dread = true;
  }

  clear(h) {
    const g = this.game, s = g.state, id = h.realm.id;
    s.haunts.push(h.key);
    this.twistCleanup(h);
    this.active = null;
    g.audio.play('ascend');
    g.player.shake = 0.6;
    g.ui.banner(`${h.cfg.name}`, `${h.realm.def.glyph} The haunt is lifted`, 'Its lanterns are lit for good, its harvest grows double, and its Echo Stone will speak to you now.', 6500);
    s.addXP(260, `${h.cfg.name} lifted`);
    // A Dread's trophy: a little of everything this realm's creature carries.
    const drop = CREATURES[h.cfg.kind].drop;
    if (drop) s.addItem(drop, 3);
    const p = s.school(id);
    if (!p.trial) {
      p.trial = true;
      setTimeout(() => g.ui.toast(`${h.realm.def.trial.name} — complete`, h.realm.def.color, 'The first haunt of a realm counts as its trial'), 2500);
      g.checkMastery(id);
    }
    this.lightCleared(h.realm);
    g.save();
  }

  abort(msg) {
    const g = this.game, h = this.active;
    if (!h) return;
    for (const w of g.magic.wisps) if (w.haunt === h.key && !w.dying) { w.dying = 0.001; w.noReward = true; }
    this.twistCleanup(h);
    this.active = null;
    if (msg) g.ui.toast(msg, '#ff7ad8');
  }

  onKill(w) {
    const h = this.active;
    if (!h || w.haunt !== h.key) return;
    if (h.totem === w) { h.totem = null; for (const x of this.game.magic.wisps) if (x.haunt === h.key) x.shielded = false; this.game.ui.banner('The ward breaks', h.cfg.name, 'Its creatures are open to your spells.', 3000); }
  }

  // ---------------------------------------------------------------- twists
  nearestLit(h, w) {
    let best = null, bd = Infinity;
    for (const l of h.lights || []) { if (!l.lit) continue; const d = Math.hypot(l.x - w.mesh.position.x, l.z - w.mesh.position.z); if (d < bd) { bd = d; best = l; } }
    return best;
  }

  twistSetup(h) {
    const g = this.game, r = h.realm, cfg = h.cfg, scene = r.scene;
    if (cfg.twist === 'lanterns' || cfg.twist === 'braziers') {
      const fire = cfg.twist === 'braziers';
      h.lights = [0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.5, x = h.L.x + Math.cos(a) * h.L.r * 0.45, z = h.L.z + Math.sin(a) * h.L.r * 0.45, y = r.heightAt(x, z);
        const grp = new THREE.Group();
        const model = !fire && prop('soul_lantern');
        if (model) grp.add(model);
        else {
          grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8), new THREE.MeshStandardMaterial({ color: '#2b2833', roughness: 0.5 })));
          grp.children[0].position.y = 1.1;
        }
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), new THREE.MeshStandardMaterial({ color: fire ? '#ffb347' : '#b8ffcc', emissive: fire ? '#ff6a1c' : '#5dff8a', emissiveIntensity: 3 }));
        flame.position.y = fire ? 2.4 : 2.1; grp.add(flame);
        const light = new THREE.PointLight(fire ? '#ff9a3c' : '#9dffb8', 18, 14, 1.6); light.position.y = 2.4; grp.add(light);
        grp.position.set(x, y, z); scene.add(grp); h.objects.push(grp);
        return { x, z, r: 6.5, lit: true, snuff: 0, flame, light, fire };
      });
      g.magic.onImpact = (el, p) => {
        for (const l of h.lights) if (!l.lit && el === (l.fire ? 'fire' : 'radiance') && Math.hypot(p.x - l.x, p.z - l.z) < 3.5) {
          l.lit = true; l.snuff = 0; g.ui.floatText(new THREE.Vector3(l.x, r.heightAt(l.x, l.z) + 2.5, l.z), 'Relit!', l.fire ? '#ffb347' : '#b8ffcc', true);
        }
      };
    }
    if (cfg.twist === 'totem') {
      const known = ELEMENTS.filter((e) => g.state.knows(e.id)).map((e) => e.id);
      const w = g.magic.spawnCreature('orb', h.L.x, h.L.z, { haunt: h.key, name: 'Ward Totem', model: 'totem' });
      w.orbEl = known[Math.floor(Math.random() * known.length)]; w.cycle = known; w.support = true; w.hp = w.maxHp = 4; w.static = true;
      w.creature.setColor?.(EL[w.orbEl].color);
      h.totem = w;
    }
    if (cfg.twist === 'escort') {
      h.waitEscort = true;
      h.miners = [0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 1, x = h.L.x + Math.cos(a) * (h.L.r + 6), z = h.L.z + Math.sin(a) * (h.L.r + 6);
        const grp = new THREE.Group(), model = prop('miner_spirit');
        if (model) { model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.62; o.material.emissive?.set?.('#5fd8b0'); o.material.emissiveIntensity = 0.5; } }); grp.add(model); }
        else { const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1, 4, 10), new THREE.MeshStandardMaterial({ color: '#b8ffe8', emissive: '#5fd8b0', emissiveIntensity: 0.8, transparent: true, opacity: 0.6 })); m.position.y = 1; grp.add(m); }
        const lamp = new THREE.PointLight('#ffc46a', 6, 8, 2); lamp.position.y = 1.9; grp.add(lamp);
        grp.position.set(x, r.heightAt(x, z) + 0.3, z); scene.add(grp); h.objects.push(grp);
        return { grp, following: false, saved: false, x, z };
      });
      h.lift = { x: h.L.x, z: h.L.z };
      h.golemT = 2;
    }
    if (cfg.twist === 'tremor' && r.theme) r.theme.tremorBoost = 3;
    if (cfg.twist === 'eruptions' || cfg.twist === 'lava') h.hazardT = 3;
  }

  twistTick(h, dt, t) {
    const g = this.game, r = h.realm, p = g.player.pos, cfg = h.cfg;
    if (h.lights) {
      for (const l of h.lights) {
        const near = g.magic.wisps.some((w) => w.haunt === h.key && !w.dying && w.frozen <= 0 && Math.hypot(w.mesh.position.x - l.x, w.mesh.position.z - l.z) < 2);
        if (l.lit && near) { l.snuff += dt; if (l.snuff > 2) { l.lit = false; g.ui.toast(l.fire ? 'A watch-fire is smothered!' : 'A lantern is snuffed!', '#ff7ad8', `Relight it with ${l.fire ? 'Fire' : 'Radiance'}`); } }
        else if (l.lit) l.snuff = Math.max(0, l.snuff - dt);
        l.flame.visible = l.lit; l.light.intensity = l.lit ? 16 + Math.sin(t * 8 + l.x) * 3 : 0;
      }
      if (h.lights.every((l) => !l.lit) && h.t > 4) { this.abort(cfg.twist === 'braziers' ? 'The last fire dies. The night takes the stones — try again.' : 'The last lantern dies. The chapel sinks into the dark — try again.'); return; }
    }
    if (h.totem && !h.totem.dying) {
      h.totemT = (h.totemT || 0) + dt;
      if (h.totemT > 6) { h.totemT = 0; const k = h.totem.cycle; h.totem.orbEl = k[(k.indexOf(h.totem.orbEl) + 1) % k.length]; h.totem.creature.setColor?.(EL[h.totem.orbEl].color); }
    }
    if (h.miners) {
      for (const m of h.miners) {
        if (m.saved) continue;
        const gp = m.grp.position;
        if (!m.following && Math.hypot(p.x - gp.x, p.z - gp.z) < 3.5) { m.following = true; g.ui.toast('A lost miner follows you', '#b8ffe8', 'Lead them to the lift'); }
        if (m.following) {
          const i = h.miners.indexOf(m), tx = p.x - Math.sin(g.player.facing) * (2 + i * 1.3), tz = p.z - Math.cos(g.player.facing) * (2 + i * 1.3);
          gp.x += (tx - gp.x) * Math.min(1, dt * 2); gp.z += (tz - gp.z) * Math.min(1, dt * 2);
          gp.y = r.heightAt(gp.x, gp.z) + 0.3 + Math.sin(t * 2 + i) * 0.15;
          if (Math.hypot(gp.x - h.lift.x, gp.z - h.lift.z) < 5) {
            m.saved = true; m.grp.visible = false;
            r.fx.burst(gp.clone().setY(gp.y + 1), { count: 90, color: '#b8ffe8', speed: 5, size: 0.6, life: 1.6, gravity: -3 });
            const n = h.miners.filter((x) => x.saved).length;
            g.ui.toast(`Miner ${n} of 3 rides the lift home`, '#b8ffe8');
          }
        }
      }
      // Golems keep waking until every miner is safe.
      h.golemT -= dt;
      const golems = g.magic.wisps.filter((w) => w.haunt === h.key && !w.dying).length;
      if (h.golemT <= 0 && golems < 3) { h.golemT = 9; this.spawn(h, 'golem', Math.random() < 0.3 ? 'elder' : 'common'); }
      if (h.miners.every((m) => m.saved) && h.waitEscort) { h.waitEscort = false; h.wave = WAVES.length; h.nextAt = h.t + 1; }
    }
    if (cfg.twist === 'eruptions' || cfg.twist === 'lava') {
      h.hazardT -= dt;
      if (cfg.twist === 'lava' && h.hazardT <= 0) {
        h.hazardT = 3.5;
        const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 6;
        g.magic.addLavaPool(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr);
      }
      if (cfg.twist === 'eruptions') {
        if (h.hazardT <= 0 && !h.vent) {
          const v = { x: p.x + (Math.random() - 0.5) * 3, z: p.z + (Math.random() - 0.5) * 3, t: 1.8 };
          v.mesh = new THREE.Mesh(new THREE.CircleGeometry(3.2, 32), new THREE.MeshBasicMaterial({ color: '#ff6a1c', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
          v.mesh.rotation.x = -Math.PI / 2; v.mesh.position.set(v.x, r.heightAt(v.x, v.z) + 0.1, v.z); r.scene.add(v.mesh); g.aoHidden.push(v.mesh);
          h.vent = v;
        }
        if (h.vent) {
          const v = h.vent; v.t -= dt; v.mesh.material.opacity = 0.25 + 0.3 * Math.abs(Math.sin(t * 12));
          if (v.t <= 0) {
            r.fx.burst(new THREE.Vector3(v.x, r.heightAt(v.x, v.z) + 1, v.z), { count: 160, color: '#ff8a3c', speed: 14, size: 0.9, life: 1.2, gravity: 6, up: 8 });
            const d = Math.hypot(p.x - v.x, p.z - v.z);
            if (d < 3.2 && g.player.onGround) { g.state.mana = Math.max(0, g.state.mana - 22); g.player.vel.y = 9; g.player.shake = 0.7; g.ui.toast('The vent erupts! −22 mana', '#ff8a3c'); }
            for (const w of [...g.magic.wisps]) if (w.haunt === h.key && Math.hypot(w.mesh.position.x - v.x, w.mesh.position.z - v.z) < 3.2) g.magic.hitWisp(w, 1, 'fire');
            r.scene.remove(v.mesh); h.vent = null; h.hazardT = 4 + Math.random() * 2;
          }
        }
      }
    }
  }

  twistCleanup(h) {
    const g = this.game, r = h.realm;
    h.objects.forEach((o) => r.scene.remove(o));
    if (h.vent) r.scene.remove(h.vent.mesh);
    if (r.theme) r.theme.tremorBoost = 1;
    g.magic.onImpact = null;
    for (const w of g.magic.wisps) if (w.haunt === h.key && w.static && !w.dying) { w.dying = 0.001; w.noReward = true; }
  }
}

export { SCHOOLS };
