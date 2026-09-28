import * as THREE from 'three';
import { heightAt } from './world.js';
import { SANCTUMS, SHRINES, PASS_LIP, PASS_END, passPoint } from './data.js';
import { HAUNTS } from './haunts.js';

// First-visit tours: the first time you set foot somewhere new (the valley on a new game, each
// realm the first time through its gate), the camera lifts into a slow bird's-eye flight that
// names what's there — the fallen tower, the landmarks — then settles back behind you.
// Any key or a click skips it.

const $ = (id) => document.getElementById(id);
const smooth = (t) => t * t * (3 - 2 * t);

export class Tour {
  // stops: [{ pos: Vector3, look: Vector3, title?, sub?, text? }]; ceiling(x, z) optional (caverns).
  constructor(game, stops, { ceiling = null, onDone = null, secondsPerStop = 2.8 } = {}) {
    game.tour?.skip(); // one tour at a time
    this.game = game; this.stops = stops; this.ceiling = ceiling; this.onDone = onDone;
    this.pos = new THREE.CatmullRomCurve3(stops.map((s) => s.pos), false, 'centripetal');
    this.look = new THREE.CatmullRomCurve3(stops.map((s) => s.look), false, 'centripetal');
    // Where along the path (0..1 of its length) each stop falls, for timing the captions.
    // Both curves are sampled by the same stop parameter (i / (n-1)), so the camera and its look
    // target reach each stop together; the leg lengths only set how long each glide takes.
    const n = stops.length;
    this.marks = stops.map((_, i) => i / (n - 1));
    this.legs = stops.map((st, i) => (i ? st.pos.distanceTo(stops[i - 1].pos) : 0));
    // Timeline: glide between stops, then hold (with a slow drift) on each captioned one.
    this.hold = secondsPerStop * 0.6;
    this.keys = [{ t: 0, u: 0 }];
    let t = 1.2; // a beat on the opening view
    this.keys.push({ t, u: 0.004 });
    for (let i = 1; i < stops.length; i++) {
      t += Math.max(1.4, secondsPerStop * 0.5 + this.legs[i] / 60);
      this.keys.push({ t, u: this.marks[i], arrive: i });
      if (stops[i].title && i < stops.length - 1) { t += this.hold; this.keys.push({ t, u: Math.min(1, this.marks[i] + 0.012) }); }
    }
    this.duration = t + 0.6;
    this.shown = -1;
    this.tmpP = new THREE.Vector3(); this.tmpL = new THREE.Vector3();
    document.body.classList.add('touring'); // HUD hidden, captions (the banner) kept
    $('tour-skip').classList.remove('hidden');
    game.startCinematic(this.duration, (t, cam) => this.frame(t, cam), () => this.end());
  }

  frame(t, cam) {
    let k = 1;
    while (k < this.keys.length - 1 && this.keys[k].t < t) k++;
    const a = this.keys[k - 1], b = this.keys[k], f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    const u = this.u = Math.min(1, a.u + (b.u - a.u) * smooth(f));
    this.pos.getPoint(u, this.tmpP);
    this.look.getPoint(u, this.tmpL);
    if (this.ceiling) this.tmpP.y = Math.min(this.tmpP.y, this.ceiling(this.tmpP.x, this.tmpP.z) - 3);
    cam.position.copy(this.tmpP);
    cam.lookAt(this.tmpL);
    // Caption each stop as the camera arrives at it.
    for (let i = this.shown + 1; i < this.stops.length; i++) {
      if (u + 0.006 < this.marks[i]) break;
      this.shown = i;
      const s = this.stops[i];
      if (s.title) this.game.ui.banner(s.title, s.sub || '', s.text || '', i === this.stops.length - 1 ? 4000 : this.hold * 1000 + 700);
    }
  }

  skip() { if (this.game.cinematic) { this.game.cinematic = null; this.end(); } }

  end() {
    if (this.ended) return;
    this.ended = true;
    const g = this.game;
    $('tour-skip').classList.add('hidden');
    g.tour = null;
    document.body.classList.remove('touring');
    if (g.realm) g.realms.cullT = 0;
    g.input.pressedKeys.clear();
    if (g.mode === 'play') g.input.lock();
    this.onDone?.();
  }
}

// A camera stop hovering over a point: lifted and pulled back toward `from`.
function over(x, y, z, from, back, lift) {
  const dx = x - from.x, dz = z - from.z, d = Math.hypot(dx, dz) || 1;
  return new THREE.Vector3(x - (dx / d) * back, y + lift, z - (dz / d) * back);
}
// The view behind the player, where the tour lands.
function behind(player) {
  const p = player.pos, f = player.facing;
  return { pos: new THREE.Vector3(p.x - Math.sin(f) * 11, p.y + 6, p.z - Math.cos(f) * 11), look: new THREE.Vector3(p.x + Math.sin(f) * 4, p.y + 1.6, p.z + Math.cos(f) * 4) };
}

