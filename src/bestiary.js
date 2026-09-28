import { TOWER_FLOORS, SANCTUMS, UPGRADES, RESOURCES, SCHOOLS } from './data.js';

// The elemental combat rules ("locks and keys"), the creatures that obey them, and the
// bestiary journal's knowledge model. Pure data + pure functions: Magic applies the results,
// the journal renders them, the state stores what the player has learned.

// ---------------------------------------------------------------- elements
// One bolt, five attunements (keys 1–5). Each is learned somewhere in the story.
export const ELEMENTS = [
  { id: 'arcane', name: 'Arcane', key: 1, color: '#8fd8ff', core: '#e8fbff', glyph: '✦', school: null,
    learn: 'Known from the start', how: 'Fast and homing: the all-rounder.' },
  { id: 'radiance', name: 'Radiance', key: 2, color: '#ffd36b', core: '#fff6d8', glyph: '☀', school: null,
    learn: 'Research it at the Spell Tome in your Study', how: 'Slower; leaves a pool of light. Spirits inside it turn solid; crystal eyes are dazzled.' },
  { id: 'earth', name: 'Earth', key: 3, color: '#dca468', core: '#f6dcb8', glyph: '⛰', school: 'geomancy',
    learn: 'Reach Initiate rank in Geomancy', how: 'A heavy arcing stone. Breaks armour and ice of any kind and knocks foes down.' },
  { id: 'frost', name: 'Frost', key: 4, color: '#8fe3ff', core: '#effbff', glyph: '❄', school: 'cryomancy',
    learn: 'Reach Initiate rank in Cryomancy', how: 'Chills and slows; three hits freeze a foe solid. Arcane shatters the frozen.' },
  { id: 'fire', name: 'Fire', key: 5, color: '#ff8a3c', core: '#ffe2b8', glyph: '🔥', school: 'pyromancy',
    learn: 'Reach Initiate rank in Pyromancy', how: 'Burns through armour and ice. Frost then Fire on stone: thermal shock.' },
];
export const EL = Object.fromEntries(ELEMENTS.map((e) => [e.id, e]));

