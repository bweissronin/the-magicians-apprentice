import { CREATURES, CREATURE_ORDER, ELEMENTS, EL, neededFor, elementVerdict } from './bestiary.js';
import { RESOURCES, SCHOOLS } from './data.js';
import { CreatureStage } from './creaturestage.js';

const $ = (id) => document.getElementById(id);

// Sketch plates for each creature, drawn in the margin of Aldric's bestiary. A rumour shows
// only the silhouette.
const PLATES = {
  shade: `<g fill="var(--tint)" stroke="var(--ink-c)" stroke-width="2" stroke-linejoin="round">
    <path d="M65 22 C90 26 104 52 96 76 C90 96 104 108 92 128 C84 118 78 132 66 124 C56 134 48 118 38 126 C32 106 26 92 34 72 C28 50 42 24 65 22Z"/>
    <path d="M44 64 q10 -8 20 0 M66 64 q10 -8 20 0" fill="none"/><circle cx="54" cy="66" r="3.5" fill="var(--eye)" stroke="none"/><circle cx="76" cy="66" r="3.5" fill="var(--eye)" stroke="none"/>
    <path d="M100 40 q14 -6 20 6 M30 44 q-14 -4 -18 8" fill="none" opacity=".6"/></g>`,
  specter: `<g fill="var(--tint)" stroke="var(--ink-c)" stroke-width="2" stroke-linejoin="round">
    <path d="M65 14 C88 14 98 34 98 52 L104 108 L94 100 L88 132 L78 116 L66 138 L56 116 L44 132 L38 100 L28 108 L34 52 C34 34 44 14 65 14Z"/>
    <path d="M48 40 C50 26 80 26 82 40 L80 62 C72 70 58 70 50 62Z" fill="#0d1a14"/>
    <circle cx="58" cy="50" r="3.5" fill="var(--eye)" stroke="none"/><circle cx="72" cy="50" r="3.5" fill="var(--eye)" stroke="none"/>
    <path d="M34 70 L14 86 M96 70 L116 86" /><path d="M14 86 l-4 6 M14 86 l2 7 M116 86 l4 6 M116 86 l-2 7" /></g>`,
  bones: `<g fill="var(--tint)" stroke="var(--ink-c)" stroke-width="2" stroke-linejoin="round">
    <path d="M48 26 C48 12 82 12 82 26 L82 40 C80 48 50 48 48 40Z"/><path d="M44 30 L86 30" /><circle cx="58" cy="36" r="3.5" fill="var(--eye)" stroke="none"/><circle cx="72" cy="36" r="3.5" fill="var(--eye)" stroke="none"/>
    <path d="M65 48 L65 96 M52 58 q13 6 26 0 M52 68 q13 6 26 0 M54 78 q11 5 22 0" fill="none"/>
    <path d="M65 96 L52 138 M65 96 L78 138 M52 58 L34 88 M78 58 L100 70 L112 40" fill="none"/>
    <circle cx="34" cy="92" r="16"/><circle cx="34" cy="92" r="5" fill="var(--ink-c)" stroke="none" opacity=".5"/></g>`,
  golem: `<g fill="var(--tint)" stroke="var(--ink-c)" stroke-width="2" stroke-linejoin="round">
    <path d="M40 22 L90 22 L98 48 L32 48 Z"/><circle cx="54" cy="36" r="4" fill="var(--eye)" stroke="none"/><circle cx="76" cy="36" r="4" fill="var(--eye)" stroke="none"/>
    <path d="M24 52 L106 52 L112 102 L18 102 Z"/><path d="M48 62 L82 62 L78 92 L52 92 Z" fill="none"/>
    <circle cx="65" cy="77" r="6" fill="#ffb347" stroke="none" opacity=".75"/>
    <path d="M18 56 L4 96 L16 100 M112 56 L126 96 L114 100" fill="none"/>
    <path d="M34 102 L30 140 L52 140 L54 102 M76 102 L78 140 L100 140 L96 102"/></g>`,
  wraith: `<g fill="var(--tint)" stroke="var(--ink-c)" stroke-width="2" stroke-linejoin="round">
    <path d="M65 18 L84 34 L92 70 L104 58 L100 96 L112 124 L86 112 L76 138 L64 118 L52 138 L42 112 L18 124 L30 96 L26 58 L38 70 L46 34 Z"/>
    <path d="M52 42 L78 42 L74 64 L56 64 Z" fill="#0d1624"/><circle cx="60" cy="52" r="3" fill="var(--eye)" stroke="none"/><circle cx="70" cy="52" r="3" fill="var(--eye)" stroke="none"/>
    <path d="M40 84 l-8 -18 l10 6 M90 84 l8 -18 l-10 6 M58 90 l7 -14 l7 14" fill="none" opacity=".7"/></g>`,
  imp: `<g fill="var(--tint)" stroke="var(--ink-c)" stroke-width="2" stroke-linejoin="round">
    <path d="M44 40 L36 14 L54 32 M86 40 L94 14 L76 32" /><circle cx="65" cy="56" r="26"/>
    <circle cx="55" cy="54" r="4" fill="var(--eye)" stroke="none"/><circle cx="75" cy="54" r="4" fill="var(--eye)" stroke="none"/><path d="M54 68 q11 8 22 0" fill="none"/>
    <path d="M46 80 C40 100 44 116 54 124 L60 110 L70 110 L76 124 C86 116 90 100 84 80Z"/>
    <path d="M84 110 q20 6 24 -10 l6 2 l-4 -8" fill="none"/><path d="M58 20 q6 -12 12 0 q-6 -4 -12 0" fill="#ff8a3c" stroke="none"/></g>`,
};
const TINT = { bones: ['#4a4438', '#8dffb0'], shade: ['#3a2350', '#c04dff'], specter: ['#1e3a2e', '#7dff9b'], golem: ['#5a4430', '#ffd36b'], wraith: ['#24405a', '#9fe8ff'], imp: ['#5a2414', '#ffd36b'] };
const VERDICT = { weak: ['Weak', 'weak'], resisted: ['Resisted', 'res'], neutral: ['Neutral', 'neu'], heals: ['Heals it', 'heal'], armour: ['Chips its armour', 'res'] };

