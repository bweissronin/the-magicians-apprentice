import { SCHOOLS, SANCTUMS, TOWER_FLOORS, RESOURCES, SHRINES, MASTERY_RANKS } from './data.js';
import { CHAPTERS, chapterOf, chapterGoals, chapterLabel, stability, ALDRIC_LETTER, GUARDIANS } from './story.js';
import { CREATURES } from './bestiary.js';

const $ = (id) => document.getElementById(id);

// The quest log (J): where you are and what's next, in two tabs.
//   Story  — every chapter on one line: done, current (with each goal and how far along it is),
//            and still to come; the Veil's seals and Aldric's letter.
//   Towers — the Arcane tower and the four sanctums side by side. Pick one to see every floor or
//            stage, and for the next one exactly what it needs: level or rank, a guardian, and
//            each material you have against what it costs, with where to find the rest.
export class QuestLog {
  constructor(game) {
    this.game = game;
    this.el = $('questlog');
    this.tab = 'story';
    this.tower = null;
    $('questlog-close').onclick = () => this.toggle(false);
  }
  get open() { return !this.el.classList.contains('hidden'); }
  toggle(force, tab) {
    const g = this.game, show = force ?? !this.open;
    if (show) {
      if (g.mode !== 'play') return;
      g.mode = 'questlog'; g.releasePointer();
      if (tab) this.tab = tab;
      this.render(); this.el.classList.remove('hidden'); g.audio.play('ui');
    } else if (this.open) {
      this.el.classList.add('hidden');
      if (g.mode === 'questlog') { g.mode = 'play'; g.input.lock(); }
      g.audio.play('ui');
    }
  }

  // Every tower as data: its steps, how many are built, and what the next one still needs.
  towers() {
    const s = this.game.state;
    const arcane = {
      id: 'arcane', name: 'The Arcane Tower', where: 'The valley', glyph: '✦', color: '#a792ff', open: true,
      built: s.floors, steadies: 'Each floor closes a rift over the valley and relights a ley line.',
      buildAt: 'Raise it at the Builder’s Altar by the tower, or from the tower plans [P] anywhere in the valley.',
      steps: TOWER_FLOORS.map((f) => ({ name: f.name, lore: f.lore, cost: f.cost, reqs: [{ text: `Level ${f.level}`, ok: s.level >= f.level }] })),
      reward: { label: 'Every floor adds a room to your tower — and the sixth, the Spire, is where the story ends.' },
    };
    const realms = SCHOOLS.map((d) => {
      const sanc = SANCTUMS[d.id], open = s.schoolUnlocked(d.id), rank = s.mastery(d.id);
      return {
        id: d.id, name: sanc.name, where: d.realm, glyph: d.glyph, color: d.color, open, lockWhy: s.gateBlock(d.id), hint: d.needs.hint,
        built: s.sanctumStage(d.id), steadies: sanc.steadies,
        buildAt: `Raise it at the cornerstone in ${d.realm} (cross the bridge at the valley’s edge).`,
        steps: sanc.stages.map((f) => ({
          name: f.name, lore: f.lore, cost: f.cost,
          reqs: [
            ...(f.rank ? [{ text: `${MASTERY_RANKS[f.rank]} in ${d.name} (you: ${MASTERY_RANKS[rank]})`, ok: rank >= f.rank, open: 'schools' }] : []),
            ...(f.guardian ? [{ text: `Defeat ${GUARDIANS[f.guardian].name}`, ok: s.guardians.includes(f.guardian) }] : []),
          ],
        })),
        reward: { label: `Completion boon — ${sanc.boon.name}`, desc: sanc.boon.desc },
      };
    });
    return [arcane, ...realms].map((t) => {
      const next = t.steps[t.built];
      const ready = !!(t.open && next && next.reqs.every((r) => r.ok) && s.canAfford(next.cost));
      return { ...t, next, ready, done: t.built >= t.steps.length };
    });
  }

  // Where to get a material, in a few words.
  source(k) {
    const s = this.game.state, r = RESOURCES[k];
    if (r.reagent) return { text: `Dropped by ${CREATURES[r.reagent].name}s`, beast: r.reagent };
    if (r.school) { const d = SCHOOLS.find((x) => x.id === r.school); return { text: `Harvested in ${d.realm}` }; }
    if (k === 'sigil') {
      const left = SHRINES.filter((x) => !s.shrines.includes(x.id));
      return { text: left.length ? `Won at a rune shrine — ${left.length} still unsolved` : 'Every shrine is solved' };
    }
    return { text: { wood: 'Charm trees in the valley', stone: 'Shape boulders in the valley', crystal: 'Attune crystals in the valley (level 2)', essence: 'Distil glowing flowers in the valley (level 3)' }[k] || '' };
  }

