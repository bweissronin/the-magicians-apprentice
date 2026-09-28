import * as THREE from 'three';

// Player-facing options, persisted per browser. Graphics presets scale every expensive
// feature so the game holds its frame rate from integrated-GPU laptops up to desktops;
// "Auto" watches real frame times for the first seconds of play and steps down if needed.

const KEY = 'magicians-apprentice-settings-v1';
export const QUALITY = {
  low:    { label: 'Low',    pixelRatio: 0.85, msaa: 0, ao: false, bloom: false, shadowSize: 1024, shadowSoft: false, grass: 0.35, particles: 0.5 },
  medium: { label: 'Medium', pixelRatio: 1.0,  msaa: 2, ao: true,  bloom: true,  shadowSize: 2048, shadowSoft: true,  grass: 0.7,  particles: 0.8 },
  high:   { label: 'High',   pixelRatio: 1.5,  msaa: 4, ao: true,  bloom: true,  shadowSize: 3072, shadowSoft: true,  grass: 1.0,  particles: 1.0 },
};
const DEFAULTS = { quality: 'auto', resolved: 'high', volume: 0.8, ambience: 0.7, sensitivity: 1.0, invertY: false, cameraShake: true, showHints: true, scholar: false };

export class Settings {
  constructor(game) {
    this.game = game;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
    this.v = { ...DEFAULTS, ...saved };
    this.autoSamples = [];
    this.autoDone = this.v.quality !== 'auto';
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* ignore */ } }

  get preset() { return QUALITY[this.v.quality === 'auto' ? this.v.resolved : this.v.quality]; }

  apply() {
    const g = this.game, q = this.preset;
    const r = g.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    // MSAA sample count lives on the composer's targets; changing it needs a re-allocation.
    for (const rt of [g.composer.renderTarget1, g.composer.renderTarget2]) {
      if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); }
    }
    g.resize();
    g.gtao.enabled = q.ao;
    g.bloom.enabled = q.bloom;
    r.shadowMap.type = q.shadowSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const sun = g.world.sun;
    if (sun.shadow.mapSize.x !== q.shadowSize) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    const grass = g.world.grass;
    grass.userData.fullCount ??= grass.count;
    grass.count = Math.floor(grass.userData.fullCount * q.grass);
    g.particles.density = q.particles;
    g.interior.fx.density = q.particles;
    // Audio + controls.
    g.audio.setVolume?.(this.v.volume, this.v.ambience);
    g.player.sensitivity = this.v.sensitivity;
    g.player.invertY = this.v.invertY;
    g.player.shakeEnabled = this.v.cameraShake;
    document.body.classList.toggle('no-hints', !this.v.showHints);
    g.magic.strict = !!this.v.scholar;
  }

  set(key, value) {
    this.v[key] = value;
    if (key === 'quality') { this.autoDone = value !== 'auto'; this.autoSamples = []; }
    this.save();
    this.apply();
  }

  // Auto quality: after the first ~4 s of real play, drop a tier if the median frame is slow.
  sample(dt, playing) {
    if (this.autoDone || !playing) return;
    this.autoSamples.push(dt);
    if (this.autoSamples.length < 240) return;
    const s = [...this.autoSamples].sort((a, b) => a - b);
    const median = s[s.length >> 1] * 1000;
    const order = ['high', 'medium', 'low'];
    const i = order.indexOf(this.v.resolved);
    if (median > 22 && i < 2) {
      this.v.resolved = order[i + 1];
      this.save(); this.apply();
      this.game.ui.toast(`Graphics set to ${QUALITY[this.v.resolved].label} for smoother play`, '#8fd8ff', 'Change it any time in Settings');
      this.autoSamples = []; // re-measure at the new tier
      return;
    }
    this.autoDone = true;
  }

  // ---------------- Panel ----------------
  render() {
    const v = this.v;
    const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([val, label]) =>
      `<button class="${String(v[key]) === String(val) ? 'on' : ''}" data-val="${val}">${label}</button>`).join('')}</div>`;
    const slider = (key, min, max, step) => `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${v[key]}">`;
    const toggle = (key) => `<button class="toggle ${v[key] ? 'on' : ''}" data-key="${key}" role="switch" aria-checked="${v[key]}"><i></i></button>`;
    const auto = v.quality === 'auto' ? ` <small>(currently ${QUALITY[v.resolved].label})</small>` : '';
    document.getElementById('settings-body').innerHTML = `
      <section><h3>Graphics</h3>
        <div class="set-row"><label>Quality${auto}</label>${seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}</div>
        <p class="set-note">Low turns off ambient occlusion, bloom and antialiasing and thins the grass — use it on laptops without a dedicated GPU.</p>
      </section>
      <section><h3>Audio</h3>
        <div class="set-row"><label>Master volume</label>${slider('volume', 0, 1, 0.05)}</div>
        <div class="set-row"><label>Ambient music</label>${slider('ambience', 0, 1, 0.05)}</div>
      </section>
      <section><h3>Controls</h3>
        <div class="set-row"><label>Mouse sensitivity</label>${slider('sensitivity', 0.3, 2.5, 0.05)}</div>
        <div class="set-row"><label>Invert camera tilt</label>${toggle('invertY')}</div>
      </section>
      <section><h3>Challenge</h3>
        <div class="set-row"><label>Scholar wards <small>resisted elements do no damage at all</small></label>${toggle('scholar')}</div>
        <p class="set-note">Off (default): a resisted element still chips a quarter of its damage, so you can always grind through — slowly. On: every fight is a strict elemental puzzle.</p>
      </section>
      <section><h3>Comfort</h3>
        <div class="set-row"><label>Camera shake</label>${toggle('cameraShake')}</div>
        <div class="set-row"><label>On-screen tips &amp; key hints</label>${toggle('showHints')}</div>
      </section>`;
    const body = document.getElementById('settings-body');
    body.querySelectorAll('.seg button').forEach((b) => { b.onclick = () => { this.set(b.parentElement.dataset.key, b.dataset.val); this.game.audio.play('ui'); this.render(); }; });
    body.querySelectorAll('input[type=range]').forEach((r) => { r.oninput = () => this.set(r.dataset.key, +r.value); });
    body.querySelectorAll('.toggle').forEach((t) => { t.onclick = () => { this.set(t.dataset.key, !this.v[t.dataset.key]); this.game.audio.play('ui'); this.render(); }; });
  }
}
