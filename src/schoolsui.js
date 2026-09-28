import { SCHOOLS, SANCTUMS, SHRINES, TOWER_FLOORS, MASTERY_RANKS } from './data.js';
import { ELEMENTS } from './bestiary.js';
import { GUARDIANS } from './story.js';

// Schools of Magic (K): one tab per school across the top — glyph, a progress ring and the rank
// you hold — and a single detail page for the chosen school below: the rank ladder and what each
// rank teaches, the steps toward mastery, what lies beyond it, and the rewards.

const $ = (id) => document.getElementById(id);
const GIFT_EL = { geomancy: 'earth', cryomancy: 'frost', pyromancy: 'fire' };

// Everything the page shows for one school, as plain data.
function schoolData(s, id) {
  if (id === 'arcane') {
    const rank = s.ascended ? 3 : s.floors >= 4 ? 2 : s.floors >= 1 ? 1 : 0;
    const steps = [
      { text: 'Raise the Arcane tower', have: s.floors, of: TOWER_FLOORS.length },
      { text: 'Attune the valley\'s rune shrines', have: s.shrines.length, of: SHRINES.length },
      { text: 'Research Radiance at the Spell Tome', done: s.up('radiance') >= 1 },
      { text: 'Face the Unraveller atop the Spire', done: !!s.finale },
    ];
    return {
      id, name: 'Arcane', glyph: '✦', color: '#9b7bff', realm: 'The Valley & your Tower', rank,
      blurb: 'The foundation of all magic. Raise your master\'s tower floor by floor and attune the valley\'s shrines; every other school grows from this one.',
      ladder: [['Unstudied', ''], ['Initiate', 'Raise the Foundation'], ['Adept', 'Four floors standing'], ['Master', 'The Unraveller falls']],
      steps, stepsTitle: 'The path', beyond: [],
      rewards: [{ at: 'Master', name: 'The title of Magician', desc: 'Aldric\'s successor, and keeper of the Spire.', got: rank >= 3, glyph: '♛' }],
      pct: (s.floors / TOWER_FLOORS.length + s.shrines.length / SHRINES.length + (s.up('radiance') >= 1) + !!s.finale) / 4,
    };
  }
  const d = SCHOOLS.find((x) => x.id === id), p = s.school(id), sanc = SANCTUMS[id], stage = s.sanctumStage(id);
  const guard = Object.entries(GUARDIANS).find(([, gd]) => gd.realm === id);
  const haunts = s.haunts.filter((k) => k.startsWith(id + ':')).length, echoes = s.echoes.filter((k) => k.startsWith(id + ':')).length;
  const el = GIFT_EL[id] && ELEMENTS.find((e) => e.id === GIFT_EL[id]);
  const gift = el ? { name: `${el.name} attunement [${el.key}]`, desc: el.how, glyph: el.glyph } : { name: d.gift.name, desc: d.gift.desc, glyph: '👁' };
  const rank = s.mastery(id);
  return {
    id, name: d.name, glyph: d.glyph, color: d.color, realm: d.realm, rank,
    locked: !s.schoolUnlocked(id), lockWhy: s.gateBlock(id), hint: d.needs.hint, blurb: d.blurb,
    ladder: [['Unstudied', ''], ['Initiate', gift.name.replace(/ \[\d\]$/, '')], ['Adept', ''], ['Master', d.spell.name], ['Grandmaster', sanc.boon.name]],
    stepsTitle: 'Toward mastery', stepsNote: 'Each one done raises your rank by one.',
    steps: [
      ...d.puzzles.map((pz) => ({ text: `Solve ${pz.name}`, done: p.puzzles.includes(pz.id) })),
      { text: `Lift a haunt — the realm's trial`, done: p.trial, sub: `${haunts} of 4 haunts lifted` },
    ],
    beyond: [
      { text: `Raise ${sanc.name}`, have: stage, of: sanc.stages.length },
      guard && { text: `Drive out ${guard[1].name}`, done: s.guardians.includes(guard[0]), sub: stage < 4 ? 'Waits beyond the fourth stage' : '' },
      { text: 'Hear the Echo Stones', have: echoes, of: 4 },
    ].filter(Boolean),
    rewards: [
      { at: 'Initiate', ...gift, got: rank >= 1 },
      { at: 'Master', name: `${d.spell.name}${d.spell.key !== 'passive' ? ` [${d.spell.key}]` : ' · passive'}`, desc: d.spell.desc, got: rank >= 3, glyph: '✧' },
      { at: 'Sanctum restored', name: sanc.boon.name, desc: sanc.boon.desc, got: s.hasBoon(id), glyph: '❂' },
    ],
    pct: (p.puzzles.length + (p.trial ? 1 : 0) + stage / sanc.stages.length + (guard && s.guardians.includes(guard[0]) ? 1 : 0)) / (d.puzzles.length + 3),
  };
}

