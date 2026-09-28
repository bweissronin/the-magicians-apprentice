// Fully synthesised audio: every sound is built from oscillators + filtered noise.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    // A cheap convolution-free "reverb": feedback delay network.
    this.verb = this.ctx.createDelay(1.0);
    this.verb.delayTime.value = 0.23;
    const fb = this.ctx.createGain(); fb.gain.value = 0.38;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    this.verb.connect(lp); lp.connect(fb); fb.connect(this.verb);
    const wet = this.ctx.createGain(); wet.gain.value = 0.35;
    lp.connect(wet); wet.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise();
    this.master.gain.value = 0.55 * (this.volume ?? 1);
    this.startAmbience();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  makeNoise() {
    const len = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  out(node, wet = 0.4) {
    node.connect(this.master);
    if (wet > 0) {
      const g = this.ctx.createGain(); g.gain.value = wet;
      node.connect(g); g.connect(this.verb);
    }
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, attack = 0.01, when = 0, slide = 0, wet = 0.4 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); this.out(g, wet);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, { freq = 1200, q = 1, vol = 0.3, type = 'bandpass', when = 0, sweep = 0, wet = 0.2 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); this.out(g, wet);
    s.start(t); s.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx) return;
    const r = Math.random;
    switch (name) {
      // Harvesting is magical: shimmering chimes with a soft hint of the material underneath.
      case 'chop': this.tone(587 + r() * 90, 0.35, { vol: 0.07, type: 'triangle', slide: 1.25 }); this.noise(0.18, { freq: 900, q: 1.5, vol: 0.12, sweep: 1.8 }); break;
      case 'quarry': this.tone(440 + r() * 60, 0.35, { vol: 0.07, type: 'sine', slide: 1.5 }); this.noise(0.15, { freq: 3200, q: 3, vol: 0.1, sweep: 0.6 }); break;
      case 'attune': this.tone(880 + r() * 200, 0.4, { vol: 0.07, type: 'sine' }); this.tone(1320, 0.3, { vol: 0.04, when: 0.05 }); break;
      case 'distill': this.tone(520 + r() * 80, 0.35, { vol: 0.08, type: 'triangle', slide: 1.5 }); break;
      case 'collect': [0, 0.07, 0.14].forEach((w, i) => this.tone([660, 880, 1175][i], 0.25, { vol: 0.08, when: w })); break;
      case 'bolt': this.tone(900, 0.25, { type: 'sawtooth', vol: 0.06, slide: 0.3, wet: 0.3 }); this.noise(0.2, { freq: 3000, sweep: 0.2, vol: 0.12 }); break;
      case 'impact': this.noise(0.3, { freq: 800, sweep: 0.3, vol: 0.3, type: 'lowpass' }); this.tone(220, 0.3, { type: 'triangle', vol: 0.1, slide: 0.5 }); break;
      case 'blink': this.tone(300, 0.35, { type: 'sine', vol: 0.12, slide: 4 }); this.noise(0.3, { freq: 5000, sweep: 0.3, vol: 0.12 }); break;
      case 'nova': this.tone(110, 1.2, { type: 'sawtooth', vol: 0.12, slide: 0.5 }); this.noise(1.0, { freq: 400, sweep: 8, vol: 0.3, type: 'lowpass', wet: 0.6 });
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.8, { vol: 0.06, when: i * 0.05 })); break;
      case 'wispDie': this.tone(700, 0.5, { type: 'triangle', vol: 0.1, slide: 0.25 }); this.noise(0.4, { freq: 1500, vol: 0.15 }); break;
      case 'drain': this.tone(160, 0.5, { type: 'sawtooth', vol: 0.1, slide: 0.5, wet: 0.5 }); break;
      case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => { this.tone(f, 0.9, { vol: 0.1, when: i * 0.09, type: 'triangle' }); this.tone(f * 2, 0.6, { vol: 0.03, when: i * 0.09 }); }); break;
      case 'build': this.noise(1.6, { freq: 200, vol: 0.5, type: 'lowpass', sweep: 0.5, wet: 0.5 }); [262, 330, 392, 523].forEach((f, i) => this.tone(f, 1.4, { vol: 0.08, when: 0.4 + i * 0.12, type: 'triangle' })); break;
      case 'rune': this.tone(400 + r() * 50, 0.2, { vol: 0.08 }); break;
      case 'error': this.tone(180, 0.25, { type: 'square', vol: 0.06, slide: 0.7, wet: 0.1 }); break;
      case 'solve': [392, 494, 587, 784, 988].forEach((f, i) => this.tone(f, 1.2, { vol: 0.09, when: i * 0.11, type: 'sine' })); break;
      case 'ui': this.tone(1200, 0.06, { vol: 0.04, wet: 0 }); break;
      case 'step': this.noise(0.05, { freq: 500 + r() * 200, q: 0.8, vol: 0.06, wet: 0 }); break;
      case 'talk': this.tone(200 + r() * 60, 0.08, { type: 'triangle', vol: 0.04, wet: 0 }); break;
      case 'ascend': [262, 330, 392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 2.5, { vol: 0.08, when: i * 0.18, type: 'triangle' })); this.noise(3, { freq: 300, sweep: 10, vol: 0.2, type: 'lowpass', wet: 0.8 }); break;
    }
  }

  // Ambient pad in D dorian, gently breathing via an LFO on the filter.
  startAmbience() {
    const c = this.ctx;
    const pad = c.createGain(); pad.gain.value = 0.0;
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05;
    const lfoGain = c.createGain(); lfoGain.gain.value = 350;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency); lfo.start();
    [73.4, 110, 146.8, 174.6, 220].forEach((f, i) => {
      const o = c.createOscillator(); o.type = i % 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      const g = c.createGain(); g.gain.value = i < 2 ? 0.05 : 0.025;
      o.connect(g); g.connect(filt); o.start();
    });
    filt.connect(pad); this.out(pad, 0.6);
    pad.gain.linearRampToValueAtTime(0.35 * (this.ambience ?? 1), c.currentTime + 6);
    this.pad = pad;
    // Occasional twinkling chimes.
    const scale = [587, 659, 698, 784, 880, 988, 1175];
    const chime = () => {
      if (this.enabled) this.tone(scale[Math.floor(Math.random() * scale.length)], 2.5, { vol: 0.025, attack: 0.3, wet: 0.9 });
      setTimeout(chime, 2500 + Math.random() * 6000);
    };
    setTimeout(chime, 3000);
  }

  // Master and ambient-pad levels (0..1) from the Settings panel.
  setVolume(master, ambience) {
    this.volume = master; this.ambience = ambience;
    if (!this.master) return;
    this.master.gain.value = this.enabled ? 0.55 * master : 0;
    if (this.pad) this.pad.gain.cancelScheduledValues(this.ctx.currentTime), this.pad.gain.value = 0.35 * ambience;
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55 * (this.volume ?? 1);
  }
}