// ---------------------------------------------------------------- creatures
// wards: resisted elements · weak: double damage + stagger · special rules live in resolveHit.
export const CREATURES = {
  shade: {
    name: 'Shadow Wisp', home: 'The valley', realm: null, when: 'After dusk', drop: 'silk', hp: 2,
    wards: [], weak: ['arcane'],
    rumour: 'Scraps of forgotten spells gather in the dark. They hunt in packs near the crystal outcrops once the sun is down.',
    trick: '"A wisp is only a spell that forgot its caster. Arcane reminds it. Two good bolts, and it remembers nothing at all." — Aldric',
    carries: 'Its threads are fine as spider-silk and hum faintly. The Spell Tome would drink them — and so would a library\'s bindings.',
    elder: { name: 'Hollow Wisp', trait: 'Invisible unless within 12 m of a crystal outcrop or the tower.' },
    perk: { at: 15, name: 'Dusk Ward', desc: 'Wisps no longer drain mana on contact.' },
    note: 'I counted forty in one night by the eastern crystals. They sing, very quietly, the spells they used to be.',
  },
  specter: {
    name: 'Restless Spirit', home: 'The Hollow Crypt', realm: 'necromancy', when: 'Any hour, from the graves', drop: 'ecto', hp: 3,
    wards: ['arcane'], weak: ['radiance'], intangible: true,
    rumour: 'Something drifts between the graves west of the Drowned Chapel, and rises again however often it is struck.',
    trick: '"Bolts pass through the dead like wind through a sheet. Give them light to stand in — a Radiance pool, a soul lantern — and they must be solid to stay in it." — Aldric',
    carries: 'Where it fades, a cold, glistening dew is left behind. Wells could be filled with it, and windows glazed with it.',
    elder: { name: 'Grave Warden', trait: 'Splits into two lesser spirits if it leaves the light before it falls.' },
    perk: { at: 15, name: 'Lantern Keeper', desc: 'Radiance pools last twice as long.' },
    note: 'They are not wicked, only lost. Most go quietly once the light finds them.',
  },
  bones: {
    name: 'Bone Soldier', home: 'The Hollow Crypt · the Bone Fields', realm: 'necromancy', when: 'Where the old army fell', drop: 'bone', hp: 3,
    wards: ['arcane', 'frost'], weak: ['earth'], stone: true,
    rumour: 'A whole army lies under the Bone Fields. When the haunt wakes, it remembers how to stand in ranks.',
    trick: '"Their shields turn aside a bolt and shrug off the cold. But a thrown stone breaks bone like any hammer." — Aldric',
    carries: 'Sound old bone, and plenty of it — the Ossuary could use every piece.',
    elder: { name: 'Bone Sergeant', trait: 'Raises its shield: only a stone from the side or behind breaks through.' },
    perk: { at: 12, name: 'Bonebreaker', desc: 'Earth stones knock Bone Soldiers apart in one hit.' },
    note: 'They march in step even now. Someone drilled them very well, once.',
  },
  golem: {
    name: 'Crag Golem', home: 'The Sundered Deep', realm: 'geomancy', when: 'Any hour, from rock piles', drop: 'golemheart', hp: 4,
    wards: ['arcane', 'fire'], weak: ['radiance', 'earth'], plated: true,
    rumour: 'Rock piles in the Deep stand up when the ground shakes. Miners called them the mountain\'s dogs.',
    trick: '"Its eyes are cut crystal. Light blinds it, and a blind golem forgets to guard its chest. Stone cracks stone, too — once you know how to throw it." — Aldric',
    carries: 'Something at its core still beats like a heart. A bell-frame or a crown would want its steadiness.',
    elder: { name: 'Elder Golem', trait: 'Regrows its plates six seconds after they break. Don\'t let it rest.' },
    perk: { at: 12, name: 'Stonebreaker', desc: 'Earth stones stun golems for 3 seconds.' },
    note: 'Frost, then fire — a stone that is shocked hot and cold splits along its grain. Veyra taught me that. I wish she had not.',
  },
  wraith: {
    name: 'Frost Wraith', home: 'The Glacial Hollow', realm: 'cryomancy', when: 'Worst in blizzards', drop: 'rimecore', hp: 3,
    wards: ['frost'], weak: ['fire', 'earth'], armoured: true,
    rumour: 'On the ice fields, the blizzard sometimes has a face. It wears the snow like armour.',
    trick: '"Ice armour. Earth shatters it, fire melts it; anything else you merely chip. And never feed it frost." — Aldric',
    carries: 'A core of cold that never thaws. A volcano would need such a thing to be quenched.',
    elder: { name: 'Rime Wraith', trait: 'Refreezes its armour three seconds after it breaks.' },
    perk: { at: 15, name: 'Icebreaker', desc: 'Wraith ice armour breaks in one hit of any element.' },
    note: 'The blizzard hides them from the living. The dead see them well enough.',
  },
  imp: {
    name: 'Fire Imp', home: 'The Ember Caldera', realm: 'pyromancy', when: 'Any hour, near lava', drop: 'cinder', hp: 3,
    wards: ['fire'], weak: ['frost'], heals: 'fire',
    rumour: 'The caldera\'s lava has laughter in it. Little things climb out and run along the rivers.',
    trick: '"Fire feeds an imp — don\'t. Kill it raw and it bursts into a lava pool; freeze it first and it shatters clean. A stone smothers any pool it leaves." — Aldric',
    carries: 'Its heart keeps burning after the rest is ash. Chains are smelted with such things, and crowns forged.',
    elder: { name: 'Forge Imp', trait: 'Flees to lava to heal when hurt. Freeze it before it gets there.' },
    perk: { at: 15, name: 'Ember Harvest', desc: 'Frozen imps drop two Cinder Hearts.' },
    note: 'I kept one in a lantern for a winter. It was excellent company and burned down the kitchen.',
  },
  // Hidden targets used by bosses (not in the journal): the Lich's phylacteries, the Unraveller's orbs.
  phylactery: { name: 'Phylactery', hidden: true, home: '', when: '', drop: null, hp: 2, wards: ['arcane', 'earth', 'frost', 'fire'], weak: ['radiance'], perk: { at: 1e9 } },
  orb: { name: 'Ward Orb', hidden: true, home: '', when: '', drop: null, hp: 2, wards: [], weak: [], perk: { at: 1e9 } },
};
export const CREATURE_ORDER = ['shade', 'specter', 'bones', 'golem', 'wraith', 'imp'];
export const kindForRealm = (realmId) => ({ necromancy: 'specter', geomancy: 'golem', cryomancy: 'wraith', pyromancy: 'imp' })[realmId] || 'shade';

