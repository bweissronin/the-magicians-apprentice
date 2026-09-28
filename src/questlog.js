import { SCHOOLS, SANCTUMS, TOWER_FLOORS, RESOURCES, SHRINES, MASTERY_RANKS, ALTAR_POS, THRESHOLDS } from './data.js';
import { CHAPTERS, chapterOf, chapterGoals, chapterLabel, stability, ALDRIC_LETTER, GUARDIANS } from './story.js';
import { CREATURES } from './bestiary.js';

const $ = (id) => document.getElementById(id);

// The quest log (J) opens on what to do next.
//   next   — one short to-do list: the chapter's open goals, and for each tower you can work on,
//            its next floor or stage with only what's still missing. Click a line to pin it: the
//            HUD waypoint then leads there (across a bridge first if it's in another land).
//            Beside it, progress at a glance: chapter, seals, and a row of pips per tower.
//   story  — every chapter so far, one click deeper.
//   towers — one tower's every floor or stage, and for the next one exactly what it needs.
export class QuestLog {
  constructor(game) {
    this.game = game;
    this.el = $('questlog');
    this.tab = 'next';
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
        buildAt: `Raise it at the cornerstone in ${d.realm} (through ${THRESHOLDS[d.id].name} at the valley’s edge).`,
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
    return { text: { wood: 'Charm trees in the valley', stone: 'Shape boulders in the valley', crystal: 'Gather crystals in the valley (level 2)', essence: 'Distil glowing flowers in the valley (level 3)' }[k] || '' };
  }

