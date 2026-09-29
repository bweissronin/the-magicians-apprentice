import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { World, heightAt } from './world.js';
import { Particles } from './particles.js';
import { ResourceManager } from './resources.js';
import { Tower } from './tower.js';
import { Shrines } from './shrines.js';
import { Mentor } from './npc.js';
import { Props } from './props.js';
import { Interior, ARCANE_TOWER } from './interior.js';
import { roomKey, stationKey } from './roomguide.js';
import { SANCTUM_TOWERS } from './sanctum-rooms.js';
import { SANCTUM_DOOR_Z, SANCTUM_SITE } from './sanctums.js';
import { RoomUI } from './roomui.js';
import { assetsReady } from './assets.js';
import { CUT, cutoutScene } from './cutout.js';
import { stepSchools } from './schoolsui.js';
import { Soundscape } from './soundscape.js';
import { Wildlife } from './wildlife.js';
import { SpellWorld } from './spellworld.js';
import { Settings } from './settings.js';
import { TouchControls, isTouch } from './touch.js';
import { Realms } from './realms.js';
import { Crossings } from './crossings.js';
import './puzzles-schools.js';
import './puzzles-deep.js';
import { Player } from './player.js';
import { Magic } from './magic.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { PuzzleUI } from './puzzles.js';
import { AudioSys } from './audio.js';
import { GameState } from './state.js';
import { RESOURCES, TOWER_FLOORS, SHRINES, ALTAR_POS, PLAYER_START, MAX_LEVEL, NODE_TYPES, ROOMS, POTIONS, SCHOOLS, MASTERY_RANKS, GATE_POS, SANCTUMS, THRESHOLDS, THRESHOLD_IN, PASS_LIP } from './data.js';
import { formatTime, damp } from './util.js';
import { CREATURES, EL, ELEMENTS, neededFor, RANK } from './bestiary.js';
import { Journal } from './journal.js';
import { ValleyScars, chapterOf, CHAPTERS, chapterLabel, stability } from './story.js';
import { Atlas } from './atlas.js';
import { QuestLog } from './questlog.js';
import { Haunts, HAUNTS } from './haunts.js';
import { BossFight, canChallenge, guardianFor } from './bosses.js';
import { GUARDIANS } from './story.js';
import { realmTour, valleyTour } from './tour.js';

const $ = (id) => document.getElementById(id);
const TOWER_DOOR = { x: 0, z: 9.6 }; // foot of the foundation steps