// ---------------------------------------------------------------- ranks
// Ranks follow place, hour and chapter — never the player's level. Higher ranks add a rule.
export const RANK = {
  common: { id: 'common', name: 'Common', hp: 1, scale: 1, reagent: 1, xp: 1 },
  elder: { id: 'elder', name: 'Elder', hp: 2.5, scale: 1.3, reagent: 2, xp: 3, pristine: 0.2 },
  dread: { id: 'dread', name: 'Dread', hp: 6, scale: 1.75, reagent: 3, xp: 10 },
};

// Chance a newly spawned creature is an Elder.
//   dist: distance from the realm's portal (or the tower)   night: 0..1
//   movedOn: the player has opened the next chapter's gate   haunt: inside uncleared haunted ground
export function elderChance({ dist = 0, night = 0, movedOn = false, haunt = false }) {
  let c = 0;
  if (dist > 95) c += 0.45;
  else if (dist > 70) c += 0.15;
  if (night > 0.7) c += 0.25;
  if (movedOn) c += 0.3;
  if (haunt) c += 0.35;
  return Math.min(0.75, c);
}

// ---------------------------------------------------------------- the damage rules
// w: the creature instance ({kind, rank, armour, frozen, dazzled, solid, …}); el: element id.
// Returns { mult, tag, effects[] } — Magic applies the numbers and effects. strict: the
// "Scholar" setting, where resisted elements do nothing at all.
export function resolveHit(w, el, { strict = false, perks = {} } = {}) {
  const d = CREATURES[w.kind];
  const res = strict ? 0 : 0.25;
  const out = { mult: 1, tag: 'neutral', effects: [] };
  const weak = () => { out.mult = 2; out.tag = 'weak'; out.effects.push('stagger'); };
  const resist = () => { out.mult = res; out.tag = 'resisted'; };
  // Elemental side effects that don't depend on the creature.
  if (el === 'frost') out.effects.push('chill');
  if (el === 'earth') out.effects.push('knockdown');
  if (el === 'radiance') out.effects.push('pool');
  // Combos on a frozen foe.
  if (w.frozen > 0) {
    if (el === 'fire' && (d.plated || w.kind === 'wraith' || w.stone)) { out.mult = 99; out.tag = 'shock'; out.effects.push('thaw'); return out; }
    if (el === 'arcane' || el === 'earth') { out.mult = 3; out.tag = 'shatter'; out.effects.push('thaw'); return out; }
    if (el === 'fire') { out.effects.push('thaw'); }
  }
  switch (w.kind) {
    case 'shade':
      if (el === 'arcane') weak();
      break;
    case 'specter':
      if (el === 'radiance') { weak(); out.effects.push('solidify'); }
      else if (!(w.solid > 0)) { resist(); out.tag = 'passes'; }
      break;
    case 'golem':
      if (el === 'earth') { weak(); if (w.armour) out.effects.push('breakArmour'); if (perks.golem) out.effects.push('stun'); }
      else if (el === 'radiance') { out.effects.push('dazzle'); if (w.armour) out.mult = 0.5, out.tag = 'dazzled'; else weak(); }
      else if (w.armour && !(w.dazzled > 0)) resist();
      else if (w.dazzled > 0 && el === 'arcane') { weak(); out.tag = 'core'; }
      else if (el === 'fire') resist();
      break;
    case 'wraith':
      if (el === 'frost') { resist(); out.effects = out.effects.filter((e) => e !== 'chill'); }
      else if (el === 'fire' || el === 'earth') { weak(); if (w.armour) out.effects.push('breakArmour'); }
      else if (w.armour) { if (perks.wraith) { out.effects.push('breakArmour'); } else resist(); }
      break;
    case 'imp':
      if (el === 'fire') { out.mult = -1; out.tag = 'absorbed'; }
      else if (el === 'frost') weak();
      break;
    case 'bones':
      if (el === 'earth') { weak(); if (perks.bones) out.mult = 99; }
      else if (el === 'arcane' || el === 'frost') resist();
      break;
    case 'phylactery':
      if (el === 'radiance') weak(); else resist();
      break;
    case 'orb':
      // An Unraveller ward orb: only its own element breaks it.
      if (el === w.orbEl) weak(); else { out.mult = 0; out.tag = 'resisted'; }
      break;
  }
  return out;
}

