import { UPGRADES, POTIONS, PUZZLE_HINTS, LORE, SHRINES, RESOURCES, SPELLS } from './data.js';
import { roomGuide, towerDirectory } from './roomguide.js';

const $ = (id) => document.getElementById(id);
const PUZZLE_NAMES = { sequence: 'Echoing Runes', lights: 'Ley-Line Nexus', rings: 'Astral Lock' };

// The station panels inside the tower: spell research, hints, brewing, star chart, trophies.
export class RoomUI {
  constructor(game) {
    this.game = game;
    this.el = $('room-panel');
    this.station = null;
    $('rp-close').onclick = () => this.game.closeRoomPanel();
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  // `guide` (for station 'guide'): { def, floor, tab: 'room' | 'tower', here } — see openGuide in main.js.
  open(station, guide = null) {
    this.station = station;
    this.guide = guide;
    this.render();
    this.el.classList.remove('hidden');
  }

  close() { this.el.classList.add('hidden'); this.station = null; }

  costChips(cost) {
    const s = this.game.state;
    return Object.entries(cost).map(([k, v]) =>
      `<span class="cost ${s.inv[k] >= v ? 'ok' : 'no'}">${RESOURCES[k].name} ${Math.min(s.inv[k], v)}/${v}</span>`).join('');
  }

  render() {
    const s = this.game.state;
    const set = (eyebrow, title, body) => { $('rp-eyebrow').textContent = eyebrow; $('rp-title').textContent = title; $('rp-body').innerHTML = body; };
    this.el.classList.toggle('guide', this.station === 'guide');
    switch (this.station) {
      case 'guide': this.renderGuide(set); break;
      case 'trophies': {
        const rows = SHRINES.map((sh) => {
          const done = s.shrines.includes(sh.id);
          const col = '#' + sh.color.toString(16).padStart(6, '0');
          return `<div class="rp-row ${done ? '' : 'dim'}"><div class="rp-icon" style="--c:${done ? col : '#555'}">◆</div>
            <div><h3>${sh.name}</h3><div class="lore">${done ? `Attuned — its Sigil hums on your shelf.` : `Unattuned · requires level ${sh.level} · ${PUZZLE_NAMES[sh.puzzle]}`}</div></div>
            <div>${done ? '<span class="cost ok">Attuned ✓</span>' : ''}</div></div>`;
        }).join('');
        set('Entrance Hall', 'Hall of Sigils', `<p class="rp-intro">Every shrine you attune leaves a Sigil here. ${s.shrines.length} of ${SHRINES.length} gathered.</p>${rows}`);
        break;
      }
      case 'upgrades': {
        const rows = UPGRADES.map((u) => {
          const rank = s.up(u.id);
          const locked = u.requires && !s.hasSpell(u.requires);
          const maxed = rank >= u.max;
          const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
          const cost = maxed ? {} : u.cost[rank];
          const can = !locked && !maxed && s.canAfford(cost);
          const rq = SPELLS.find((x) => x.id === u.requires);
          const req = locked ? `Requires ${rq.name} (${rq.school ? `master ${rq.school[0].toUpperCase() + rq.school.slice(1)}` : `level ${rq.level}`})` : '';
          return `<div class="rp-row ${locked ? 'dim' : ''}"><div class="rp-icon">${u.icon}</div>
            <div><h3>${u.name} <span class="rp-pips">${pips}</span></h3>
              <div class="lore">${maxed ? 'Fully mastered.' : req || `Next: ${u.desc[rank]}`}</div>
              <div class="costs">${maxed || locked ? '' : this.costChips(cost)}</div></div>
            <div>${maxed ? '<span class="cost ok">Mastered</span>' : `<button class="btn ${can ? 'primary' : ''}" data-up="${u.id}" ${can ? '' : 'disabled'}>Research</button>`}</div></div>`;
        }).join('');
        set("Apprentice's Study", 'The Spell Tome', `<p class="rp-intro">Pour essence and crystal into the Tome to deepen your craft.</p>${rows}`);
        this.el.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => this.research(b.dataset.up); });
        break;
      }
      case 'hints': {
        const next = SHRINES.find((x) => !s.shrines.includes(x.id));
        const lore = LORE[s.hintsRead % LORE.length];
        const body = next
          ? `<div class="rp-hint"><div class="eyebrow">Next trial</div><h3>${next.name} — ${PUZZLE_NAMES[next.puzzle]}</h3>
              <ul>${PUZZLE_HINTS[next.puzzle].map((h) => `<li>${h}</li>`).join('')}</ul>
              ${next.level > s.level ? `<p class="lore">Its runes will only answer a level ${next.level} mage.</p>` : ''}</div>`
          : `<div class="rp-hint"><h3>Every shrine is attuned.</h3><p class="lore">There is nothing left in these pages you have not already mastered.</p></div>`;
        s.hintsRead++;
        set('Arcane Library', 'The Reading Lectern', `${body}<div class="rp-lore"><div class="eyebrow">From the stacks</div><p>“${lore}”</p></div>`);
        break;
      }
      case 'brew': {
        const active = POTIONS.filter((p) => s.hasBuff(p.id)).map((p) => `<span class="cost ok">${p.icon} ${p.name} · ${Math.ceil(s.buffs[p.id])}s</span>`).join('');
        const rows = POTIONS.map((p) => {
          const can = s.canAfford(p.cost);
          return `<div class="rp-row"><div class="rp-icon" style="--c:${p.color}">${p.icon}</div>
            <div><h3>${p.name}</h3><div class="lore">${p.desc}</div><div class="costs">${this.costChips(p.cost)}</div></div>
            <div><button class="btn ${can ? 'primary' : ''}" data-brew="${p.id}" ${can ? '' : 'disabled'}>Brew & drink</button></div></div>`;
        }).join('');
        set('Alchemy Laboratory', 'The Bubbling Cauldron', `<p class="rp-intro">Distill essence into potions. They take effect the moment you drink them.</p>${active ? `<div class="costs rp-active">${active}</div>` : ''}${rows}`);
        this.el.querySelectorAll('[data-brew]').forEach((b) => { b.onclick = () => this.brew(b.dataset.brew); });
        break;
      }
      case 'travel': {
        const dests = [{ id: 'home', name: 'Tower Courtyard', note: 'Step outside your front door', x: 0, z: 13 }];
        SHRINES.forEach((sh) => { if (s.shrines.includes(sh.id)) dests.push({ id: sh.id, name: sh.name, note: 'Attuned shrine', x: sh.x, z: sh.z + 9 }); });
        const rows = dests.map((d, i) => `<div class="rp-row"><div class="rp-icon" style="--c:#8fd8ff">✧</div>
          <div><h3>${d.name}</h3><div class="lore">${d.note}</div></div>
          <div><button class="btn primary" data-travel="${i}">Travel</button></div></div>`).join('');
        const locked = SHRINES.length - s.shrines.length;
        set('Star Observatory', 'The Star Chart', `<p class="rp-intro">The telescope can fold the sky between any place your magic has touched.${locked ? ` Attune more shrines to chart ${locked} more destination${locked > 1 ? 's' : ''}.` : ''}</p>${rows}`);
        this.el.querySelectorAll('[data-travel]').forEach((b) => { b.onclick = () => this.game.fastTravel(dests[+b.dataset.travel]); });
        break;
      }
    }
  }

  // The room guide: what this room is for, or a directory of the whole tower.
  renderGuide(set) {
    const gd = this.guide, g = this.game;
    const tabs = `<div class="rg-tabs">${gd.floor != null ? `<button class="rg-tab ${gd.tab === 'room' ? 'on' : ''}" data-tab="room">${gd.floor === gd.here ? 'This room' : 'Room'}</button>` : ''}
      <button class="rg-tab ${gd.tab === 'tower' ? 'on' : ''}" data-tab="tower">Whole tower</button></div>`;
    const foot = '<p class="rg-foot">Press <kbd>I</kbd> any time to open this guide.</p>';
    if (gd.tab === 'room') {
      const r = roomGuide(g, gd.def, gd.floor, gd.floor === gd.here ? g.interior.interactables : []);
      const rows = r.does.map((d) => `<div class="rp-row rg-do"><div class="rp-icon">${d.icon}</div>
        <div><h3>${d.what}${d.used ? '' : ' <span class="rg-new">Not tried yet</span>'}</h3>
          <div class="lore">${d.how}</div>
          <div class="rg-value"><b>Why it matters</b> ${d.value}</div>
          <div class="rg-status">${d.status}</div></div><div></div></div>`).join('');
      const above = r.above ? `<div class="rg-above ${r.above.built ? '' : 'locked'}">${r.above.built ? '⬆' : '🔒'} ${r.above.text}</div>` : '';
      set(r.eyebrow, r.title, `${tabs}<p class="rp-intro">${r.blurb}</p><div class="eyebrow rg-h">What you can do here</div>${rows}${above}${foot}`);
    } else {
      const d = towerDirectory(g, gd.def);
      const rows = d.rows.map((r) => `<div class="rp-row rg-floor ${r.built ? '' : 'dim'} ${r.floor === gd.here ? 'here' : ''}" ${r.built ? `data-floor="${r.floor}"` : ''}>
        <div class="rp-icon">${r.floor + 1}</div>
        <div><h3>${r.name}${r.floor === gd.here ? ' <span class="rg-here">You are here</span>' : ''}${r.fresh ? ' <span class="rg-new">Something new</span>' : ''}</h3>
          <div class="lore">${r.gist}</div>${r.lock ? `<div class="rg-status">🔒 ${r.lock}</div>` : ''}</div>
        <div>${r.built ? '<span class="rg-go">Details ›</span>' : ''}</div></div>`).join('');
      const built = d.rows.filter((r) => r.built).length;
      set(d.eyebrow, d.title, `${tabs}<p class="rp-intro">${built} of ${d.rows.length} rooms raised. Rooms marked <span class="rg-new">Something new</span> hold a station you haven't tried yet.</p>${rows}${foot}`);
      this.el.querySelectorAll('[data-floor]').forEach((b) => { b.onclick = () => { gd.floor = +b.dataset.floor; gd.tab = 'room'; this.game.audio.play('ui'); this.render(); }; });
    }
    this.el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { gd.tab = b.dataset.tab; if (gd.tab === 'room' && gd.floor == null) gd.floor = gd.here; this.game.audio.play('ui'); this.render(); }; });
  }

  research(id) {
    const s = this.game.state, u = UPGRADES.find((x) => x.id === id);
    const rank = s.up(id);
    if (rank >= u.max || !s.canAfford(u.cost[rank])) return;
    s.spend(u.cost[rank]);
    s.upgrades[id] = rank + 1;
    if (id === 'well') s.mana = s.maxMana;
    this.game.audio.play('levelup');
    if (id === 'radiance' && rank === 0) {
      s.element = 'radiance';
      this.game.ui.banner('Radiance', 'A new attunement · press 2', 'Your bolt can carry light. Spirits standing in it must be solid — and crystal eyes are dazzled.', 6000);
      this.game.story?.onEvent('radiance');
    } else this.game.ui.toast(`${u.name} — rank ${rank + 1}`, '#8fd8ff', u.desc[rank]);
    this.game.interior.fx.burst(this.game.player.pos.clone().setY(1.8), { count: 60, color: '#9fe8ff', speed: 5, size: 0.4, life: 1 });
    this.game.save();
    this.render();
  }

  brew(id) {
    const s = this.game.state, p = POTIONS.find((x) => x.id === id);
    if (!s.canAfford(p.cost)) return;
    s.spend(p.cost);
    if (p.id === 'mana') s.mana = s.maxMana;
    else s.buffs[p.id] = p.duration;
    this.game.audio.play('solve');
    this.game.ui.toast(`${p.icon} ${p.name}`, p.color, p.duration ? `Active for ${Math.round(p.duration / 60 * 10) / 10} min` : 'Mana restored');
    this.game.interior.fx.burst(this.game.player.pos.clone().setY(1.6), { count: 70, color: p.color, speed: 4, size: 0.45, life: 1.2, gravity: -1 });
    this.game.save();
    this.render();
  }
}
