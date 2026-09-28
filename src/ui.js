import * as THREE from 'three';
import { RESOURCES, SPELLS, TOWER_FLOORS, SHRINES, ALTAR_POS, MAX_LEVEL, POTIONS, SCHOOLS, MASTERY_RANKS, SANCTUMS } from './data.js';
import { heightAt, WATER_LEVEL } from './world.js';
import { formatTime } from './util.js';
import { CREATURES, ELEMENTS, EL, dropperOf, neededFor } from './bestiary.js';
import { renderSchools } from './schoolsui.js';
import { chapterOf, chapterGoals, CHAPTERS, chapterLabel, GUARDIANS } from './story.js';

const $ = (id) => document.getElementById(id);
const SPELL_ICONS = { bolt: '✦', blink: '➶', reach: '✋', float: '☁', nova: '✺', siphon: '☠', fireball: '✹', frostwalk: '❄', earthstair: '⛰' };
const schoolOf = (id) => SCHOOLS.find((s) => s.id === id);
const NODE_FOR = { wood: 'tree', stone: 'rock', crystal: 'crystal', essence: 'flower' };
const NODE_COLORS = { tree: '#5fae4a', rock: '#c9c9c9', crystal: '#b59bff', flower: '#5ff2d2' };

export class UI {
  constructor(game) {
    this.game = game;
    this.state = game.state;
    this.el = {
      hud: $('hud'), level: $('hud-level'), rank: $('hud-rank'), xp: $('hud-xp'), xpText: $('hud-xp-text'),
      mana: $('hud-mana'), manaText: $('hud-mana-text'), clock: $('hud-clock'), daynight: $('hud-daynight'),
      questTitle: $('quest-title'), questList: $('quest-list'), toasts: $('toasts'), inventory: $('inventory'),
      spellbar: $('spellbar'), prompt: $('prompt'), promptLabel: $('prompt-label'), promptRing: $('prompt-ring'),
      waypoint: $('waypoint'), wpDist: $('wp-dist'), labels: $('labels'), banner: $('banner'), lockhint: $('lockhint'),
      dialogue: $('dialogue'), dlgName: $('dlg-name'), dlgText: $('dlg-text'), build: $('build'), buildFloors: $('build-floors'),
      pause: $('pause'), pauseStats: $('pause-stats'), crosshair: $('crosshair'),
    };
    this.buildInventory();
    this.buildSpellbar();
    this.buildAttune();
    this.buildLabels();
    this.buildMinimapBase();
    this.minimap = $('minimap').getContext('2d');
    this.dialogueState = null;
    this.lastQuestKey = '';
    this.v = new THREE.Vector3();
    $('build-close').onclick = () => game.closeBuild();
    this.el.dialogue.onclick = () => this.advanceDialogue();
  }

  show() { this.el.hud.classList.remove('hidden'); }

  // Indoors the world-space HUD (minimap, labels, waypoint, threats) makes no sense.
  enterRoom(name, eyebrow = 'Inside your tower') {
    document.querySelector('#room-chip .eyebrow').textContent = eyebrow;
    document.getElementById('room-name').textContent = name;
    document.getElementById('room-chip').classList.remove('hidden');
    document.querySelector('.hud-tr').classList.add('hidden');
    document.getElementById('room-guide-hint').innerHTML = '<kbd>I</kbd> Room guide';
  }
  enterRealm(realm) {
    this.enterRoom(realm.def.realm, `${realm.def.glyph} ${realm.def.name}`);
    document.getElementById('room-chip').style.setProperty('--c', realm.def.color);
    document.body.dataset.realm = realm.id;
    document.getElementById('room-guide-hint').innerHTML = '<kbd>I</kbd> Sanctum guide';
    document.querySelector('.hud-tr').classList.remove('hidden'); // realms are big enough to need a map
  }
  leaveRealm() { this.leaveRoom(); delete document.body.dataset.realm; }

  leaveRoom() {
    document.getElementById('room-chip').classList.add('hidden');
    document.querySelector('.hud-tr').classList.remove('hidden');
  }

  updateBuffs() {
    const s = this.state, box = document.getElementById('buffs');
    const html = POTIONS.filter((p) => s.hasBuff(p.id))
      .map((p) => `<div class="buff" style="--c:${p.color}">${p.icon} ${p.name} <small>${Math.ceil(s.buffs[p.id])}s</small></div>`).join('');
    if (box.innerHTML !== html) box.innerHTML = html;
  }
  hide() { this.el.hud.classList.add('hidden'); }

  // The satchel: your resources as icon · name · count cards (with "of N" when the next build
  // needs them). [V] or a click on the chip folds it away; the choice is remembered.
  buildInventory() {
    this.invEls = {};
    this.el.inventory.innerHTML = '';
    for (const [k, r] of Object.entries(RESOURCES)) {
      const d = document.createElement('div');
      d.className = 'inv';
      d.title = r.name;
      d.style.setProperty('--c', r.color);
      d.innerHTML = `<span class="ico">${r.glyph}</span><span class="nm">${r.name}</span><b class="n">0</b><small class="need"></small>`;
      this.el.inventory.appendChild(d);
      this.invEls[k] = d;
    }
    try { this.satchelOpen = localStorage.getItem('satchelOpen') !== '0'; } catch { this.satchelOpen = true; }
    $('satchel-chip').onclick = () => this.toggleSatchel();
    this.applySatchel();
  }

  toggleSatchel() {
    this.satchelOpen = !this.satchelOpen;
    try { localStorage.setItem('satchelOpen', this.satchelOpen ? '1' : '0'); } catch {}
    this.applySatchel();
    this.game.audio.play('ui');
  }

  // Tuck the satchel just under whatever holds the top-right corner: the minimap outdoors, the
  // room card indoors (or both, in a realm).
  placeSatchel() {
    let bottom = 16;
    for (const q of ['.hud-tr', '#room-chip']) {
      const e = document.querySelector(q);
      if (e && !e.classList.contains('hidden')) {
        const r = e.getBoundingClientRect();
        if (r.width && r.right > innerWidth - 40) bottom = Math.max(bottom, r.bottom);
      }
    }
    let top = bottom + 10;
    const br = document.querySelector('.hud-br');
    if (document.body.classList.contains('touch')) { // the toggle heads the column on phones
      const t = `${Math.round(top)}px`;
      if (br.style.top !== t) br.style.top = t;
      top += 40;
    }
    const px = `${Math.round(top)}px`;
    if ($('satchel').style.top !== px) $('satchel').style.top = px;
  }

  applySatchel() {
    $('satchel').classList.toggle('closed', !this.satchelOpen);
  }

  buildSpellbar() {
    this.spellEls = {};
    this.el.spellbar.innerHTML = '';
    for (const s of SPELLS) {
      const d = document.createElement('div');
      d.className = 'spell';
      d.dataset.lvl = s.school ? `${schoolOf(s.school).glyph} Master` : `Lv ${s.level}`;
      d.title = `${s.name} — ${s.desc}${s.mana ? ` (${s.mana} mana)` : ''}`;
      d.innerHTML = `<span class="ico">${SPELL_ICONS[s.id]}</span><span class="key">${s.key}</span><div class="cd"></div>`;
      this.el.spellbar.appendChild(d);
      this.spellEls[s.id] = d;
    }
  }