// What the player sees for each element against a creature, once they've tried it.
export function outcomeLabel(tag) {
  return { weak: 'Weak', resisted: 'Resisted', passes: 'Passes through', absorbed: 'Heals it', dazzled: 'Dazzles', neutral: 'Neutral', core: 'Weak (dazzled)', shatter: 'Shatter', shock: 'Thermal shock' }[tag] || tag;
}
// Journal summary for an element: 'weak' | 'resisted' | 'neutral' | 'heals' | 'armour'.
export function elementVerdict(kind, el) {
  const d = CREATURES[kind];
  if (d.heals === el) return 'heals';
  if (d.weak.includes(el)) return 'weak';
  if (d.wards.includes(el)) return 'resisted';
  if (d.armoured) return 'armour';
  return 'neutral';
}

// ---------------------------------------------------------------- where things are needed
// Every recipe in the game that spends a resource, for the reward pop-up and the journal.
export function recipes() {
  const list = [];
  TOWER_FLOORS.forEach((f, i) => list.push({ where: f.name, group: 'Arcane Tower', cost: f.cost, done: (s) => s.floors > i, next: (s) => s.floors === i }));
  for (const [id, sanc] of Object.entries(SANCTUMS)) {
    sanc.stages.forEach((st, i) => list.push({ where: st.name, group: sanc.name, cost: st.cost, school: id, done: (s) => s.sanctumStage(id) > i, next: (s) => s.sanctumStage(id) === i }));
  }
  UPGRADES.forEach((u) => u.cost.forEach((c, r) => list.push({ where: `${u.name}${u.max > 1 ? ` ${'I'.repeat(r + 1)}` : ''}`, group: 'Spell Tome', cost: c, done: (s) => s.up(u.id) > r, next: (s) => s.up(u.id) === r })));
  return list;
}
let RECIPES = null;
export function neededFor(key, state, limit = 4) {
  RECIPES ||= recipes();
  return RECIPES.filter((r) => r.cost[key] && !r.done(state))
    .sort((a, b) => (b.next(state) - a.next(state)))
    .slice(0, limit)
    .map((r) => ({ where: r.where, group: r.group, need: r.cost[key], have: Math.min(state.inv[key], r.cost[key]), next: r.next(state) }));
}

// Which creature drops a resource (reagents only).
export const dropperOf = (key) => CREATURE_ORDER.find((k) => CREATURES[k].drop === key);
export const resName = (k) => RESOURCES[k]?.name || k;
export const schoolName = (id) => SCHOOLS.find((s) => s.id === id)?.realm || 'The valley';
