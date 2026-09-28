// Puzzles for the elemental realms. Each is a different *kind* of reasoning from the Arcane
// shrines (memory, lights-out, coupled rings): partition arithmetic, spatial sliding, graph
// connectivity, recursive planning, momentum pathing and optics. Every generator produces a
// guaranteed-solvable instance (scrambled from a solution, or verified by search).
import { PuzzleUI } from './puzzles.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

Object.assign(PuzzleUI.prototype, {
  // ================= NECROMANCY =================
  // Soul Scales: split every bone between two pans so both weigh the same (a partition puzzle).
  scales(difficulty, token, resetBtn) {
    const perSide = 3 + difficulty;
    const left = Array.from({ length: perSide }, () => 2 + Math.floor(Math.random() * 8));
    const total = left.reduce((a, b) => a + b, 0);
    // Right side: same total, different split, so the pairing isn't obvious.
    let right;
    do {
      right = Array.from({ length: perSide }, () => 1);
      for (let rest = total - perSide; rest > 0; rest--) right[Math.floor(Math.random() * perSide)]++;
    } while (right.some((w) => w > 12) || [...right].sort().join() === [...left].sort().join());
    const bones = shuffle([...left, ...right].map((w, i) => ({ id: i, w, side: 0, home: i < perSide ? 1 : 2 }))); // 0 tray, 1 left, 2 right
    // QA hook: place each bone on the pan it was generated for, via real clicks.
    this.autoSolve = () => bones.forEach((b) => { for (let k = 0; k < b.home; k++) this.board.querySelector(`.bone[data-id="${b.id}"]`).click(); });
    this.board.innerHTML = `
      <div class="scales">
        <svg viewBox="0 0 400 190" class="scale-svg">
          <rect x="194" y="40" width="12" height="130" rx="4" class="post"/>
          <path d="M150 178 L250 178 L230 166 L170 166Z" class="post"/>
          <g class="beam"><rect x="60" y="34" width="280" height="10" rx="5" class="beam-bar"/>
            <line x1="80" y1="44" x2="80" y2="92" class="chain"/><line x1="320" y1="44" x2="320" y2="92" class="chain"/>
            <g class="pan-l"><path d="M30 92 Q80 128 130 92Z" class="pan"/><text x="80" y="118" class="pan-sum" data-s="1">0</text></g>
            <g class="pan-r"><path d="M270 92 Q320 128 370 92Z" class="pan"/><text x="320" y="118" class="pan-sum" data-s="2">0</text></g>
          </g>
          <circle cx="200" cy="39" r="12" class="skull-pin"/>
        </svg>
        <div class="bone-rows">
          <div class="bone-row" data-side="1"><span>Left pan</span><div></div></div>
          <div class="bone-row" data-side="0"><span>Bone tray</span><div></div></div>
          <div class="bone-row" data-side="2"><span>Right pan</span><div></div></div>
        </div>
      </div>`;
    const beam = this.board.querySelector('.beam');
    const render = () => {
      this.board.querySelectorAll('.bone-row').forEach((row) => {
        const side = +row.dataset.side, box = row.querySelector('div');
        box.innerHTML = bones.filter((b) => b.side === side).map((b) => `<button class="bone" data-id="${b.id}" title="Move bone">🦴<b>${b.w}</b></button>`).join('') || '<em>empty</em>';
      });
      const sum = (s) => bones.filter((b) => b.side === s).reduce((a, b) => a + b.w, 0);
      const L = sum(1), Rr = sum(2), tray = bones.filter((b) => b.side === 0).length;
      beam.style.transform = `rotate(${Math.max(-14, Math.min(14, (Rr - L) * 1.6))}deg)`;
      this.board.querySelector('[data-s="1"]').textContent = L;
      this.board.querySelector('[data-s="2"]').textContent = Rr;
      this.status.textContent = tray ? `${tray} bone${tray > 1 ? 's' : ''} left in the tray · left ${L} vs right ${Rr}` : L === Rr ? '' : `Left ${L} vs right ${Rr} — the scales still tremble`;
      this.board.querySelectorAll('.bone').forEach((btn) => {
        btn.onclick = () => {
          const b = bones.find((x) => x.id === +btn.dataset.id);
          b.side = b.side === 0 ? 1 : b.side === 1 ? 2 : 0; // tray → left → right → tray
          this.audio.tone(220 + b.w * 30, 0.2, { vol: 0.08, type: 'triangle' });
          render();
        };
      });
      if (!tray && L === Rr && this.active === token) { this.board.querySelectorAll('.bone').forEach((x) => (x.disabled = true)); this.solved(token); }
    };
    resetBtn.onclick = () => { bones.forEach((b) => (b.side = 0)); this.audio.play('ui'); render(); };
    render();
  },

  // Ossuary Seal: classic sliding-tile puzzle; tiles are slices of a painted skull sigil.
  slider(difficulty, token, resetBtn) {
    const N = 3 + (difficulty > 1 ? 1 : 0), S = 300;
    const art = paintSkull(S);
    const solvedOrder = [...Array(N * N).keys()]; // last index is the gap
    let tiles = solvedOrder.slice();
    const gapOf = () => tiles.indexOf(N * N - 1);
    const neighbors = (i) => [i - N, i + N, i % N ? i - 1 : -1, (i + 1) % N ? i + 1 : -1].filter((j) => j >= 0 && j < N * N);
    let prev = -1;
    const walk = [];
    for (let k = 0; k < 40 + difficulty * 40; k++) { // legal random walk from solved
      const g = gapOf(), opts = neighbors(g).filter((j) => j !== prev);
      const j = pick(opts); [tiles[g], tiles[j]] = [tiles[j], tiles[g]]; prev = g; walk.push(g);
    }
    if (tiles.every((t, i) => t === i)) { const g = gapOf(), j = neighbors(g)[0]; [tiles[g], tiles[j]] = [tiles[j], tiles[g]]; walk.push(g); }
    // QA hook: undo the scramble by clicking the tiles back into place in reverse order.
    this.autoSolve = () => [...walk].reverse().forEach((g) => this.board.querySelector(`.tile[data-i="${g}"]`)?.click());
    const start = tiles.slice();
    let moves = 0;
    this.board.innerHTML = `<div class="slider" style="--n:${N};--s:${S}px"></div>`;
    const box = this.board.querySelector('.slider');
    const render = () => {
      box.innerHTML = tiles.map((t, i) => t === N * N - 1 ? `<div class="tile gap"></div>`
        : `<button class="tile" data-i="${i}" style="background-image:url(${art});background-position:${-(t % N) * (S / N)}px ${-Math.floor(t / N) * (S / N)}px"></button>`).join('');
      const placed = tiles.filter((t, i) => t === i && t !== N * N - 1).length;
      this.status.textContent = `${placed} / ${N * N - 1} fragments in place · ${moves} moves`;
      box.querySelectorAll('button.tile').forEach((b) => {
        b.onclick = () => {
          const i = +b.dataset.i, g = gapOf();
          if (!neighbors(g).includes(i)) { this.audio.play('error'); return; }
          [tiles[g], tiles[i]] = [tiles[i], tiles[g]]; moves++;
          this.audio.tone(330, 0.12, { vol: 0.07, type: 'triangle' });
          render();
          if (tiles.every((t, k) => t === k)) this.solved(token);
        };
      });
    };
    resetBtn.onclick = () => { tiles = start.slice(); moves = 0; this.audio.play('ui'); render(); };
    render();
  },

  // ================= PYROMANCY =================
  // Flame Conduit: rotate channel tiles so fire reaches every brazier with no leaks.
  conduit(difficulty, token, resetBtn) {
    const N = 5;
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W → bits 1 2 4 8
    const mask = new Array(N * N).fill(0);
    const src = Math.floor(N / 2) * N; // middle of the left edge
    // Random spanning tree over ~70% of cells.
    const seen = new Set([src]), stack = [src];
    const target = Math.floor(N * N * (0.6 + difficulty * 0.1));
    while (stack.length && seen.size < target) {
      const c = stack[stack.length - 1], x = c % N, y = Math.floor(c / N);
      const opts = DIRS.map(([dx, dy], d) => [x + dx, y + dy, d]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < N && ny < N && !seen.has(ny * N + nx));
      if (!opts.length || (stack.length > 1 && Math.random() < 0.25)) { stack.pop(); continue; }
      const [nx, ny, d] = pick(opts), n = ny * N + nx;
      mask[c] |= 1 << d; mask[n] |= 1 << ((d + 2) % 4);
      seen.add(n); stack.push(n);
    }
    const bits = (m) => [0, 1, 2, 3].filter((d) => m & (1 << d)).length;
    const braziers = new Set([...seen].filter((c) => c !== src && bits(mask[c]) === 1));
    const rot = (m, k) => { let r = m; for (let i = 0; i < k; i++) r = ((r << 1) | (r >> 3)) & 15; return r; };
    const turns = mask.map((m, c) => (m && c !== src ? Math.floor(Math.random() * 4) : 0));
    if (turns.every((t, c) => !mask[c] || c === src || rot(mask[c], t) === mask[c])) turns[[...seen].find((c) => c !== src && bits(mask[c]) === 2)] = 1;
    const start = turns.slice();
    // QA hook: rotate each tile back to its generated orientation.
    this.autoSolve = () => turns.forEach((t, c) => { for (let k = 0; k < (4 - t) % 4; k++) this.board.querySelector(`.cell[data-c="${c}"]`)?.click(); });
    const cur = () => mask.map((m, c) => rot(m, turns[c]));
    const flood = () => {
      const m = cur(), lit = new Set([src]), q = [src];
      let leak = false;
      while (q.length) {
        const c = q.pop(), x = c % N, y = Math.floor(c / N);
        DIRS.forEach(([dx, dy], d) => {
          if (!(m[c] & (1 << d))) return;
          const nx = x + dx, ny = y + dy, n = ny * N + nx;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N || !(m[n] & (1 << ((d + 2) % 4)))) { leak = true; return; }
          if (!lit.has(n)) { lit.add(n); q.push(n); }
        });
      }
      return { lit, leak };
    };
    this.board.innerHTML = `<div class="conduit" style="--n:${N}"></div>`;
    const box = this.board.querySelector('.conduit');
    const pipeSvg = (m, on, kind) => {
      const arms = [[50, 0], [100, 50], [50, 100], [0, 50]].map(([x, y], d) => (m & (1 << d)) ? `<line x1="50" y1="50" x2="${x}" y2="${y}"/>` : '').join('');
      const cap = kind === 'src' ? '<circle cx="50" cy="50" r="22" class="heart"/>' : kind === 'brazier' ? '<path d="M30 70 L70 70 L62 40 L38 40Z" class="brazier"/>' : '<circle cx="50" cy="50" r="9"/>';
      return `<svg viewBox="0 0 100 100" class="${on ? 'on' : ''}">${arms}${cap}</svg>`;
    };
    const render = () => {
      const m = cur(), { lit, leak } = flood();
      box.innerHTML = m.map((v, c) => !mask[c] ? '<div class="cell empty"></div>'
        : `<button class="cell ${braziers.has(c) && lit.has(c) ? 'burning' : ''}" data-c="${c}" ${c === src ? 'disabled' : ''}>${pipeSvg(v, lit.has(c), c === src ? 'src' : braziers.has(c) ? 'brazier' : '')}</button>`).join('');
      const litB = [...braziers].filter((c) => lit.has(c)).length;
      const done = litB === braziers.size && !leak && lit.size === seen.size;
      this.status.textContent = `${litB} / ${braziers.size} braziers ablaze${leak ? ' · fire is leaking from an open channel' : ''}`;
      box.querySelectorAll('button.cell').forEach((b) => {
        b.onclick = () => { const c = +b.dataset.c; turns[c] = (turns[c] + 1) % 4; this.audio.play('rune'); render(); };
      });
      if (done && this.active === token) { box.querySelectorAll('button').forEach((x) => (x.disabled = true)); this.solved(token); }
    };
    resetBtn.onclick = () => { start.forEach((t, i) => (turns[i] = t)); this.audio.play('ui'); render(); };
    render();
  },

  // Ember Forge: Tower of Hanoi — recursive planning with glowing ember discs.
  hanoi(difficulty, token, resetBtn) {
    const n = 3 + difficulty;
    let pegs, held, moves;
    const init = () => { pegs = [[...Array(n).keys()].map((i) => n - i), [], []]; held = null; moves = 0; };
    init();
    const best = 2 ** n - 1;
    // QA hook: the classic recursive solution, played through anvil clicks.
    this.autoSolve = () => {
      const mv = [];
      const go = (k, a, b, c) => { if (!k) return; go(k - 1, a, c, b); mv.push([a, c]); go(k - 1, b, a, c); };
      go(n, 0, 1, 2);
      const peg = (i) => this.board.querySelector(`.anvil[data-p="${i}"]`);
      mv.forEach(([a, b]) => { peg(a).click(); peg(b).click(); });
    };
    this.board.innerHTML = `<div class="hanoi">${[0, 1, 2].map((i) => `<button class="anvil" data-p="${i}"><div class="stack"></div><div class="rod"></div><div class="base">${['Kiln', 'Bellows', 'Anvil'][i]}</div></button>`).join('')}</div>`;
    const render = () => {
      this.board.querySelectorAll('.anvil').forEach((a) => {
        const p = +a.dataset.p;
        a.classList.toggle('held', held === p);
        a.querySelector('.stack').innerHTML = pegs[p].map((d, k) => `<i class="ember ${held === p && k === pegs[p].length - 1 ? 'lift' : ''}" style="--w:${30 + d * 14}%;--h:${d / n}"></i>`).join('');
      });
      this.status.textContent = `${pegs[2].length} / ${n} embers on the anvil · ${moves} moves (best: ${best})`;
    };
    this.board.querySelectorAll('.anvil').forEach((a) => {
      a.onclick = () => {
        const p = +a.dataset.p;
        if (held === null) { if (pegs[p].length) { held = p; this.audio.tone(300, 0.15, { vol: 0.06 }); } }
        else if (held === p) held = null;
        else {
          const d = pegs[held].at(-1), top = pegs[p].at(-1);
          if (top !== undefined && top < d) { this.audio.play('error'); this.status.innerHTML = '<span class="bad">A great ember would crush a smaller one.</span>'; held = null; setTimeout(render, 700); return; }
          pegs[p].push(pegs[held].pop()); held = null; moves++;
          this.audio.tone(260 + d * 60, 0.25, { vol: 0.08, type: 'triangle' });
        }
        render();
        if (pegs[2].length === n) { this.board.querySelectorAll('.anvil').forEach((x) => (x.disabled = true)); this.solved(token); }
      };
    });
    resetBtn.onclick = () => { init(); this.audio.play('ui'); render(); };
    render();
  },

  // ================= CRYOMANCY =================
  // Frozen Lake: the rune slides until it hits a rock or the shore; stop exactly on the sigil.
  iceslide(difficulty, token, resetBtn) {
    const N = 7;
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const slide = (rocks, x, y, [dx, dy]) => { while (true) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N || rocks.has(ny * N + nx)) return [x, y]; x = nx; y = ny; } };
    const solve = (rocks, s, goal) => { // BFS over stop positions
      const dist = new Map([[s, 0]]), q = [s];
      while (q.length) {
        const c = q.shift();
        if (c === goal) return dist.get(c);
        for (const d of Object.values(D)) {
          const [x, y] = slide(rocks, c % N, Math.floor(c / N), d), n = y * N + x;
          if (!dist.has(n)) { dist.set(n, dist.get(c) + 1); q.push(n); }
        }
      }
      return -1;
    };
    let rocks, startCell, goal, need;
    for (let tries = 0; tries < 500; tries++) {
      rocks = new Set();
      const count = 8 + difficulty * 2;
      while (rocks.size < count) rocks.add(Math.floor(Math.random() * N * N));
      startCell = Math.floor(Math.random() * N * N); goal = Math.floor(Math.random() * N * N);
      if (rocks.has(startCell) || rocks.has(goal) || startCell === goal) continue;
      need = solve(rocks, startCell, goal);
      if (need >= 4 + difficulty) break;
    }
    let pos = startCell, moves = 0;
    // QA hook: BFS for the push sequence, then push through the real controls.
    this.autoSolve = () => {
      const prevOf = new Map([[pos, null]]), q = [pos];
      while (q.length) {
        const c = q.shift(); if (c === goal) break;
        for (const [name, d] of Object.entries(D)) {
          const [x, y] = slide(rocks, c % N, Math.floor(c / N), d), n2 = y * N + x;
          if (!prevOf.has(n2)) { prevOf.set(n2, [c, name]); q.push(n2); }
        }
      }
      const path = []; for (let c = goal; prevOf.get(c); c = prevOf.get(c)[0]) path.unshift(prevOf.get(c)[1]);
      path.forEach((d) => this.board.querySelector(`.ice-pad [data-d="${d}"]`).click());
    };
    this.board.innerHTML = `<div class="ice-wrap"><div class="ice" style="--n:${N}"></div>
      <div class="ice-pad">${['up', 'left', 'right', 'down'].map((d) => `<button class="btn sm" data-d="${d}" aria-label="Push ${d}">${{ up: '↑', left: '←', right: '→', down: '↓' }[d]}</button>`).join('')}
      <p class="hint">Arrow keys or WASD also push the stone.</p></div></div>`;
    const grid = this.board.querySelector('.ice');
    const render = () => {
      grid.innerHTML = Array.from({ length: N * N }, (_, i) => `<div class="ice-cell ${rocks.has(i) ? 'rock' : ''} ${i === goal ? 'goal' : ''}">${i === pos ? '<i class="stone">ᛟ</i>' : ''}</div>`).join('');
      this.status.textContent = `${moves} pushes · the lake can be crossed in ${need}`;
    };
    const push = (d) => {
      if (this.active !== token) return;
      const [x, y] = slide(rocks, pos % N, Math.floor(pos / N), D[d]);
      const n = y * N + x;
      if (n === pos) { this.audio.play('error'); return; }
      pos = n; moves++;
      this.audio.noise(0.25, { freq: 4000, sweep: 0.3, vol: 0.12 });
      render();
      if (pos === goal) this.solved(token);
    };
    this.board.querySelectorAll('.ice-pad button').forEach((b) => { b.onclick = () => push(b.dataset.d); });
    this.keyHandler = (e) => {
      const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
      if (map[e.code]) { e.preventDefault(); push(map[e.code]); }
    };
    addEventListener('keydown', this.keyHandler);
    resetBtn.onclick = () => { pos = startCell; moves = 0; this.audio.play('ui'); render(); };
    render();
  },

  // Crystal Prism: rotate mirrors so the starbeam threads its way to the frozen heart.
  mirrors(difficulty, token, resetBtn) {
    const N = 6;
    const reflect = (m, [dx, dy]) => (m === '/' ? [-dy, -dx] : [dy, dx]); // '/' or '\'
    let grid, targetCell, row;
    for (let tries = 0; tries < 400; tries++) {
      grid = new Array(N * N).fill(null);
      row = Math.floor(Math.random() * N);
      let x = 0, y = row, d = [1, 0], turns = 0, len = 0;
      const used = new Set();
      let ok = false;
      while (len < 40) {
        const c = y * N + x;
        if (used.has(c)) break;
        used.add(c);
        len++;
        const nextOut = (dd) => { const nx = x + dd[0], ny = y + dd[1]; return nx < 0 || ny < 0 || nx >= N || ny >= N; };
        if (len > 5 + difficulty && turns >= 3 && Math.random() < 0.35) { targetCell = c; ok = true; break; }
        if (Math.random() < 0.4 || nextOut(d)) {
          const opts = ['/', '\\'].filter((m) => !nextOut(reflect(m, d)));
          if (!opts.length) break;
          const m = pick(opts); grid[c] = m; d = reflect(m, d); turns++;
        }
        x += d[0]; y += d[1];
      }
      if (!ok) continue;
      var solution = grid.slice();
      // Decoy mirrors off the path, then scramble every mirror's orientation.
      for (let k = 0; k < 3 + difficulty; k++) { const c = Math.floor(Math.random() * N * N); if (!used.has(c) && c !== targetCell) grid[c] = pick(['/', '\\']); }
      grid.forEach((m, c) => { if (m && Math.random() < 0.6) grid[c] = m === '/' ? '\\' : '/'; });
      if (!trace().hit) break;
    }
    function trace() {
      let x = 0, y = row, d = [1, 0];
      const pts = [[-0.5, row]], seen = new Set();
      for (let k = 0; k < 100; k++) {
        if (x < 0 || y < 0 || x >= N || y >= N) { pts.push([x, y]); return { pts, hit: false }; }
        const c = y * N + x;
        pts.push([x, y]);
        if (c === targetCell) return { pts, hit: true };
        const key = c + ':' + d;
        if (seen.has(key)) return { pts, hit: false };
        seen.add(key);
        if (grid[c]) d = reflect(grid[c], d);
        x += d[0]; y += d[1];
      }
      return { pts, hit: false };
    }
    const start = grid.slice();
    let moves = 0;
    const C = 56;
    // QA hook: flip every path mirror that differs from the generated solution.
    this.autoSolve = () => solution.forEach((m, c) => { if (m && grid[c] !== m) this.board.querySelector(`.mirror[data-c="${c}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    this.board.innerHTML = `<svg class="prism" viewBox="${-C} 0 ${C * (N + 1)} ${C * N}" width="${(N + 1) * 52}"></svg>`;
    const svg = this.board.querySelector('.prism');
    const render = () => {
      const { pts, hit } = trace();
      let h = `<rect x="0" y="0" width="${C * N}" height="${C * N}" rx="10" class="field"/>`;
      h += `<g class="emitter" transform="translate(${-C / 2} ${row * C + C / 2})"><circle r="14"/><path d="M-6 -8 L10 0 L-6 8Z"/></g>`;
      const tx = (targetCell % N) * C + C / 2, ty = Math.floor(targetCell / N) * C + C / 2;
      h += `<g class="heart ${hit ? 'lit' : ''}" transform="translate(${tx} ${ty})"><path d="M0 -18 L14 0 L0 18 L-14 0Z"/></g>`;
      h += `<polyline class="beam" points="${pts.map(([x, y]) => `${x * C + C / 2},${y * C + C / 2}`).join(' ')}"/>`;
      grid.forEach((m, c) => {
        if (!m) return;
        const x = (c % N) * C + C / 2, y = Math.floor(c / N) * C + C / 2;
        h += `<g class="mirror" data-c="${c}" transform="translate(${x} ${y}) rotate(${m === '/' ? -45 : 45})"><rect x="-24" y="-24" width="48" height="48" class="hit"/><rect x="-22" y="-4" width="44" height="8" rx="3"/></g>`;
      });
      svg.innerHTML = h;
      this.status.textContent = hit ? '' : `${moves} turns · the beam has not reached the heart`;
      svg.querySelectorAll('.mirror').forEach((g) => {
        g.onclick = () => { const c = +g.dataset.c; grid[c] = grid[c] === '/' ? '\\' : '/'; moves++; this.audio.tone(900 + Math.random() * 200, 0.2, { vol: 0.05 }); render(); };
      });
      if (hit && this.active === token) { svg.querySelectorAll('.mirror').forEach((g) => (g.onclick = null)); this.solved(token); }
    };
    resetBtn.onclick = () => { start.forEach((m, i) => (grid[i] = m)); moves = 0; this.audio.play('ui'); render(); };
    render();
  },
});

// Painted skull sigil for the sliding-tile seal.
function paintSkull(S) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
  grd.addColorStop(0, '#2d4a3a'); grd.addColorStop(1, '#0e1a14');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(125,255,155,0.45)'; g.lineWidth = 4;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillStyle = '#7dff9b'; g.fillRect(S / 2 + Math.cos(a) * S * 0.44 - 4, S / 2 + Math.sin(a) * S * 0.44 - 4, 8, 8); }
  g.fillStyle = '#e8e2d0';
  g.beginPath(); g.ellipse(S / 2, S * 0.44, S * 0.26, S * 0.24, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(S * 0.36, S * 0.56, S * 0.28, S * 0.16);
  g.fillStyle = '#0e1a14';
  [[0.4, 0.44], [0.6, 0.44]].forEach(([x, y]) => { g.beginPath(); g.ellipse(S * x, S * y, S * 0.07, S * 0.08, 0, 0, Math.PI * 2); g.fill(); });
  g.beginPath(); g.moveTo(S / 2, S * 0.52); g.lineTo(S * 0.47, S * 0.58); g.lineTo(S * 0.53, S * 0.58); g.fill();
  for (let i = 0; i < 4; i++) g.fillRect(S * (0.39 + i * 0.06), S * 0.64, S * 0.025, S * 0.07);
  g.fillStyle = '#7dff9b';
  [[0.4, 0.44], [0.6, 0.44]].forEach(([x, y]) => { g.beginPath(); g.arc(S * x, S * y, S * 0.025, 0, Math.PI * 2); g.fill(); });
  g.font = `${S * 0.08}px serif`; g.textAlign = 'center';
  g.fillText('ᛗ ᛟ ᚱ ᛏ', S / 2, S * 0.88);
  return c.toDataURL();
}