  // The attunement dial: one slot per element, keys 1–5.
  buildAttune() {
    const box = $('attune');
    box.innerHTML = ELEMENTS.map((e) => `<div class="att" data-el="${e.id}" style="--c:${e.color}" title="${e.name} [${e.key}] — ${e.how}">${e.glyph}<b>${e.key}</b></div>`).join('');
    this.attEls = [...box.children];
    this.attEls.forEach((d) => { d.onclick = () => this.game.attune(d.dataset.el); });
  }

  // "+2 Golem Heart · needed for …": every drop says where it goes.
  rewardPop(key, n, needs, { pristine = false, first = false, kind = null } = {}) {
    const r = RESOURCES[key], box = $('reward');
    const list = needs.slice(0, 3).map((x) => `<li class="${x.have >= x.need ? 'ok' : ''}">needed for <b>${x.where}</b> <small>(${x.group})</small> — ${x.have} of ${x.need}</li>`).join('');
    box.style.setProperty('--c', r.color);
    box.innerHTML = `<div class="rw-head">+${n} <b>${r.glyph} ${r.name}</b>${pristine ? '<span class="rw-tag">Pristine</span>' : ''}${first ? '<span class="rw-tag">New</span>' : ''}</div>
      <ul>${list || '<li>Nothing left needs it.</li>'}</ul>${first && kind ? `<div class="rw-foot">📖 The bestiary page for the ${CREATURES[kind].name} now lists everything it's needed for (B).</div>` : ''}`;
    box.classList.remove('hidden');
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    clearTimeout(this.rewardT);
    this.rewardT = setTimeout(() => box.classList.add('hidden'), first ? 6000 : 3800);
  }

  buildLabels() {
    const g = this.game;
    this.labels = [];
    const add = (text, sub, getPos, extra) => {
      const d = document.createElement('div');
      d.className = 'lbl';
      d.innerHTML = `${text}<small>${sub}</small>`;
      this.el.labels.appendChild(d);
      this.labels.push({ el: d, getPos, extra });
    };
    add('Quill', 'Aldric\'s owl', () => new THREE.Vector3(g.mentor.x, g.mentor.mesh.position.y + 3.2, g.mentor.z));
    add("Builder's Altar", 'Raise your tower', () => new THREE.Vector3(ALTAR_POS.x, heightAt(ALTAR_POS.x, ALTAR_POS.z) + 3.6, ALTAR_POS.z));
    g.gates.list.forEach((gt) => {
      add(`${gt.def.glyph} ${gt.def.realm}`, '', () => new THREE.Vector3(gt.x, gt.arch.position.y + 7.4, gt.z), { gate: gt });
    });
    g.shrines.list.forEach((s) => {
      add(s.def.name, `Requires level ${s.def.level}`, () => new THREE.Vector3(s.x, s.y + 6.2, s.z), s);
    });
  }

  // Bake the terrain colours once into an offscreen canvas for the minimap.
  buildMinimapBase() {
    const N = 200, span = 400;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * span, z = (j / N - 0.5) * span;
        const h = heightAt(x, z);
        const k = (j * N + i) * 4;
        let r, gg, b;
        if (h < WATER_LEVEL) { r = 40; gg = 95; b = 135; }
        else if (h < WATER_LEVEL + 1.2) { r = 190; gg = 176; b = 130; }
        else if (h > 34) { r = 225; gg = 230; b = 238; }
        else if (h > 22) { r = 110; gg = 105; b = 100; }
        else { const s = Math.min(1, h / 20); r = 70 + s * 40; gg = 115 + s * 20; b = 55 + s * 10; }
        const shade = 0.85 + ((heightAt(x + 2, z) - h) * 0.06);
        img.data[k] = r * shade; img.data[k + 1] = gg * shade; img.data[k + 2] = b * shade; img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.mapBase = c; this.mapSpan = span;
  }

  // Mana drained by creatures: one running total per fight instead of a card per hit, plus a
  // purple pulse at the screen's edge so a hit reads without looking away from the fight.
  drained(n, who) {
    const hurt = $('hurt');
    hurt.style.animation = 'none'; void hurt.offsetWidth; hurt.style.animation = 'hurt 0.6s ease-out';
    const d = this.drainEl;
    if (d?.isConnected) {
      d._total += n; d._hits++;
    } else {
      const el = this.drainEl = document.createElement('div');
      el.className = 'toast'; el.style.setProperty('--c', '#c04dff');
      el._total = n; el._hits = 1;
      this.el.toasts.appendChild(el);
      while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
    }
    const el = this.drainEl;
    if (el._total < 1 && el._hits === 1) { el.remove(); return; } // a graze against an empty well
    el.innerHTML = `−${Math.round(el._total)} Mana <small>${who} drains you!</small><b class="x">${el._hits > 1 ? `×${el._hits}` : ''}</b>`;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(el._t); el._t = setTimeout(() => el.remove(), 3200);
  }

  toast(text, color = '#ffd36b', sub = '') {
    // Collapse repeats ("+4 Timber" three times) into one stacking toast instead of a wall of cards.
    const key = text + '|' + sub;
    const last = this.el.toasts.lastElementChild;
    if (last && last.dataset.key === key && last.isConnected) {
      const n = (+last.dataset.n || 1) + 1;
      last.dataset.n = n;
      last.querySelector('.x').textContent = `×${n}`;
      last.style.animation = 'none'; void last.offsetWidth; last.style.animation = '';
      clearTimeout(last._t); last._t = setTimeout(() => last.remove(), 3200);
      return;
    }
    const d = document.createElement('div');
    d.dataset.key = key;
    d.className = 'toast';
    d.style.setProperty('--c', color);
    d.innerHTML = `${text}${sub ? ` <small>${sub}</small>` : ''}<b class="x"></b>`;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
    d._t = setTimeout(() => d.remove(), 3200);
  }

