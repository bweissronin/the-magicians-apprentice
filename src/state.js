import { MAX_LEVEL, xpForLevel, TOWER_FLOORS, SPELLS, rankFor, SCHOOLS, MASTERY_RANKS, SANCTUMS, RESOURCES, UPGRADES } from './data.js';
import { CREATURES, EL } from './bestiary.js';

const SAVE_KEY = 'magicians-apprentice-save-v1';

// Central, serialisable game state. Systems read it and subscribe to its events;
// only this class mutates progression, so saves are a straight JSON dump.
export class GameState {
  constructor() {
    this.listeners = {};
    this.reset();
  }

  reset() {
    this.level = 1;
    this.xp = 0;
    this.inv = Object.fromEntries(Object.keys(RESOURCES).map((k) => [k, 0]));
    this.floors = 0;
    this.shrines = [];
    this.talkedToMentor = false;
    this.ascended = false;
    this.mana = 100;
    this.playTime = 0;
    this.stats = { gathered: 0, wisps: 0, spells: 0 };
    this.player = null; // {x, z, yaw}
    this.timeOfDay = 0.3;
    this.upgrades = Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
    this.buffs = {}; // potion id -> seconds remaining
    this.hintsRead = 0;
    // Per-school progress: solved puzzle ids and trial kills.
    this.schools = Object.fromEntries(SCHOOLS.map((s) => [s.id, { puzzles: [], kills: 0, trial: false }]));
    // Stages raised on each school's sanctum.
    this.sanctums = Object.fromEntries(SCHOOLS.map((s) => [s.id, 0]));
    this.echoes = []; // "school:landmark" echo stones heard in the realms
    // Combat & the bestiary journal: what the apprentice has learned about each creature.
    this.element = 'arcane';
    this.bestiary = Object.fromEntries(Object.keys(CREATURES).map((k) => [k, { rumour: false, seen: false, kills: 0, tried: {}, dropped: false, ranks: {}, last: null }]));
    this.tracked = null;       // creature kind pinned to the quest line
    // Story: Aldric's fallen towers.
    this.story = { letter: false, chapter: 1, seen: {} };
    this.haunts = [];          // "school:landmark" haunts cleared
    this.guardians = [];       // guardian ids defeated
    this.grandfathered = {};   // realms opened before the gate keys existed (old saves)
    this.finale = false;       // the Unraveller defeated
    this.guide = { rooms: [], used: [] }; // tower rooms introduced / stations tried (roomguide.js)
  }

  // ----- Elements & keys -----
  knows(el) {
    if (el === 'arcane') return true;
    if (el === 'radiance') return this.up('radiance') >= 1;
    const school = EL[el]?.school;
    return !!school && this.mastery(school) >= 1;
  }
  hasKey(key) {
    if (key === 'sight') return this.mastery('necromancy') >= 1;
    return this.knows(key);
  }
  beast(kind) { return this.bestiary[kind]; }
  perk(kind) { return this.bestiary[kind].kills >= CREATURES[kind].perk.at; }

  school(id) { return this.schools[id]; }
  // 0–3 from puzzles + trial; a Master who completes the sanctum becomes Grandmaster (4).
  mastery(id) {
    const p = this.schools[id];
    const m = Math.min(3, p.puzzles.length + (p.trial ? 1 : 0));
    return m === 3 && this.sanctumComplete(id) ? 4 : m;
  }
  sanctumStage(id) { return this.sanctums[id] || 0; }
  nextSanctumStage(id) { return SANCTUMS[id].stages[this.sanctumStage(id)] || null; }
  sanctumComplete(id) { return this.sanctumStage(id) >= SANCTUMS[id].stages.length; }
  hasBoon(id) { return this.sanctumComplete(id); }
  masteryTitle(id) { return MASTERY_RANKS[this.mastery(id)]; }
  isMaster(id) { return this.mastery(id) >= 3; }
  schoolUnlocked(id) {
    const d = SCHOOLS.find((s) => s.id === id);
    return !!this.grandfathered[id] || (this.level >= d.level && this.hasKey(d.needs.key));
  }
  // Why a gate is still sealed, or null.
  gateBlock(id) {
    const d = SCHOOLS.find((s) => s.id === id);
    if (this.schoolUnlocked(id)) return null;
    if (this.level < d.level) return `requires level ${d.level}${this.hasKey(d.needs.key) ? '' : ` and ${d.needs.label}`}`;
    return `requires ${d.needs.label}`;
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, data) { (this.listeners[evt] || []).forEach((fn) => fn(data)); }

