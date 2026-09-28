// Place-by-place ambience, synthesised like everything else in audio.js. Each place has a bed of
// looping filtered noise (wind, rumble, cave hum) that crossfades as you travel, plus occasional
// one-shot sounds that belong there: birdsong by day and crickets at night in the valley, crows
// and a far-off bell in the Crypt, drips in the Deep, cracking ice in the Hollow, bubbling lava
// in the Caldera. Levels follow the "Ambient music" setting.

// Continuous layers: [filter type, centre Hz, Q, LFO rate Hz, LFO depth Hz, gain in each place].
const BEDS = {
  breeze: { type: 'bandpass', freq: 520, q: 0.6, lfo: 0.07, depth: 260, at: { valley: 0.05, necromancy: 0.03, interior: 0 } },
  gale:   { type: 'bandpass', freq: 700, q: 3.5, lfo: 0.11, depth: 420, at: { cryomancy: 0.09 } },
  moan:   { type: 'bandpass', freq: 260, q: 5, lfo: 0.05, depth: 90, at: { necromancy: 0.05 } },
  rumble: { type: 'lowpass', freq: 110, q: 0.7, lfo: 0.2, depth: 40, at: { pyromancy: 0.22, geomancy: 0.06 } },
  cave:   { type: 'lowpass', freq: 300, q: 1.2, lfo: 0.03, depth: 80, at: { geomancy: 0.07, interior: 0.025 } },
};

export class Soundscape {
  constructor(audio) {
    this.audio = audio;
    this.beds = null;
    this.place = null;
    this.t = 0;
  }

  // Build the looping layers the first time the audio context exists (it needs a user gesture).
  build() {
    const a = this.audio, c = a.ctx;
    const loop = c.createBuffer(1, c.sampleRate * 4, c.sampleRate), d = loop.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.beds = {};
    for (const [name, b] of Object.entries(BEDS)) {
      const src = c.createBufferSource(); src.buffer = loop; src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.4; // decorrelate the layers
      const f = c.createBiquadFilter(); f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q;
      const lfo = c.createOscillator(); lfo.frequency.value = b.lfo;
      const lg = c.createGain(); lg.gain.value = b.depth;
      lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); a.out(g, 0.3); src.start();
      this.beds[name] = g;
    }
  }

  // place: 'valley' | a realm id | 'interior'; night: 0..1.
  update(dt, place, night) {
    const a = this.audio;
    if (!a.ctx || !a.enabled) return;
    if (!this.beds) this.build();
    const level = a.ambience ?? 1;
    if (place !== this.place || Math.abs((this.level ?? -1) - level) > 0.01) {
      this.place = place; this.level = level;
      const now = a.ctx.currentTime;
      for (const [name, b] of Object.entries(BEDS)) this.beds[name].gain.setTargetAtTime((b.at[place] || 0) * level, now, 1.8);
    }
    // One-shots: roughly `rate` per second, rolled every quarter second.
    if ((this.t -= dt) > 0) return;
    this.t = 0.25;
    const roll = (rate) => Math.random() < rate * 0.25;
    const r = Math.random, v = level;
    if (place === 'valley') {
      if (night < 0.4 && roll(0.35)) this.bird(v);
      if (night > 0.6 && roll(1.2)) this.cricket(v);
      if (night > 0.7 && roll(0.04)) this.owl(v);
    } else if (place === 'necromancy') {
      if (roll(0.08)) this.crow(v);
      if (roll(0.025)) a.tone(196, 4.5, { vol: 0.03 * v, attack: 0.01, wet: 1, type: 'sine' }), a.tone(392 * 1.01, 3, { vol: 0.012 * v, wet: 1 });
    } else if (place === 'geomancy') {
      if (roll(0.5)) this.drip(v);
    } else if (place === 'cryomancy') {
      if (roll(0.06)) a.tone(70 + r() * 40, 1.2, { type: 'sawtooth', vol: 0.012 * v, slide: 1.5, attack: 0.05, wet: 0.7 });
      if (roll(0.15)) a.noise(0.6, { freq: 5000, q: 1, vol: 0.02 * v, type: 'highpass', wet: 0.5 });
    } else if (place === 'pyromancy') {
      if (roll(2.5)) a.noise(0.03, { freq: 1800 + r() * 2000, q: 0.6, vol: (0.02 + r() * 0.04) * v, wet: 0.1 });
      if (roll(0.3)) a.tone(90 + r() * 60, 0.25, { vol: 0.05 * v, slide: 1.8, wet: 0.4 });
    } else if (place === 'interior') {
      if (roll(1.2)) a.noise(0.025, { freq: 2500 + r() * 1500, q: 0.7, vol: 0.012 * v, wet: 0.1 }); // a hearth, crackling
    }
  }

  bird(v) {
    const a = this.audio, base = 2600 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) a.tone(base * (1 + (Math.random() - 0.5) * 0.15), 0.07 + Math.random() * 0.05, { vol: 0.022 * v, when: i * 0.11, slide: 1.3 + Math.random() * 0.4, wet: 0.5 });
  }

  cricket(v) {
    const a = this.audio, f = 4200 + Math.random() * 500;
    for (let i = 0; i < 3; i++) a.tone(f, 0.03, { type: 'triangle', vol: 0.009 * v, when: i * 0.05, wet: 0.2 });
  }

  owl(v) {
    const a = this.audio;
    a.tone(390, 0.35, { vol: 0.035 * v, slide: 0.9, attack: 0.05, wet: 0.8 });
    a.tone(360, 0.5, { vol: 0.03 * v, slide: 0.88, attack: 0.05, when: 0.45, wet: 0.8 });
  }

  crow(v) {
    const a = this.audio;
    for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
      a.noise(0.18, { freq: 950, q: 4, vol: 0.05 * v, when: i * 0.3, wet: 0.6 });
      a.tone(620, 0.18, { type: 'sawtooth', vol: 0.012 * v, slide: 0.75, when: i * 0.3, wet: 0.6 });
    }
  }

  drip(v) {
    const a = this.audio, f = 1100 + Math.random() * 900;
    a.tone(f, 0.12, { vol: 0.035 * v, slide: 1.9, wet: 1 });
    if (Math.random() < 0.4) a.tone(f * 1.4, 0.08, { vol: 0.015 * v, slide: 1.6, when: 0.18, wet: 1 });
  }
}