  render() {
    const s = this.game.state, towers = this.towers(), readyN = towers.filter((t) => t.ready).length;
    $('questlog-title').textContent = 'Quest Log';
    const tabs = `<div class="qx-tabs" role="tablist">
      <button class="qx-tab ${this.tab === 'story' ? 'on' : ''}" data-tab="story">Story <small>${chapterLabel(chapterOf(s))}</small></button>
      <button class="qx-tab ${this.tab === 'towers' ? 'on' : ''}" data-tab="towers">Towers <small>${stability(s)} / 25 seals${readyN ? ` · <b class="qx-ready">${readyN} ready to raise</b>` : ''}</small></button></div>`;
    $('questlog-body').innerHTML = tabs + (this.tab === 'story' ? this.storyTab(towers) : this.towersTab(towers));
    this.el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.render(); this.game.audio.play('ui'); }; });
    this.el.querySelectorAll('[data-tower]').forEach((b) => { b.onclick = () => { this.tab = 'towers'; this.tower = b.dataset.tower; this.render(); this.game.audio.play('ui'); }; });
    this.el.querySelectorAll('[data-beast]').forEach((b) => { b.onclick = () => { this.toggle(false); this.game.journal.toggle(true, b.dataset.beast); }; });
    this.el.querySelectorAll('[data-open="schools"]').forEach((b) => { b.onclick = () => { this.toggle(false); this.game.toggleSchools(true); }; });
  }

  storyTab(towers) {
    const s = this.game.state, n = chapterOf(s), seals = stability(s);
    const goalRow = (g) => `<li class="${g.done ? 'done' : ''}"><span class="qx-check">${g.done ? '✓' : ''}</span><span>${g.text}</span></li>`;
    const chapters = CHAPTERS.map((c) => {
      const goals = c.n <= n ? chapterGoals(s, c.n) : [], done = goals.filter((g) => g.done).length;
      if (c.n < n) {
        return `<details class="qx-ch done"><summary><span class="qx-num">✓</span><span><small>${chapterLabel(c.n)}</small><b>${c.title}</b></span><em>Complete</em></summary>
          <ul class="qx-goals">${goals.map(goalRow).join('')}</ul></details>`;
      }
      if (c.n === n) {
        return `<div class="qx-ch now"><div class="qx-chhead"><span class="qx-num">${c.n}</span><span><small>${chapterLabel(c.n)} · now</small><b>${c.title}</b></span><em>${done} of ${goals.length}</em></div>
          <p class="qx-blurb">${c.blurb}</p>
          <div class="qx-bar"><i style="width:${(done / goals.length) * 100}%"></i></div>
          <ul class="qx-goals">${goals.map(goalRow).join('')}</ul></div>`;
      }
      // Only the very next chapter gets a row; the rest of the road folds into one line.
      if (c.n === n + 1) return `<div class="qx-ch later"><span class="qx-num">${c.n}</span><span><small>${chapterLabel(c.n)}</small><b>???</b></span><em>Opens after ${chapterLabel(c.n - 1)}</em></div>`;
      return '';
    }).join('') + (CHAPTERS.length > n + 1
      ? `<div class="qx-road">${CHAPTERS.slice(n + 1).map((c) => `<i>${c.n}</i>`).join('')}<span>${CHAPTERS.length - n - 1} more chapter${CHAPTERS.length - n - 1 > 1 ? 's' : ''}, still veiled</span></div>` : '');
    // A compact line per tower, linking to the Towers tab.
    const strip = towers.map((t) => `<button class="qx-strip ${t.open ? '' : 'dim'}" data-tower="${t.id}" style="--c:${t.color}">
      <span class="qx-glyph">${t.open ? t.glyph : '🔒'}</span><span><b>${t.name}</b><i class="qx-mini"><i style="width:${(t.built / t.steps.length) * 100}%"></i></i></span>
      <em>${t.done ? 'Complete' : t.ready ? '<b class="qx-ready">Ready</b>' : `${t.built} / ${t.steps.length}`}</em></button>`).join('');
    return `<div class="qx-grid">
      <div class="qx-chapters">${chapters}</div>
      <div>
        <div class="qx-seals"><b>${seals}</b> of 25 seals hold the Veil<div class="qx-bar gold"><i style="width:${(seals / 25) * 100}%"></i></div>
          <small>Every Arcane floor and every sanctum stage adds a seal.</small></div>
        <div class="qx-sect">Towers</div>
        <div class="qx-strips">${strip}</div>
        <details class="qx-letter"><summary>Aldric’s letter</summary>${ALDRIC_LETTER.map((l) => `<p>${l}</p>`).join('')}</details>
      </div></div>`;
  }

  towersTab(towers) {
    const s = this.game.state;
    // Open on the tower that's ready to raise, else the one the story is working on.
    if (!towers.find((t) => t.id === this.tower)) this.tower = (towers.find((t) => t.ready) || towers.find((t) => t.open && !t.done) || towers[0]).id;
    const t = towers.find((x) => x.id === this.tower);
    const list = towers.map((x) => `<button class="qx-tw ${x.id === t.id ? 'on' : ''} ${x.open ? '' : 'dim'}" data-tower="${x.id}" style="--c:${x.color}">
      <span class="qx-glyph">${x.open ? x.glyph : '🔒'}</span>
      <span><b>${x.name}</b><small>${x.where}</small><i class="qx-mini"><i style="width:${(x.built / x.steps.length) * 100}%"></i></i></span>
      <em>${x.done ? '✓' : x.ready ? '<b class="qx-ready">Ready</b>' : x.open ? `${x.built}/${x.steps.length}` : 'Sealed'}</em></button>`).join('');
    const stepRow = (st, i) => {
      const state = i < t.built ? 'done' : i === t.built ? 'next' : 'later';
      if (state !== 'next') {
        return `<li class="qx-step ${state}"><span class="qx-num">${state === 'done' ? '✓' : i + 1}</span><div><b>${st.name}</b>${state === 'done' ? '' : `<small>${Object.entries(st.cost).map(([k, v]) => `${v} ${RESOURCES[k].name}`).join(' · ')}</small>`}</div></li>`;
      }
      const reqs = st.reqs.map((r) => `<span class="qx-req ${r.ok ? 'ok' : 'no'}" ${r.open && !r.ok ? `data-open="${r.open}" role="button"` : ''}>${r.ok ? '✓' : '✗'} ${r.text}</span>`).join('');
      const mats = Object.entries(st.cost).map(([k, v]) => {
        const have = Math.min(s.inv[k], v), ok = s.inv[k] >= v, src = this.source(k), r = RESOURCES[k];
        return `<li class="${ok ? 'ok' : ''}"><span class="qx-dot" style="--c:${r.color}"></span>
          <span class="qx-mat"><b>${r.name}</b><small ${src.beast && !ok ? `data-beast="${src.beast}" role="button" class="qx-link"` : ''}>${ok ? 'Enough' : src.text}${src.beast && !ok ? ' ›' : ''}</small></span>
          <span class="qx-count">${have} / ${v}</span><i class="qx-mini"><i style="width:${(have / v) * 100}%"></i></i></li>`;
      }).join('');
      return `<li class="qx-step next"><span class="qx-num">${i + 1}</span><div>
        <div class="qx-nexthead"><b>${st.name}</b>${t.ready ? '<span class="qx-ready pill">Ready to raise</span>' : '<span class="qx-pill">Next</span>'}</div>
        <p class="qx-lore">${st.lore}</p>
        ${reqs ? `<div class="qx-reqs">${reqs}</div>` : ''}
        <ul class="qx-mats">${mats}</ul>
        <small class="qx-where">${t.buildAt}</small></div></li>`;
    };
    const body = !t.open
      ? `<div class="qx-sealed"><b>🔒 ${t.where} is sealed — ${t.lockWhy}</b><span>${t.hint}.</span></div><ol class="qx-steps">${t.steps.map((st, i) => stepRow(st, i + 99)).join('')}</ol>`
      : `<ol class="qx-steps">${t.steps.map(stepRow).join('')}</ol>`;
    return `<div class="qx-towers">
      <div class="qx-twlist">${list}</div>
      <div class="qx-twpage" style="--c:${t.color}">
        <div class="qx-twhead"><span class="qx-big">${t.glyph}</span><div><h3>${t.name}</h3><small>${t.where} · ${t.done ? 'complete' : `${t.built} of ${t.steps.length} raised`}</small></div></div>
        <div class="qx-bar" style="--c:${t.color}"><i style="width:${(t.built / t.steps.length) * 100}%"></i></div>
        <p class="qx-lore">${t.steadies}</p>
        ${body}
        <div class="qx-reward ${t.done ? 'got' : ''}"><b>${t.reward.label}</b>${t.reward.desc ? ` — ${t.reward.desc}` : ''}</div>
      </div></div>`;
  }
}
