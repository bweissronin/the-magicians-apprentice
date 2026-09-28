import { SCHOOLS, SANCTUMS, SHRINES, TOWER_FLOORS, RESOURCES } from './data.js';
import { mulberry32 } from './util.js';
import { stability, GUARDIANS } from './story.js';

// The world atlas (M): Aldric's map of the Veiled Lands, amended as the apprentice rebuilds.
// Towers show as ruins, rising or restored; ley lines light; the Veil's rifts heal into gold
// stitches; sealed realms sit under fog. Click a realm for its chart; click a raised tower to
// travel there.

const $ = (id) => document.getElementById(id);
const ART = 'assets/ui/atlas/'; // rendered layers (tools/blender/build_atlas.py)
const W = 1000, H = 700, VC = { x: 500, y: 350 };
// Where each realm sits on the parchment, and its accent.
const PLACE = {
  necromancy: { x: 192, y: 368, r: 112, sx: 1, sy: 1.12, fill: '#8f9a7c', seed: 11 },
  geomancy: { x: 500, y: 120, r: 98, sx: 1.45, sy: 0.82, fill: '#b08a5c', seed: 21 },
  cryomancy: { x: 812, y: 342, r: 112, sx: 0.95, sy: 1.1, fill: '#dfeaf0', seed: 31 },
  pyromancy: { x: 514, y: 590, r: 92, sx: 1.5, sy: 0.78, fill: '#d98a5a', seed: 41 },
};
const VALLEY = { a: 120, b: 114 }; // the valley's radii on the parchment
// Rift energy: violet while the Veil is torn around a land, gold as its sanctum heals it.
const TORN = [230, 40, 255], TORN_CORE = [255, 150, 245], HEALED = [240, 195, 74], HEALED_CORE = [255, 240, 176];
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
// Bridges: the valley to each realm, and round the ring between neighbouring realms.
const BRIDGES = [['arcane', 'necromancy'], ['arcane', 'geomancy'], ['arcane', 'cryomancy'], ['arcane', 'pyromancy'],
  ['necromancy', 'geomancy'], ['geomancy', 'cryomancy'], ['cryomancy', 'pyromancy'], ['pyromancy', 'necromancy']];
const INK = '#4a3520', INK2 = '#7a5f3e';
const REALM_LANDMARKS = {
  necromancy: [['mausoleums', -118, -34], ['chapel', 106, 46], ['bonefields', 42, -128], ['hill', -72, 116]],
  pyromancy: [['obsidian', -112, -64], ['forge', 116, -46], ['vent', -76, 112], ['bridges', 84, 106]],
  cryomancy: [['armada', -106, 72], ['giant', 112, -84], ['stones', 102, 88], ['caves', -88, -112]],
  geomancy: [['geode', 118, -64], ['mine', -112, -58], ['cathedral', -86, 102], ['colossus', 28, 146]],
};
const LM_NAMES = {
  mausoleums: 'Weeping Mausoleums', chapel: 'Drowned Chapel', bonefields: 'Bone Fields', hill: "Hangman's Hill",
  obsidian: 'Obsidian Forest', forge: 'Sunken Forge', vent: 'Great Vent', bridges: 'Salamander Bridges',
  armada: 'Frozen Armada', giant: "Giant's Rest", stones: 'Aurora Stones', caves: 'Hollow Caves',
  geode: 'Great Geode', mine: 'Flooded Mine', cathedral: 'Fungal Cathedral', colossus: 'Sleeping Colossus',
};

function blob(cx, cy, r, amp, sx, sy, seed, n = 28) {
  const rnd = mulberry32(seed * 977 + 3), ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28], pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = 1 + amp * (Math.sin(3 * a + ph[0]) * 0.5 + Math.sin(5 * a + ph[1]) * 0.3 + Math.sin(7 * a + ph[2]) * 0.2);
    pts.push([cx + Math.cos(a) * r * k * sx, cy + Math.sin(a) * r * k * sy]);
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}
// blob()'s radius wobble as a function, so an island's cliff can follow its plateau's outline.
function blobK(seed, amp) {
  const rnd = mulberry32(seed * 977 + 3), ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  return (a) => 1 + amp * (Math.sin(3 * a + ph[0]) * 0.5 + Math.sin(5 * a + ph[1]) * 0.3 + Math.sin(7 * a + ph[2]) * 0.2);
}
const realmToMap = (id, x, z) => { const P = PLACE[id], k = (P.r * 0.78) / 180; return { x: P.x + x * k * P.sx, y: P.y + z * k * P.sy }; };
const valleyToMap = (x, z) => ({ x: VC.x + x * (104 / 185), y: VC.y + z * (96 / 185) });