// Aldric's half-finished bestiary: entries fill in as the apprentice sees, tries and loots
// each creature. Opened with B anywhere, or at the lectern in the Study.
export class Journal {
  constructor(game) {
    this.game = game;
    this.kind = 'shade';
    this.el = $('journal');
    $('journal-close').onclick = () => this.toggle(false);
  }

  get open() { return !this.el.classList.contains('hidden'); }

  toggle(force, kind) {
    const g = this.game, show = force ?? !this.open;
    if (kind) this.kind = kind;
    if (show) {
      if (g.mode !== 'play' && g.mode !== 'journal' && g.mode !== 'build' && g.mode !== 'panel') return;
      this.returnMode = g.mode === 'journal' ? this.returnMode : g.mode;
      if (this.returnMode === 'build') $('build').classList.add('hidden');
      g.mode = 'journal'; g.releasePointer();
      this.el.classList.remove('hidden');
      this.render();
      this.animate();
      g.audio.play('ui');
    } else if (this.open) {
      this.el.classList.add('hidden');
      cancelAnimationFrame(this.raf); this.raf = 0;
      if (this.returnMode === 'build') { $('build').classList.remove('hidden'); g.mode = 'build'; g.ui.renderBuild(g.buildSchool); }
      else if (this.returnMode === 'panel') { g.mode = 'panel'; }
      else { g.mode = 'play'; g.input.lock(); }
      g.audio.play('ui');
    }
  }