export function realmTour(game, realm) {
  const h = (x, z) => realm.heightAt(x, z), A = realm.arrive, hub = new THREE.Vector3(0, h(0, 0), 0);
  const stops = [];
  stops.push({ pos: new THREE.Vector3(A.x, h(A.x, A.z) + 55, A.z + 75), look: new THREE.Vector3(0, hub.y + 4, -10),
    title: realm.def.realm, sub: `${realm.def.glyph} ${realm.def.name} · first visit`, text: realm.def.blurb });
  const sc = realm.sanctum.world;
  stops.push({ pos: new THREE.Vector3(sc.x + 26, sc.y + 26, sc.z + 30), look: new THREE.Vector3(sc.x, sc.y + 5, sc.z),
    title: SANCTUMS[realm.id].name, sub: 'Aldric\'s fallen tower', text: 'Rebuild it stage by stage at the cornerstone. Every stage steadies this land.' });
  // The four landmarks, in a sweep around the realm starting nearest the tower.
  const lms = [...realm.land.landmarks].sort((a, b) => Math.atan2(a.x, -a.z) - Math.atan2(b.x, -b.z));
  for (const L of lms) {
    const y = h(L.x, L.z), haunted = HAUNTS[`${realm.id}:${L.id}`] && !game.state.haunts.includes(`${realm.id}:${L.id}`);
    stops.push({ pos: over(L.x, y, L.z, hub, L.r + 16, L.r * 0.35 + 13), look: new THREE.Vector3(L.x, y + 4, L.z),
      title: L.name, sub: haunted ? 'Landmark · haunted ground' : 'Landmark', text: haunted ? 'An Echo Stone waits here — once the haunt is lifted.' : '' });
  }
  const end = behind(game.player);
  stops.push({ pos: new THREE.Vector3(end.pos.x, end.pos.y + 30, end.pos.z + 20), look: end.look });
  stops.push({ pos: end.pos, look: end.look, title: realm.def.realm, sub: `${realm.def.glyph} ${realm.def.name}`, text: 'Press M for the atlas and J for your quest log.' });
  return new Tour(game, stops, { ceiling: realm.theme.roofAt || null, secondsPerStop: 1.9 });
}

export function valleyTour(game, onDone) {
  const h = (x, z) => heightAt(x, z) + 0;
  const stops = [
    { pos: new THREE.Vector3(0, 75, 120), look: new THREE.Vector3(0, 6, 0), title: 'The Valley', sub: 'Home', text: 'Master Aldric\'s valley — and the Veil above it, torn.' },
    { pos: new THREE.Vector3(20, h(0, 0) + 20, 26), look: new THREE.Vector3(0, h(0, 0) + 3, 0), title: 'Aldric\'s Tower', sub: 'In ruins', text: 'It fell the night he walked into the Veil. You will raise it again.' },
    (() => { // the Hollow's bridge, running out over the mist
      const from = passPoint('cryomancy', PASS_LIP - 26, -14), to = passPoint('cryomancy', PASS_END);
      return { pos: new THREE.Vector3(from.x, h(from.x, from.z) + 16, from.z), look: new THREE.Vector3(to.x, h(passPoint('cryomancy', 135).x, passPoint('cryomancy', 135).z), to.z), title: 'The Four Bridges', sub: 'Four realms', text: 'At each edge of the valley a bridge runs out into the mist. Beyond each, one of Aldric\'s sanctums lies fallen too.' };
    })(),
  ];
  for (const sh of [...SHRINES].sort((a, b) => Math.atan2(a.x, -a.z) - Math.atan2(b.x, -b.z)).slice(0, 3)) {
    stops.push({ pos: over(sh.x, h(sh.x, sh.z), sh.z, { x: 0, z: 0 }, 26, 22), look: new THREE.Vector3(sh.x, h(sh.x, sh.z) + 3, sh.z), title: sh.name, sub: 'Rune Shrine', text: 'Solve its trial for an Arcane Sigil.' });
  }
  const end = behind(game.player);
  stops.push({ pos: new THREE.Vector3(end.pos.x, end.pos.y + 32, end.pos.z + 26), look: end.look });
  stops.push({ pos: end.pos, look: end.look, title: 'Find Quill', sub: 'Chapter I · The Empty Tower', text: 'Aldric\'s owl waits by the ruined tower with a letter.' });
  return new Tour(game, stops, { onDone, secondsPerStop: 1.9 });
}