// A progress ring around a glyph (SVG, so it scales crisply).
const ring = (pct, color, glyph) => {
  const C = 2 * Math.PI * 25, on = Math.max(0, Math.min(1, pct)) * C;
  return `<svg class="sc-ring" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="25" class="bg"/>
    <circle cx="30" cy="30" r="25" class="fg" stroke="${color}" stroke-dasharray="${on.toFixed(1)} ${C.toFixed(1)}"/>
    <text x="30" y="31">${glyph}</text></svg>`;
};

const row = (st) => {
  const bar = st.of !== undefined;
  const done = bar ? st.have >= st.of : st.done;
  return `<li class="${done ? 'done' : ''}"><span class="sc-check">${done ? '✓' : ''}</span>
    <div class="sc-step"><span>${st.text}</span>${bar ? `<b>${st.have} / ${st.of}</b>` : ''}
      ${bar ? `<div class="sc-bar"><i style="width:${(Math.min(1, st.have / st.of) * 100).toFixed(0)}%"></i></div>` : ''}
      ${st.sub ? `<small>${st.sub}</small>` : ''}</div></li>`;
};

export function renderSchools(game, pick) {
  const s = game.state, ids = ['arcane', ...SCHOOLS.map((d) => d.id)];
  const all = ids.map((id) => schoolData(s, id));
  const cur = all.find((o) => o.id === pick) || all[0];
  const tabs = all.map((o) => `
    <button class="sc-tab ${o.id === cur.id ? 'on' : ''} ${o.locked ? 'locked' : ''}" data-school="${o.id}" style="--c:${o.color}" aria-pressed="${o.id === cur.id}">
      ${ring(o.locked ? 0 : o.pct, o.color, o.locked ? '🔒' : o.glyph)}
      <span class="sc-tname">${o.name}</span><span class="sc-trank">${o.locked ? 'Sealed' : MASTERY_RANKS[o.rank]}</span>
    </button>`).join('');
  const o = cur;
  const ladder = o.ladder.map(([title, unlock], i) => `
    <li class="${i <= o.rank && !o.locked ? 'got' : ''} ${i === o.rank && !o.locked ? 'now' : ''}"><i></i><b>${title}</b>${unlock ? `<small>${unlock}</small>` : ''}</li>`).join('');
  const rewards = o.rewards.map((r) => `
    <div class="sc-reward ${r.got ? 'got' : ''}"><span class="sc-rglyph">${r.glyph}</span>
      <div><div class="sc-rat">${r.got ? 'Learned' : r.at}</div><b>${r.name}</b><p>${r.desc}</p></div></div>`).join('');
  $('schools-body').innerHTML = `
    <div class="sc-tabs" role="tablist">${tabs}</div>
    <section class="sc-page ${o.locked ? 'locked' : ''}" style="--c:${o.color}">
      <header class="sc-head">
        <span class="sc-big">${o.glyph}</span>
        <div class="sc-title"><h3>${o.name}</h3><div class="sc-realm">${o.realm}</div></div>
        <ol class="sc-ladder" style="--n:${o.ladder.length}">${ladder}</ol>
      </header>
      ${o.locked ? `<div class="sc-sealed"><b>🔒 Gate sealed — ${o.lockWhy}</b><span>${o.hint}</span></div>` : ''}
      <p class="sc-blurb">${o.blurb}</p>
      <div class="sc-cols">
        <div><h4>${o.stepsTitle}</h4>${o.stepsNote ? `<div class="sc-note">${o.stepsNote}</div>` : ''}<ul class="sc-steps">${o.steps.map(row).join('')}</ul></div>
        ${o.beyond.length ? `<div><h4>Beyond mastery</h4><div class="sc-note">A Master who restores the sanctum becomes Grandmaster.</div><ul class="sc-steps">${o.beyond.map(row).join('')}</ul></div>` : ''}
      </div>
      <h4>Rewards</h4>
      <div class="sc-rewards">${rewards}</div>
    </section>`;
  $('schools-body').querySelectorAll('[data-school]').forEach((b) => { b.onclick = () => { game.schoolsPick = b.dataset.school; renderSchools(game, b.dataset.school); game.audio.play('ui'); }; });
}

// ←/→ step between schools while the page is open.
export function stepSchools(game, dir) {
  const ids = ['arcane', ...SCHOOLS.map((d) => d.id)];
  const i = (ids.indexOf(game.schoolsPick || 'arcane') + dir + ids.length) % ids.length;
  game.schoolsPick = ids[i];
  renderSchools(game, ids[i]);
  game.audio.play('ui');
}
