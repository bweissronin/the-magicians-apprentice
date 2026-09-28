// Puzzles for the Sundered Deep (Geomancy). Both are verified by exhaustive search at
// generation time: the Boulder Run is BFS-solved over every boulder arrangement, and the
// Strata Lock is checked to have exactly one alignment that joins the ore seam.
import { PuzzleUI } from './puzzles.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const DIR = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const ARROW = { up: '↑', right: '→', down: '↓', left: '←' };
const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };

Object.assign(PuzzleUI.prototype, {
  // ================= GEOMANCY =================
  // Boulder Run: a shoved boulder rolls until a pillar, another boulder or the wall stops it.
  // Cover every pressure plate at once. Levels are BFS-solved over boulder arrangements.
  boulders(difficulty, token, resetBtn) {
    const hard = difficulty > 1, N = hard ? 8 : 7, K = hard ? 3 : 2, minNeed = hard ? 6 : 4;
    const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    // Roll the boulder at c over an occupancy grid (pillars + boulders); returns its resting cell.
    const roll = (occ, c, [dx, dy]) => {
      let x = c % N, y = (c / N) | 0;
      while (inside(x + dx, y + dy) && !occ[(y + dy) * N + x + dx]) { x += dx; y += dy; }
      return y * N + x;
    };
    const occOf = (walls, pos) => { const o = new Uint8Array(N * N); walls.forEach((c) => (o[c] = 1)); pos.forEach((c) => (o[c] = 1)); return o; };
    const keyOf = (pos) => [...pos].sort((a, b) => a - b).reduce((k, c) => k * 64 + c, 0);
    // BFS over (unordered) boulder arrangements; `goal(pos)` stops early. Returns path of [boulder, dir].
    const search = (walls, start, goal, onLayer) => {
      const seen = new Map([[keyOf(start), null]]);
      let layer = [start];
      for (let depth = 0; layer.length; depth++) {
        onLayer?.(layer, depth);
        const next = [];
        for (const pos of layer) {
          if (goal?.(pos)) {
            const path = [];
            for (let k = keyOf(pos); seen.get(k); k = seen.get(k).from) path.unshift(seen.get(k).move);
            return path;
          }
          const occ = occOf(walls, pos);
          pos.forEach((c, i) => {
            occ[c] = 0;
            for (const d in DIR) {
              const to = roll(occ, c, DIR[d]);
              if (to === c) continue;
              const np = pos.slice(); np[i] = to;
              const k = keyOf(np);
              if (!seen.has(k)) { seen.set(k, { from: keyOf(pos), move: [i, d] }); next.push(np); }
            }
            occ[c] = 1;
          });
        }
        layer = next;
      }
      return null;
    };
    // Generate: random pillars + boulders, explore everything, put the plates on a far arrangement.
    let walls, startPos, plates, need;
    for (let tries = 0; ; tries++) {
      walls = new Set();
      while (walls.size < Math.round(N * N * (hard ? 0.13 : 0.14))) walls.add(Math.floor(Math.random() * N * N));
      startPos = [];
      while (startPos.length < K) { const c = Math.floor(Math.random() * N * N); if (!walls.has(c) && !startPos.includes(c)) startPos.push(c); }
      const layers = [];
      search(walls, startPos, null, (layer, depth) => (layers[depth] = layer));
      const maxD = layers.length - 1;
      if (maxD < minNeed) continue;
      const fresh = (pos) => pos.every((c) => !startPos.includes(c)); // every boulder must actually travel
      for (let d = Math.min(maxD, minNeed + 2 + Math.floor(Math.random() * 4)); d >= minNeed && !plates; d--) {
        const opts = layers[d].filter(fresh);
        if (opts.length) { plates = pick(opts).slice(); need = d; }
      }
      if (plates) break;
    }
    const plateSet = new Set(plates);
    let pos = startPos.slice(), spin = pos.map(() => 0), sel = 0, moves = 0, done = false;
    const history = [];
    const covered = () => plates.filter((p) => pos.includes(p)).length;
    // QA hook: BFS from the current arrangement, then play it through real clicks on boulder + arrow.
    this.autoSolve = () => {
      const path = search(walls, pos.slice(), (p) => plates.every((c) => p.includes(c))) || [];
      path.forEach(([i, d]) => {
        this.board.querySelector(`.bd-boulder[data-b="${i}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        this.board.querySelector(`.bd-pad [data-d="${d}"]`).click();
      });
    };

    // ---- Board art (static layer drawn once; boulders move by CSS transform) ----
    const U = 100, at = (c) => [(c % N) * U + U / 2, ((c / N) | 0) * U + U / 2];
    const floorTones = ['#3b2f25', '#413328', '#372b22', '#3e3127', '#44362a'];
    let art = '';
    for (let c = 0; c < N * N; c++) {
      const x = (c % N) * U, y = ((c / N) | 0) * U;
      art += `<rect x="${x + 2}" y="${y + 2}" width="${U - 4}" height="${U - 4}" rx="9" fill="${pick(floorTones)}"/>`;
      if (Math.random() < 0.35) { const sx = x + rnd(20, 80), sy = y + rnd(15, 45); art += `<path class="bd-crack" d="M${sx} ${sy} l${rnd(-14, 14)} ${rnd(10, 20)} l${rnd(-12, 12)} ${rnd(10, 22)}"/>`; }
    }
    // Faint mine rails along a couple of rows and columns (decoration only).
    const rails = [];
    const rowsR = new Set([Math.floor(Math.random() * N), Math.floor(Math.random() * N)]);
    const colsR = new Set([Math.floor(Math.random() * N)]);
    rowsR.forEach((r) => { for (let x = 0; x < N; x++) if (!walls.has(r * N + x)) rails.push([x * U, r * U + U / 2, 1]); });
    colsR.forEach((cl) => { for (let y = 0; y < N; y++) if (!walls.has(y * N + cl)) rails.push([cl * U + U / 2, y * U, 0]); });
    art += `<g class="bd-rails">${rails.map(([x, y, h]) => h
      ? `<path d="M${x + 16} ${y - 18}v36M${x + 50} ${y - 18}v36M${x + 84} ${y - 18}v36" class="tie"/><path d="M${x} ${y - 11}h${U}M${x} ${y + 11}h${U}"/>`
      : `<path d="M${x - 18} ${y + 16}h36M${x - 18} ${y + 50}h36M${x - 18} ${y + 84}h36" class="tie"/><path d="M${x - 11} ${y}v${U}M${x + 11} ${y}v${U}"/>`).join('')}</g>`;
    art += plates.map((p) => { const [x, y] = at(p); return `<g class="bd-plate" data-p="${p}" transform="translate(${x} ${y})"><rect x="-34" y="-34" width="68" height="68" rx="12"/><path d="M0 -17 L17 0 L0 17 L-17 0Z" class="rune"/></g>`; }).join('');
    art += [...walls].map((c) => {
      const [x, y] = at(c);
      const pts = Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2 + rnd(-0.2, 0.2), r = rnd(34, 45); return `${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`; }).join(' ');
      return `<ellipse cx="${x + 5}" cy="${y + 34}" rx="38" ry="11" class="bd-shadow"/><polygon points="${pts}" class="bd-pillar"/><path d="M${x - 24} ${y - 14} L${x - 6} ${y - 30} L${x + 14} ${y - 26}" class="bd-pillar-hi"/>`;
    }).join('');
    const boulderSvg = (i) => {
      const cracks = Array.from({ length: 2 }, () => `M${rnd(-20, 5).toFixed(0)} ${rnd(-24, -6).toFixed(0)} l${rnd(6, 14).toFixed(0)} ${rnd(8, 14).toFixed(0)} l${rnd(-4, 10).toFixed(0)} ${rnd(8, 16).toFixed(0)}`).join('');
      return `<g class="bd-boulder" data-b="${i}" tabindex="0" role="button" aria-label="Boulder ${i + 1}">
        <ellipse cx="6" cy="32" rx="34" ry="10" class="bd-shadow"/>
        <circle r="46" class="bd-ring"/>
        <g class="bd-spin"><circle r="37" class="bd-rock"/><path d="${cracks}" class="bd-rock-crack"/>
          <circle cx="14" cy="-8" r="3" class="bd-fleck"/><circle cx="-12" cy="16" r="2.5" class="bd-fleck"/><circle cx="18" cy="18" r="2" class="bd-fleck"/></g>
        <ellipse cx="-12" cy="-15" rx="13" ry="8" class="bd-shine"/>
      </g>`;
    };
    const arrowsSvg = Object.entries(DIR).map(([d, [dx, dy]]) => `<g class="bd-arrow" data-d="${d}" transform="translate(${dx * 68} ${dy * 68}) rotate(${{ up: 0, right: 90, down: 180, left: 270 }[d]})"><circle r="17"/><path d="M-8 4 L0 -5 L8 4"/></g>`).join('');
    const S = hard ? 46 : 52;
    this.board.innerHTML = `
      <div class="boulders">
        <svg class="bd-svg" viewBox="0 0 ${N * U} ${N * U}" width="${N * S}" height="${N * S}">
          <defs>
            <radialGradient id="bd-rockg" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="#cdb38c"/><stop offset="0.55" stop-color="#8a6e50"/><stop offset="1" stop-color="#3e2f22"/></radialGradient>
            <radialGradient id="bd-pillarg" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#7d7268"/><stop offset="1" stop-color="#2c2622"/></radialGradient>
            <filter id="bd-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${Math.floor(Math.random() * 99)}"/><feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.07  0 0 0 0 0.04  0 0 0 0.55 -0.12"/></filter>
          </defs>
          <rect width="${N * U}" height="${N * U}" class="bd-bed"/>
          ${art}
          <rect width="${N * U}" height="${N * U}" filter="url(#bd-grain)" class="bd-grainlayer"/>
          ${pos.map((_, i) => boulderSvg(i)).join('')}
          <g class="bd-arrows">${arrowsSvg}</g>
        </svg>
        <div class="bd-side">
          <div class="bd-pad">${['up', 'left', 'right', 'down'].map((d) => `<button class="btn sm" data-d="${d}" aria-label="Shove ${d}">${ARROW[d]}</button>`).join('')}</div>
          <p class="hint">Click a boulder (or press ${pos.map((_, i) => i + 1).join('/')}), then shove it with the arrows, arrow keys or WASD. <kbd>Z</kbd> undoes.</p>
        </div>
      </div>`;
    resetBtn.insertAdjacentHTML('afterend', '<button class="btn ghost" data-act="undo">Undo</button>');
    const undoBtn = this.el.querySelector('[data-act=undo]');
    const svg = this.board.querySelector('.bd-svg');
    const gs = [...svg.querySelectorAll('.bd-boulder')];
    const arrows = svg.querySelector('.bd-arrows');
    const padBtns = [...this.board.querySelectorAll('.bd-pad button')];
    const plateEls = [...svg.querySelectorAll('.bd-plate')];

    const canRoll = (i, d) => { const occ = occOf(walls, pos); occ[pos[i]] = 0; return roll(occ, pos[i], DIR[d]) !== pos[i]; };
    const place = (secs) => {
      const ease = `${secs}s cubic-bezier(.3, .05, .45, 1)`;
      gs.forEach((g, i) => {
        const [x, y] = at(pos[i]);
        g.style.transition = `transform ${ease}`;
        g.style.transform = `translate(${x}px, ${y}px)`;
        const s = g.querySelector('.bd-spin');
        s.style.transition = `transform ${ease}`;
        s.style.transform = `rotate(${spin[i]}deg)`;
        g.classList.toggle('sel', i === sel && !done);
      });
      const [ax, ay] = at(pos[sel]);
      arrows.style.transition = `transform ${ease}, opacity .2s`;
      arrows.style.transform = `translate(${ax}px, ${ay}px)`;
      arrows.classList.toggle('off', done);
      Object.keys(DIR).forEach((d) => {
        const ok = !done && canRoll(sel, d);
        arrows.querySelector(`[data-d="${d}"]`).classList.toggle('blocked', !ok);
        this.board.querySelector(`.bd-pad [data-d="${d}"]`).disabled = !ok;
      });
      undoBtn.disabled = done || !history.length;
    };
    const lightPlates = () => plateEls.forEach((p) => p.classList.toggle('on', pos.includes(+p.dataset.p)));
    const status = () => {
      this.status.textContent = `${covered()} / ${K} plates pressed · ${moves} moves · the run can be done in ${need}`;
    };
    const render = (secs = 0) => {
      place(secs);
      status();
      clearTimeout(this.bdTimer);
      if (secs) this.bdTimer = setTimeout(() => this.active === token && lightPlates(), secs * 1000 * 0.85);
      else lightPlates();
    };
    const select = (i) => { if (done || i === sel || i < 0 || i >= K) return; sel = i; this.audio.play('ui'); place(0.12); };
    const shove = (d) => {
      if (this.active !== token || done) return;
      const occ = occOf(walls, pos); occ[pos[sel]] = 0;
      const from = pos[sel], to = roll(occ, from, DIR[d]);
      if (to === from) { this.audio.play('error'); return; }
      const dist = Math.abs((to % N) - (from % N)) + Math.abs(((to / N) | 0) - ((from / N) | 0));
      history.push({ pos: pos.slice(), spin: spin.slice(), sel });
      pos[sel] = to; spin[sel] += dist * 75 * (d === 'left' || d === 'up' ? -1 : 1); moves++;
      const secs = 0.12 + dist * 0.08;
      this.audio.noise(secs + 0.1, { freq: 180, q: 0.7, vol: 0.22, type: 'lowpass', sweep: 0.6 });
      const willCover = plateSet.has(to);
      if (willCover) this.audio.tone(330, 0.5, { vol: 0.08, type: 'triangle', when: secs * 0.85 });
      done = plates.every((p) => pos.includes(p));
      render(secs);
      if (done) setTimeout(() => this.solved(token), secs * 1000);
    };
    gs.forEach((g, i) => {
      g.addEventListener('click', () => select(i));
      g.addEventListener('focus', () => select(i));
    });
    arrows.querySelectorAll('.bd-arrow').forEach((a) => a.addEventListener('click', () => shove(a.dataset.d)));
    padBtns.forEach((b) => { b.onclick = () => shove(b.dataset.d); });
    const undo = () => {
      if (done || !history.length || this.active !== token) return;
      const h = history.pop(); pos = h.pos; spin = h.spin; sel = h.sel; moves++;
      this.audio.play('ui'); render(0.25);
    };
    undoBtn.onclick = undo;
    this.keyHandler = (e) => {
      if (KEYS[e.code]) { e.preventDefault(); shove(KEYS[e.code]); }
      else if (/^Digit[1-9]$/.test(e.code)) select(+e.code.slice(5) - 1);
      else if (e.code === 'KeyZ' || e.code === 'Backspace') { e.preventDefault(); undo(); }
    };
    addEventListener('keydown', this.keyHandler);
    resetBtn.onclick = () => {
      if (done) return;
      pos = startPos.slice(); spin = pos.map(() => 0); sel = 0; moves = 0; history.length = 0;
      this.audio.play('ui'); render(0.3);
    };
    render();
  },

  // Strata Lock: slide wrapping layers of rock until the ore veins form one seam from the top
  // marker to the bottom marker. Built from a real seam, padded with dead-end decoys and extra
  // through-veins, and accepted only when exactly one alignment joins the seam.
  strata(difficulty, token, resetBtn) {
    const hard = difficulty > 1, L = hard ? 6 : 5, W = hard ? 7 : 6;
    const mod = (v) => ((v % W) + W) % W;
    // A layer's segments: { a: top column, k: kink (-1/0/1), kind: 'full' | 'top' (dead end) | 'bot' (rises from the bottom) | 'fleck' }
    const countSolutions = (layers, T, B) => {
      let n = 0;
      const go = (r, x) => { if (r === L) { if (x === B) n++; return; } for (const s of layers[r]) if (s.kind === 'full') go(r + 1, mod(x + s.k)); };
      go(0, T);
      return n;
    };
    let layers, T, B;
    const extras = hard ? 4 : 2;
    for (let tries = 0; tries < 2000; tries++) {
      T = Math.floor(Math.random() * W);
      layers = [];
      let x = T;
      for (let r = 0; r < L; r++) {
        const k = pick([-1, -1, 0, 1, 1]);
        layers.push([{ a: x, k, kind: 'full' }]);
        x = mod(x + k);
      }
      B = x;
      const tops = layers.map((l) => new Set(l.map((s) => s.a)));
      const bots = layers.map((l) => new Set(l.map((s) => mod(s.a + s.k))));
      const crosses = (r, a, k) => k && layers[r].some((s) => s.kind === 'full' && s.a === mod(a + k) && s.k === -k);
      // Extra through-veins: different kink from the true seam in that layer (same kink = twin solution).
      let placed = 0;
      for (let guard = 0; placed < extras && guard < 60; guard++) {
        const r = Math.floor(Math.random() * L), a = Math.floor(Math.random() * W), k = pick([-1, 0, 1]);
        if (tops[r].has(a) || bots[r].has(mod(a + k)) || layers[r].some((s) => s.kind === 'full' && s.k === k) || crosses(r, a, k)) continue;
        layers[r].push({ a, k, kind: 'full' }); tops[r].add(a); bots[r].add(mod(a + k)); placed++;
      }
      if (placed < extras || countSolutions(layers, T, B) !== 1) continue;
      // Dead-end decoys: veins that fizzle out mid-rock, from above or below, plus loose flecks.
      layers.forEach((l, r) => {
        for (let a = 0; a < W; a++) {
          if (!tops[r].has(a) && Math.random() < 0.4) { l.push({ a, k: pick([-1, 0, 1]), kind: 'top' }); tops[r].add(a); }
          if (!bots[r].has(a) && Math.random() < 0.3) { l.push({ a, k: pick([-1, 0, 1]), kind: 'bot' }); bots[r].add(a); }
        }
        if (Math.random() < 0.5) l.push({ a: Math.floor(Math.random() * W), k: pick([-1, 1]), kind: 'fleck' });
      });
      break;
    }
    const off = layers.map(() => 1 + Math.floor(Math.random() * (W - 1))); // solution is all-zero
    const vis = off.slice(); // unbounded visual offset for smooth wrapping slides
    const start = off.slice();
    let moves = 0, sel = 0, done = false;
    // QA hook: slide each layer home the short way round, through the real arrow buttons.
    this.autoSolve = () => off.slice().forEach((o, r) => {
      const [d, n] = o <= W / 2 ? [-1, o] : [1, W - o];
      for (let i = 0; i < n; i++) this.board.querySelector(`.st-row[data-r="${r}"] [data-d="${d}"]`).click();
    });
    // Follow the seam down from the top marker; returns the lit segments and whether it lands on B.
    const trace = () => {
      const lit = []; let x = T, r = 0;
      for (; r < L; r++) {
        const i = layers[r].findIndex((s) => (s.kind === 'full' || s.kind === 'top') && mod(s.a + off[r]) === x);
        if (i < 0) break;
        lit.push([r, i]);
        if (layers[r][i].kind === 'top') break;
        x = mod(x + layers[r][i].k);
      }
      return { lit, joined: lit.filter(([r2, i]) => layers[r2][i].kind === 'full').length, win: r === L && x === B };
    };

    // ---- Art: each layer is a wrapping SVG strip, drawn 5× side by side and slid by transform ----
    const TW = hard ? 54 : 60, U = 100, SW = W * U;
    const tones = ['#8a6a4a', '#a88a64', '#6a5a4a', '#9a7a58', '#7a6048', '#b0926a'];
    const vein = (s) => {
      const x0 = s.a * U + U / 2, x1 = x0 + s.k * U, w = rnd(-10, 10);
      if (s.kind === 'full') return s.k ? `M${x0} 0 C${x0} 46 ${x1} 54 ${x1} 100` : `M${x0} 0 C${x0 + 14 + w} 34 ${x0 - 14 - w} 66 ${x0} 100`;
      if (s.kind === 'top') return `M${x0} 0 C${x0} 22 ${x0 + s.k * 30} 30 ${x0 + s.k * 38 + w} ${rnd(46, 58)}`;
      if (s.kind === 'bot') return `M${x0} 100 C${x0} 78 ${x0 + s.k * 30} 70 ${x0 + s.k * 38 + w} ${rnd(42, 54)}`;
      const y = rnd(34, 66); return `M${x0 - 22} ${y} Q${x0} ${y + s.k * 16} ${x0 + 24} ${y - s.k * 6}`;
    };
    const strip = (r) => {
      const l = layers[r];
      let body = `<rect width="${SW}" height="${U}" fill="${tones[r % tones.length]}"/>`;
      // Periodic sediment lines (integer cycles per strip so the wrap is seamless) and speckle.
      for (let j = 0; j < 3; j++) {
        const y0 = 18 + j * 30 + rnd(-6, 6), amp = rnd(2, 6), cyc = 1 + Math.floor(Math.random() * 3), ph = rnd(0, 6.28);
        let d = '';
        for (let px = 0; px <= SW; px += 20) d += `${px ? 'L' : 'M'}${px} ${(y0 + Math.sin((px / SW) * cyc * 6.283 + ph) * amp).toFixed(1)}`;
        body += `<path d="${d}" class="st-sediment ${j % 2 ? 'dk' : ''}"/>`;
      }
      for (let j = 0; j < W * 7; j++) body += `<circle cx="${rnd(0, SW).toFixed(0)}" cy="${rnd(6, 94).toFixed(0)}" r="${rnd(1, 3).toFixed(1)}" class="st-speck ${j % 3 ? '' : 'lt'}"/>`;
      for (let c = 1; c <= W; c++) body += `<path d="M${c * U + rnd(-4, 4)} 0 l${rnd(-5, 5)} 40 l${rnd(-4, 4)} 60" class="st-joint"/>`;
      body += l.map((s, i) => { const d = vein(s); return `<g class="st-vein" data-s="${i}"><path d="${d}" class="bed"/><path d="${d}" class="glow"/><path d="${d}" class="core"/></g>`; }).join('');
      // Every copy shares identical geometry: build once, stamp at -2W..+2W.
      return [-2, -1, 0, 1, 2].map((k) => `<g transform="translate(${k * SW} 0)">${body}</g>`).join('');
    };
    const marker = (c, bottom) => `<div class="st-mark-row">${Array.from({ length: W }, (_, i) => `<span class="${i === c ? `st-mark ${bottom ? 'bottom' : 'top'}` : ''}">${i === c ? `<svg viewBox="0 0 40 40"><path d="M20 3 L31 20 L20 37 L9 20Z"/><circle cx="20" cy="20" r="4"/></svg>` : ''}</span>`).join('')}</div>`;
    this.board.innerHTML = `
      <div class="strata" style="--w:${W};--tw:${TW}px">
        <span></span>${marker(T, false)}<span></span>
        ${layers.map((_, r) => `<div class="st-row${r === 0 ? ' first' : ''}${r === L - 1 ? ' last' : ''}" data-r="${r}">
          <button class="btn sm" data-d="-1" aria-label="Slide layer ${r + 1} left">◀</button>
          <div class="st-band"><svg viewBox="0 0 ${SW} ${U}" preserveAspectRatio="none"><g class="st-strip">${strip(r)}</g></svg></div>
          <button class="btn sm" data-d="1" aria-label="Slide layer ${r + 1} right">▶</button></div>`).join('')}
        <span></span>${marker(B, true)}<span></span>
        <p class="hint">Drag a layer or use its arrows. ↑/↓ picks a layer, ←/→ slides it.</p>
      </div>`;
    const rows = [...this.board.querySelectorAll('.st-row')];
    const strips = rows.map((row) => row.querySelector('.st-strip'));
    const bottomMark = this.board.querySelector('.st-mark.bottom');
    let lastJoined = 0;
    const render = () => {
      strips.forEach((g, r) => { g.style.transform = `translateX(${vis[r] * U}px)`; });
      rows.forEach((row, r) => row.classList.toggle('sel', r === sel && !done));
      const { lit, joined, win } = trace();
      this.board.querySelectorAll('.st-vein.lit').forEach((v) => v.classList.remove('lit'));
      lit.forEach(([r, i]) => rows[r].querySelectorAll(`.st-vein[data-s="${i}"]`).forEach((v) => v.classList.add('lit')));
      bottomMark.classList.toggle('lit', win);
      this.status.textContent = win ? '' : `${joined} / ${L} layers joined · ${moves} slides`;
      if (joined > lastJoined && moves) this.audio.tone(330 + joined * 70, 0.35, { vol: 0.07, type: 'triangle' });
      lastJoined = joined;
      return win;
    };
    const slide = (r, d) => {
      if (this.active !== token || done) return;
      sel = r;
      // Keep the visual offset within the drawn copies: jump a whole strip-width invisibly first.
      if (Math.abs(vis[r] + d) > W) {
        const g = strips[r]; g.style.transition = 'none';
        vis[r] -= Math.sign(vis[r]) * W; g.style.transform = `translateX(${vis[r] * U}px)`;
        g.getBoundingClientRect(); g.style.transition = '';
      }
      vis[r] += d; off[r] = mod(off[r] + d); moves++;
      this.audio.noise(0.22, { freq: 260, q: 0.8, vol: 0.14, type: 'lowpass', sweep: 0.7 });
      if (render()) {
        done = true;
        this.board.querySelectorAll('.st-row button').forEach((b) => (b.disabled = true));
        rows.forEach((row) => row.classList.remove('sel'));
        setTimeout(() => this.solved(token), 350);
      }
    };
    rows.forEach((row, r) => {
      row.querySelectorAll('button').forEach((b) => { b.onclick = () => slide(r, +b.dataset.d); });
      // Click-drag: every ~2/3 of a tile dragged slides the layer one step.
      const band = row.querySelector('.st-band');
      let x0 = null;
      band.addEventListener('pointerdown', (e) => { if (done) return; x0 = e.clientX; sel = r; band.setPointerCapture(e.pointerId); render(); });
      band.addEventListener('pointermove', (e) => {
        if (x0 === null) return;
        const step = band.clientWidth / W;
        while (e.clientX - x0 > step * 0.66) { x0 += step; slide(r, 1); }
        while (x0 - e.clientX > step * 0.66) { x0 -= step; slide(r, -1); }
      });
      const end = () => { x0 = null; };
      band.addEventListener('pointerup', end); band.addEventListener('pointercancel', end);
    });
    this.keyHandler = (e) => {
      const k = KEYS[e.code];
      if (!k || done) return;
      e.preventDefault();
      if (k === 'up' || k === 'down') { sel = (sel + (k === 'up' ? -1 : 1) + L) % L; render(); }
      else slide(sel, k === 'left' ? -1 : 1);
    };
    addEventListener('keydown', this.keyHandler);
    resetBtn.onclick = () => {
      if (done) return;
      start.forEach((o, r) => { off[r] = o; vis[r] = o; });
      moves = 0; lastJoined = 0; this.audio.play('ui'); render();
    };
    render();
  },
});