  // The creature on its pedestal turns while the journal is open.
  animate() {
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const step = (now) => {
      if (!this.open) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const host = this.el.querySelector('.jb-stage');
      if (host && this.stage && this.kind !== 'elements') {
        const w = host.clientWidth, h = host.clientHeight;
        if (w !== this.sw || h !== this.sh) { this.sw = w; this.sh = h; this.stage.resize(w, h); this.stage.show(this.kind, this.look(this.kind)); }
        this.stage.frame(dt, now / 1000);
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  look(kind) { const b = this.game.state.beast(kind); return { seen: b.seen, tint: b.seen ? TINT[kind] : ['#2a2440', '#6a6280'] }; }

  // Which entries exist: rumours arrive with the chapter where a creature lives.
  known(kind) {
    const s = this.game.state, b = s.beast(kind), d = CREATURES[kind];
    if (b.seen || b.rumour) return true;
    return !d.realm || s.schoolUnlocked(d.realm) || s.level >= (SCHOOLS.find((x) => x.id === d.realm)?.level ?? 99) - 1;
  }

  render() {
    const s = this.game.state;
    this.stage ||= new CreatureStage();
    const list = CREATURE_ORDER.filter((k) => this.known(k));
    if (!list.includes(this.kind) && this.kind !== 'elements') this.kind = list[0] || 'elements';
    // Roster: a portrait of each creature (its silhouette until met).
    const tabs = list.map((k) => {
      const b = s.beast(k), d = CREATURES[k], look = this.look(k);
      return `<button class="jb-tab ${k === this.kind ? 'on' : ''} ${b.seen ? '' : 'rumour'}" data-k="${k}" style="--glow:${look.tint[1]}">
        <img src="${this.stage.thumb(k, look.seen, look.tint)}" alt="">
        <span>${b.seen ? d.name : 'Rumour'}<small>${b.seen ? `${b.kills} banished` : d.home}</small></span>${s.tracked === k ? '<i class="jb-pin" title="Tracked">◆</i>' : ''}</button>`;
    }).join('') + `<button class="jb-tab ${this.kind === 'elements' ? 'on' : ''}" data-k="elements"><span class="jb-el-ico">✦</span><span>Attunements<small>${ELEMENTS.filter((e) => s.knows(e.id)).length} of 5 known</small></span></button>`;
    $('journal-tabs').innerHTML = tabs;
    const page = $('journal-page');
    page.className = this.kind === 'elements' ? 'jb-page elements' : 'jb-page';
    page.innerHTML = this.kind === 'elements' ? this.elementsPage() : this.page(this.kind);
    if (this.kind !== 'elements') {
      this.el.querySelector('.jb-stage').appendChild(this.stage.canvas);
      this.sw = this.sh = 0; // re-fit on the next frame
    }
    this.el.querySelectorAll('.jb-tab').forEach((b) => { b.onclick = () => { this.kind = b.dataset.k; this.render(); this.game.audio.play('ui'); }; });
    const tr = this.el.querySelector('[data-track]');
    if (tr) tr.onclick = () => { s.tracked = s.tracked === this.kind ? null : this.kind; this.render(); this.game.ui.toast(s.tracked ? `Tracking ${CREATURES[this.kind].name}` : 'Tracking cleared', '#ffd36b', s.tracked ? 'Shown on your quest line and minimap' : ''); };
  }

  page(kind) {
    const s = this.game.state, d = CREATURES[kind], b = s.beast(kind), [tint, glow] = this.look(kind).tint;
    const ranks = ['common', 'elder', 'dread'].map((r) => `<span class="${b.ranks[r] ? 'on' : ''}">${r[0].toUpperCase() + r.slice(1)}${b.ranks[r] ? '' : ' ?'}</span>`).join('');
    const hero = (title, sub, quote) => `<section class="jb-hero" style="--tint:${tint};--glow:${glow}">
      <div class="jb-stage"></div>
      <header class="jb-title"><div class="jb-sub">${sub}</div><h3>${title}</h3></header>
      <div class="jb-ranks">${ranks}</div>
      <p class="jb-quote">${quote}</p>
    </section>`;
    if (!b.seen) {
      return `${hero('Rumour', d.home, d.rumour)}
        <aside class="jb-side">
          <div class="jb-card"><h4>Where</h4><p>${d.home}${d.realm ? ` — ${s.schoolUnlocked(d.realm) ? 'the gate is open' : `gate ${s.gateBlock(d.realm)}`}` : ''}</p><p class="jb-dim">${d.when}</p></div>
          <div class="jb-card jb-locked"><h4>Unwritten</h4><p>Meet one to begin its page: its weaknesses, what it carries, and how to study it.</p></div>
        </aside>`;
    }
    // Weaknesses: one badge per element, filled in as you try them.
    const els = ELEMENTS.map((e) => {
      const v = b.tried[e.id];
      const [label, cls] = v ? VERDICT[v] : ['?', 'unk'];
      return `<div class="jb-el ${cls}" style="--c:${e.color}" title="${e.name}: ${v ? label : 'not yet tried'}"><b>${e.glyph}</b><span>${v ? label : e.name}</span></div>`;
    }).join('');
    // Drops: the reagent, how many you hold, and what it's for.
    const drop = RESOURCES[d.drop];
    let drops;
    if (b.dropped) {
      const needs = neededFor(d.drop, s, 99), open = needs.filter((n) => n.have < n.need);
      const rows = open.slice(0, 3).map((n) => `<li><b>${n.where}</b> <span>${n.have}/${n.need}</span></li>`).join('');
      drops = `<div class="jb-drop"><i style="--c:${drop.color}">${drop.glyph}</i><div><b>${drop.name}</b><small>You hold ${s.inv[d.drop]} · Elders drop more</small></div></div>
        ${open.length ? `<p class="jb-dim">Needed for:</p><ul class="jb-needs">${rows}</ul>${open.length > 3 ? `<p class="jb-dim">…and ${open.length - 3} more</p>` : ''}` : '<p class="jb-dim">Nothing left needs it.</p>'}`;
    } else {
      drops = `<div class="jb-drop unk"><i>?</i><div><b>Not yet recovered</b><small>Banish one to find out</small></div></div><p class="jb-hint">${d.carries}</p>`;
    }
    // Study: banish enough of them to earn the perk.
    const perk = d.perk, pct = Math.min(100, (b.kills / perk.at) * 100), got = b.kills >= perk.at;
    const last = b.last ? (b.last.realm ? SCHOOLS.find((x) => x.id === b.last.realm).realm : 'The valley') : null;
    return `${hero(d.name, `${d.home} · ${d.when.toLowerCase()}`, d.trick)}
      <aside class="jb-side">
        <div class="jb-card"><h4>Weaknesses</h4><div class="jb-els">${els}</div></div>
        <div class="jb-card"><h4>Drops</h4>${drops}</div>
        <div class="jb-card"><h4>Learned <span>${Math.min(b.kills, perk.at)} / ${perk.at}</span></h4><div class="jb-bar"><i style="width:${pct}%"></i></div>
          <p>${got ? `<b>${perk.name}</b> — ${perk.desc}` : `<span class="jb-dim">Perk: ??? — banish ${perk.at - b.kills} more</span>`}</p>
          <p class="jb-dim">${b.ranks.elder ? `Elder: <b>${d.elder.name}</b> — ${d.elder.trait}` : 'Elder: not yet met'}${last ? ` · last seen in ${last}` : ''}</p></div>
        <button class="btn jb-track ${s.tracked === kind ? 'primary' : ''}" data-track="1">${s.tracked === kind ? '◆ Tracking' : '◇ Track this creature'}</button>
      </aside>`;
  }

  elementsPage() {
    const s = this.game.state;
    const rows = ELEMENTS.map((e) => `<div class="jr-el ${s.knows(e.id) ? '' : 'dim'}" style="--c:${e.color}">
      <div class="jr-el-key"><kbd>${e.key}</kbd></div><div class="jr-el-glyph">${e.glyph}</div>
      <div><h3>${e.name} ${s.element === e.id ? '<span class="cost ok">attuned</span>' : ''}</h3><div class="lore">${e.how}</div>
      <div class="lore"><small>${s.knows(e.id) ? 'Learned ✓' : e.learn}</small></div></div></div>`).join('');
    return `<div class="jr-facts wide"><p class="rp-intro">One bolt, five attunements. Press <kbd>1</kbd>–<kbd>5</kbd> to attune your staff. Every creature wards against some elements and is weak to others — the pages fill in as you try them.</p>${rows}
      <div class="jr-row"><div class="k">Combos</div><div><b>Frost ×3</b> freezes a foe; <b>Arcane</b> then shatters it. <b>Radiance</b> makes a spirit solid. <b>Radiance → Arcane</b> strikes a golem's open core. <b>Frost → Fire</b> on stone: thermal shock.</div></div></div>`;
  }

  // Called by Magic the first time an element is tried on a creature.
  learned(kind, el, verdict) {
    const d = CREATURES[kind], e = EL[el], [label] = VERDICT[verdict];
    this.game.ui.toast(`📖 ${d.name}: ${e.glyph} ${e.name} — ${label}`, e.color, 'Bestiary updated (B)');
  }
}

export { PLATES, TINT, elementVerdict };