  get maxMana() { return 80 + this.level * 20 + this.upgrades.well * 25; }
  get manaRegen() { return 5 + this.level * 0.6 + this.upgrades.well * 2.5; }
  up(id) { return this.upgrades[id] || 0; }
  hasBuff(id) { return (this.buffs[id] || 0) > 0; }

  tickBuffs(dt) {
    for (const k of Object.keys(this.buffs)) {
      this.buffs[k] -= dt;
      if (this.buffs[k] <= 0) { delete this.buffs[k]; this.emit('buffEnd', k); }
    }
  }
  get rank() { return rankFor(this.level); }
  get xpToNext() { return this.level >= MAX_LEVEL ? Infinity : xpForLevel(this.level); }
  hasSpell(id) {
    const sp = SPELLS.find((s) => s.id === id);
    return sp.school ? this.isMaster(sp.school) : this.level >= sp.level;
  }

  addXP(amount, source = '') {
    if (this.level >= MAX_LEVEL) return;
    this.xp += amount;
    this.emit('xp', { amount, source });
    while (this.level < MAX_LEVEL && this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.mana = this.maxMana;
      const unlocked = SPELLS.filter((s) => s.level === this.level);
      this.emit('levelup', { level: this.level, rank: this.rank, unlocked });
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    this.emit('change');
  }

  addItem(key, n) {
    this.inv[key] += n;
    this.emit('item', { key, n });
    this.emit('change');
  }

  canAfford(cost) {
    return Object.entries(cost).every(([k, v]) => this.inv[k] >= v);
  }

  spend(cost) {
    for (const [k, v] of Object.entries(cost)) this.inv[k] -= v;
    this.emit('change');
  }

  get nextFloor() { return TOWER_FLOORS[this.floors] || null; }

  spendMana(n) {
    if (this.mana < n) return false;
    this.mana -= n;
    return true;
  }

  save() {
    const data = {
      level: this.level, xp: this.xp, inv: this.inv, floors: this.floors,
      shrines: this.shrines, talkedToMentor: this.talkedToMentor, ascended: this.ascended,
      playTime: this.playTime, stats: this.stats, player: this.player, timeOfDay: this.timeOfDay,
      upgrades: this.upgrades, buffs: this.buffs, hintsRead: this.hintsRead, schools: this.schools, sanctums: this.sanctums, echoes: this.echoes,
      element: this.element, bestiary: this.bestiary, tracked: this.tracked, story: this.story, haunts: this.haunts, guardians: this.guardians, grandfathered: this.grandfathered, finale: this.finale, guide: this.guide,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  }

  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      // Merge nested objects so saves from older versions gain new fields with defaults.
      data.upgrades = { ...this.upgrades, ...(data.upgrades || {}) };
      data.buffs = data.buffs || {};
      data.inv = { ...this.inv, ...(data.inv || {}) };
      data.sanctums = { ...this.sanctums, ...(data.sanctums || {}) };
      data.echoes = data.echoes || [];
      data.schools = Object.fromEntries(Object.entries(this.schools).map(([k, v]) => [k, { ...v, ...(data.schools?.[k] || {}) }]));
      data.bestiary = Object.fromEntries(Object.entries(this.bestiary).map(([k, v]) => [k, { ...v, ...(data.bestiary?.[k] || {}) }]));
      data.story = { ...this.story, ...(data.story || {}) };
      data.haunts ||= []; data.guardians ||= [];
      data.guide = { rooms: [], used: [], ...(data.guide || {}) };
      // Migration: realms already opened under the old level-only gates stay open.
      if (!data.grandfathered) {
        data.grandfathered = {};
        for (const [k, v] of Object.entries(data.schools)) if (v.puzzles.length || v.kills || data.sanctums[k]) data.grandfathered[k] = true;
        if (data.floors > 0) data.story.letter = true; // an established apprentice has read the letter
      }
      if (!EL[data.element]) data.element = 'arcane';
      Object.assign(this, data);
      this.mana = this.maxMana;
      return true;
    } catch { return false; }
  }

  static wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
}