export class Atlas {
  constructor(game) {
    this.game = game;
    this.el = $('atlas');
    this.view = 'world';
    $('atlas-close').onclick = () => this.toggle(false);
    // Each land is a floating island, rendered in Blender (tools/blender/build_atlas.py →
    // assets/ui/atlas/). The SVG adds what changes with progress: the rift glow round each rim
    // (violet → gold as it heals), sparks, and the tint of the rendered veins.
    this.isles = {};
    const lands = { arcane: { x: VC.x, y: VC.y, r: VALLEY.a, sx: 1, sy: VALLEY.b / VALLEY.a, seed: 2, amp: 0.1 }, ...Object.fromEntries(Object.entries(PLACE).map(([id, P]) => [id, { ...P, amp: 0.15 }])) };
    for (const [id, L] of Object.entries(lands)) {
      const rnd = mulberry32(L.seed * 31 + 7), k = blobK(L.seed, L.amp), N = 84, rim = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        rim.push([L.x + Math.cos(a) * L.r * k(a) * 1.1 * L.sx, L.y + Math.sin(a) * L.r * k(a) * 1.1 * L.sy]);
      }
      const at = (a, f) => { const rr = L.r * k(a) * f; return [L.x + Math.cos(a) * rr * L.sx, L.y + Math.sin(a) * rr * L.sy]; };
      const sparks = Array.from({ length: 22 }, () => ({ p: at(rnd() * Math.PI * 2, 1.08 + rnd() * 0.28), r: 0.8 + rnd() * 1.4, hot: rnd() < 0.4 }));
      this.isles[id] = { L, rim, sparks };
    }
  }

  get open() { return !this.el.classList.contains('hidden'); }

  toggle(force) {
    const g = this.game, show = force ?? !this.open;
    if (show) {
      if (g.mode !== 'play') return;
      g.mode = 'atlas'; g.releasePointer();
      this.view = 'world'; this.pick = null;
      this.render();
      this.el.classList.remove('hidden');
      g.audio.play('ui');
    } else if (this.open) {
      this.el.classList.add('hidden');
      if (g.mode === 'atlas') { g.mode = 'play'; g.input.lock(); }
      g.audio.play('ui');
    }
  }

  // Which towers can be travelled to: the Arcane tower once raised, and any realm tower with a stage.
  waypoints() {
    const s = this.game.state, list = [];
    if (s.floors > 0) list.push({ id: 'arcane', name: 'The Arcane Tower' });
    SCHOOLS.forEach((d) => { if (s.sanctumStage(d.id) > 0 && s.schoolUnlocked(d.id)) list.push({ id: d.id, name: SANCTUMS[d.id].name }); });
    return list;
  }

  render() {
    const s = this.game.state;
    $('atlas-seals').textContent = `${stability(s)} of 25 seals`;
    if (this.view !== 'world') return this.renderChart(this.view);
    $('atlas-body').innerHTML = this.worldSvg();
    $('atlas-body').onclick = () => { if (this.pick) this.select(null); }; // click open parchment: back to the overview
    this.el.querySelectorAll('.atlas-svg [data-realm]').forEach((n) => { n.onclick = (e) => { e.stopPropagation(); this.select(n.dataset.realm); }; });
    this.renderSide();
  }

  // The side panel: an overview of every land (and a legend), or the chosen land's page.
  renderSide() {
    $('atlas-foot').innerHTML = this.pick ? this.footer() : this.overview();
    this.el.querySelectorAll('.atl-side [data-realm]').forEach((b) => { b.onclick = () => this.select(b.dataset.realm); });
    this.el.querySelectorAll('[data-travel]').forEach((b) => { b.onclick = () => { this.toggle(false); this.game.travelTo(b.dataset.travel); }; });
    this.el.querySelectorAll('[data-chart]').forEach((b) => { b.onclick = () => { this.view = b.dataset.chart; this.render(); }; });
    const back = this.el.querySelector('[data-overview]');
    if (back) back.onclick = () => this.select(null);
    // Highlight the chosen land on the parchment.
    this.el.querySelectorAll('.atlas-svg .atl-hit').forEach((n) => n.classList.toggle('picked', n.dataset.realm === this.pick));
    // Landmark names only for the chosen land (or on hover): the models say what's there.
    this.el.querySelectorAll('.atlas-svg .atl-lmname').forEach((n) => n.classList.toggle('show', n.dataset.land === this.pick));
  }

  select(id) {
    this.pick = id;
    this.renderSide();
    this.game.audio.play('ui');
  }

  // Overview: veil stability, one row per land, and what the marks on the map mean.
  overview() {
    const s = this.game.state, seals = stability(s);
    const lands = [{ id: 'arcane', glyph: '✦', color: '#a792ff', name: 'The Arcane Tower', sub: `${s.floors} of ${TOWER_FLOORS.length} floors · ${s.shrines.length} of ${SHRINES.length} shrines`, pct: s.floors / TOWER_FLOORS.length }]
      .concat(SCHOOLS.map((d) => {
        const open = s.schoolUnlocked(d.id), st = s.sanctumStage(d.id);
        return { id: d.id, glyph: d.glyph, color: d.color, name: d.realm, sub: open ? `${SANCTUMS[d.id].name.replace('The ', '')} · ${st} of 5` : `Locked — ${s.gateBlock(d.id)}`, pct: st / 5, locked: !open };
      }));
    const row = (l) => `<button class="atl-land ${l.locked ? 'locked' : ''}" data-realm="${l.id}" style="--c:${l.color}">
      <span class="atl-lg">${l.locked ? '🔒' : l.glyph}</span><span><b>${l.name}</b><small>${l.sub}</small><i class="atl-mini"><i style="width:${(l.pct * 100).toFixed(0)}%"></i></i></span></button>`;
    const key = (sym, text) => `<li><span class="atl-sym">${sym}</span>${text}</li>`;
    return `<div class="atl-stab"><div><b>${seals}</b> / 25 seals</div><small>Your tower’s first five floors and every sanctum stage each add a seal.</small><i class="atl-mini big"><i style="width:${(seals / 25 * 100).toFixed(0)}%"></i></i></div>
      <div class="atl-sect">The lands</div><div class="atl-lands">${lands.map(row).join('')}</div>
      <div class="atl-sect">Legend</div>
      <ul class="atl-legend">
        ${key('<svg viewBox="-12 -12 24 24"><path d="M0,-9 L2.6,-2.8 9,-2.8 3.8,1.2 5.8,8 0,4 -5.8,8 -3.8,1.2 -9,-2.8 -2.6,-2.8Z" fill="#f0c34a" stroke="#4a3520" stroke-width="1"/></svg>', 'Your current goal')}
        ${key('<svg viewBox="-12 -12 24 24"><path d="M0,-8 L5.5,6 L0,3 L-5.5,6Z" fill="#e84b8a" stroke="#fff" stroke-width="1.2"/></svg>', 'You')}
        ${key('<svg viewBox="-12 -12 24 24"><path d="M0,-7 L6,0 L0,7 L-6,0Z" fill="#c9961e" stroke="#4a3520"/></svg>', 'Rune shrine (gold once awakened)')}
        ${key('<svg viewBox="-12 -12 24 24"><circle r="7" fill="#3a2a3e"/><circle cx="-2.5" cy="-1" r="1.6" fill="#e9dcc0"/><circle cx="2.5" cy="-1" r="1.6" fill="#e9dcc0"/></svg>', 'Haunted landmark')}
        ${key('<svg viewBox="-12 -12 24 24"><circle r="8" fill="#f0c34a" opacity=".5"/><path d="M-3,-5 h6 v8 h-6z" fill="#f0c34a" stroke="#4a3520"/></svg>', 'Haunt lifted')}
        ${key('<svg viewBox="-12 -12 24 24"><path d="M0,-7 L5,0 L0,7 L-5,0Z" fill="#8a7cff" stroke="#4a3520"/></svg>', 'Echo Stone heard')}
        ${key('<svg viewBox="-12 -12 24 24"><path d="M-10,4 L-6,-2 L-2,3 L2,-4 L6,2 L10,-3" stroke="#d84bff" stroke-width="5" fill="none" opacity=".45"/><path d="M-10,4 L-6,-2 L-2,3 L2,-4 L6,2 L10,-3" stroke="#ffb8ff" stroke-width="1.3" fill="none"/></svg>', 'Rift energy — the Veil torn round a land')}
        ${key('<svg viewBox="-12 -12 24 24"><path d="M-10,2 Q0,-6 10,2" stroke="#f0c34a" stroke-width="5" fill="none" opacity=".45"/><path d="M-10,2 Q0,-6 10,2" stroke="#fff0b0" stroke-width="1.3" fill="none"/></svg>', 'Healing — turns gold as the sanctum (or your tower) rises')}
        ${key('<svg viewBox="-12 -12 24 24"><path d="M-11,3 L-3,-1 M3,-1 L11,3" stroke="#8c6b50" stroke-width="6" fill="none"/></svg>', 'Broken bridge — mends when the realm\'s gate opens')}
      </ul>`;
  }

  // The chosen land's page.
  footer() {
    const g = this.game, s = g.state, id = this.pick, way = this.waypoints();
    const back = '<button class="atl-back" data-overview="1">◂ All lands</button>';
    const stat = (label, have, of) => `<div class="atl-stat"><span>${label}</span><b>${have} / ${of}</b><i class="atl-mini"><i style="width:${(Math.min(1, have / of) * 100).toFixed(0)}%"></i></i></div>`;
    if (id === 'arcane') {
      const shrines = SHRINES.map((sh) => `<li class="${s.shrines.includes(sh.id) ? 'done' : ''}">${sh.name}<small>${s.shrines.includes(sh.id) ? 'Awakened' : s.level >= sh.level ? 'Trial awaits' : `Level ${sh.level}`}</small></li>`).join('');
      return `${back}<div class="atl-page" style="--c:#a792ff"><h3>✦ The Arcane Tower</h3><div class="atl-sub">The valley · your master's tower</div>
        ${stat('Tower floors', s.floors, TOWER_FLOORS.length)}${stat('Rune shrines awakened', s.shrines.length, SHRINES.length)}
        <p>${s.floors ? 'Each floor closed a rift over the valley and relit a ley line.' : 'A ruin. Raise the Foundation Stones at the Builder\'s Altar.'}</p>
        <div class="atl-sect">Rune shrines</div><ul class="atl-list">${shrines}</ul>
        <div class="atl-acts">${way.find((w) => w.id === 'arcane') ? '<button class="btn primary" data-travel="arcane">Travel here</button>' : ''}</div></div>`;
    }
    const d = SCHOOLS.find((x) => x.id === id), sanc = SANCTUMS[id], st = s.sanctumStage(id), open = s.schoolUnlocked(id);
    const guard = Object.entries(GUARDIANS).find(([, gd]) => gd.realm === id);
    if (!open) {
      return `${back}<div class="atl-page" style="--c:${d.color}"><h3>${d.glyph} ${d.realm}</h3><div class="atl-sub">${d.name}</div>
        <div class="atl-sealed"><b>🔒 Locked — ${s.gateBlock(id)}</b><span>${d.needs.hint}.</span></div>
        <p>${d.blurb}</p>
        <div class="atl-sect">What waits inside</div>
        <ul class="atl-list">
          <li>Sanctum<small>${sanc.name}</small></li>
          ${guard ? `<li>Guardian<small>${guard[1].name}</small></li>` : ''}
          <li>Found only here<small>${RESOURCES[sanc.resource].name}</small></li>
          <li>Mastery teaches<small>${d.spell.name}</small></li>
        </ul></div>`;
    }
    const haunts = s.haunts.filter((k) => k.startsWith(id + ':')).length, echoes = s.echoes.filter((k) => k.startsWith(id + ':')).length;
    const lms = REALM_LANDMARKS[id].map(([lid]) => {
      const key = `${id}:${lid}`, seen = s.story.seen?.[key] || s.echoes.includes(key) || s.haunts.includes(key);
      const state = !seen ? 'Unexplored' : s.haunts.includes(key) ? (s.echoes.includes(key) ? 'Lifted · echo heard' : 'Lifted · echo waits') : 'Haunted';
      return `<li class="${s.haunts.includes(key) ? 'done' : ''}">${seen ? LM_NAMES[lid] : '? ? ?'}<small>${state}</small></li>`;
    }).join('');
    return `${back}<div class="atl-page" style="--c:${d.color}"><h3>${d.glyph} ${d.realm}</h3><div class="atl-sub">${d.name} · ${s.masteryTitle(id)}</div>
      ${stat(sanc.name, st, 5)}${stat('Haunts lifted', haunts, 4)}${stat('Echo Stones heard', echoes, 4)}
      ${guard ? `<div class="atl-guard ${s.guardians.includes(guard[0]) ? 'done' : ''}">${s.guardians.includes(guard[0]) ? '✓' : '☠'} ${guard[1].name} ${s.guardians.includes(guard[0]) ? 'defeated' : st >= 4 ? 'awaits your challenge' : 'waits beyond the fourth stage'}</div>` : ''}
      <p><small>${sanc.steadies}</small></p>
      <div class="atl-sect">Landmarks</div><ul class="atl-list">${lms}</ul>
      <div class="atl-acts">${g.realms.cache[id] ? `<button class="btn" data-chart="${id}">Open chart</button>` : ''}
      ${way.find((w) => w.id === id) ? `<button class="btn primary" data-travel="${id}">Travel to ${sanc.name}</button>` : ''}</div></div>`;
  }

  tower(x, y, state, col, pips, label, sub, id) {
    const out = [`<g class="atl-hit" data-realm="${id}"><title>${label} — ${sub}</title>`];
    // The tower itself is a render (tools/blender/build_atlas.py): ruin, rising or restored.
    if (state !== 'ruin') out.push(`<circle cx="${x}" cy="${y - 22}" r="26" fill="${col}" opacity="${state === 'restored' ? 0.45 : 0.25}" filter="url(#aglow)"/>`);
    out.push(`<image href="${ART}tower-${id}-${state}.webp" width="${W}" height="${H}" x="0" y="0" pointer-events="none"/>`);
    for (let i = 0; i < 5; i++) out.push(`<circle cx="${x - 16 + i * 8}" cy="${y + 9}" r="2.8" fill="${i < pips ? '#c9961e' : 'none'}" stroke="${INK}" stroke-width="1"/>`);
    out.push(`<text x="${x}" y="${y + 27}" class="al t">${label}</text><text x="${x}" y="${y + 40}" class="al s">${sub}</text></g>`);
    return out.join('');
  }

  worldSvg() {
    const g = this.game, s = g.state, A = [];
    A.push(`<svg class="atlas-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of the Veiled Lands">`);
    A.push(`<defs><radialGradient id="aparch" cx="50%" cy="48%" r="70%"><stop offset="0" stop-color="#f3e7c9"/><stop offset=".75" stop-color="#e7d4a8"/><stop offset="1" stop-color="#cdb07a"/></radialGradient>
      <filter id="arough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="5"/></filter>
      <filter id="aglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
      <pattern id="afog" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="10" height="10" fill="#4a3a78"/><line x1="0" y1="0" x2="0" y2="10" stroke="#7a68b0" stroke-width="2.2"/></pattern>
      <linearGradient id="asky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fbcff"/><stop offset=".55" stop-color="#a9d4ff"/><stop offset="1" stop-color="#cdbdff"/></linearGradient>
      <radialGradient id="apuff"><stop offset=".6" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <pattern id="awaves" width="26" height="10" patternUnits="userSpaceOnUse"><path d="M0 6 q6.5 -5 13 0 t13 0" fill="none" stroke="#b39a6c" stroke-width="1"/></pattern>
      <radialGradient id="avig" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#5a3a14" stop-opacity="0"/><stop offset="1" stop-color="#5a3a14" stop-opacity=".45"/></radialGradient>
      <filter id="agrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="8"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .25  0 0 0 0 .1  0 0 0 .22 0"/></filter>
      <pattern id="acobble" width="14" height="10" patternUnits="userSpaceOnUse"><rect width="14" height="10" fill="#8c6b50"/><rect x="1" y="1" width="6" height="3.6" rx="1.4" fill="#a3825f" stroke="#5c4230" stroke-width=".6"/><rect x="8" y="1" width="5" height="3.6" rx="1.4" fill="#9a7858" stroke="#5c4230" stroke-width=".6"/><rect x="4" y="5.6" width="6" height="3.6" rx="1.4" fill="#a07e5c" stroke="#5c4230" stroke-width=".6"/></pattern>
      <filter id="arift" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
      <filter id="aveinglow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/></feMerge></filter>
      <filter id="azapglow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="ashade" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#3a2410" flood-opacity=".35"/></filter></defs>`);
    A.push(`<rect width="${W}" height="${H}" rx="14" fill="url(#asky)"/>`);
    A.push(this.clouds());
    // How healed each land's rim is: the valley by tower floors, a realm by its sanctum stages.
    const heal = { arcane: s.floors / TOWER_FLOORS.length };
    SCHOOLS.forEach((d) => { heal[d.id] = s.schoolUnlocked(d.id) ? s.sanctumStage(d.id) / 5 : 0; });
    const sealed = (id) => id !== 'arcane' && !s.schoolUnlocked(id);
    const ids = ['arcane', ...SCHOOLS.map((d) => d.id)];
    for (const [a, b] of BRIDGES) A.push(this.bridge(a, b, (heal[a] + heal[b]) / 2, sealed(a) || sealed(b)));
    for (const id of ids) A.push(this.glow(id, heal[id]));
    A.push(`<image href="${ART}base.webp" width="${W}" height="${H}" pointer-events="none"/>`);
    for (const id of ids) A.push(this.veins(id, heal[id]));
    // The valley.
    A.push(`<g class="atl-hit atl-shape" data-realm="arcane"><title>The valley — your master's tower and its rune shrines</title><path d="${blob(VC.x, VC.y, VALLEY.a, 0.1, 1, VALLEY.b / VALLEY.a, 2)}" fill="transparent" stroke="none"/>`);
    // The river and the pond (the woods, courtyard and bridges are in the render).
    A.push(`<path d="M392,292 C430,318 452,298 478,330 S522,400 566,396 S622,428 626,452" fill="none" stroke="#6fa3c8" stroke-width="4.5" stroke-linecap="round"/>`);
    const lake = valleyToMap(-40, 60);
    A.push(`<ellipse cx="${lake.x}" cy="${lake.y}" rx="22" ry="14" fill="#86b8d8" stroke="#5a88a8" stroke-width="1.2"/>`);
    A.push('</g>');
    SHRINES.forEach((sh) => {
      const p = valleyToMap(sh.x, sh.z), done = s.shrines.includes(sh.id);
      A.push(`<g class="atl-pin"><title>${sh.name} — ${done ? 'awakened' : s.level >= sh.level ? 'its trial awaits' : `level ${sh.level}`}</title>${done ? `<circle cx="${p.x}" cy="${p.y - 12}" r="14" fill="#f0c34a" opacity=".45" filter="url(#aglow)"/>` : ''}<path d="M${p.x},${p.y - 34} L${p.x + 6},${p.y - 27} L${p.x},${p.y - 20} L${p.x - 6},${p.y - 27}Z" fill="${done ? '#f0c34a' : '#fff'}" stroke="#2a1d3a" stroke-width="1.4"/></g>`);
    });
    // Realms.
    for (const d of SCHOOLS) {
      const P = PLACE[d.id], open = s.schoolUnlocked(d.id), st = s.sanctumStage(d.id);
      A.push(`<g class="atl-hit atl-shape" data-realm="${d.id}"><title>${d.realm} — ${open ? `${SANCTUMS[d.id].name}, ${st} of 5 stages` : `locked: ${s.gateBlock(d.id)}`}</title><path d="${blob(P.x, P.y, P.r, 0.15, P.sx, P.sy, P.seed)}" fill="transparent" stroke="none"/>`);
      if (!open) A.push(`<path d="${blob(P.x, P.y, P.r + 4, 0.15, P.sx, P.sy, P.seed)}" fill="url(#afog)" opacity=".5"/><g transform="translate(${P.x},${P.y - 30}) scale(1.4)"><rect x="-9" y="-3" width="18" height="14" rx="3" fill="#f0c34a" stroke="#2a1d3a" stroke-width="1.6"/><path d="M-5.5,-3 v-4 a5.5,5.5 0 0 1 11,0 v4" fill="none" stroke="#2a1d3a" stroke-width="2.6"/></g><text x="${P.x}" y="${P.y}" class="al t">${d.realm.replace('The ', '')}</text><text x="${P.x}" y="${P.y + 15}" class="al s">Locked · ${s.gateBlock(d.id)}</text>`);
      A.push('</g>');
      if (open) {
        for (const [lid, lx, lz] of REALM_LANDMARKS[d.id]) {
          const p = realmToMap(d.id, lx, lz), key = `${d.id}:${lid}`, seen = s.story.seen?.[key] || s.echoes.includes(key) || s.haunts.includes(key);
          if (!seen) {
            A.push(`<g class="atl-pin atl-fog"><title>Unexplored — walk nearby to chart it</title>${[[0, -8, 20], [-17, -2, 14], [17, -3, 15], [-8, -18, 12], [9, -17, 13], [0, 4, 16]].map(([dx, dy, r]) => `<circle cx="${p.x + dx}" cy="${p.y + dy}" r="${r}" fill="#f4f1ff"/>`).join('')}<text x="${p.x}" y="${p.y - 1}" class="al q">?</text></g>`);
            continue;
          }
          A.push(`<g class="atl-pin"><title>${LM_NAMES[lid]} — ${s.haunts.includes(key) ? 'haunt lifted' : 'haunted'}${s.echoes.includes(key) ? ' · echo heard' : ''}</title>`);
          if (s.haunts.includes(key)) A.push(`<g transform="translate(${p.x},${p.y - 32})"><circle r="7" fill="#f0c34a" opacity=".5" filter="url(#aglow)"/><path d="M-3,-5 h6 v8 h-6z" fill="#f0c34a" stroke="${INK}" stroke-width="1"/></g>`);
          else A.push(`<g transform="translate(${p.x},${p.y - 32})"><circle r="7" fill="#3a2a3e" stroke="#fff" stroke-width="1.2"/><circle cx="-2" cy="-1" r="1.4" fill="#e9dcc0"/><circle cx="2" cy="-1" r="1.4" fill="#e9dcc0"/></g>`);
          if (s.echoes.includes(key)) A.push(`<path d="M${p.x + 11},${p.y - 42} L${p.x + 15},${p.y - 37} L${p.x + 11},${p.y - 32} L${p.x + 7},${p.y - 37}Z" fill="#8a7cff" stroke="${INK}" stroke-width=".8"/>`);
          A.push(`<text x="${p.x}" y="${p.y + 20}" class="al s atl-lmname" data-land="${d.id}">${LM_NAMES[lid]}</text></g>`);
        }
        const tp = { x: P.x, y: P.y + 12 };
        A.push(this.tower(tp.x, tp.y, st >= 5 ? 'restored' : st > 0 ? 'rising' : 'ruin', d.color, st, SANCTUMS[d.id].name.replace('The ', ''), `${d.realm.replace('The ', '')} · ${st >= 5 ? 'restored' : st ? `${st} of 5` : 'ruin'}`, d.id));
      }
    }
    // The Arcane tower on top of everything.
    A.push(this.tower(VC.x, VC.y + 2, s.floors >= TOWER_FLOORS.length ? 'restored' : s.floors > 0 ? 'rising' : 'ruin', '#a792ff', Math.min(5, s.floors), 'The Arcane Tower', `The valley · ${s.floors} of ${TOWER_FLOORS.length} floors`, 'arcane'));
    // You.
    const pp = g.player.pos, you = g.realm ? realmToMap(g.realm.id, pp.x, pp.z) : valleyToMap(pp.x, pp.z);
    A.push(`<g transform="translate(${you.x},${you.y}) rotate(${(-g.player.mesh.rotation.y * 180) / Math.PI + 180})"><circle r="10" fill="#e84b8a" opacity=".3"/><path d="M0,-8 L5.5,6 L0,3 L-5.5,6Z" fill="#e84b8a" stroke="#fff" stroke-width="1.2"/></g><text x="${you.x}" y="${you.y - 14}" class="al you">You</text>`);
    // Your current goal: a gold star where the quest marker points.
    const o = g.ui.currentObjective?.target;
    if (o && !g.inside) {
      const q = g.realm ? realmToMap(g.realm.id, o.x, o.z) : valleyToMap(o.x, o.z);
      A.push(`<g class="atl-goal" transform="translate(${q.x.toFixed(1)},${q.y.toFixed(1)})"><title>Current goal — ${g.ui.currentObjective.title}</title><circle r="14" fill="#f0c34a" opacity=".35" filter="url(#aglow)"/><path d="M0,-11 L3.2,-3.4 11,-3.4 4.7,1.5 7.1,9.8 0,4.9 -7.1,9.8 -4.7,1.5 -11,-3.4 -3.2,-3.4Z" fill="#f0c34a" stroke="${INK}" stroke-width="1.2"/></g>`);
    }
    A.push(`<rect width="${W}" height="${H}" rx="14" fill="url(#avig)" pointer-events="none"/>`);
    // Cartouche, compass, stability ring.
    A.push(`<g transform="translate(34,30)"><rect width="262" height="70" rx="14" fill="#3b2a6b" stroke="#f0c34a" stroke-width="3"/><rect x="5" y="5" width="252" height="60" rx="10" fill="none" stroke="#6b54b0" stroke-width="1.2"/><text x="131" y="34" class="al title">The Veiled Lands</text><text x="131" y="53" class="al s">charted by Aldric · amended by his apprentice</text></g>`);
    A.push(`<g transform="translate(80,620)"><circle r="30" fill="rgba(255,255,255,.35)" stroke="#2a1d3a" stroke-width="1.5"/><path d="M0,-38 L6,0 L0,38 L-6,0Z" fill="#2a1d3a"/><path d="M-38,0 L0,6 L38,0 L0,-6Z" fill="#5a4a7a"/><path d="M0,-38 L6,0 L-6,0Z" fill="#b02a8a"/><text y="-44" class="al s">N</text></g>`);
    const seals = stability(s);
    A.push(`<g transform="translate(900,82)"><text y="-40" class="al s">Veil stability</text>`);
    for (let i = 0; i < 25; i++) { const a = -Math.PI / 2 + (i / 25) * Math.PI * 2; A.push(`<circle cx="${(Math.cos(a) * 30).toFixed(1)}" cy="${(Math.sin(a) * 30).toFixed(1)}" r="3.2" fill="${i < seals ? '#c9961e' : 'none'}" stroke="${INK}" stroke-width=".9"/>`); }
    A.push(`<text y="6" class="al t">${seals}/25</text></g>`);
    A.push('</svg>');
    return A.join('');
  }

  // Under an island: the rift light round its rim —
  // violet while torn, calming to gold as `t` (0–1) heals it.
  glow(id, t) {
    const I = this.isles[id], { L } = I, f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const rim = `M${I.rim.map(f).join(' L')}Z`, glow = mix(TORN, HEALED, t), calm = t >= 1;
    return `<g pointer-events="none">
      <g class="${calm ? '' : 'atl-energy'}" filter="url(#arift)" opacity="${calm ? 0.55 : 0.95}">
        <path d="${rim}" transform="translate(0,16)" fill="none" stroke="${glow}" stroke-width="38" opacity=".6"/>
        <path d="${rim}" fill="none" stroke="${glow}" stroke-width="22"/></g></g>`;
  }

  // Over an island: its rendered rift veins, tinted and bloomed, and a few sparks. The veins fade
  // as the land heals.
  veins(id, t) {
    const I = this.isles[id], glow = mix(TORN, HEALED, t), core = mix(TORN_CORE, HEALED_CORE, t), calm = t >= 1;
    const m = `url(#aem-${id})`;
    const sparks = calm ? '' : I.sparks.map((p) => `<circle cx="${p.p[0].toFixed(1)}" cy="${p.p[1].toFixed(1)}" r="${p.r.toFixed(1)}" fill="${p.hot ? '#ffb070' : core}"/>`).join('');
    const f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`, rim = `M${I.rim.map(f).join(' L')}Z`;
    return `<g pointer-events="none" opacity="${(1 - t * 0.7).toFixed(2)}">
      <g style="mix-blend-mode:screen" filter="url(#arift)" opacity="${calm ? 0.3 : 0.5}"><path d="${rim}" transform="translate(0,8)" fill="none" stroke="${glow}" stroke-width="20"/></g>
      <mask id="aem-${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><image href="${ART}energy-${id}.webp" width="${W}" height="${H}"/></mask>
      <g class="${calm ? '' : 'atl-energy'}" filter="url(#aveinglow)"><rect width="${W}" height="${H}" fill="${glow}" mask="${m}"/></g>
      <rect class="${calm ? '' : 'atl-zap'}" width="${W}" height="${H}" fill="${core}" mask="${m}"/>
      ${sparks}</g>`;
  }

  // A stone causeway between two islands, with rift light under it. Broken at the middle while
  // the realm at either end is still sealed.
  bridge(a, b, t, broken) {
    const A = this.isles[a].L, B = this.isles[b].L, mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    // Ring bridges bow outward, away from the valley (as rendered); valley bridges run straight.
    const ring = a !== 'arcane', ox = mx - VC.x, oy = my - VC.y, ol = Math.hypot(ox, oy) || 1, bow = ring ? 70 : 0;
    const cx = mx + (ox / ol) * bow, cy = my + (oy / ol) * bow, d = `M${A.x},${A.y} Q${cx.toFixed(0)},${cy.toFixed(0)} ${B.x},${B.y}`;
    return `<g class="atl-bridge ${broken ? 'broken' : ''}" pointer-events="none">
      <path d="${d}" transform="translate(0,14)" fill="none" stroke="${mix(TORN, HEALED, t)}" stroke-width="${broken ? 30 : 46}" opacity="${broken ? 0.3 : 0.5}" filter="url(#arift)"/>
      <image href="${ART}bridge-${a}-${b}${broken ? '-broken' : ''}.webp" width="${W}" height="${H}"/></g>`;
  }

  // Soft clouds drifting in the sky around the islands.
  clouds() {
    const r = mulberry32(99), out = [];
    for (let i = 0; i < 16; i++) {
      const x = 30 + r() * (W - 60), y = 30 + r() * (H - 60), s = 0.6 + r() * 0.9;
      const puffs = [[0, 0, 26], [-24, 6, 18], [24, 5, 20], [-10, -12, 16], [12, -10, 17]];
      out.push(`<g transform="translate(${x.toFixed(0)},${y.toFixed(0)}) scale(${s.toFixed(2)})" opacity="${(0.55 + r() * 0.35).toFixed(2)}">${puffs.map(([dx, dy, rr]) => `<ellipse cx="${dx}" cy="${dy}" rx="${rr}" ry="${(rr * 0.72).toFixed(0)}" fill="url(#apuff)"/>`).join('')}</g>`);
    }
    return `<g>${out.join('')}</g>`; // soft edges come from the gradient: a live blur here cost ~10 fps
  }

  // The realm chart: the realm's own baked map with its landmarks, tower and you.
  renderChart(id) {
    const g = this.game, s = g.state, r = g.realms.cache[id], d = SCHOOLS.find((x) => x.id === id);
    $('atlas-body').innerHTML = `<div class="atl-chart"><canvas id="atlas-chart" width="640" height="640"></canvas></div>`;
    $('atlas-foot').innerHTML = `<b style="color:${d.color}">${d.glyph} ${d.realm}</b> · ${SANCTUMS[id].name} ${s.sanctumStage(id)}/5 <button class="btn" data-back="1">◂ Back to the atlas</button>${this.waypoints().find((w) => w.id === id) ? `<button class="btn primary" data-travel="${id}">Travel here</button>` : ''}`;
    this.el.querySelector('[data-back]').onclick = () => { this.view = 'world'; this.render(); };
    this.el.querySelectorAll('[data-travel]').forEach((b) => { b.onclick = () => { this.toggle(false); g.travelTo(b.dataset.travel); }; });
    const c = $('atlas-chart').getContext('2d'), N = 640, k = N / 400;
    c.imageSmoothingEnabled = true;
    c.drawImage(r.mapBase, 0, 0, N, N);
    c.fillStyle = 'rgba(40,24,10,0.18)'; c.fillRect(0, 0, N, N);
    const at = (x, z) => [(x + 200) * k, (z + 200) * k];
    // Paths, landmarks, echo stones, the tower, nodes, you.
    c.strokeStyle = 'rgba(255,230,170,0.5)'; c.lineWidth = 2;
    for (const p of r.land.paths) { c.beginPath(); p.forEach(([x, z], i) => { const [px, py] = at(x, z); i ? c.lineTo(px, py) : c.moveTo(px, py); }); c.stroke(); }
    c.font = '600 14px Cinzel, serif'; c.textAlign = 'center';
    for (const L of r.land.landmarks) {
      const key = `${id}:${L.id}`, seen = s.story.seen?.[key] || s.echoes.includes(key) || s.haunts.includes(key), [px, py] = at(L.x, L.z);
      c.beginPath(); c.arc(px, py, L.r * k, 0, Math.PI * 2); c.strokeStyle = s.haunts.includes(key) ? 'rgba(240,195,74,0.8)' : 'rgba(176,42,138,0.6)'; c.lineWidth = 2; c.setLineDash([6, 5]); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#fff3d6'; c.strokeStyle = '#1b1008'; c.lineWidth = 4; const label = seen ? L.name : '?';
      c.strokeText(label, px, py + 5); c.fillText(label, px, py + 5);
      if (s.echoes.includes(key)) { c.fillStyle = '#8a7cff'; c.beginPath(); c.moveTo(px + 14, py - 22); c.lineTo(px + 20, py - 16); c.lineTo(px + 14, py - 10); c.lineTo(px + 8, py - 16); c.fill(); }
    }
    for (const n of r.nodes.nodes) { if (!n.alive) continue; const [px, py] = at(n.x, n.z); c.fillStyle = d.color; c.fillRect(px - 1.5, py - 1.5, 3, 3); }
    const [tx, ty] = at(0, -30); c.fillStyle = d.color; c.beginPath(); c.arc(tx, ty, 9, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#fff3d6'; c.strokeStyle = '#1b1008'; c.lineWidth = 4; c.strokeText(SANCTUMS[id].name, tx, ty - 16); c.fillText(SANCTUMS[id].name, tx, ty - 16);
    if (g.realm?.id === id) { const [px, py] = at(g.player.pos.x, g.player.pos.z); c.fillStyle = '#e84b8a'; c.beginPath(); c.arc(px, py, 8, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff'; c.stroke(); }
  }
}