  banner(big, small, unlock = '', ms = 3500) {
    const b = this.el.banner;
    b.innerHTML = `<div class="small">${small}</div><div class="big">${big}</div>${unlock ? `<div class="unlock">${unlock}</div>` : ''}`;
    b.classList.remove('hidden');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.add('hidden'), ms);
  }

  // Floating combat text that pops up from a world position and drifts upward.
  floatText(worldPos, text, color = '#ffd36b', big = false) {
    const p = this.project(worldPos.clone().setY(worldPos.y + 0.8));
    if (p.behind) return;
    const d = document.createElement('div');
    d.className = 'float-text' + (big ? ' big' : '');
    d.style.left = `${p.x + (Math.random() - 0.5) * 30}px`; d.style.top = `${p.y}px`; d.style.color = color;
    d.textContent = text;
    this.el.hud.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  bumpItem(key) {
    const d = this.satchelOpen ? this.invEls[key] : $('satchel-chip');
    if (!d) return;
    d.classList.add('bump');
    setTimeout(() => d.classList.remove('bump'), 220);
  }

  prompt(label, progress = 0, locked = false, sub = '') {
    if (!label) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.classList.remove('hidden');
    const html = `${label}${sub ? `<span class="sub">${sub}</span>` : ''}`;
    if (this.el.promptLabel.innerHTML !== html) this.el.promptLabel.innerHTML = html;
    this.el.promptLabel.parentElement.classList.toggle('locked', locked);
    this.el.promptRing.style.strokeDashoffset = String(119.4 * (1 - progress));
  }

  // ----- Quest / objective -----
  objective() {
    const o = this.baseObjective();
    // A tracked creature adds a line: what it carries and where that's needed.
    const tk = this.state.tracked;
    if (tk && o.items) {
      const d = CREATURES[tk], need = neededFor(d.drop, this.state, 1)[0];
      o.items = [...o.items, { text: `📖 <b>${d.name}</b> → ${RESOURCES[d.drop].name}${need ? ` ${need.have}/${need.need} <small>(${need.where})</small>` : ''}`, done: false }];
    }
    return o;
  }

  baseObjective() {
    const s = this.state, g = this.game;
    if (g.realm) {
      const r = g.realm, d = r.def, p = s.school(d.id);
      const next = r.stations.find((st) => st.kind === 'puzzle' && !p.puzzles.includes(st.puzzle.id));
      const haunts = r.land.landmarks.filter((L) => s.haunts.includes(`${d.id}:${L.id}`)).length;
      const items = [
        ...d.puzzles.map((pz) => ({ text: `<b>${pz.name}</b>`, done: p.puzzles.includes(pz.id) })),
        { text: `<b>Haunts</b> lifted ${haunts} / 4${p.trial ? '' : ' — the first is the trial'}`, done: p.trial },
      ];
      const hv = g.haunts.active;
      if (hv) items.unshift({ text: `⚔ <b>${hv.cfg.name}</b> — ${hv.phase === 'dread' ? hv.cfg.dread : `wave ${hv.wave} of 3`}`, done: false });
      // The sanctum: next stage, its rank gate and the realm material it needs.
      const sanc = SANCTUMS[d.id], stage = s.nextSanctumStage(d.id), res = sanc.resource;
      let target = null;
      if (stage) {
        const rankOk = s.mastery(d.id) >= stage.rank, have = Math.min(s.inv[res], stage.cost[res]);
        items.push({ text: `<b>${stage.name}</b> ${s.sanctumStage(d.id) + 1}/${sanc.stages.length}`, done: false });
        if (!rankOk) items.push({ text: `Reach <b>${MASTERY_RANKS[stage.rank]}</b> in ${d.name}`, done: false });
        items.push({ text: `<b>${RESOURCES[res].name}</b> ${have} / ${stage.cost[res]}`, done: have >= stage.cost[res] });
        const corner = r.stations.find((st) => st.kind === 'sanctum');
        if (rankOk && s.canAfford(stage.cost)) target = { x: corner.x, z: corner.z - 2.2 };
        else if (next) target = { x: next.x, z: next.z - 2.2 };
        else if (rankOk && s.inv[res] < stage.cost[res]) {
          let best = null, bd = Infinity;
          for (const n of r.nodes.nodes) {
            if (!n.alive) continue;
            const dd = Math.hypot(n.x - g.player.pos.x, n.z - g.player.pos.z);
            if (dd < bd) { bd = dd; best = n; }
          }
          if (best) target = { x: best.x, z: best.z, soft: true };
        }
      } else {
        items.push({ text: `<b>${sanc.name}</b> complete — ${sanc.boon.name}`, done: true });
        if (next) target = { x: next.x, z: next.z - 2.2 };
      }
      // A haunt to clear when the plans are waiting on rank.
      if (!target && !p.trial) {
        let best = null, bd = Infinity;
        for (const L of r.land.landmarks) { if (s.haunts.includes(`${d.id}:${L.id}`)) continue; const dd = Math.hypot(L.x - g.player.pos.x, L.z - g.player.pos.z); if (dd < bd) { bd = dd; best = L; } }
        if (best) target = { x: best.x, z: best.z, soft: true };
      }
      // Exploration: echo stones at the realm's four landmarks.
      const echoes = r.land.landmarks.filter((L) => s.echoes.includes(`${d.id}:${L.id}`)).length;
      items.push({ text: `<b>Echoes</b> of the realm ${echoes} / ${r.land.landmarks.length}`, done: echoes >= r.land.landmarks.length });
      if (!target && echoes < r.land.landmarks.length) {
        let best = null, bd = Infinity;
        for (const L of r.land.landmarks) {
          if (s.echoes.includes(`${d.id}:${L.id}`)) continue;
          const dd = Math.hypot(L.ex - g.player.pos.x, L.ez - g.player.pos.z);
          if (dd < bd) { bd = dd; best = L; }
        }
        if (best) target = { x: best.ex, z: best.ez, soft: true };
      }
      if (s.isMaster(d.id) && !stage) { items.push({ text: `Return through the portal`, done: true }); target ||= { x: r.arrive.x, z: r.arrive.z + 5 }; }
      return { title: `${d.glyph} ${d.name} · ${MASTERY_RANKS[s.mastery(d.id)]}`, items, target };
    }
    if (!s.talkedToMentor) {
      return { title: 'The Empty Tower', items: [{ text: 'Find <b>Quill</b> by the ruined tower', done: false }, { text: 'Read <b>Aldric\'s letter</b>', done: false }], target: { x: g.mentor.x, z: g.mentor.z } };
    }
    if (s.finale) return { title: 'The Veil Holds', items: [{ text: 'Aldric is home. Explore freely.', done: true }], target: null };
    // Past the first floors, the chapter's goals lead; floors come back when they're the next step.
    const ch = chapterOf(s), goals = chapterGoals(s, ch), open = goals.find((x) => !x.done);
    if (open && !/Raise the <b>/.test(open.text) && !(ch === 1 && s.floors < 2)) {
      const shown = goals.filter((x) => !x.done).slice(0, 3);
      let target = open.target ? { ...open.target } : null;
      if (/Research <b>Radiance/.test(open.text)) target = { x: 0, z: 10 };
      if (/Initiate|Raise <b>/.test(open.text)) { const gt = g.gates.list.find((x) => open.text.includes(x.def.name) || open.text.includes(SANCTUMS[x.def.id].name)); target = gt ? { x: gt.x, z: gt.z } : null; }
      return { title: `${chapterLabel(ch)} · ${CHAPTERS[ch - 1].title}`, items: shown, target };
    }
    if (s.ascended) return { title: 'Magician of the Valley', items: [{ text: 'Your tower stands complete. Explore freely.', done: true }], target: null };
    const next = TOWER_FLOORS[s.floors];
    if (!next) {
      return { title: 'The Final Circle', items: [{ text: `Reach <b>level ${MAX_LEVEL}</b> (now ${s.level})`, done: s.level >= MAX_LEVEL }, { text: 'Banish wisps, harvest and explore', done: false }], target: null };
    }
    const items = [];
    if (next.level > 1) items.push({ text: `Reach <b>level ${next.level}</b>`, done: s.level >= next.level, key: 'lvl' });
    let target = null;
    let needSigil = false;
    for (const [k, v] of Object.entries(next.cost)) {
      const have = Math.min(s.inv[k], v);
      if (k === 'sigil') {
        const shrine = SHRINES.find((x) => !s.shrines.includes(x.id));
        const done = s.inv.sigil >= v;
        needSigil = !done;
        const where = done ? 'in hand' : `${shrine ? shrine.name : 'any shrine'}${shrine && shrine.level > s.level ? ` (Lv ${shrine.level})` : ''}`;
        items.push({ text: `<b>Arcane Sigil</b> — ${where}`, done, key: k });
        if (!done && shrine && shrine.level <= s.level) target = { x: shrine.x, z: shrine.z };
      } else {
        items.push({ text: `<b>${RESOURCES[k].name}</b> ${have} / ${v}`, done: s.inv[k] >= v, key: k });
      }
    }
    const ready = s.canAfford(next.cost) && s.level >= next.level;
    items.push({ text: "Raise it at the <b>Builder's Altar</b>", done: false });
    if (ready) target = { x: ALTAR_POS.x, z: ALTAR_POS.z };
    if (!target && !needSigil) {
      // Point at the nearest node of the first missing harvestable resource.
      const miss = Object.entries(next.cost).find(([k, v]) => k !== 'sigil' && s.inv[k] < v);
      if (miss) {
        const type = NODE_FOR[miss[0]];
        let best = null, bd = Infinity;
        for (const n of g.resources.nodes) {
          if (n.type !== type || !n.alive) continue;
          const d = Math.hypot(n.x - g.player.pos.x, n.z - g.player.pos.z);
          if (d < bd) { bd = d; best = n; }
        }
        if (best) target = { x: best.x, z: best.z, soft: true };
      }
    }
    return { title: `Raise the ${next.name}`, items, target };
  }

  updateQuest() {
    const o = this.objective();
    this.currentObjective = o;
    const key = o.title + o.items.map((i) => i.text + i.done).join('|');
    if (key === this.lastQuestKey) return;
    this.lastQuestKey = key;
    this.el.questTitle.textContent = o.title;
    const next = o.items.findIndex((i) => !i.done);
    this.el.questList.innerHTML = o.items.map((i, n) => `<li class="${i.done ? 'done' : ''}${n === next ? ' next' : ''}">${i.text}</li>`).join('');
  }

  // ----- Per-frame HUD -----
  update(dt) {
    const s = this.state, g = this.game;
    this.el.level.textContent = s.level;
    this.el.rank.textContent = s.rank;
    const xpPct = s.level >= MAX_LEVEL ? 100 : (s.xp / s.xpToNext) * 100;
    this.el.xp.style.width = `${xpPct}%`;
    this.el.xpText.textContent = s.level >= MAX_LEVEL ? 'MAX LEVEL' : `${Math.floor(s.xp)} / ${s.xpToNext} XP`;
    this.el.mana.style.width = `${(s.mana / s.maxMana) * 100}%`;
    this.el.manaText.textContent = `${Math.floor(s.mana)} / ${s.maxMana}`;
    // Low well while something is hunting you: the bar warns before a hit can make you falter.
    this.el.mana.parentElement.classList.toggle('low', s.mana < s.maxMana * 0.2 && g.magic.wisps.some((w) => w.chasing && !w.dying));
    this.el.clock.textContent = g.world.clockLabel();
    this.el.daynight.textContent = g.world.night > 0.5 ? '☾' : '☀';
    // Only what you hold, plus whatever the next thing you're building needs (so a 0 there reads
    // as "go get some"). Everything else lives in the pause screen.
    const need = { ...(TOWER_FLOORS[s.floors]?.cost || {}), ...(g.realm ? s.nextSanctumStage(g.realm.id)?.cost || {} : {}) };
    let held = 0;
    for (const [k, d] of Object.entries(this.invEls)) {
      const n = d.querySelector('.n'), have = s.inv[k], want = need[k];
      if (n.textContent !== String(have)) n.textContent = have;
      const nd = want ? `of ${want}` : '';
      const ne = d.querySelector('.need');
      if (ne.textContent !== nd) ne.textContent = nd;
      d.classList.toggle('short', !!want && have < want);
      d.classList.toggle('met', !!want && have >= want);
      d.classList.toggle('hidden', !(have > 0 || want));
      if (have > 0) held++;
    }
    const sum = held ? `Satchel · ${held}` : 'Satchel';
    if ($('satchel-sum').textContent !== sum) $('satchel-sum').textContent = sum;
    this.placeSatchel();
    // Spell slots appear as they're learned; only the next level-spell shows (locked) as a teaser.
    const tease = SPELLS.filter((sp) => !sp.school && !s.hasSpell(sp.id)).sort((a, b) => a.level - b.level)[0];
    for (const sp of SPELLS) {
      const d = this.spellEls[sp.id], has = s.hasSpell(sp.id);
      d.classList.toggle('locked', !has);
      d.classList.toggle('hidden', !has && sp !== tease);
      if (has && d.dataset.had === '0') { d.classList.remove('fresh'); void d.offsetWidth; d.classList.add('fresh'); }
      d.dataset.had = has ? '1' : '0';
      d.classList.toggle('nomana', sp.mana > s.mana);
      const cd = g.magic.cooldowns[sp.id];
      const max = { bolt: g.magic.boltMax || 0.28, blink: 1.2, nova: 6, fireball: 1.4, earthstair: 0.6 }[sp.id];
      d.querySelector('.cd').style.transform = `scaleY(${cd && max ? cd / max : 0})`;
    }
    let known = 0;
    for (const d of this.attEls) {
      const k = s.knows(d.dataset.el); known += k;
      d.classList.toggle('on', s.element === d.dataset.el);
      d.classList.toggle('hidden', !k);
      if (k && d.dataset.had === '0') { d.classList.remove('fresh'); void d.offsetWidth; d.classList.add('fresh'); }
      d.dataset.had = k ? '1' : '0';
    }
    $('attune').classList.toggle('hidden', known < 2); // one element needs no dial
    this.updateQuest();
    this.updateBuffs();
    if (g.inside) {
      this.labels.forEach((l) => { l.el.style.display = 'none'; });
      this.el.waypoint.classList.add('hidden');
      document.getElementById('target-info').classList.add('hidden');
      (this.threatEls || []).forEach((e) => { e.style.display = 'none'; });
      return;
    }
    if (g.realm) {
      // Realms have their own geography: their own minimap, no valley labels.
      this.labels.forEach((l) => { l.el.style.display = 'none'; });
      this.updateTargeting();
      this.updateWaypoint();
      this.drawMinimap();
      return;
    }
    this.updateTargeting();
    this.updateLabels();
    this.updateWaypoint();
    this.drawMinimap();
  }

  project(p) {
    const v = this.v.copy(p).project(this.game.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, behind: v.z > 1 };
  }

  // Lock-on label above the targeted wisp, and edge arrows for off-screen attackers.
  updateTargeting() {
    const g = this.game, m = g.magic, info = document.getElementById('target-info');
    const t = m.reticle.visible ? m.target : null;
    if (!t || g.cinematic) info.classList.add('hidden');
    else {
      const p = g.magic.aimPoint(t); p.y += t.creature.grounded ? (t.creature.height || 2) * 0.6 * t.scale + 0.6 : 1.6 * t.scale;
      const sc = this.project(p);
      if (sc.behind) info.classList.add('hidden');
      else {
        info.classList.remove('hidden');
        info.style.left = `${sc.x}px`; info.style.top = `${sc.y}px`;
        info.classList.toggle('manual', m.manualLock);
        const np = Math.min(12, t.maxHp), per = t.maxHp / np;
        const pips = Array.from({ length: np }, (_, i) => `<i class="${i * per < t.hp - 0.01 ? 'on' : ''}"></i>`).join('');
        const pe = info.querySelector('.ti-pips');
        if (pe.innerHTML !== pips) pe.innerHTML = pips;
        const nm = info.querySelector('.ti-name').firstChild;
        const rankTag = t.rank === 'common' ? '' : `${t.rank === 'dread' ? 'Dread' : 'Elder'} · `;
        if (nm.nodeValue !== rankTag + t.name + ' ') nm.nodeValue = rankTag + t.name + ' ';
        // Ward sigils: what the journal knows about this creature (unknown elements stay hidden).
        const b = this.state.beast(t.kind), known = ELEMENTS.filter((e) => b.tried[e.id] && b.tried[e.id] !== 'neutral');
        const cls = { weak: 'weak', resisted: 'res', heals: 'heal', armour: 'res' };
        const extra = `${t.armour ? '<span style="--c:#c9d0e0">armoured</span>' : ''}${t.frozen > 0 ? '<span style="--c:#bfefff">frozen</span>' : ''}${t.dazzled > 0 ? '<span style="--c:#ffd36b">dazzled</span>' : ''}${CREATURES[t.kind].intangible ? (t.solid > 0 ? '<span style="--c:#8dffb0">solid</span>' : '<span style="--c:#8a9aa0">intangible</span>') : ''}`;
        const wards = known.map((e) => `<span class="${cls[b.tried[e.id]]}" style="--c:${e.color}">${e.glyph}</span>`).join('') + extra;
        const we = info.querySelector('.ti-wards');
        if (we.innerHTML !== wards) we.innerHTML = wards;
        info.classList.toggle('dread', t.rank === 'dread');
        info.querySelector('.ti-lock').textContent = m.manualLock ? '◆ Locked' : '⚠ Hunting you';
        // How your current element fares, as far as the bestiary knows — so a fight teaches you.
        const el = this.state.element, fx = b.tried[el];
        const verdict = { weak: ['weak ✓', 'weak'], resisted: ['resisted', 'res'], armour: ['glances off', 'res'], heals: ['heals it!', 'heal'], neutral: ['normal', ''] }[fx] || ['untried ?', 'unk'];
        const de = info.querySelector('.ti-dist');
        const dh = `${Math.round(t.mesh.position.distanceTo(g.player.pos))}m · ${EL[el].glyph} ${EL[el].name} bolt <span class="ti-fx ${verdict[1]}">${verdict[0]}</span>`;
        if (de.innerHTML !== dh) de.innerHTML = dh;
      }
    }
    // Threat arrows: chasing wisps that are behind the camera or off-screen.
    const box = document.getElementById('threats');
    this.threatEls ||= [];
    let n = 0;
    if (!g.cinematic) {
      for (const w of m.wisps) {
        if (!w.chasing || w.dying) continue;
        const sc = this.project(w.mesh.position);
        const on = !sc.behind && sc.x > 0 && sc.x < innerWidth && sc.y > 0 && sc.y < innerHeight;
        if (on) continue;
        // Direction from screen centre toward the wisp (flipped when behind the camera).
        let dx = sc.x - innerWidth / 2, dy = sc.y - innerHeight / 2;
        if (sc.behind) { dx = -dx; dy = -dy; }
        const a = Math.atan2(dy, dx);
        // Keep arrows inside a safe frame that avoids the HUD panels and the spell bar.
        const L = 360, R = innerWidth - 60, T = 60, B = innerHeight - 190;
        const cx = (L + R) / 2, cy = (T + B) / 2;
        const k = Math.min((R - L) / 2 / Math.abs(Math.cos(a) || 1e-6), (B - T) / 2 / Math.abs(Math.sin(a) || 1e-6));
        let el = this.threatEls[n];
        if (!el) { el = document.createElement('div'); el.className = 'threat'; box.appendChild(el); this.threatEls.push(el); }
        el.style.display = 'block';
        el.style.left = `${cx + Math.cos(a) * k}px`;
        el.style.top = `${cy + Math.sin(a) * k}px`;
        el.style.transform = `translate(-50%, -50%) rotate(${a}rad)`;
        el.classList.toggle('targeted', w === m.target);
        n++;
      }
    }
    for (let i = n; i < this.threatEls.length; i++) this.threatEls[i].style.display = 'none';
  }

  updateLabels() {
    const pp = this.game.player.pos;
    // HUD panels a world label must never draw across (it hides instead).
    const blocks = ['.hud-tl', '#quest', '.hud-tr', '.hud-bottom', '#room-chip', '#toasts', '#reward', '#satchel']
      .map((q) => document.querySelector(q)).filter((e) => e && e.offsetParent && !e.classList.contains('hidden'))
      .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    for (const l of this.labels) {
      const p = l.getPos();
      const d = Math.hypot(p.x - pp.x, p.z - pp.z);
      const sc = this.project(p);
      // World labels step aside while a centre-screen banner is showing.
      const vis = d < 55 && !sc.behind && !this.game.cinematic && this.el.banner.classList.contains('hidden');
      l.el.style.display = vis ? 'block' : 'none';
      if (!vis) continue;
      l.el.style.left = `${sc.x}px`; l.el.style.top = `${sc.y}px`;
      const w = l.el.offsetWidth / 2 + 6, h = l.el.offsetHeight + 6;
      if (blocks.some((r) => sc.x + w > r.left && sc.x - w < r.right && sc.y > r.top && sc.y - h < r.bottom)) { l.el.style.display = 'none'; continue; }
      l.el.style.opacity = String(Math.min(1, (55 - d) / 15));
      if (l.extra?.gate) {
        const d = l.extra.gate.def;
        const sub = this.state.schoolUnlocked(d.id) ? `${d.name} · ${this.state.masteryTitle(d.id)}` : `Locked · level ${d.level}`;
        const sm = l.el.querySelector('small');
        if (sm.textContent !== sub) sm.textContent = sub;
      } else if (l.extra) {
        const solved = this.state.shrines.includes(l.extra.def.id);
        const sub = solved ? 'Awakened ✓' : this.state.level >= l.extra.def.level ? 'Trial awaits' : `Requires level ${l.extra.def.level}`;
        const sm = l.el.querySelector('small');
        if (sm.textContent !== sub) sm.textContent = sub;
        l.el.classList.toggle('solved', solved);
      }
    }
  }

  updateWaypoint() {
    const o = this.currentObjective;
    const wp = this.el.waypoint;
    if (!o?.target || this.game.cinematic) { wp.classList.add('hidden'); return; }
    const t = o.target;
    const pp = this.game.player.pos;
    const dist = Math.hypot(t.x - pp.x, t.z - pp.z);
    if (dist < 6) { wp.classList.add('hidden'); return; }
    wp.classList.remove('hidden');
    const p = new THREE.Vector3(t.x, (this.game.realm ? this.game.realm.heightAt : heightAt)(t.x, t.z) + 7.5, t.z);
    let { x, y, behind } = this.project(p);
    const m = 60;
    // Keep the marker inside a safe frame that clears the HUD panels on any screen size.
    const small = innerWidth < 700 || innerHeight < 500;
    const top = small ? 150 : 60, bottom = small ? 230 : 190;
    if (behind) { x = innerWidth - x; y = innerHeight - bottom; }
    x = Math.min(innerWidth - m, Math.max(m, x));
    y = Math.min(innerHeight - bottom, Math.max(top, y));
    // Never sit on the rank / quest panels or the minimap: drop below whichever it lands on, and
    // check again (dropping below one panel can land it on the next).
    const panels = ['#quest', '.hud-tl', '.hud-tr', '#satchel'].map((q) => document.querySelector(q)?.getBoundingClientRect()).filter((r) => r?.width);
    for (let pass = 0; pass < 3; pass++) {
      const r = panels.find((r) => x > r.left - 24 && x < r.right + 24 && y > r.top - 34 && y < r.bottom + 24);
      if (!r) break;
      // Step left of a tall right-hand column (the satchel); drop below anything else.
      if (r.right > innerWidth - 40 && r.height > 160) x = r.left - 34; else y = r.bottom + 28;
    }
    wp.style.left = `${x}px`; wp.style.top = `${y}px`;
    wp.style.opacity = t.soft ? '0.6' : '1';
    this.el.wpDist.textContent = `${Math.round(dist)}m`;
  }

  drawMinimap() {
    const ctx = this.minimap, W = 200, R = 100;
    const g = this.game, p = g.player.pos, yaw = g.player.camYaw;
    const view = 75; // world units from centre to edge
    const k = R / view;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const toMap = (x, z) => {
      const dx = x - p.x, dz = z - p.z;
      return [R + (dx * cs - dz * sn) * k, R + (dx * sn + dz * cs) * k];
    };
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#10182a'; ctx.fillRect(0, 0, W, W);
    // Terrain image: rotate around the player.
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(yaw);
    const scale = (this.mapSpan / this.mapBase.width) * k;
    ctx.scale(scale, scale);
    const base = g.realm ? g.realm.mapBase : this.mapBase;
    ctx.translate(-(p.x / this.mapSpan + 0.5) * base.width, -(p.z / this.mapSpan + 0.5) * base.height);
    ctx.drawImage(base, 0, 0);
    ctx.restore();
    // Night tint.
    if (!g.realm) { ctx.fillStyle = `rgba(10,12,40,${g.world.night * 0.45})`; ctx.fillRect(0, 0, W, W); }

    const dot = (x, z, r, color, stroke) => {
      const [mx, my] = toMap(x, z);
      if (Math.hypot(mx - R, my - R) > R + 4) return;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    };
    const diamond = (x, z, fill, size = 4.5) => {
      const [mx, my] = toMap(x, z), d = Math.hypot(mx - R, my - R);
      const cx = d > R - 8 ? R + ((mx - R) / d) * (R - 8) : mx, cy = d > R - 8 ? R + ((my - R) / d) * (R - 8) : my;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = fill; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.fillRect(-size, -size, size * 2, size * 2); ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.restore();
    };
    if (g.realm) {
      const r = g.realm, col = r.def.color;
      for (const n of r.nodes.nodes) if (n.alive && Math.abs(n.x - p.x) < view * 1.5 && Math.abs(n.z - p.z) < view * 1.5) dot(n.x, n.z, 2.2, RESOURCES[n.def && Object.keys(n.def.yields)[0]]?.color || '#fff');
      for (const w of g.magic.wisps) dot(w.mesh.position.x, w.mesh.position.z, 3, '#ff4df0', '#000');
      dot(r.sanctum.world.x, r.sanctum.world.z, 7, this.state.sanctumStage(r.id) ? col : 'rgba(255,255,255,0.25)', '#ffd36b');
      for (const st of r.stations) {
        if (st.kind === 'exit') dot(st.x, st.z, 5, col, '#fff');
        else if (st.kind === 'puzzle') dot(st.x, st.z - 2.2, 3.5, this.state.school(r.id).puzzles.includes(st.puzzle.id) ? '#ffd36b' : col, '#000');
        else if (st.kind === 'sanctum') dot(st.x, st.z - 2.2, 3, '#8fd8ff', '#000');
        else if (st.kind === 'echo') diamond(st.x, st.z, this.state.echoes.includes(`${r.id}:${st.landmark.id}`) ? '#ffd36b' : col);
      }
    } else {
    for (const n of g.resources.nodes) {
      if (!n.alive || Math.abs(n.x - p.x) > view * 1.5 || Math.abs(n.z - p.z) > view * 1.5) continue;
      dot(n.x, n.z, n.type === 'tree' ? 1.6 : 2.2, NODE_COLORS[n.type]);
    }
    for (const w of g.magic.wisps) dot(w.mesh.position.x, w.mesh.position.z, 3, '#ff4df0', '#000');
    // Tower & altar.
    dot(0, 0, 7, this.state.floors ? '#d9cfb8' : 'rgba(217,207,184,0.35)', '#ffd36b');
    dot(ALTAR_POS.x, ALTAR_POS.z, 3, '#8fd8ff');
    dot(g.mentor.x, g.mentor.z, 4, '#ff9bf0', '#fff');
    for (const gt of g.gates.list) dot(gt.x, gt.z, 3.5, this.state.schoolUnlocked(gt.def.id) ? gt.def.color : '#555', '#000');
    for (const s of g.shrines.list) {
      const solved = this.state.shrines.includes(s.def.id);
      const [mx, my] = toMap(s.x, s.z);
      const d = Math.hypot(mx - R, my - R);
      const cx = d > R - 8 ? R + ((mx - R) / d) * (R - 8) : mx;
      const cy = d > R - 8 ? R + ((my - R) / d) * (R - 8) : my;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = solved ? '#ffd36b' : '#' + s.def.color.toString(16).padStart(6, '0');
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.fillRect(-4.5, -4.5, 9, 9); ctx.strokeRect(-4.5, -4.5, 9, 9);
      ctx.restore();
    }
    }
    const o = this.currentObjective;
    if (o?.target) {
      const [mx, my] = toMap(o.target.x, o.target.z);
      const d = Math.hypot(mx - R, my - R);
      const cx = d > R - 10 ? R + ((mx - R) / d) * (R - 10) : mx;
      const cy = d > R - 10 ? R + ((my - R) / d) * (R - 10) : my;
      ctx.beginPath(); ctx.arc(cx, cy, 6 + Math.sin(performance.now() * 0.006) * 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    // Player arrow (always points up since the map rotates).
    const rel = g.player.mesh.rotation.y - yaw - Math.PI;
    ctx.save(); ctx.translate(R, R); ctx.rotate(-rel);
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1030'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();
    // Rim + north marker.
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,211,107,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    const [nx, ny] = [R + sn * (R - 10), R - cs * (R - 10)];
    ctx.font = '700 12px Cinzel, serif'; ctx.fillStyle = '#ffd36b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
  }

  // ----- Dialogue -----
  showDialogue(name, lines, onDone) {
    this.dialogueState = { lines, i: 0, onDone, typing: null };
    this.el.banner.classList.add('hidden');
    this.el.dlgName.textContent = name;
    this.el.dialogue.classList.remove('hidden');
    this.typeLine();
  }

  typeLine() {
    const ds = this.dialogueState;
    const text = ds.lines[ds.i];
    let n = 0;
    clearInterval(ds.typing);
    this.el.dlgText.textContent = '';
    ds.typing = setInterval(() => {
      n += 2;
      this.el.dlgText.textContent = text.slice(0, n);
      if (n % 6 === 0) this.game.audio.play('talk');
      if (n >= text.length) { clearInterval(ds.typing); ds.typing = null; }
    }, 22);
  }

  advanceDialogue() {
    const ds = this.dialogueState;
    if (!ds) return;
    if (ds.typing) {
      clearInterval(ds.typing); ds.typing = null;
      this.el.dlgText.textContent = ds.lines[ds.i];
      return;
    }
    ds.i++;
    if (ds.i >= ds.lines.length) {
      this.el.dialogue.classList.add('hidden');
      this.dialogueState = null;
      ds.onDone?.();
      return;
    }
    this.typeLine();
  }

  get dialogueOpen() { return !!this.dialogueState; }

  // ----- Build panel -----
  // Missing reagents in a plan link to the creature that carries them.
  costChip(k, v, done) {
    const s = this.state, ok = s.inv[k] >= v, who = RESOURCES[k].reagent;
    const src = !done && !ok && who ? ` · from ${CREATURES[who].name}s` : '';
    return `<span class="cost ${done ? '' : ok ? 'ok' : 'no'}${who && !done ? ' cost-link' : ''}" ${who && !done ? `data-journal="${who}" title="Open the bestiary"` : ''}>${RESOURCES[k].name} ${done ? v : `${Math.min(s.inv[k], v)}/${v}`}${src}</span>`;
  }
  wireCostLinks() {
    this.el.buildFloors.querySelectorAll('[data-journal]').forEach((c) => { c.onclick = () => this.game.journal.toggle(true, c.dataset.journal); });
  }

  renderBuild(school = null) {
    if (school) return this.renderSanctumBuild(school);
    $('build-eyebrow').textContent = "Builder's Altar";
    $('build-title').textContent = 'Tower Plans';
    $('build').style.removeProperty('--c');
    const s = this.state;
    this.el.buildFloors.innerHTML = TOWER_FLOORS.map((f, i) => {
      const built = i < s.floors, next = i === s.floors;
      const cls = built ? 'built' : next ? 'next' : 'future';
      const costs = Object.entries(f.cost).map(([k, v]) => this.costChip(k, v, built)).join('');
      const lvlOk = s.level >= f.level;
      const lvl = `<span class="cost req ${built ? '' : lvlOk ? 'ok' : 'no'}">Level ${f.level}</span>`;
      const can = next && lvlOk && s.canAfford(f.cost);
      const action = built ? '<span class="cost ok">Raised ✓</span>'
        : next ? `<button class="btn ${can ? 'primary' : ''}" data-build="${i}" ${can ? '' : 'disabled'}>Raise</button>` : '';
      return `<div class="floor ${cls}"><div class="num">${i + 1}</div>
        <div><h3>${f.name}</h3><div class="lore">${f.lore}</div><div class="costs">${lvl}${costs}</div></div>
        <div>${action}</div></div>`;
    }).join('');
    const btn = this.el.buildFloors.querySelector('[data-build]');
    if (btn) btn.onclick = () => this.game.buildNextFloor();
    this.wireCostLinks();
  }

  // A school's sanctum plans: same layout as the tower, gated by mastery rank instead of level.
  renderSanctumBuild(id) {
    const s = this.state, def = schoolOf(id), sanc = SANCTUMS[id], built = s.sanctumStage(id), rank = s.mastery(id);
    $('build-eyebrow').textContent = `${def.glyph} ${def.name} Sanctum`;
    $('build-title').textContent = sanc.name;
    $('build').style.setProperty('--c', def.color);
    const boon = `<div class="sanctum-boon ${built >= sanc.stages.length ? 'got' : ''}"><b>Completion boon — ${sanc.boon.name}:</b> ${sanc.boon.desc}<br><small>Complete it as a Master to become <b>Grandmaster of ${def.name}</b>.</small></div>`;
    this.el.buildFloors.innerHTML = `<p class="sanctum-blurb">${sanc.blurb}</p>` + sanc.stages.map((f, i) => {
      const done = i < built, next = i === built;
      const costs = Object.entries(f.cost).map(([k, v]) => this.costChip(k, v, done)).join('');
      const rankOk = rank >= f.rank, guardOk = !f.guardian || s.guardians.includes(f.guardian);
      const req = (f.rank ? `<span class="cost req ${done ? '' : rankOk ? 'ok' : 'no'}">${MASTERY_RANKS[f.rank]} mastery</span>` : '')
        + (f.guardian ? `<span class="cost req ${done ? '' : guardOk ? 'ok' : 'no'}">Defeat ${GUARDIANS[f.guardian].name}${guardOk ? ' ✓' : ''}</span>` : '');
      const can = next && rankOk && guardOk && s.canAfford(f.cost);
      const action = done ? '<span class="cost ok">Raised ✓</span>'
        : next ? `<button class="btn ${can ? 'primary' : ''}" data-build="${i}" ${can ? '' : 'disabled'}>Raise</button>` : '';
      return `<div class="floor ${done ? 'built' : next ? 'next' : 'future'}"><div class="num">${i + 1}</div>
        <div><h3>${f.name}</h3><div class="lore">${f.lore}</div><div class="costs">${req}${costs}</div></div>
        <div>${action}</div></div>`;
    }).join('') + boon;
    const btn = this.el.buildFloors.querySelector('[data-build]');
    if (btn) btn.onclick = () => this.game.buildNextFloor();
    this.wireCostLinks();
  }

  // ----- Controls legend -----
  renderLegend() {
    const s = this.state;
    const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join(' ');
    const row = (keys, label, sub = '', locked = false) =>
      `<div class="lg-row${locked ? ' locked' : ''}"><div class="lg-keys">${keys}</div><div class="lg-label">${label}${sub ? `<small>${sub}</small>` : ''}</div></div>`;
    const passive = '<span class="lg-passive">passive</span>';
    const spellKeys = { bolt: k('Click'), blink: k('Q'), reach: passive, float: k('Space') + ' <span class="lg-hold">hold</span>', nova: k('F'), siphon: passive, fireball: k('R'), frostwalk: passive, earthstair: k('T') };
    const spells = SPELLS.map((sp) => {
      const locked = !s.hasSpell(sp.id);
      const sub = locked ? (sp.school ? `Master ${schoolOf(sp.school).name} to unlock` : `Unlocks at level ${sp.level}`) : `${sp.desc}${sp.mana ? ` · ${sp.mana} mana` : ''}`;
      return row(spellKeys[sp.id], `${SPELL_ICONS[sp.id]} ${sp.name}`, sub, locked);
    }).join('');
    const reachOn = s.hasSpell('reach');
    const tabs = [['move', 'Movement'], ['act', 'Actions'], ['spells', 'Spells'], ['combat', 'Combat'], ['menus', 'Menus']];
    this.legendTab ||= 'move';
    document.getElementById('legend-body').innerHTML = `
      <div class="lg-tabs" role="tablist">${tabs.map(([id, name]) => `<button class="lg-tab ${id === this.legendTab ? 'on' : ''}" data-lgtab="${id}">${name}</button>`).join('')}</div>
      <section data-lg="move"><h3>Movement</h3>
        ${row(k('W') + k('S'), 'Walk forward / back', 'Backing up is slower')}
        ${row(k('A') + k('D') + ' or mouse', 'Turn', 'The camera always follows behind you')}
        ${row(k('Shift'), 'Sprint', 'Hold while walking')}
        ${row(k('C'), 'Dodge', 'A quick dash; nothing can touch you mid-dash')}
        ${row(k('Space'), 'Jump')}
      </section>
      <section data-lg="act"><h3>Actions</h3>
        ${row(k('E') + ' <span class="lg-hold">hold</span>', 'Harvest', `Trees, boulders, crystals and blooms (and each realm's own)${reachOn ? ' · Far Reach: 2× faster' : ''}`)}
        ${row(k('E'), 'Interact', 'Talk, build, begin a trial')}
        ${row(k('P'), 'Tower plans', 'What the next floor needs')}
        ${row(k('B'), 'Bestiary', 'Creatures, weaknesses and drops')}
        ${row(k('V'), 'Satchel', 'Show or hide your resources')}
        ${row(k('E'), 'Enter your tower', 'At the gold portal by the steps')}
        ${row(k('E'), 'Use a room', 'Stair pads and room stations')}
      </section>
      <section data-lg="spells"><h3>Spells</h3>${spells}</section>
      <section data-lg="combat"><h3>Combat</h3>
        ${row(k('Tab'), 'Target next foe', 'Cycle nearby creatures')}
        ${row('<span class="lg-passive">auto</span>', 'Threat lock', 'Foes hunting you lock on by themselves')}
        ${row(k('Click'), 'Bolt the target', 'Bolts home in on a locked foe')}
        ${row(k('1') + '–' + k('5'), 'Attune your bolt', ELEMENTS.map((e) => `${e.glyph} ${e.name}${s.knows(e.id) ? '' : ' (locked)'}`).join(' · '))}
        ${row('<span class="lg-passive">rules</span>', 'Wards &amp; weaknesses', 'Weak: ×2 and a stagger · resisted: ¼')}
      </section>
      <section data-lg="menus"><h3>Camera &amp; menus</h3>
        ${row('Mouse up / down', 'Tilt camera')}
        ${row('Scroll wheel', 'Zoom in / out')}
        ${row(k('K'), 'Schools of Magic', 'Mastery of each school')}
        ${row(k('J'), 'Quest log', 'Story, your tower and every sanctum')}
        ${row(k('M'), 'World atlas', 'Every land; travel between them')}
        ${row(k('I'), 'Room guide', 'What each room is for')}
        ${row(k('H'), 'Show / hide this legend')}
        ${row(k('Esc'), 'Pause, save, sound settings')}
        ${row('Click the game', 'Capture the mouse for turning')}
      </section>`;
    const body = document.getElementById('legend-body');
    const show = () => {
      body.querySelectorAll('[data-lg]').forEach((x) => x.classList.toggle('on', x.dataset.lg === this.legendTab));
      body.querySelectorAll('[data-lgtab]').forEach((b) => b.classList.toggle('on', b.dataset.lgtab === this.legendTab));
    };
    body.querySelectorAll('[data-lgtab]').forEach((b) => { b.onclick = () => { this.legendTab = b.dataset.lgtab; show(); this.game.audio.play('ui'); }; });
    show();
  }

  // ----- Schools of Magic -----
  // Schools of Magic (K) lives in schoolsui.js; open on the realm you're in, else where you left off.
  renderSchools() {
    const g = this.game;
    if (g.realm) g.schoolsPick = g.realm.id;
    renderSchools(g, g.schoolsPick || 'arcane');
  }

  renderPause() {
    const s = this.state;
    // The headline: who you are and how far along. The small counts sit on one quiet line.
    this.el.pauseStats.innerHTML = `
      <div class="ps-rank"><span class="ps-lvl">${s.level}</span><div><b>${s.rank}</b><small>${formatTime(s.playTime)} played</small></div></div>
      <dl class="ps-figs">
        <div><dt>Tower floors</dt><dd>${s.floors}<small>/${TOWER_FLOORS.length}</small></dd></div>
        <div><dt>Shrines</dt><dd>${s.shrines.length}<small>/${SHRINES.length}</small></dd></div>
        <div><dt>Banished</dt><dd>${s.stats.wisps}</dd></div>
      </dl>
      <p class="pause-minor">${s.stats.gathered} gathered · ${s.stats.spells} spells cast</p>`;
    const held = Object.entries(RESOURCES).filter(([k]) => s.inv[k] > 0);
    $('pause-satchel').innerHTML = `<div class="eyebrow">Satchel</div><div class="ps-sat">${held.length
      ? held.map(([k, r]) => `<span class="sat" style="--c:${r.color}"><i></i><b>${s.inv[k]}</b> ${r.name}</span>`).join('')
      : '<small>Empty — charm a tree or shape a boulder.</small>'}</div>`;
  }

}