// Final colour grade: gentle saturation boost, warm lift, soft vignette.
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.05 }, uVignette: { value: 0.28 }, uAsh: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uVignette, uAsh; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb *= vec3(1.03, 1.0, 0.96);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.14, 0.9, 0.8), uAsh); // ash from the unquenched Caldera
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5) * 1.25);
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = c;
    }`,
};

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 2000);
    // Multisampled HDR target so edges stay smooth through the post-processing chain
    // (the canvas' own antialias flag does nothing once an EffectComposer is in use).
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    // Ground-truth ambient occlusion: soft contact shadows give the "clay diorama" depth.
    this.gtao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
    this.gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.4, thickness: 2.5, scale: 1.2, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.9;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.state = new GameState();
    this.audio = new AudioSys();
    this.soundscape = new Soundscape(this.audio);
    this.input = new Input(this.canvas);
    this.world = new World(this.scene);
    this.particles = new Particles(this.scene);
    this.resources = new ResourceManager(this.scene, this.particles);
    this.tower = new Tower(this.scene, this.particles);
    this.shrines = new Shrines(this.scene, this.particles);
    this.mentor = new Mentor(this.scene);
    this.props = new Props(this.scene);
    this.mainParticles = this.particles;
    this.wildlife = new Wildlife(this.scene, this.particles, () => this.resources.nodes);
    this.player = new Player(this.scene, this.camera, this.input);
    const aoHidden = this.aoHidden = [this.world.sky, this.world.water];
    const ov = this.gtao.overrideVisibility.bind(this.gtao), rv = this.gtao.restoreVisibility.bind(this.gtao);
    this.gtao.overrideVisibility = () => { ov(); aoHidden.forEach((o) => { o.userData.v = o.visible; o.visible = false; }); };
    this.gtao.restoreVisibility = () => { rv(); aoHidden.forEach((o) => { o.visible = o.userData.v; }); };
    // The ways to the realms: passes, misty chasms and rope bridges (kept as `gates` for the HUD).
    this.gates = new Crossings(this);
    this.magic = new Magic(this.scene, this.particles, this.state, this.audio);
    this.spellWorld = new SpellWorld(this);
    this.magic.onLand = (el, p) => this.spellWorld.onLand(el, p);
    this.magic.onLeave = () => this.spellWorld.clear();
    this.journal = new Journal(this);
    this.scars = new ValleyScars(this);
    this.atlas = new Atlas(this);
    this.questlog = new QuestLog(this);
    this.haunts = new Haunts(this);
    Object.assign(this.magic.valleyArena, {
      nightly: true,
      nearCrystal: (x, z) => this.resources.nodes.some((n) => n.type === 'crystal' && n.alive && Math.abs(n.x - x) < 12 && Math.hypot(n.x - x, n.z - z) < 12),
    });
    this.ui = new UI(this);
    this.puzzles = new PuzzleUI(this.audio);
    this.settings = new Settings(this);
    this.realms = new Realms(this);
    this.realm = null;
    this.interior = new Interior(this);
    this.roomUI = new RoomUI(this);
    this.inside = false;

    this.mode = 'title';
    this.cinematic = null;
    this.gather = null;
    this.elapsed = 0;
    this.autosave = 0;
    this.clock = new THREE.Clock();
    this.player.place(PLAYER_START.x, PLAYER_START.z);
    // Walking into a way (valley side or realm side), the camera draws in behind you.
    this.player.boomCap = () => {
      if (this.inside || this.tour) return null;
      const p = this.player.pos;
      if (this.realm) { const a = this.realm.arrive; return Math.abs(p.x - a.x) < 4 && p.z > a.z - 2 ? 5.5 : null; }
      const w = this.gates.inWay(p);
      return w && w.s > PASS_LIP - 7 ? 5.5 : null;
    };
    this.player.solidAt = (x, z) => (this.inside ? -Infinity : this.realm ? this.realm.solidAt(x, z) : Math.max(this.shrines.surfaceAt(x, z), this.gates.surfaceAt(x, z), this.tower.surfaceAt(x, z)));
    this.player.surfaces = [(x, z) => this.shrines.surfaceAt(x, z), (x, z) => this.magic.pillarAt(x, z, this.player.pos.y), (x, z) => this.spellWorld.floeAt(x, z), (x, z) => this.gates.surfaceAt(x, z), (x, z) => this.tower.surfaceAt(x, z)];
    this.player.cameraBlockers = () => (this.inside ? [] : this.realm ? this.realm.sanctum.blockers
      : this.state.floors && !this.inside ? [{ x: 0, z: 0, r: 8.4, top: this.tower.topWorld }] : []);

    this.wireEvents();
    this.wireDom();
    addEventListener('resize', () => this.resize());
    // Hold the loading screen until furniture models and fonts are ready (no flash of unstyled title).
    const t0 = performance.now();
    assetsReady.then(() => { this.player.rebuildModel(); this.mentor.rebuildAldric(); });
    Promise.all([assetsReady, document.fonts?.ready]).finally(() => {
      setTimeout(() => $('loading').classList.remove('show'), Math.max(0, 500 - (performance.now() - t0)));
    });
    this.settings.apply();
    if (isTouch()) this.touch = new TouchControls(this);
    this.showTitle();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.gtao.setSize(innerWidth, innerHeight);
  }

  // ---------------- State events -> feedback ----------------
  wireEvents() {
    const s = this.state;
    s.on('item', ({ key, n }) => {
      this.ui.bumpItem(key);
      if (n > 0 && !RESOURCES[key].reagent) this.ui.toast(`+${n} ${RESOURCES[key].name}`, RESOURCES[key].color);
    });
    s.on('xp', ({ amount, source }) => {
      if (amount >= 50) this.ui.toast(`+${amount} XP`, '#ffe08a', source);
      $('hud-xp').parentElement.classList.remove('flash'); void $('hud-xp').offsetWidth;
      $('hud-xp').parentElement.classList.add('flash');
    });
    s.on('levelup', ({ level, rank, unlocked }) => {
      this.audio.play('levelup');
      const unlock = unlocked.length ? `New spell: ${unlocked.map((u) => `<b>${u.name}</b> [${u.key}] — ${u.desc}`).join('<br>')}` : '';
      this.ui.banner(`Level ${level}`, rank, unlock, unlocked.length ? 5500 : 3500);
      const p = this.player.pos;
      this.particles.ring(p, { count: 160, color: '#ffe08a', speed: 12, size: 0.7, life: 1.4, y: 0.3 });
      this.particles.burst(p.clone().setY(p.y + 1.5), { count: 90, color: '#fff3c4', speed: 7, size: 0.5, life: 1.6, gravity: -2 });
      this.player.canFloat = s.hasSpell('float');
      this.checkAscension();
    });
    s.on('buffEnd', (id) => { const p = POTIONS.find((x) => x.id === id); if (p) this.ui.toast(`${p.icon} ${p.name} wore off`, '#b9b0c9'); });
    this.magic.onWispKilled = (w, info) => this.onCreatureKilled(w, info);
    this.magic.onHit = (pos, dmg, killed, tag) => {
      if (killed) this.ui.floatText(pos, 'Banished!', '#ffe08a', true);
      else if (dmg >= 0.5 && tag === 'neutral') this.ui.floatText(pos, `−${Math.round(dmg * 10) / 10}`, '#ff9ad5');
      if (killed) this.player.shake = Math.max(this.player.shake, 0.15);
    };
    this.magic.onText = (pos, text, color, big) => this.ui.floatText(pos.clone ? pos.clone() : pos, text, color, big);
    this.magic.onPlayerHit = (n, w) => {
      this.ui.drained(n, w?.name || 'A wisp');
      if (this.state.mana + n < 1) this.falter(); // struck with nothing left in the well
    };
    this.magic.onFirstSight = (w) => this.firstSight(w);
    this.magic.onLearn = (w, el, verdict) => this.journal.learned(w.kind, el, verdict);
    this.magic.onAddFx = (o) => this.aoHidden.push(o);
    this.aoHidden.push(this.magic.fx.root); // bolt glows and impacts stay out of the AO pass
    this.magic.fx.camera = this.camera;
    this.magic.fx.onShake = (v) => { this.player.shake = Math.max(this.player.shake, v); }; // (off if the player turned shake off)
  }

  wireDom() {
    $('btn-new').onclick = () => {
      if (!GameState.hasSave()) { this.startGame(false); return; }
      if (!confirm('Begin a new apprenticeship? Your current progress will be lost.')) return;
      GameState.wipe();
      try { sessionStorage.setItem('ma-autostart', '1'); } catch { /* ignore */ }
      location.reload();
    };
    $('btn-continue').onclick = () => this.startGame(true);
    $('btn-resume').onclick = () => this.resume();
    $('btn-controls').onclick = () => this.toggleLegend(true);
    const openSettings = () => { this.settings.render(); $('settings').classList.remove('hidden'); this.audio.play('ui'); };
    $('btn-settings').onclick = openSettings;
    $('btn-title-settings').onclick = openSettings;
    $('settings-close').onclick = () => $('settings').classList.add('hidden');
    $('schools-close').onclick = () => this.toggleSchools(false);
    $('btn-schools').onclick = () => { this.ui.renderSchools(); $('schools').classList.remove('hidden'); this.audio.play('ui'); };
    $('legend-close').onclick = () => this.toggleLegend(false);
    $('btn-save').onclick = () => { this.save(); this.ui.toast('Game saved', '#7dff9b'); this.audio.play('ui'); };
    $('btn-quit').onclick = () => { this.save(); location.reload(); };
    $('btn-mute').onclick = () => {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      $('btn-mute').querySelector('em').textContent = this.muted ? 'Off' : 'On';
    };
    $('btn-freeplay').onclick = () => {
      $('ending').classList.remove('show');
      this.mode = 'play';
      this.ui.show();
      this.input.lock();
    };
    this.input.onLockChange = (locked) => {
      $('lockhint').classList.toggle('hidden', locked || this.mode !== 'play' || !!this.touch);
      if (!locked && this.mode === 'play' && !this.intentionalUnlock && !this.touch) this.pause();
      this.intentionalUnlock = false;
    };
    this.canvas.addEventListener('mousedown', (e) => {
      this.audio.init(); this.audio.resume();
      if (this.tour) { this.tour.skip(); return; }
      if (this.mode === 'play' && !this.input.locked && e.button === 0) this.input.lock();
    });
    addEventListener('keydown', (e) => {
      this.audio.init(); this.audio.resume();
      // Any of these skips a first-visit tour.
      if (this.tour && ['Escape', 'KeyE', 'Space', 'Enter'].includes(e.code)) { e.preventDefault(); this.tour.skip(); return; }
      if (e.code === 'Escape') this.onEscape();
      if (e.code === 'KeyB' && (this.mode === 'play' || this.mode === 'journal')) this.journal.toggle();
      if (e.code === 'KeyP' && this.mode === 'play' && !this.inside) this.openBuild(this.realm?.id);
      if (e.code === 'KeyM' && (this.mode === 'play' || this.mode === 'atlas')) this.atlas.toggle();
      if (e.code === 'KeyJ' && (this.mode === 'play' || this.mode === 'questlog')) this.questlog.toggle();
      if (e.code === 'KeyV' && this.mode === 'play') this.ui.toggleSatchel();
      if (e.code === 'KeyI' && this.mode === 'play' && !this.cinematic) this.openGuide();
      else if (e.code === 'KeyI' && this.mode === 'panel' && this.roomUI.station === 'guide') this.closeRoomPanel();
      const dig = /^Digit([1-5])$/.exec(e.code);
      if (dig && this.mode === 'play') this.attune(ELEMENTS[+dig[1] - 1].id);
      if (e.code === 'KeyH' && (this.mode === 'play' || this.mode === 'paused')) this.toggleLegend();
      if (e.code === 'KeyK' && (this.mode === 'play' || this.mode === 'schools')) this.toggleSchools();
      if (this.mode === 'schools' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) stepSchools(this, e.code === 'ArrowLeft' ? -1 : 1);
      if (e.code === 'Tab' && this.mode === 'play') {
        e.preventDefault();
        if (!this.magic.cycleTarget(this.player)) this.ui.toast('No wisps in range to target', '#c04dff');
      }
      if ((e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') && this.mode === 'dialogue') { e.preventDefault(); this.ui.advanceDialogue(); }
    });
  }

  // The legend is non-blocking: you can keep walking while it is open during play.
  toggleLegend(force) {
    const el = $('legend');
    const show = force ?? el.classList.contains('hidden');
    if (show) this.ui.renderLegend();
    el.classList.toggle('hidden', !show);
    $('controls-hint').classList.toggle('active', show);
    this.audio.play('ui');
  }

  onEscape() {
    if (!$('schools').classList.contains('hidden') && this.mode !== 'schools') { $('schools').classList.add('hidden'); return; }
    if (!$('settings').classList.contains('hidden')) { $('settings').classList.add('hidden'); return; }
    if (!$('legend').classList.contains('hidden')) { this.toggleLegend(false); if (this.mode !== 'play') return; }
    if (this.mode === 'journal') { this.journal.toggle(false); return; }
    if (this.mode === 'atlas') { this.atlas.toggle(false); return; }
    if (this.mode === 'questlog') { this.questlog.toggle(false); return; }
    if (this.mode === 'play') this.pause();
    else if (this.mode === 'paused') this.resume();
    else if (this.mode === 'build') this.closeBuild();
    else if (this.mode === 'panel') this.closeRoomPanel();
    else if (this.mode === 'schools') this.toggleSchools(false);
    else if (this.mode === 'puzzle') this.puzzles.close();
  }

  releasePointer() {
    if (this.input.locked) { this.intentionalUnlock = true; this.input.unlock(); }
  }

  // ---------------- Flow ----------------
  showTitle() {
    this.mode = 'title';
    this.ui.hide();
    const has = GameState.hasSave();
    $('btn-continue').style.display = has ? '' : 'none';
    $('btn-new').textContent = has ? 'New Apprenticeship' : 'Begin Apprenticeship';
    $('title').classList.add('show');
    let auto = false;
    try { auto = !!sessionStorage.getItem('ma-autostart'); sessionStorage.removeItem('ma-autostart'); } catch { /* ignore */ }
    if (auto) {
      this.startGame(false);
    }
  }

  startGame(load) {
    this.audio.init(); this.audio.resume();
    $('title').classList.remove('show');
    if (load && this.state.load()) {
      this.tower.setFloors(this.state.floors);
      this.state.shrines.forEach((id) => this.shrines.markSolved(id, false));
      const pl = this.state.player;
      if (pl) this.player.place(pl.x, pl.z, pl.yaw); else this.player.place(PLAYER_START.x, PLAYER_START.z);
      this.world.time = this.state.timeOfDay ?? 0.3;
      this.player.canFloat = this.state.hasSpell('float');
      this.ui.toast('Welcome back, ' + this.state.rank, '#ffd36b');
    } else {
      this.world.time = 0.3;
      this.player.place(PLAYER_START.x, PLAYER_START.z, 0.35);
    }
    this.fadeIn();
    this.mode = 'play';
    this.ui.show();
    this.input.lock();
    if (!this.state.talkedToMentor) {
      setTimeout(() => {
        const toured = (this.state.story.toured ||= {});
        if (!toured.valley && this.mode === 'play' && !this.realm && !this.transitioning && !this.tour) { toured.valley = true; this.tour = valleyTour(this); }
        else this.ui.banner('The Empty Tower', 'Chapter I', 'Master Aldric is gone. Find Quill by the ruined tower.', 5000);
      }, 700);
    }
  }

  fadeIn() {
    const f = $('fade');
    f.style.transition = 'none'; f.classList.add('on'); void f.offsetWidth;
    f.style.transition = ''; f.classList.remove('on');
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.releasePointer();
    this.ui.renderPause();
    $('pause').classList.remove('hidden');
    $('lockhint').classList.add('hidden');
  }

  resume() {
    $('pause').classList.add('hidden');
    this.mode = 'play';
    this.input.lock();
  }

  save() {
    const s = this.state;
    const home = this.realm && this.gates.arrival(this.realm.id);
    s.player = this.realm ? { x: home.x, z: home.z, yaw: home.face + Math.PI } : this.inside ? { x: 0, z: 11, yaw: -Math.PI } : { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.camYaw };
    s.timeOfDay = this.world.time;
    s.save();
  }

  // school: a school id to show that realm's sanctum plans instead of the Arcane tower.
  openBuild(school = null) {
    if (this.mode !== 'play') return;
    this.mode = 'build';
    this.buildSchool = school;
    this.releasePointer();
    this.ui.renderBuild(school);
    $('build').classList.remove('hidden');
    this.audio.play('ui');
  }

  closeBuild() {
    $('build').classList.add('hidden');
    if (this.mode === 'build') { this.mode = 'play'; this.input.lock(); }
  }

  buildNextFloor() {
    if (this.buildSchool) return this.buildSanctumStage(this.buildSchool);
    const s = this.state, f = s.nextFloor;
    if (this.raising || !f || s.level < f.level || !s.canAfford(f.cost)) return;
    s.spend(f.cost);
    const idx = s.floors;
    s.floors++;
    $('build').classList.add('hidden');
    this.mode = 'play';
    const prepared = this.tower.prepareFloor(idx);
    this.warmUp(prepared.group, this.scene).then(() => {
      const fl = this.tower.addFloor(idx, true, prepared);
      this.audio.play('build');
      this.player.shake = 1.2;
      this.ui.banner(f.name, `Floor ${idx + 1} raised`, f.lore, 4500);
      this.frameRaise(fl.box, this.tower.root.position, 4.2, { hide: this.tower.ghost }, () => {
        s.addXP(f.xp, `${f.name} raised`);
        this.save();
        this.checkAscension();
        this.input.lock();
      });
    });
  }

  // Raise the next stage of a school's sanctum (only from inside its realm).
  buildSanctumStage(id) {
    const s = this.state, st = s.nextSanctumStage(id), realm = this.realm;
    if (this.raising || !st || !realm || realm.id !== id || s.mastery(id) < st.rank || !s.canAfford(st.cost)) return;
    if (st.guardian && !s.guardians.includes(st.guardian)) return;
    const def = SCHOOLS.find((d) => d.id === id), sanc = SANCTUMS[id];
    s.spend(st.cost);
    const idx = s.sanctums[id];
    s.sanctums[id]++;
    $('build').classList.add('hidden');
    this.mode = 'play';
    const prepared = realm.sanctum.prepareStage(idx);
    this.warmUp(prepared.group, realm.scene).then(() => {
      if (this.realm !== realm) return; // left the realm meanwhile: it appears when you're back
      const stage = realm.sanctum.addStage(idx, true, prepared);
      this.audio.play('build');
      this.player.shake = 1.2;
      this.ui.banner(st.name, `${sanc.name} · stage ${idx + 1} of ${sanc.stages.length}`, st.lore, 4500);
      this.frameRaise(stage.box, realm.sanctum.world, 4.6, { front: new THREE.Vector3(0, 0, 1), hide: realm.sanctum.ghost }, () => {
        s.addXP(st.xp, `${st.name} raised`);
        if (s.sanctumComplete(id)) this.completeSanctum(id, def, sanc);
        this.save();
        this.input.lock();
      });
    });
  }

  // Compile a new part's shaders before it appears, so raising it never stalls a frame. Its own
  // lights sit out the compile: the scene's light bank already holds their place (lightbank.js).
  async warmUp(group, scene) {
    this.raising = true;
    // Hold the camera still from the click until the raise shot takes over (a beat, at most).
    this.startCinematic(1e9, () => {});
    const lights = [];
    group.traverse((o) => { if (o.isLight) { lights.push([o, o.visible]); o.visible = false; } });
    try { await this.renderer.compileAsync(group, this.camera, scene); } catch { /* it compiles on first draw instead */ }
    lights.forEach(([o, v]) => { o.visible = v; });
    this.raising = false;
  }

  // Show off a newly raised part: ease from wherever the camera is to a view that holds all of it,
  // then drift a little across it so it reads in the round. It's seen from the structure's front
  // (a sanctum's door; for the tower, where you're standing), leaning up to ~50° toward the side
  // the part stands out on. The ghost of the next part steps aside for the shot.
  frameRaise(box, centre, duration, { front = null, hide = null } = {}, done) {
    const cam = this.camera, c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const r = Math.max(4, size.length() / 2);
    const vfov = THREE.MathUtils.degToRad(cam.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.08;
    const f = front || cam.position.clone().sub(c).setY(0);
    const aFront = Math.atan2(f.x, f.z), out = new THREE.Vector3(c.x - centre.x, 0, c.z - centre.z);
    const lean = out.length() > 3 ? THREE.MathUtils.clamp(Math.atan2(Math.sin(Math.atan2(out.x, out.z) - aFront), Math.cos(Math.atan2(out.x, out.z) - aFront)), -0.9, 0.9) : 0;
    const a0 = aFront + lean, elev = 0.3;
    const start = cam.position.clone(), look0 = start.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(start.distanceTo(c)));
    const ground = this.realm ? this.realm.heightAt : heightAt;
    const want = new THREE.Vector3(), look = new THREE.Vector3();
    if (hide) hide.visible = false;
    this.startCinematic(duration, (t, cm) => {
      const k = Math.min(1, t / 1.1), e = k * k * (3 - 2 * k);
      const a = a0 - 0.22 + (t / duration) * 0.44;
      want.set(Math.sin(a) * Math.cos(elev), Math.sin(elev), Math.cos(a) * Math.cos(elev)).multiplyScalar(dist).add(c);
      want.y = Math.max(want.y, ground(want.x, want.z) + 2);
      cm.position.copy(start).lerp(want, e);
      cm.lookAt(look.copy(look0).lerp(c, e));
    }, () => { if (hide) hide.visible = true; done?.(); });
  }

  completeSanctum(id, def, sanc) {
    this.audio.play('ascend');
    this.player.shake = 0.8;
    const master = s => s.mastery(id) >= 4;
    this.ui.banner(`${sanc.name} Complete`, master(this.state) ? `${def.glyph} Grandmaster of ${def.name}` : `${def.glyph} ${def.name}`,
      `Sanctum boon: <b>${sanc.boon.name}</b> — ${sanc.boon.desc}`, 7000);
    this.realm.fx.burst(this.realm.sanctum.world.clone().setY(this.realm.sanctum.world.y + this.realm.sanctum.top), { count: 260, color: def.color, speed: 18, size: 1, life: 2.2, gravity: 3 });
  }

  // Chapter changes are announced once, and noted for the quest log.
  checkChapter(dt) {
    this.chapterT = (this.chapterT || 0) - dt;
    if (this.chapterT > 0 || this.mode === 'title') return;
    this.chapterT = 1;
    const s = this.state, n = chapterOf(s);
    if (n <= (s.story.chapter || 1)) { s.story.chapter = Math.max(n, s.story.chapter || 1); return; }
    s.story.chapter = n;
    const C = CHAPTERS[n - 1];
    setTimeout(() => {
      this.audio.play('ascend');
      this.ui.banner(C.title, chapterLabel(n), `${C.blurb}<br><small>The Veil holds by ${stability(s)} of 25 seals · quest log [J]</small>`, 7000);
    }, 1500);
    this.save();
  }

  startCinematic(duration, fn, done) {
    this.cinematic = { t: 0, duration, fn, done };
    this.releasePointer();
  }

  // The Spire is the last seal. Once it stands and the four guardians are gone, Veyra waits
  // above it; the old "ascension" ending is now the Convergence's victory.
  checkAscension() {
    const s = this.state;
    if (s.finale || s.floors < TOWER_FLOORS.length || this.cinematic || this.state.story.spireCalled) return;
    s.story.spireCalled = true;
    setTimeout(() => this.ui.banner('The Convergence', chapterLabel(7), s.guardians.length >= 4
      ? 'The Spire is raised and the Veil pulls taut. Veyra waits above it — step to the tower door and ascend.'
      : `The Spire is raised — but ${4 - s.guardians.length} guardian${s.guardians.length === 3 ? '' : 's'} still hold Aldric's sanctums.`, 8000), 1200);
  }

  // ---------------- Guardians & the Convergence ----------------
  startGuardian(realmId) {
    if (this.boss) return;
    const gid = guardianFor(realmId);
    this.boss = new BossFight(this, gid);
  }

  // A floating dais of light above the Arcane Spire, where the Unraveller waits.
  startFinale() {
    if (this.boss || this.transitioning) return;
    this.audio.play('ascend');
    this.fadeThen(() => {
      const y = this.finalY = this.tower.topWorld + 6;
      if (!this.finalDais) {
        const g = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(15, 11, 1.6, 64), new THREE.MeshStandardMaterial({ color: '#b8a8d8', roughness: 0.5, metalness: 0.2, emissive: '#3a2a6a', emissiveIntensity: 0.4 }));
        disc.position.y = -0.8; disc.receiveShadow = true; g.add(disc);
        const runes = new THREE.Mesh(new THREE.RingGeometry(9, 14, 64), new THREE.MeshBasicMaterial({ color: '#ff9ae8', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
        runes.rotation.x = -Math.PI / 2; runes.position.y = 0.02; g.add(runes); this.aoHidden.push(runes);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2, e = ['#8fd8ff', '#ffd36b', '#dca468', '#8fe3ff', '#ff8a3c'][i];
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 3.5, 8), new THREE.MeshStandardMaterial({ color: '#d8ccf0', roughness: 0.4 })); p.position.set(Math.cos(a) * 13.5, 1.75, Math.sin(a) * 13.5); g.add(p);
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshStandardMaterial({ color: e, emissive: e, emissiveIntensity: 2.5 })); gem.position.set(Math.cos(a) * 13.5, 4, Math.sin(a) * 13.5); g.add(gem);
        }
        g.position.set(0, y, 0);
        this.scene.add(g); this.finalDais = g;
      }
      this.finalDais.visible = true;
      this.player.setIndoor({ radius: 13.5, heightAt: () => y });
      this.player.place(0, 9, Math.PI);
      this.magic.setArena(this.scene, this.mainParticles, { radius: 13, height: () => y, safe: () => false, spawn: () => null, cap: () => 0, interval: 99, home: { x: 0, z: 0 } }, { name: 'Veyra', kind: 'orb', particle: '#ff4ad8' });
      this.world.time = 0.97;
      this.scars.finale = true;
      this.boss = new BossFight(this, 'unraveller');
      this.input.pressedKeys.clear();
    });
  }

  // Victory: the Veil closes, and Aldric steps out of it.
  finale() {
    const s = this.state;
    s.finale = true; s.ascended = true;
    this.save();
    const y = this.finalY, al = this.mentor.aldric;
    this.audio.play('ascend');
    this.ui.banner('The Veil Holds', 'Veyra is unbound', 'The last thread is mended. Something steps out of the light…', 6000);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 400, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = y + 200; this.scene.add(beam); this.aoHidden.push(beam);
    al.position.set(0, y, -3); al.rotation.y = 0; al.visible = true; al.scale.setScalar(0.01);
    this.startCinematic(10, (t, cam) => {
      const a = t * 0.35 + 0.3, r = 16 - t * 0.6;
      cam.position.set(Math.sin(a) * r, y + 4 + t * 0.3, Math.cos(a) * r);
      cam.lookAt(0, y + 1.5, -2);
      al.scale.setScalar(Math.min(1, Math.max(0.01, (t - 2) / 2)));
      beam.material.opacity = 0.25 + Math.sin(t * 4) * 0.08;
      if (Math.random() < 0.3) this.particles.burst(new THREE.Vector3((Math.random() - 0.5) * 50, y + 10 + Math.random() * 25, (Math.random() - 0.5) * 50), { count: 80, color: new THREE.Color().setHSL(Math.random(), 0.8, 0.65), speed: 12, size: 0.9, life: 1.8, gravity: 4 });
    }, () => {
      this.mode = 'dialogue'; this.dlgFixed = true;
      this.ui.showDialogue('Master Aldric', [
        'Well. That took rather longer than I planned.',
        'I held the thread, and you mended the cloth around it. Veyra is free — of the Veil, and of herself. She will need a long rest, and a great deal of tea.',
        'A tower and four sanctums, apprentice. I built them over sixty years and you raised them again in a season.',
        'Here — this is yours now. A Magician should carry a staff of their own.',
      ], () => {
        this.dlgFixed = false;
        this.mode = 'ending';
        this.ui.hide();
        $('ending-text').textContent = `Master Aldric bows deeply and hands you his staff. After ${formatTime(s.playTime)} of toil and wonder, the tower and its four sanctums stand, the Veil holds — and the valley has a new Magician.`;
        $('ending-stats').innerHTML = `
          <div>Seals set<b>${Math.min(5, s.floors) + SCHOOLS.reduce((n, d) => n + s.sanctumStage(d.id), 0)} / 25 seals</b></div><div>Haunts lifted<b>${s.haunts.length} / 16</b></div>
          <div>Guardians defeated<b>${s.guardians.length} / 4</b></div><div>Creatures catalogued<b>${Object.values(s.bestiary).filter((b) => b.kills > 0).length}</b></div>
          <div>Resources gathered<b>${s.stats.gathered}</b></div><div>Foes banished<b>${s.stats.wisps}</b></div>`;
        $('ending').classList.add('show');
        // Back on the ground for free play, with Aldric beside his tower.
        this.player.setIndoor(null);
        this.magic.setArena(this.scene, this.mainParticles);
        this.finalDais.visible = false; this.scars.finale = false;
        this.player.place(0, 14, 0);
        al.position.set(this.mentor.x + 2, heightAt(this.mentor.x + 2, this.mentor.z), this.mentor.z);
      });
    });
  }

  // ---------------- Interaction ----------------
  findInteractable() {
    const p = this.player.pos, s = this.state;
    if (this.inside) {
      const it = this.interior.nearest(p);
      return it ? { kind: 'room', it, label: it.label, sub: it.sub } : null;
    }
    if (this.realm) {
      const st = this.realms.nearest(p), id = this.realm.id;
      if (st?.kind === 'puzzle' && s.school(id).puzzles.includes(st.puzzle.id)) return { kind: 'none', label: st.puzzle.name, sub: 'Mastered ✓', locked: true };
      if (st?.kind === 'sanctum' && canChallenge(s, id) && !this.boss) {
        const gd = GUARDIANS[guardianFor(id)];
        return { kind: 'challenge', label: `Challenge ${gd.name}`, sub: 'The old ruler squats in the ruin of the crown — drive them out' };
      }
      if (st?.kind === 'sanctum') {
        const next = s.nextSanctumStage(id), sanc = SANCTUMS[id];
        if (!next) return { kind: 'none', label: sanc.name, sub: 'Complete ✓', locked: true };
        const ready = s.mastery(id) >= next.rank && s.canAfford(next.cost);
        return { kind: 'realmStation', st, label: `${sanc.name} — ${next.name}`, sub: ready ? 'Ready to raise!' : `Stage ${s.sanctumStage(id) + 1} of ${sanc.stages.length}` };
      }
      if (st?.kind === 'sanctumDoor') {
        const n = s.sanctumStage(id), sanc = SANCTUMS[id];
        if (!n) return { kind: 'none', label: sanc.name, sub: 'Raise the first stage at the cornerstone to open it', locked: true };
        return { kind: 'realmStation', st, label: `Enter ${sanc.name}`, sub: `${n} floor${n > 1 ? 's' : ''} to explore` };
      }
      if (st?.kind === 'echo' && s.echoes.includes(`${id}:${st.landmark.id}`)) return { kind: 'none', label: st.landmark.name, sub: 'Echo remembered ✓', locked: true };
      if (st?.kind === 'echo' && HAUNTS[`${id}:${st.landmark.id}`] && !s.haunts.includes(`${id}:${st.landmark.id}`)) return { kind: 'none', label: st.landmark.name, sub: 'The stone is silent while the haunt holds this ground', locked: true };
      if (st) return { kind: 'realmStation', st, label: st.label, sub: st.sub };
      const node = this.realm.nodes.nearest(p, s.hasSpell('reach') ? 5.5 : 3.2);
      if (node) return { kind: 'node', node, mgr: this.realm.nodes, label: `Hold to ${node.def.verb} ${node.def.name}` };
      return null;
    }
    const gate = this.gates.nearest(p);
    if (gate) {
      const d = gate.def;
      const w = THRESHOLDS[d.id];
      if (!s.schoolUnlocked(d.id)) return { kind: 'none', label: `${d.glyph} ${w.locked}`, sub: `It opens when you're ready — ${s.gateBlock(d.id)}`, locked: true };
      return { kind: 'gate', gate, label: `${d.glyph} ${w.title} — to ${d.realm}`, sub: `${w.enter} (or press E) · ${d.name} · ${s.masteryTitle(d.id)}` };
    }
    if (s.floors >= TOWER_FLOORS.length && s.guardians.length >= 4 && !s.finale && Math.hypot(p.x - TOWER_DOOR.x, p.z - TOWER_DOOR.z) < 2.8 && !this.input.down('ShiftLeft')) {
      return { kind: 'finale', label: 'Ascend to face the Unraveller', sub: 'Veyra waits above the Spire · hold Shift to enter the tower instead' };
    }
    if (s.floors > 0 && Math.hypot(p.x - TOWER_DOOR.x, p.z - TOWER_DOOR.z) < 2.8) {
      return { kind: 'enter', label: 'Enter your tower', sub: `${s.floors} floor${s.floors > 1 ? 's' : ''} to explore` };
    }
    const dm = Math.hypot(this.mentor.x - p.x, this.mentor.z - p.z);
    if (dm < 3.6) return { kind: 'mentor', label: this.state.story.letter ? 'Talk to Quill' : 'Talk to Quill', sub: this.state.story.letter ? 'Aldric\'s owl' : 'He has a letter for you' };
    const da = Math.hypot(ALTAR_POS.x - p.x, ALTAR_POS.z - p.z);
    if (da < 3.8) {
      const f = s.nextFloor;
      return { kind: 'altar', label: f ? `Tower Plans — ${f.name}` : 'Tower Plans', sub: f && s.canAfford(f.cost) && s.level >= f.level ? 'Ready to raise!' : '' };
    }
    const sh = this.shrines.nearest(p, 6.5);
    if (sh) {
      if (s.shrines.includes(sh.def.id)) return { kind: 'none', label: `${sh.def.name}`, sub: 'Already awakened', locked: true };
      if (s.level < sh.def.level) return { kind: 'none', label: sh.def.name, sub: `The runes won't answer you yet — requires level ${sh.def.level}`, locked: true };
      return { kind: 'shrine', shrine: sh, label: `Begin the trial — ${sh.def.name}` };
    }
    const reach = s.hasSpell('reach') ? 5.5 : 3.2;
    const node = this.resources.nearest(p, reach);
    if (node) {
      const def = NODE_TYPES[node.type];
      const names = { tree: 'Tree', rock: 'Boulder', crystal: 'Aether Crystal', flower: 'Mana Bloom' };
      if (def.minLevel && s.level < def.minLevel) return { kind: 'none', label: names[node.type], sub: `Requires level ${def.minLevel}`, locked: true };
      return { kind: 'node', node, label: `Hold to ${def.verb} ${names[node.type]}` };
    }
    return null;
  }

  // Walking into the mist at the end of an open bridge takes you to its realm; walking on into the
  // fog behind you in a realm brings you home.
  // Every second or so: has a tower become ready to raise? Say so once, and point at the log.
  checkReadyTowers(dt) {
    if ((this.readyT = (this.readyT || 0) - dt) > 0) return;
    this.readyT = 1.2;
    const ready = this.questlog.towers().filter((t) => t.ready).map((t) => t.id);
    const known = (this.readyKnown ||= new Set(ready)); // anything already ready at load isn't news
    for (const id of ready) if (!known.has(id)) {
      const t = this.questlog.towers().find((x) => x.id === id);
      this.ui.toast(`${t.glyph} ${t.next.name} can be raised`, t.color, `${t.name} · details in the quest log [J]`);
      this.audio.play('collect');
    }
    this.readyKnown = new Set(ready);
  }

  checkCrossing() {
    if (this.transitioning || this.inside || this.cinematic) return;
    const p = this.player.pos;
    if (this.realm) {
      // Into the realm's own mouth (it stands 5 m behind where you arrive) and through.
      const a = this.realm.arrive;
      if (p.z > a.z + 5 + THRESHOLD_IN && Math.abs(p.x - a.x) < 3) this.exitRealm();
      return;
    }
    const c = this.gates.through(p);
    if (c) this.enterRealm(c.id);
  }

  handleInteraction(dt) {
    const it = this.findInteractable();
    const inp = this.input;
    if (!it) { this.ui.prompt(null); this.gather = null; return; }
    if (it.kind === 'node') {
      const holding = inp.down('KeyE');
      if (!this.gather || this.gather.node !== it.node) this.gather = { node: it.node, t: 0, tick: 0 };
      const g = this.gather;
      if (holding) {
        // Harvest chain: finish the next node within a few seconds of the last and your hands
        // are already warm — each link is 12% quicker, up to four links.
        const chain = this.elapsed - (this.lastHarvestAt ?? -99) < 7 ? Math.min(4, this.harvestChain || 0) : 0;
        const speed = (this.state.hasSpell('reach') ? 2 : 1) * (this.state.hasBuff('harvest') ? 2 : 1) * (1 + chain * 0.12);
        g.t += (dt * speed) / it.node.def.time;
        g.tick -= dt;
        this.player.gatherT += dt;
        // Face the node while working.
        this.player.facing = Math.atan2(it.node.x - this.player.pos.x, it.node.z - this.player.pos.z);
        this.channelStream(it.node, dt);
        if (g.tick <= 0) {
          g.tick = 0.42;
          (it.mgr || this.resources).poke(it.node);
          this.audio.play({ tree: 'chop', rock: 'quarry', crystal: 'attune', flower: 'distill', bones: 'quarry', magma: 'quarry', rime: 'attune', vein: 'quarry' }[it.node.type]);
        }
        if (g.t >= 1) {
          const got = (it.mgr || this.resources).harvest(it.node);
          // Ground freed from a haunt yields double.
          if (this.realm && this.haunts.clearedNear(this.realm.id, it.node.x, it.node.z)) for (const k of Object.keys(got)) got[k] *= 2;
          for (const k of Object.keys(got)) got[k] += this.state.up('harvest'); // Green Thumb
          // Aldric's charm still lingers on the valley: double timber and stone until the Study stands.
          if (!this.realm && this.state.floors < 2) for (const k of ['wood', 'stone']) if (got[k]) got[k] *= 2;
          this.harvestChain = chain + 1; this.lastHarvestAt = this.elapsed;
          for (const [k, n] of Object.entries(got)) this.state.addItem(k, n);
          this.state.stats.gathered += Object.values(got).reduce((a, b) => a + b, 0);
          this.state.addXP(it.node.def.xp, 'Harvest');
          this.audio.play('collect');
          this.gather = null;
          this.player.gatherT = 0;
        }
      } else {
        g.t = Math.max(0, g.t - dt * 2);
        this.player.gatherT = 0;
      }
      const ch = this.elapsed - (this.lastHarvestAt ?? -99) < 7 ? Math.min(4, this.harvestChain || 0) : 0;
      const sub = [!this.realm && this.state.floors < 2 && ['tree', 'rock'].includes(it.node.type) ? "Aldric's charm: double yield" : '', ch ? `Chain ×${ch + 1} · ${ch * 12}% faster` : ''].filter(Boolean).join(' · ');
      this.ui.prompt(it.label, this.gather ? this.gather.t : 0, false, sub);
      return;
    }
    this.gather = null;
    this.player.gatherT = 0;
    this.ui.prompt(it.label, 0, !!it.locked, it.sub || '');
    if (!inp.pressed('KeyE')) return;
    if (it.kind === 'enter') this.enterTower(0, 'door');
    else if (it.kind === 'gate') this.enterRealm(it.gate.def.id);
    else if (it.kind === 'challenge') this.startGuardian(this.realm.id);
    else if (it.kind === 'finale') this.startFinale();
    else if (it.kind === 'realmStation') this.useRealmStation(it.st);
    else if (it.kind === 'room') this.useRoomInteractable(it.it);
    else if (it.kind === 'mentor') this.talkToMentor();
    else if (it.kind === 'altar') this.openBuild();
    else if (it.kind === 'shrine') this.openShrine(it.shrine);
  }

  // A ribbon of sparkles flowing from the staff orb into the resource being harvested.
  channelStream(node, dt) {
    const colors = { tree: '#ffe08a', rock: '#bfe8ff', crystal: '#c7a8ff', flower: '#6ff5dc', bones: '#9dffb8', magma: '#ffb347', rime: '#dff6ff', vein: '#ffcf8a' };
    const heights = { tree: 2.6, rock: 0.9, crystal: 1.0, flower: 0.8, bones: 0.5, magma: 0.9, rime: 0.9, vein: 0.9 };
    const from = this.player.staffTip();
    const to = new THREE.Vector3(node.x, node.y + heights[node.type], node.z);
    const col = new THREE.Color(colors[node.type]);
    const n = Math.ceil(dt * 90);
    for (let i = 0; i < n; i++) {
      const life = 0.45 + Math.random() * 0.15;
      const j = new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6);
      const v = to.clone().add(j).sub(from).divideScalar(life);
      this.particles.spawn(from.x, from.y, from.z, v.x, v.y, v.z, col, 0.28 + Math.random() * 0.2, life, 0, 0);
    }
    if (Math.random() < dt * 20) {
      this.particles.spawn(to.x + (Math.random() - 0.5) * 1.2, to.y + (Math.random() - 0.5) * 1.2, to.z + (Math.random() - 0.5) * 1.2,
        0, 1.5, 0, col, 0.45, 0.6, 0, 1);
    }
  }

  talkToMentor() {
    const lines = this.mentor.dialogue(this.state);
    const first = !this.state.talkedToMentor;
    this.mode = 'dialogue';
    this.ui.prompt(null);
    this.dlgCam = this.camera.position.clone();
    this.ui.showDialogue(this.mentor.name, lines, () => {
      this.mode = 'play';
      this.input.pressedKeys.delete('KeyE'); // the key that closed the dialogue must not reopen it
      if (first || !this.state.story.letter) {
        this.state.talkedToMentor = true;
        this.state.story.letter = true;
        this.state.addXP(25, 'Read Aldric\'s letter');
        this.ui.toast('Quest updated', '#8fd8ff', 'Rebuild the Foundation Stones');
        setTimeout(() => this.ui.toast('Tip: press J for your quest log, M for the world map', '#ffd36b'), 4000);
        setTimeout(() => this.ui.toast('Tip: press H to see all controls', '#ffd36b'), 1500);
        this.save();
      }
    });
  }

  openShrine(sh) {
    this.mode = 'puzzle';
    this.releasePointer();
    this.ui.prompt(null);
    this.audio.play('ui');
    this.puzzles.open(sh.def, () => {
      // Solved.
      this.state.shrines.push(sh.def.id);
      this.shrines.markSolved(sh.def.id, true);
      this.state.addItem('sigil', 1);
      this.state.addXP(sh.def.xp, `${sh.def.name} awakened`);
      this.ui.banner('Shrine Awakened', sh.def.name, 'You received an <b>Arcane Sigil</b>', 4000);
      this.player.shake = 0.6;
      this.mode = 'play';
      this.save();
      this.input.lock();
    }, () => {
      this.mode = 'play';
      this.input.lock();
    });
  }

  // ---------------- Spells ----------------
  handleSpells() {
    const inp = this.input, s = this.state;
    if (this.inside) return; // no spellslinging in the library
    const report = (r) => { if (r === 'mana') { this.ui.toast('Not enough mana', '#7fe3ff'); this.audio.play('error'); } };
    if (inp.clicked && s.hasSpell('bolt')) report(this.magic.castBolt(this.player));
    if (inp.pressed('KeyQ')) {
      if (s.hasSpell('blink')) report(this.magic.castBlink(this.player));
      else this.ui.toast('Blink unlocks at level 3', '#8fd8ff');
    }
    if (inp.pressed('KeyF')) {
      if (s.hasSpell('nova')) report(this.magic.castNova(this.player));
      else this.ui.toast('Starfall Nova unlocks at level 9', '#8fd8ff');
    }
    if (inp.pressed('KeyT')) {
      if (s.hasSpell('earthstair')) report(this.magic.castStair(this.player));
      else this.ui.toast('Earthen Stair — master Geomancy in the Sundered Deep', '#dca468');
    }
    if (inp.pressed('KeyR')) {
      if (s.hasSpell('fireball')) report(this.magic.castFireball(this.player));
      else this.ui.toast('Fireball — master Pyromancy in the Ember Caldera', '#ff8a3c');
    }
  }

  // ---------------- Elemental realms ----------------
  // at: 'portal' (default) or 'sanctum' (atlas travel to a raised tower).
  enterRealm(id, at = 'portal') {
    if (this.transitioning) return;
    this.audio.play('blink');
    this.fadeThen(() => {
      if (this.realm) this.teardownRealm();
      const realm = this.realms.get(id);
      this.realm = this.realms.active = realm;
      this.outsideCam = { dist: this.player.camDist, pitch: this.player.camPitch };
      realm.scene.add(this.player.mesh);
      this.player.setIndoor({ radius: realm.radius, heightAt: realm.heightAt, ceilingAt: realm.theme.roofAt });
      if (at === 'sanctum') this.player.place(SANCTUM_SITE.x, SANCTUM_SITE.z + SANCTUM_DOOR_Z[id] + 4, 0);
      else this.player.place(realm.arrive.x, realm.arrive.z - 6, 0); // a few steps in, facing north, portal behind
      this.particles = realm.fx;
      this.magic.setArena(realm.scene, realm.fx, realm.arena, realm.theme.enemy);
      this.setRenderScene(realm.scene);
      this.ui.enterRealm(realm);
      const p = this.state.school(id), toured = (this.state.story.toured ||= {});
      if (!toured[id]) {
        // First time through this gate: a bird's-eye tour of the realm.
        toured[id] = true;
        realm.chunks.forEach((ch) => { ch.visible = true; }); this.realms.cullT = 1e9;
        this.input.pressedKeys.clear();
        setTimeout(() => { if (this.realm === realm && this.mode === 'play') this.tour = realmTour(this, realm); }, 350);
        return;
      }
      this.ui.banner(realm.def.realm, `${realm.def.glyph} ${realm.def.name} · ${this.state.masteryTitle(id)}`, p.puzzles.length + (p.trial ? 1 : 0) ? '' : realm.def.blurb, 5000);
      this.input.pressedKeys.clear();
    }, at === 'portal' ? THRESHOLDS[id].fade : '#000');
  }

  teardownRealm() {
    this.realm = this.realms.active = null;
    this.magic.setArena(this.scene, this.mainParticles);
  }

  // Atlas travel between raised towers.
  travelTo(dest) {
    if (this.transitioning || this.inside) return;
    if (dest === 'arcane') {
      if (this.realm) return this.exitRealm({ x: 0, z: 13, face: 0 });
      this.audio.play('blink');
      this.fadeThen(() => { this.player.place(0, 13, 0); this.ui.toast('Travelled to the Arcane Tower', '#a792ff'); });
      return;
    }
    if (this.realm?.id === dest) {
      this.audio.play('blink');
      this.fadeThen(() => this.player.place(SANCTUM_SITE.x, SANCTUM_SITE.z + SANCTUM_DOOR_Z[dest] + 4, 0));
      return;
    }
    this.enterRealm(dest, 'sanctum');
  }

  exitRealm(dest = null) {
    if (this.transitioning || !this.realm) return;
    this.audio.play('blink');
    const tint = dest ? '#000' : THRESHOLDS[this.realm.id].fade;
    this.fadeThen(() => {
      const gate = this.gates.list.find((g) => g.def.id === this.realm.id);
      this.realm = this.realms.active = null;
      this.scene.add(this.player.mesh);
      this.player.setIndoor(null);
      this.player.traction = 1;
      if (this.outsideCam) { this.player.camDist = this.outsideCam.dist; this.player.camPitch = this.outsideCam.pitch; }
      if (dest) this.player.place(dest.x, dest.z, (dest.face ?? 0) - Math.PI);
      else { const at = this.gates.arrival(gate.id); this.player.place(at.x, at.z, at.face + Math.PI); } // just out of the mouth, facing home (place() takes the camera's yaw)
      this.particles = this.mainParticles;
      this.magic.setArena(this.scene, this.mainParticles);
      this.setRenderScene(this.scene);
      this.ui.leaveRealm();
      this.input.pressedKeys.clear();
      this.save();
    }, tint);
  }

  useRealmStation(st) {
    if (st.kind === 'exit') return this.exitRealm();
    if (st.kind === 'sanctum') return this.openBuild(this.realm.id);
    if (st.kind === 'echo') return this.hearEcho(st.landmark);
    if (st.kind === 'sanctumDoor') return this.enterTower(0, 'door', SANCTUM_TOWERS[this.realm.id]);
    const realm = this.realm, p = st.puzzle;
    this.mode = 'puzzle';
    this.releasePointer();
    this.ui.prompt(null);
    this.audio.play('ui');
    this.puzzles.open({ ...p, eyebrow: `${realm.def.glyph} ${realm.def.name} · ${realm.def.realm}` }, () => {
      this.state.school(realm.id).puzzles.push(p.id);
      this.state.addXP(p.xp, p.name);
      this.ui.banner(p.name, `${realm.def.name} trial complete`, '', 3500);
      this.player.shake = 0.5;
      this.realm.fx.burst(this.player.pos.clone().setY(this.player.pos.y + 1.5), { count: 120, color: realm.def.color, speed: 9, size: 0.7, life: 1.6, gravity: -1 });
      this.mode = 'play';
      this.checkMastery(realm.id);
      this.save();
      this.input.lock();
    }, () => { this.mode = 'play'; this.input.lock(); });
  }

  // Echo stones at each realm landmark: lore and XP for exploring the far reaches.
  hearEcho(L) {
    const r = this.realm, key = `${r.id}:${L.id}`;
    if (this.state.echoes.includes(key)) return;
    this.state.echoes.push(key);
    this.state.addXP(90, `Echo: ${L.name}`);
    this.audio.play('attune');
    this.ui.banner(L.name, `${r.def.glyph} An echo of ${r.def.realm}`, `<i>${L.lore}</i>`, 6500);
    r.fx.burst(new THREE.Vector3(L.ex, r.heightAt(L.ex, L.ez) + 4, L.ez), { count: 120, color: r.def.color, speed: 7, size: 0.6, life: 1.8, gravity: -1.5 });
    const found = this.state.echoes.filter((e) => e.startsWith(r.id + ':')).length;
    setTimeout(() => this.ui.toast(`Echoes of ${r.def.realm}: ${found} / ${r.land.landmarks.length}`, r.def.color), 1200);
    this.save();
  }

  // A creature falls: XP, its reagent (with where it's needed), bestiary progress, realm trials.
  onCreatureKilled(w, info) {
    const r = this.realm, s = this.state, def = CREATURES[w.kind], pos = w.mesh.position.clone();
    const b = s.beast(w.kind);
    b.last = { realm: r?.id || null, x: pos.x, z: pos.z };
    s.addXP(20 * RANK[w.rank].xp, `${w.name} banished`);
    if (info.essence) s.addItem('essence', info.essence);
    const firstDrop = !b.dropped;
    if (def.drop) {
      b.dropped = true;
      s.addItem(def.drop, info.reagent);
      this.ui.rewardPop(def.drop, info.reagent, neededFor(def.drop, s), { pristine: info.pristine, first: firstDrop, kind: w.kind });
      this.ui.floatText(pos, `+${info.reagent} ${RESOURCES[def.drop].name}`, RESOURCES[def.drop].color);
    }
    this.boss?.onKill?.(w);
    if (info.perkNow) {
      this.audio.play('ascend');
      setTimeout(() => this.ui.banner(`${def.perk.name}`, `Learned: ${def.name}`, `Bestiary perk — ${def.perk.desc}`, 5500), 600);
    }
    // Legion of Bone (Necromancy sanctum boon): every banished foe leaves Grave Bone.
    if (s.hasBoon('necromancy')) s.addItem('bone', 1);
    this.haunts?.onKill(w);
    if (!r || def.realm !== r.id) return;
    const p = s.school(r.id), goal = r.def.trial.goal;
    if (p.trial || this.haunts?.replacesTrial(r.id)) return;
    p.kills = Math.min(goal, p.kills + 1);
    if (p.kills >= goal) {
      p.trial = true;
      s.addXP(r.def.trial.xp, r.def.trial.name);
      this.ui.banner(r.def.trial.name, `${r.def.name} trial complete`, '', 3500);
      this.checkMastery(r.id);
      this.save();
    } else this.ui.toast(`${r.def.trial.name}: ${p.kills} / ${goal}`, r.def.color);
  }

  // Keys 1–5: attune the bolt to an element, if it has been learned.
  attune(el) {
    const s = this.state, e = EL[el];
    if (!s.knows(el)) { this.ui.toast(`${e.glyph} ${e.name} is not yet learned`, e.color, e.learn); this.audio.play('error'); return; }
    if (s.element === el) return;
    s.element = el;
    this.audio.play('ui');
    this.ui.toast(`${e.glyph} Attuned to ${e.name}`, e.color, e.how);
    this.particles.burst(this.player.staffTip(), { count: 30, color: e.color, speed: 3, size: 0.4, life: 0.6 });
  }

  // The first meeting with a kind of creature: time stops while Quill reads Aldric's note.
  firstSight(w) {
    const s = this.state, def = CREATURES[w.kind], b = s.beast(w.kind);
    // Mid-tour or mid-dialogue, wait for the next one to show up rather than skip the meeting.
    if (this.cinematic || this.mode === 'dialogue') return;
    b.seen = true; b.rumour = true; b.ranks[w.rank] = true;
    b.last = { realm: this.realm?.id || null, x: w.mesh.position.x, z: w.mesh.position.z };
    if (this.mode !== 'play' || this.inside) return;
    const trick = def.trick.replace(/^"|"\s*—\s*Aldric$/g, '').replace(/"$/, '');
    this.mode = 'dialogue'; this.dlgFixed = true;
    this.ui.prompt(null);
    this.audio.play('attune');
    this.ui.showDialogue('Quill · reading from Aldric\'s notes', [
      `Hoo — a ${def.name}! The master wrote about these. Let me find the page…`,
      `"${trick}"`,
      `I've pinned it in the bestiary. Press B to read what we know — we'll learn the rest the hard way.`,
    ], () => { this.mode = 'play'; this.dlgFixed = false; this.input.pressedKeys.delete('KeyE'); this.input.lock(); });
  }

  // Announce rank-ups; at Master, unlock the school's spell.
  checkMastery(id) {
    const def = SCHOOLS.find((s) => s.id === id), m = this.state.mastery(id);
    this.masterySeen ||= {};
    if ((this.masterySeen[id] ?? -1) >= m) return;
    this.masterySeen[id] = m;
    if (m === 3) {
      setTimeout(() => {
        this.audio.play('ascend');
        this.ui.banner(`Master of ${def.name}`, `${def.glyph} ${def.realm} conquered`, `New spell: <b>${def.spell.name}</b>${def.spell.key !== 'passive' ? ` [${def.spell.key}]` : ''} — ${def.spell.desc}`, 6500);
        this.player.shake = 0.6;
      }, 3600);
    } else if (m > 0) {
      setTimeout(() => this.ui.toast(`${def.glyph} ${def.name} mastery: ${MASTERY_RANKS[m]}`, def.color, `${3 - m} more to Master`), 1200);
    }
  }

  // Environmental challenges unique to each realm.
  realmHazards(dt) {
    const r = this.realm, p = this.player, s = this.state;
    p.traction = this.haunts.tractionAt(p.pos.x, p.pos.z) ?? (r.theme.traction ? r.theme.traction(p.pos.x, p.pos.z) : 1);
    if (p.onGround && r.slowAt?.(p.pos.x, p.pos.z)) {
      // The drowned chapel's bog: black water drags at your robes.
      p.speedMul = (p.speedMul || 1) * 0.55;
      this.bogWarn = (this.bogWarn || 0) - dt;
      if (this.bogWarn <= 0) { this.bogWarn = 5; this.ui.toast(r.theme.slowMsg || 'The bog drags at your robes', r.def.color); }
      if (Math.random() < dt * 8) r.fx.spawn(p.pos.x, p.pos.y + 0.1, p.pos.z, 0, 0.6, 0, new THREE.Color('#2a3a2e'), 0.5, 1, 0, 0.5);
    }
    const onPillar = this.magic.pillarAt(p.pos.x, p.pos.z, p.pos.y) > -Infinity;
    const stride = s.up('rimewalk') && s.hasSpell('frostwalk');
    if (p.onGround && !onPillar && !stride && (r.lavaAt(p.pos.x, p.pos.z) || this.magic.lavaPoolAt(p.pos.x, p.pos.z))) {
      // Magma burns away mana and slows you; the rock paths and bridges are safe.
      s.mana = Math.max(0, s.mana - dt * (16 + s.manaRegen)); // cancels regeneration, then burns
      p.speedMul = (p.speedMul || 1) * 0.6;
      if (Math.random() < dt * 30) r.fx.spawn(p.pos.x + (Math.random() - 0.5), p.pos.y + 0.2, p.pos.z + (Math.random() - 0.5), 0, 2, 0, new THREE.Color('#ff6a1c'), 0.5, 0.6, 0, 1);
      this.lavaWarn = (this.lavaWarn || 0) - dt;
      if (this.lavaWarn <= 0) { this.lavaWarn = 3; this.ui.toast('The lava burns your mana!', '#ff6a1c', 'Stay on the black rock and bridges'); this.audio.play('drain'); }
    }
  }

  toggleSchools(force) {
    const el = $('schools');
    const show = force ?? el.classList.contains('hidden');
    if (show) { this.ui.renderSchools(); this.mode = 'schools'; this.releasePointer(); }
    else if (this.mode === 'schools') { this.mode = 'play'; this.input.lock(); }
    if (!show && this.mode === 'paused') { el.classList.add('hidden'); return; }
    el.classList.toggle('hidden', !show);
    this.audio.play('ui');
  }

  // ---------------- Tower interior ----------------
  // Running dry: a creature that strikes you while your mana is empty knocks you down. You
  // wake at the nearest safe ground (the courtyard, or the realm's sanctum) with a fifth of your
  // common materials spilled, and whatever fight you were in is called off.
  falter() {
    if (this.faltering || this.transitioning || this.inside || this.mode !== 'play') return;
    this.faltering = true;
    const s = this.state, lost = [];
    for (const [k, r] of Object.entries(RESOURCES)) {
      if (k === 'sigil' || r.reagent) continue; // sigils and creature drops are never lost
      const n = Math.floor(s.inv[k] * 0.2);
      if (n > 0) { s.inv[k] -= n; lost.push(`${n} ${r.name}`); }
    }
    const b = this.boss;
    if (b) { b.fail(); if (!b.boss.dying) { b.boss.dying = 0.001; b.boss.noReward = true; } }
    this.haunts.abort(null);
    for (const w of this.magic.wisps) if (w.chasing && !w.dying && !w.boss) { w.dying = 0.001; w.noReward = true; }
    this.audio.play('drain');
    this.player.shake = 0.8;
    this.particles.burst(this.player.pos.clone().setY(this.player.pos.y + 1), { count: 80, color: '#c04dff', speed: 6, size: 0.5, life: 1, gravity: 2 });
    setTimeout(() => this.fadeThen(() => {
      if (this.realm) this.player.place(SANCTUM_SITE.x, SANCTUM_SITE.z + SANCTUM_DOOR_Z[this.realm.id] + 4, 0);
      else this.player.place(PLAYER_START.x, PLAYER_START.z, 0);
      s.mana = Math.max(s.mana, s.maxMana * 0.5);
      this.player.grace = 4;
      this.faltering = false;
      s.stats.falters = (s.stats.falters || 0) + 1;
      this.ui.banner('You Faltered', lost.length ? `Dropped ${lost.join(', ')}` : 'Your satchel was empty — nothing lost',
        s.stats.falters === 1 ? 'A creature struck you with no mana left. Keep some in reserve, and dodge with [C].' : '', 4500);
      this.save();
    }), 900);
  }

  // Fade out, run fn, fade back in. `tint` colours it (the dark of a mine, the white of the ice).
  fadeThen(fn, tint = '#000') {
    const f = $('fade');
    f.style.background = tint;
    f.classList.add('on');
    this.transitioning = true;
    setTimeout(() => { fn(); f.classList.remove('on'); this.transitioning = false; }, 450);
  }

  // Keep the line of sight to the apprentice clear (see cutout.js). New scenery is picked up
  // by a cheap re-scan of the active scene every second or so.
  updateCutout(dt, playing) {
    const on = playing && !this.tour;
    CUT.uCutR.value = damp(CUT.uCutR.value, on ? (this.inside ? 1.3 : 1.7) : 0, 6, dt);
    CUT.uCutA.value.copy(this.camera.position);
    CUT.uCutB.value.copy(this.player.pos).y += 1.2;
    if ((this.cutT = (this.cutT || 0) - dt) > 0) return;
    this.cutT = 1.2;
    [this.player.mesh, this.mentor.mesh, this.world.terrain, this.world.water, this.world.sky].forEach((o) => { if (o) o.userData.noCut = true; });
    cutoutScene(this.renderPass.scene);
  }

  setRenderScene(scene) {
    this.renderPass.scene = scene;
    this.gtao.scene = scene;
  }

  // floor: room index; arrive: 'door' | 'up' | 'down' (how the player entered this room).
  // def: which tower — the Arcane tower (default) or a school sanctum (SANCTUM_TOWERS).
  enterTower(floor, arrive, def = this.interiorDef || ARCANE_TOWER) {
    if (this.transitioning) return;
    if (!this.assetsLoaded) {
      // Furniture models load in the background at startup; wait for them the first time.
      assetsReady.then(() => { this.assetsLoaded = true; this.enterTower(floor, arrive, def); });
      return;
    }
    this.audio.play(arrive === 'door' ? 'blink' : 'ui');
    this.fadeThen(() => {
      if (!this.inside) {
        this.outsideCam = { dist: this.player.camDist, pitch: this.player.camPitch };
        this.player.camDist = 11; this.player.camPitch = 0.82;
      }
      this.inside = true;
      this.interiorDef = def;
      this.interior.scene.add(this.player.mesh);
      const spot = this.interior.enter(floor, arrive, def);
      this.player.setIndoor(spot);
      // Face the middle of the room.
      const facing = Math.atan2(-spot.x, -spot.z);
      this.player.place(spot.x, spot.z, facing - Math.PI);
      this.setRenderScene(this.interior.scene);
      const name = def.rooms[floor].name, school = SCHOOLS.find((d) => d.id === def.id);
      this.ui.enterRoom(name, school ? `${school.glyph} ${SANCTUMS[def.id].name}` : undefined);
      // First time in this room: its guide explains what it's for. After that, just the name.
      const key = roomKey(def, floor), guide = this.state.guide;
      if (!guide.rooms.includes(key)) {
        guide.rooms.push(key); this.save();
        setTimeout(() => { if (this.inside && this.interiorDef === def && this.interior.floor === floor && this.mode === 'play' && !this.cinematic) this.openGuide(); }, 650);
      } else this.ui.banner(name, school ? `${SANCTUMS[def.id].name} · Floor ${floor + 1} of ${def.floors(this.state)}` : `Floor ${floor + 1}`, '', 2200);
      this.input.pressedKeys.clear();
    });
  }

  exitTower(dest = { x: 0, z: 11 }) {
    if (this.transitioning) return;
    if (this.interiorDef && this.interiorDef !== ARCANE_TOWER && this.realm) return this.exitSanctum();
    this.audio.play('blink');
    this.fadeThen(() => {
      this.inside = false;
      this.interior.exit();
      this.interiorDef = null;
      this.scene.add(this.player.mesh);
      this.player.setIndoor(null);
      if (this.outsideCam) { this.player.camDist = this.outsideCam.dist; this.player.camPitch = this.outsideCam.pitch; }
      // Face away from wherever we came out (door) or toward the destination shrine.
      const facing = dest.face ?? 0;
      this.player.place(dest.x, dest.z, facing - Math.PI);
      this.setRenderScene(this.scene);
      this.ui.leaveRoom();
      this.input.pressedKeys.clear();
      this.save();
    });
  }

  // Walk out of a school sanctum, back into its realm at the door.
  exitSanctum() {
    const r = this.realm;
    this.audio.play('blink');
    this.fadeThen(() => {
      this.inside = false;
      this.interior.exit();
      this.interiorDef = null;
      r.scene.add(this.player.mesh);
      this.player.setIndoor({ radius: r.radius, heightAt: r.heightAt, ceilingAt: r.theme.roofAt });
      if (this.outsideCam) { this.player.camDist = this.outsideCam.dist; this.player.camPitch = this.outsideCam.pitch; }
      this.player.place(SANCTUM_SITE.x, SANCTUM_SITE.z + SANCTUM_DOOR_Z[r.id] + 2.5, 0);
      this.setRenderScene(r.scene);
      this.ui.leaveRoom(); this.ui.enterRealm(r);
      this.input.pressedKeys.clear();
      this.save();
    });
  }

  // Sanctum floor stations (see sanctum-rooms.js).
  useSanctumStation(station) {
    const r = this.realm, s = this.state, id = r.id, def = r.def, res = SANCTUMS[id].resource;
    if (station === 'mastery') return this.toggleSchools(true);
    if (station === 'transmute') {
      if (s.inv.essence < 8) { this.ui.toast('The font needs 8 Mana Essence', def.color); this.audio.play('error'); return; }
      s.spend({ essence: 8 }); s.addItem(res, 6);
      this.audio.play('attune');
      this.ui.toast(`Transmuted 8 Mana Essence into 6 ${RESOURCES[res].name}`, def.color);
      this.interior.fx.burst(new THREE.Vector3(0, 1.6, -5.2), { count: 60, color: def.color, speed: 4, size: 0.4, life: 1, gravity: -1 });
      return;
    }
    if (station === 'restore') {
      const now = this.elapsed;
      if (now < (this.restoreReady || 0)) { this.ui.toast(`The waters are still settling (${Math.ceil(this.restoreReady - now)}s)`, def.color); return; }
      this.restoreReady = now + 90;
      s.mana = s.maxMana; s.buffs.ward = 120;
      this.audio.play('ascend');
      this.ui.toast('Mana restored — warded for 2 minutes', def.color);
      this.interior.fx.burst(this.player.pos.clone().setY(1.2), { count: 90, color: def.color, speed: 5, size: 0.5, life: 1.2, gravity: -1 });
      return;
    }
    if (station === 'chronicle') {
      const heard = r.land.landmarks.filter((L) => s.echoes.includes(`${id}:${L.id}`));
      const built = SANCTUMS[id].stages.slice(0, s.sanctumStage(id));
      const lines = [
        ...built.map((st) => `<b>${st.name}.</b> ${st.lore}`),
        ...(heard.length ? heard.map((L) => `<b>${L.name}.</b> ${L.lore}`) : ['The pages are blank. Find the Echo Stones out in the realm, and their stories will write themselves here.']),
      ];
      this.mode = 'dialogue'; this.dlgFixed = true;
      this.ui.prompt(null);
      this.ui.showDialogue(`Chronicle of ${def.realm}`, lines, () => { this.mode = 'play'; this.dlgFixed = false; this.input.pressedKeys.delete('KeyE'); });
      return;
    }
    if (station === 'lookout') return this.sanctumLookout();
  }

  // From the sanctum's crown: a slow orbit over the whole realm.
  sanctumLookout() {
    const r = this.realm;
    this.audio.play('ascend');
    this.fadeThen(() => {
      this.setRenderScene(r.scene);
      this.ui.hide();
      const c = r.sanctum.world, top = r.sanctum.top;
      r.chunks.forEach((ch) => { ch.visible = true; });
      this.realms.cullT = 12;
      this.startCinematic(10, (t, cam) => {
        const a = t * 0.3 + 0.4, rr = 30 + t * 4;
        cam.position.set(c.x + Math.sin(a) * rr, c.y + top + 6 + t, c.z + Math.cos(a) * rr);
        cam.lookAt(c.x + Math.sin(a) * 90, c.y + 2, c.z + Math.cos(a) * 90);
      }, () => this.fadeThen(() => {
        this.setRenderScene(this.interior.scene);
        this.ui.show();
        this.input.lock();
      }));
    });
  }

  // The room guide [I]: inside a tower, the room you're standing in; outside, the directory of
  // the tower nearest to hand (Aldric's in the valley, the sanctum in a realm).
  openGuide(tab = 'room') {
    const s = this.state;
    let def = ARCANE_TOWER, floor = null;
    if (this.inside) { def = this.interiorDef; floor = this.interior.floor; }
    else if (this.realm) def = SANCTUM_TOWERS[this.realm.id];
    if (floor == null && def.floors(s) === 0) {
      this.ui.toast(def === ARCANE_TOWER ? 'Raise the Foundation Stones to open the tower' : `Raise the first stage of ${SANCTUMS[def.id].name} to open it`, '#ffd36b');
      return;
    }
    this.mode = 'panel';
    this.releasePointer();
    this.ui.prompt(null);
    this.audio.play('ui');
    this.roomUI.open('guide', { def, floor, here: floor, tab: floor == null ? 'tower' : tab });
  }

  // Remember a station once it's been used: its guide stops saying "Not tried yet" and its
  // sparkle goes out.
  markStationUsed(it) {
    const k = stationKey(this.interiorDef || ARCANE_TOWER, it.station), used = this.state.guide.used;
    if (!used.includes(k)) { used.push(k); this.interior.clearMarker(it); }
  }

  useRoomInteractable(it) {
    const f = this.interior.floor;
    if (it.kind === 'station') this.markStationUsed(it);
    if (it.kind === 'exit') this.exitTower();
    else if (it.kind === 'up') this.enterTower(f + 1, 'up');
    else if (it.kind === 'down') this.enterTower(f - 1, 'down');
    else if (it.kind === 'station' && it.station === 'bestiary') this.journal.toggle(true);
    else if (it.kind === 'station' && this.interiorDef && this.interiorDef !== ARCANE_TOWER) this.useSanctumStation(it.station);
    else if (it.kind === 'station') {
      if (it.station === 'lookout') this.spireLookout();
      else this.openRoomPanel(it.station);
    }
  }

  openRoomPanel(station) {
    this.mode = 'panel';
    this.releasePointer();
    this.ui.prompt(null);
    this.audio.play('ui');
    this.roomUI.open(station);
  }

  closeRoomPanel() {
    this.roomUI.close();
    if (this.mode === 'panel') { this.mode = 'play'; this.input.lock(); }
  }

  fastTravel(dest) {
    this.closeRoomPanel();
    const face = dest.id === 'home' ? 0 : Math.PI; // shrines: arrive just south of it, facing north toward it
    this.particles.burst(new THREE.Vector3(dest.x, heightAt(dest.x, dest.z) + 1, dest.z), { count: 80, color: '#8fd8ff', speed: 6, size: 0.5, life: 1.2 });
    this.exitTower({ x: dest.x, z: dest.z, face });
    this.ui.toast(`Travelled to ${dest.name}`, '#8fd8ff');
  }

  // Step out onto the spire balcony: an orbit of the valley from the top of the tower.
  spireLookout() {
    this.audio.play('ascend');
    this.fadeThen(() => {
      this.setRenderScene(this.scene);
      const top = this.tower.topWorld;
      this.ui.hide();
      this.startCinematic(9, (t, cam) => {
        const a = t * 0.35 + 0.8;
        cam.position.set(Math.sin(a) * 9, top - 2, Math.cos(a) * 9);
        cam.lookAt(Math.sin(a) * 60, top - 14, Math.cos(a) * 60);
      }, () => this.fadeThen(() => {
        this.setRenderScene(this.interior.scene);
        this.ui.show();
        this.input.lock();
      }));
    });
  }

  // Over-the-shoulder two-shot framing the mentor while he speaks.
  dialogueCamera(dt) {
    const m = this.mentor, p = this.player.pos;
    const head = new THREE.Vector3(m.x, m.mesh.position.y + (m.headY || 1.6), m.z);
    const dir = new THREE.Vector3(p.x - m.x, 0, p.z - m.z).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const want = head.clone().addScaledVector(dir, 6.5).addScaledVector(side, 3.4).add(new THREE.Vector3(0, 0.9, 0));
    this.dlgCam ||= this.camera.position.clone();
    this.dlgCam.lerp(want, 1 - Math.exp(-dt * 4));
    this.camera.position.copy(this.dlgCam);
    this.camera.lookAt(head.clone().addScaledVector(dir, 1.2).addScaledVector(side, -0.3));
  }

  // ---------------- Main loop ----------------
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    const s = this.state;
    const playing = this.mode === 'play' && !this.cinematic;

    if (this.mode === 'title') {
      const a = this.elapsed * 0.05;
      this.camera.position.set(Math.sin(a) * 58, 42, Math.cos(a) * 58);
      this.camera.lookAt(0, 6, 0);
      this.world.update(dt * 4, this.elapsed, new THREE.Vector3(0, 0, 0));
    } else {
      if (this.mode !== 'paused') {
        s.playTime += dt;
        this.world.update(dt, this.elapsed, this.player.pos);
        s.mana = Math.min(s.maxMana, s.mana + dt * s.manaRegen);
        s.tickBuffs(dt);
        this.player.speedMul = s.hasBuff('speed') ? 1.4 : 1;
      }
      if (this.mode !== 'paused') {
        const colliders = this.inside ? this.interior.colliders : this.realm ? [...this.realm.colliders, ...this.realm.sanctum.colliders, ...this.realm.nodes.colliders, ...this.magic.pillarColliders]
          : [...this.resources.colliders, ...this.tower.colliders, ...this.shrines.colliders, ...this.props.colliders, ...this.gates.colliders, this.mentor.collider, ...this.magic.pillarColliders, ...this.scars.colliders];
        this.player.frostwalk = !this.realm && !this.inside && s.hasSpell('frostwalk');
        if (this.realm && !this.inside) this.realmHazards(dt);
        this.player.frozen = !playing || !!this.faltering;
        this.player.combatFocus = this.magic.reticle.visible && this.magic.target ? this.magic.target.mesh.position : null;
        this.player.update(dt, colliders, this.audio);
        if (this.player.justDodged) {
          this.player.justDodged = false;
          const p = this.player.pos;
          this.particles.burst(new THREE.Vector3(p.x, p.y + 0.6, p.z), { count: 26, color: '#c9b8ff', speed: 4, size: 0.4, life: 0.45, gravity: 1 });
          this.audio.play('blink');
        }
        this.magic.update(dt, this.elapsed, this.player, this.realm ? 1 : this.world.night, !playing || this.inside);
        this.magic.updateReticle(dt, this.elapsed, this.camera, this.player, playing && !this.inside);
      }
      if (playing) {
        this.checkCrossing();
        this.checkReadyTowers(dt);
        this.handleInteraction(dt);
        this.handleSpells();
        this.autosave += dt;
        if (this.autosave > 30) { this.autosave = 0; this.save(); }
      } else if (this.mode !== 'dialogue') this.ui.prompt(null);
      if (this.mode === 'dialogue' && !this.dlgFixed) this.dialogueCamera(dt);
      if (this.cinematic) {
        const c = this.cinematic;
        c.t += dt;
        c.fn(c.t, this.camera);
        if (c.t >= c.duration) { this.cinematic = null; c.done?.(); }
      }
      this.ui.update(dt);
      $('crosshair').style.display = playing ? '' : 'none';
    }

    // Fireflies around the player at night.
    if (!this.realm && this.world.night > 0.4 && Math.random() < dt * 12 * this.world.night) {
      const p = this.player.pos;
      this.particles.spawn(p.x + (Math.random() - 0.5) * 40, p.y + 0.5 + Math.random() * 3, p.z + (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 0.6, (Math.random() - 0.3) * 0.4, (Math.random() - 0.5) * 0.6, new THREE.Color('#d8ff7a'), 0.3, 4, 0, 0.1);
    }
    this.resources.update(dt, this.elapsed, this.player.pos, this.world.night);
    this.tower.update(dt, this.elapsed);
    this.shrines.update(dt, this.elapsed, this.player.pos);
    this.mentor.update(dt, this.elapsed, this.player.pos);
    this.scars.update(dt, this.elapsed, this.player.pos);
    this.checkChapter(dt);
    // Landmarks enter the atlas once you've laid eyes on them.
    if (this.realm && !this.inside && (this.seenT = (this.seenT || 0) - dt) <= 0) {
      this.seenT = 0.5;
      const seen = (this.state.story.seen ||= {}), p = this.player.pos;
      for (const L of this.realm.land.landmarks) if (Math.hypot(L.x - p.x, L.z - p.z) < L.r + 45) seen[`${this.realm.id}:${L.id}`] = true;
    }
    this.updateCutout(dt, playing);
    // Every popup takes the colours of the land you're in (style.css: body[data-land]).
    const land = this.realm?.id || 'arcane';
    if (document.body.dataset.land !== land) document.body.dataset.land = land;
    this.spellWorld.update(dt, this.elapsed);
    this.wildlife.update(dt, this.elapsed, !this.realm && !this.inside, this.world.night, this.player.pos);
    // In a realm's edge of the valley you start to hear it too.
    const edge = !this.realm && !this.inside ? this.gates.bleedHere(this.player.pos) : null;
    if (this.mode !== 'title') this.soundscape.update(dt, this.inside ? 'interior' : this.realm?.id || (edge?.k > 0.55 ? edge.id : 'valley'), this.realm ? 0 : this.world.night);
    this.particles.update(dt);
    this.interior.update(dt, this.elapsed);
    this.gates.update(dt, this.elapsed, this.state);
    if (this.realm) this.realms.update(dt, this.elapsed, this.player, this.inside);
    if (this.mode !== 'paused') { this.haunts.update(dt, this.elapsed); this.boss?.update(dt, this.elapsed); }
    this.bloom.strength = 0.5 + this.world.night * 0.35;
    this.settings.sample(dt, playing);
    this.composer.render();
    this.input.endFrame();
  }
}

try {
  window.game = new Game();
  const scenario = new URLSearchParams(location.search).get('scenario');
  if (scenario) import('./debug.js').then((m) => m.runScenario(window.game, scenario));
} catch (err) {
  console.error(err);
  $('loading').innerHTML = `<p style="color:#ff9a9a;max-width:520px;text-align:center">The spell fizzled: ${err.message}<br><small>WebGL is required.</small></p>`;
}