  render() {
    const towers = this.towers();
    $('questlog-title').textContent = 'Quest Log';
    const back = `<button class="qn-back" data-view="next">‹ Next steps</button>`;
    $('questlog-body').innerHTML = this.tab === 'story' ? back + this.storyTab()
      : this.tab === 'towers' ? back + this.towersTab(towers) : this.nextView(towers);
    const on = (sel, fn) => this.el.querySelectorAll(sel).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); fn(b); this.game.audio.play('ui'); }; });
    on('[data-view]', (b) => { this.tab = b.dataset.view; this.render(); });
    on('[data-tower]', (b) => { this.tab = 'towers'; this.tower = b.dataset.tower; this.render(); });
    on('[data-pin]', (b) => { this.pin(this.pins[+b.dataset.pin]); this.render(); });
    on('[data-all]', () => { this.showAll = !this.showAll; this.render(); });
    this.el.querySelectorAll('[data-beast]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); this.toggle(false); this.game.journal.toggle(true, b.dataset.beast); }; });
    this.el.querySelectorAll('[data-open="schools"]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); this.toggle(false); this.game.toggleSchools(true); }; });
  }

  // Pin a line (or unpin it if it's already pinned). The HUD resolves where it points each frame.
  pin(p) {
    const g = this.game, same = g.pin && p && g.pin.key === p.key;
    g.pin = same ? null : p;
    g.ui.toast(same ? 'Pin cleared' : `📍 ${p.label}`, '#ffd36b', same ? '' : 'Follow the marker');
  }

  // Where a material comes from, as a pin: a node to harvest, a shrine, or a creature to track.
  gatherPin(k, need) {
    const s = this.game.state, r = RESOURCES[k], label = `Gather ${need - Math.min(s.inv[k], need)} more ${r.name}`;
    if (r.reagent) return null; // creatures are tracked from the bestiary instead
    if (k === 'sigil') { const sh = SHRINES.find((x) => !s.shrines.includes(x.id) && x.level <= s.level); return sh ? { key: 'sigil', label: `Solve ${sh.name}`, realm: null, kind: 'point', x: sh.x, z: sh.z } : null; }
    return { key: 'res:' + k, label, realm: r.school || null, kind: 'node', res: k, need };
  }

  nextView(towers) {
    const s = this.game.state, n = chapterOf(s), goals = chapterGoals(s, n), seals = stability(s), C = CHAPTERS[n - 1], here = this.game.realm?.id || 'arcane';
    const pinned = this.game.pin?.key;
    this.pins = [];
    const pinAttr = (p) => { if (!p) return ''; this.pins.push(p); return `data-pin="${this.pins.length - 1}" role="button" title="Pin on the map"`; };
    const pinMark = (p) => p ? `<span class="qn-pin ${pinned === p.key ? 'on' : ''}">${pinned === p.key ? '◆ Pinned' : '◇ Pin'}</span>` : '';
    const items = [];
    const handled = new Set();
    // A tower's next step, reduced to what's still missing.
    const towerItem = (t) => {
      handled.add(t.id);
      const st = t.next, sanc = t.id !== 'arcane';
      const where = sanc ? SCHOOLS.find((d) => d.id === t.id).realm : 'the valley';
      const raise = sanc ? { key: 'raise:' + t.id, label: `Raise ${st.name}`, realm: t.id, kind: 'sanctum' }
        : { key: 'raise:arcane', label: `Raise ${st.name}`, realm: null, kind: 'point', x: ALTAR_POS.x, z: ALTAR_POS.z };
      if (t.ready) {
        return `<li class="qn-item ready" style="--c:${t.color}" ${pinAttr(raise)}><span class="qn-ico">${t.glyph}</span>
          <div><b>Raise ${st.name}</b><small>${t.name} · ${sanc ? `the cornerstone in ${where}` : 'the Builder’s Altar'}</small></div><span class="qn-tag">Ready</span>${pinMark(raise)}</li>`;
      }
      const miss = [
        ...st.reqs.filter((r) => !r.ok).map((r) => `<span class="qn-need" ${r.open ? `data-open="${r.open}" role="button"` : ''}>${r.text.replace(/ \(you: .*\)$/, '')}${r.open ? ' ›' : ''}</span>`),
        ...Object.entries(st.cost).filter(([k, v]) => s.inv[k] < v).map(([k, v]) => {
          const r = RESOURCES[k], p = this.gatherPin(k, v), src = this.source(k);
          const attr = p ? pinAttr(p) : r.reagent ? `data-beast="${r.reagent}" role="button" title="${src.text}"` : '';
          return `<span class="qn-need mat ${p && pinned === p.key ? 'on' : ''}" style="--c:${r.color}" ${attr}><i></i>${r.name} ${Math.min(s.inv[k], v)}/${v}</span>`;
        }),
      ].join('');
      return `<li class="qn-item" style="--c:${t.color}"><span class="qn-ico">${t.glyph}</span>
        <div><b>Raise ${st.name}</b><small>${t.name} · ${where}</small><div class="qn-needs">${miss}</div></div>
        <button class="qn-more" data-tower="${t.id}" title="Every ${sanc ? 'stage' : 'floor'}">›</button></li>`;
    };
    for (const goal of goals.filter((x) => !x.done)) {
      const t = towers.find((x) => x.open && x.next && goal.text.includes(x.next.name));
      if (t) { if (!handled.has(t.id)) items.push({ ready: t.ready, here: t.id === here, html: towerItem(t) }); continue; }
      const p = goal.target ? { key: 'goal:' + goal.text, label: goal.text.replace(/<[^>]+>/g, ''), realm: null, kind: 'point', x: goal.target.x, z: goal.target.z } : null;
      const schools = /Initiate|Master/.test(goal.text) ? 'data-open="schools" role="button"' : '';
      items.push({ html: `<li class="qn-item story" ${p ? pinAttr(p) : schools}><span class="qn-ico">◇</span><div><b>${goal.text}</b><small>${chapterLabel(n)} · ${C.title}</small></div>${p ? pinMark(p) : schools ? '<span class="qn-go">Schools ›</span>' : ''}</li>` });
    }
    // Then any other tower that can move forward (ready ones first).
    for (const t of [...towers].sort((a, b) => b.ready - a.ready)) if (t.open && !t.done && !handled.has(t.id)) items.push({ ready: t.ready, here: t.id === here, html: towerItem(t) });
    // Something you can raise right now comes first, then the tower of the land you're standing in.
    items.sort((a, b) => (!!b.ready - !!a.ready) || (!!b.here - !!a.here));
    const MAX = 4, more = items.length - MAX;
    const list = items.length ? items.map((i, k) => k < MAX || this.showAll ? i.html : '').join('') : '<li class="qn-empty">Nothing pressing. Explore, banish, and gather for what comes next.</li>';

    const pips = (t) => t.steps.map((_, i) => `<i class="${i < t.built ? 'on' : ''}"></i>`).join('');
    const rows = towers.map((t) => `<button class="qn-tw ${t.open ? '' : 'dim'}" data-tower="${t.id}" style="--c:${t.color}">
      <span class="qn-twn">${t.open ? t.glyph : '🔒'} ${t.name.replace(/^The /, '')}</span><span class="qn-pips">${pips(t)}</span>
      <em>${t.done ? '✓' : t.ready ? '<b class="qx-ready">Ready</b>' : t.open ? '' : 'Locked'}</em></button>`).join('');
    return `<div class="qn-grid">
      <section class="qn-do"><h4>Do next</h4><ul class="qn-list">${list}</ul>
        ${more > 0 ? `<button class="qn-show" data-all="1">${this.showAll ? 'Show fewer' : `Show ${more} more`}</button>` : ''}
        <p class="qn-note">Pick a line to pin it: the marker on your screen leads the way.</p></section>
      <aside class="qn-side">
        <button class="qn-chapter" data-view="story"><small>${chapterLabel(n)} of ${chapterLabel(CHAPTERS.length).replace('Chapter ', '')}</small><b>${C.title}</b>
          <span class="qx-bar"><i style="width:${(goals.filter((x) => x.done).length / goals.length) * 100}%"></i></span><em>Story so far ›</em></button>
        <div class="qn-seals"><div><b>${seals}</b> / 25 seals hold the Veil</div><span class="qx-bar gold"><i style="width:${(seals / 25) * 100}%"></i></span>
          <small>Your tower’s first five floors and every sanctum stage each add a seal.</small></div>
        <div class="qn-tws">${rows}</div>
        <details class="qx-letter"><summary>Aldric’s letter</summary>${ALDRIC_LETTER.map((l) => `<p>${l}</p>`).join('')}</details>
      </aside></div>`;
  }

  storyTab() {
    const s = this.game.state, n = chapterOf(s);
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
    return `<div class="qx-chapters qn-story">${chapters}</div>`;
  }

  towersTab(towers) {
    const s = this.game.state;
    // Open on the tower that's ready to raise, else the one the story is working on.
    if (!towers.find((t) => t.id === this.tower)) this.tower = (towers.find((t) => t.ready) || towers.find((t) => t.open && !t.done) || towers[0]).id;
    const t = towers.find((x) => x.id === this.tower);
    const list = towers.map((x) => `<button class="qx-tw ${x.id === t.id ? 'on' : ''} ${x.open ? '' : 'dim'}" data-tower="${x.id}" style="--c:${x.color}">
      <span class="qx-glyph">${x.open ? x.glyph : '🔒'}</span>
      <span><b>${x.name}</b><small>${x.where}</small><i class="qx-mini"><i style="width:${(x.built / x.steps.length) * 100}%"></i></i></span>
      <em>${x.done ? '✓' : x.ready ? '<b class="qx-ready">Ready</b>' : x.open ? `${x.built}/${x.steps.length}` : 'Locked'}</em></button>`).join('');
    const stepRow = (st, i, locked = false) => {
      const state = locked ? 'later' : i < t.built ? 'done' : i === t.built ? 'next' : 'later';
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
      ? `<div class="qx-sealed"><b>🔒 ${t.where} is locked — ${t.lockWhy}</b><span>${t.hint}.</span></div><ol class="qx-steps">${t.steps.map((st, i) => stepRow(st, i, true)).join('')}</ol>`
      : `<ol class="qx-steps">${t.steps.map((st, i) => stepRow(st, i)).join('')}</ol>`;
    return `<div class="qx-towers">
      <div class="qx-twlist">${list}</div>
      <div class="qx-twpage" style="--c:${t.color}">
        <div class="qx-twhead"><span class="qx-big">${t.glyph}</span><div><h3>${t.name}</h3><small>${t.where} · ${t.done ? 'complete' : `${t.built} of ${t.steps.length} ${t.id === 'arcane' ? 'floors' : 'stages'} raised`}</small></div></div>
        <div class="qx-bar" style="--c:${t.color}"><i style="width:${(t.built / t.steps.length) * 100}%"></i></div>
        <p class="qx-lore">${t.steadies}</p>
        ${body}
        <div class="qx-reward ${t.done ? 'got' : ''}"><b>${t.reward.label}</b>${t.reward.desc ? ` — ${t.reward.desc}` : ''}</div>
      </div></div>`;
  }
}
