// Pure game-design data. Tuning lives here so balancing never touches systems code.

export const RESOURCES = {
  wood:    { name: 'Timber',        color: '#c8894a', glyph: '🪵' },
  stone:   { name: 'Stone',         color: '#a9b0b8', glyph: '🪨' },
  crystal: { name: 'Aether Crystal', color: '#9b7bff', glyph: '💎' },
  essence: { name: 'Mana Essence',  color: '#5ff2d2', glyph: '✨' },
  sigil:   { name: 'Arcane Sigil',  color: '#ffd36b', glyph: '🔯' },
  // Realm materials: gathered only inside each school's realm, spent on its sanctum.
  bone:    { name: 'Grave Bone',    color: '#e9e0c8', glyph: '🦴', school: 'necromancy' },
  ember:   { name: 'Ember Core',    color: '#ff7a2a', glyph: '🔥', school: 'pyromancy' },
  frost:   { name: 'Frost Shard',   color: '#8fe3ff', glyph: '❄', school: 'cryomancy' },
  heartstone: { name: 'Heartstone',  color: '#ffb347', glyph: '⛰', school: 'geomancy' },
  // Reagents: carried only by creatures, each needed somewhere else (see bestiary.js).
  silk:    { name: 'Shadow Silk',   color: '#b98cff', glyph: '🕸', reagent: 'shade' },
  ecto:    { name: 'Ectoplasm',     color: '#8dffb0', glyph: '💧', reagent: 'specter' },
  golemheart: { name: 'Golem Heart', color: '#ff9a3c', glyph: '🧡', reagent: 'golem' },
  rimecore: { name: 'Rime Core',    color: '#bfefff', glyph: '💠', reagent: 'wraith' },
  cinder:  { name: 'Cinder Heart',  color: '#ff5a2a', glyph: '♦', reagent: 'imp' },
};

export const MAX_LEVEL = 10;
export const xpForLevel = (l) => Math.round(60 * Math.pow(l, 1.4));

export const RANKS = [
  { level: 1, title: 'Novice Apprentice' },
  { level: 3, title: 'Apprentice' },
  { level: 5, title: 'Adept' },
  { level: 7, title: 'Conjurer' },
  { level: 9, title: 'Sorcerer' },
  { level: 10, title: 'Magician' },
];
export const rankFor = (level) => RANKS.filter((r) => level >= r.level).pop().title;

// Node types you can harvest in the world.
export const NODE_TYPES = {
  tree:    { verb: 'Charm',    yields: { wood: [3, 5] },    time: 1.6, xp: 8,  respawn: 90 },
  rock:    { verb: 'Shape',  yields: { stone: [3, 5] },   time: 1.9, xp: 8,  respawn: 100 },
  crystal: { verb: 'Gather',  yields: { crystal: [2, 3] }, time: 2.4, xp: 14, respawn: 120, minLevel: 2 },
  flower:  { verb: 'Distill', yields: { essence: [1, 2] }, time: 1.4, xp: 12, respawn: 80, minLevel: 3 },
  // Realm nodes.
  bones:   { verb: 'Exhume',      name: 'Bone Pile',     yields: { bone: [2, 4] },  time: 1.7, xp: 12, respawn: 55 },
  magma:   { verb: 'Quench',      name: 'Magma Boulder', yields: { ember: [2, 4] }, time: 1.9, xp: 14, respawn: 60 },
  rime:    { verb: 'Crystallize', name: 'Rime Crystal',  yields: { frost: [2, 4] }, time: 1.7, xp: 14, respawn: 55 },
  vein:    { verb: 'Unearth',     name: 'Heartstone Vein', yields: { heartstone: [2, 4] }, time: 1.9, xp: 14, respawn: 60 },
};

// Spells unlock as the apprentice levels. Keys are what the spellbar shows.
export const SPELLS = [
  { id: 'bolt',   name: 'Arcane Bolt',  key: 'LMB',   level: 1, mana: 8,  desc: 'Hurl a bolt of raw arcana. Banishes shadow wisps.' },
  { id: 'blink',  name: 'Blink',        key: 'Q',     level: 3, mana: 22, desc: 'Step through the Veil a short distance forward.' },
  { id: 'reach',  name: 'Far Reach',    key: 'passive', level: 5, mana: 0, desc: 'Harvest from further away, twice as fast.' },
  { id: 'float',  name: 'Levitation',   key: 'Space', level: 7, mana: 0, desc: 'Hold Space in the air to drift gently.' },
  { id: 'nova',   name: 'Starfall Nova', key: 'F',    level: 9, mana: 45, desc: 'Detonate starlight around you, banishing all nearby wisps.' },
  // School spells: unlocked by mastering a realm rather than by level.
  { id: 'siphon', name: 'Soul Siphon', key: 'passive', level: 0, school: 'necromancy', mana: 0, desc: 'Banishing a foe restores 15 mana and yields double essence.' },
  { id: 'fireball', name: 'Fireball', key: 'R', level: 0, school: 'pyromancy', mana: 20, desc: 'A blazing orb that bursts on impact, striking every foe nearby.' },
  { id: 'frostwalk', name: 'Frostwalk', key: 'passive', level: 0, school: 'cryomancy', mana: 0, desc: 'Water freezes beneath your feet — walk across any lake.' },
  { id: 'earthstair', name: 'Earthen Stair', key: 'T', level: 0, school: 'geomancy', mana: 18, desc: 'Raise a stone pillar ahead of you. Chain three to climb, bridge lava and chasms, or wall off a spirit.' },
];

// Each tower floor: cost, level gate, and the XP it grants when raised.
export const TOWER_FLOORS = [
  { id: 'foundation', name: 'Foundation Stones', level: 1, xp: 120,
    cost: { wood: 15, stone: 25 },
    lore: 'Every tower begins with a promise laid in stone.' },
  { id: 'study', name: "Apprentice's Study", level: 2, xp: 260,
    cost: { wood: 30, stone: 25, crystal: 6, sigil: 1 },
    lore: 'A quiet room of candles, ink and first spells.' },
  { id: 'library', name: 'Arcane Library', level: 4, xp: 420,
    cost: { wood: 45, stone: 35, crystal: 12, silk: 2, sigil: 1 },
    lore: 'Shelves that remember every word read aloud to them.' },
  { id: 'alchemy', name: 'Alchemy Laboratory', level: 5, xp: 600,
    cost: { wood: 25, stone: 50, crystal: 18, essence: 10, sigil: 1 },
    lore: 'Where base matter is persuaded to become something finer.' },
  { id: 'observatory', name: 'Star Observatory', level: 7, xp: 800,
    cost: { wood: 35, stone: 60, crystal: 26, essence: 18, sigil: 1 },
    lore: 'The sky is a book. Here you learn to read it.' },
  { id: 'spire', name: 'The Arcane Spire', level: 9, xp: 1100,
    cost: { stone: 80, crystal: 40, essence: 30, sigil: 1, bone: 10, heartstone: 10, frost: 10, ember: 10, silk: 1, ecto: 1, golemheart: 1, rimecore: 1, cinder: 1 },
    lore: 'A tower that holds every element — and pins the Veil shut for good.' },
];

// Rune shrines scattered around the valley. Each grants one Sigil.
export const SHRINES = [
  { id: 'whisper', name: 'Shrine of Whispers', x: 62, z: -38, level: 1, color: 0x6fd3ff,
    puzzle: 'sequence', difficulty: 1, xp: 200,
    intro: 'The runes hum a melody. Echo it back to them.' },
  { id: 'leyline', name: 'Ley-Line Nexus', x: -78, z: 34, level: 3, color: 0x7dff9b,
    puzzle: 'lights', difficulty: 1, xp: 350,
    intro: 'Awaken every ley node. Each touch flips its neighbours too.' },
  { id: 'astral', name: 'Astral Lock', x: 26, z: 104, level: 4, color: 0xc58bff,
    puzzle: 'rings', difficulty: 1, xp: 500,
    intro: 'Turn the rings until every star points north. The rings are bound together.' },
  { id: 'echo', name: 'Hall of Echoes', x: -54, z: -112, level: 6, color: 0xff8a5c,
    puzzle: 'sequence', difficulty: 2, xp: 650,
    intro: 'A longer song, sung faster. Do not falter.' },
  { id: 'crown', name: 'Crown of Stars', x: 128, z: 58, level: 8, color: 0xffe066,
    puzzle: 'rings', difficulty: 2, xp: 800,
    intro: 'Four rings, tightly bound. Only a true Sorcerer can align them.' },
];

export const TOWER_POS = { x: 0, z: 0 };
export const ALTAR_POS = { x: 7, z: 11 };
export const MENTOR_POS = { x: -9, z: 9 };
export const PLAYER_START = { x: 0, z: 24 };

// ---------------- Tower interiors ----------------
// One room per raised floor; index matches TOWER_FLOORS.
export const ROOMS = [
  { name: 'Entrance Hall', station: 'trophies', stationLabel: 'Admire your Sigils' },
  { name: "Apprentice's Study", station: 'upgrades', stationLabel: 'Study the Spell Tome' },
  { name: 'Arcane Library', station: 'hints', stationLabel: 'Consult the Lectern' },
  { name: 'Alchemy Laboratory', station: 'brew', stationLabel: 'Brew at the Cauldron' },
  { name: 'Star Observatory', station: 'travel', stationLabel: 'Look through the Telescope' },
  { name: 'The Arcane Spire', station: 'lookout', stationLabel: 'Step onto the Spire Balcony' },
];

// Spell research in the Study. Each rank's cost is listed in order.
export const UPGRADES = [
  { id: 'bolt', name: 'Empowered Bolt', icon: '✦', max: 3,
    desc: ['Bolts recharge 20% faster.', 'Bolts deal double damage — wisps fall in one hit.', 'Bolts recharge 40% faster.'],
    cost: [{ essence: 4, crystal: 2, silk: 1 }, { essence: 8, crystal: 5, silk: 2 }, { essence: 12, crystal: 8, silk: 3 }] },
  { id: 'radiance', name: 'Radiance', icon: '☀', max: 2,
    desc: ['Learn the Radiance attunement [2]: a slow bolt of light that leaves a glowing pool. Spirits inside the light turn solid; crystal eyes are dazzled.', 'Radiance pools spread half again as wide.'],
    cost: [{ silk: 3, crystal: 4 }, { ecto: 4, crystal: 6 }] },
  { id: 'well', name: 'Deep Well', icon: '◈', max: 3,
    desc: ['+25 max mana, faster regeneration.', '+50 max mana, faster regeneration.', '+75 max mana, faster regeneration.'],
    cost: [{ essence: 3 }, { essence: 7, crystal: 2 }, { essence: 11, crystal: 5 }] },
  { id: 'blink', name: 'Swift Blink', icon: '➶', max: 2, requires: 'blink',
    desc: ['Blink costs 14 mana and reaches further.', 'Blink costs 8 mana and recharges quickly.'],
    cost: [{ essence: 6, crystal: 4 }, { essence: 10, crystal: 8 }] },
  { id: 'harvest', name: 'Green Thumb', icon: '❀', max: 2,
    desc: ['+1 resource from every harvest.', '+2 resources from every harvest.'],
    cost: [{ essence: 5, wood: 10 }, { essence: 10, wood: 20, stone: 10 }] },
  { id: 'stair', name: 'Deep Stair', icon: '⛰', max: 1, requires: 'earthstair',
    desc: ['Earthen Stair raises four pillars that stand for 30 seconds.'],
    cost: [{ golemheart: 2, heartstone: 10 }] },
  { id: 'rimewalk', name: 'Glacial Stride', icon: '❄', max: 1, requires: 'frostwalk',
    desc: ['Frostwalk also crusts lava beneath your feet — cross the Caldera\'s rivers unburnt.'],
    cost: [{ rimecore: 2, frost: 12 }] },
];

// Brewed and drunk on the spot in the Alchemy Laboratory.
export const POTIONS = [
  { id: 'mana', name: 'Mana Draught', icon: '🧪', color: '#7fe3ff', cost: { essence: 2 }, desc: 'Instantly refills your mana.' },
  { id: 'speed', name: 'Swiftfoot Tonic', icon: '💨', color: '#ffd36b', cost: { essence: 3, crystal: 1 }, duration: 120, desc: '+40% movement speed for 2 minutes.' },
  { id: 'harvest', name: 'Verdant Elixir', icon: '🌿', color: '#7dff9b', cost: { essence: 4, crystal: 2 }, duration: 150, desc: 'Harvest twice as fast for 2½ minutes.' },
  { id: 'ward', name: 'Wisp Ward', icon: '🛡', color: '#c58bff', cost: { essence: 5, crystal: 3 }, duration: 120, desc: 'Wisps cannot drain your mana for 2 minutes.' },
];

// Library hints for each puzzle type.
export const PUZZLE_HINTS = {
  sequence: [
    'Each rune sings its own note. Close your eyes and follow the melody rather than the lights.',
    'Hum the song back under your breath before touching the first rune — rhythm is easier to remember than order.',
  ],
  lights: [
    'Work top to bottom: for every dark node in a row, touch the node directly beneath it. Only the last row stays unsolved.',
    'The final dark pattern in the bottom row tells you exactly which nodes in the top row to press — then sweep downward again.',
  ],
  rings: [
    'Solve from the inside out. The inner ring only drags its neighbour, so fix it first, then the next, and so on.',
    'On the Crown of Stars the last ring drags the first. Align the outer three, then nudge the crown and inner ring back and forth together.',
  ],
};

export const LORE = [
  'The first Magicians built their towers upon ley lines, so the stones themselves would hum with power.',
  'Shadow wisps are fragments of forgotten spells. Banish them and their essence returns to the land.',
  'Aether crystals grow slowest where it is quietest. Master Aldric once waited forty years for a single shard.',
  'A tower is said to remember every spell cast within it. Some claim the oldest ones cast themselves on stormy nights.',
];

// ---------------- Schools of magic ----------------
// Arcane is mastered in the home valley (levels, shrines, tower). Each other school has its own
// realm, reached over a bridge at the valley's edge, with two unique puzzles and a trial.
// Mastery rank = objectives completed (0–3): Initiate → Adept → Master. Initiate teaches the
// school's element (the bolt attunement), Master grants its spell. Schools are listed in story
// order: each gate needs a level AND a key earned in the realm before it (see `needs`).
export const SCHOOLS = [
  {
    id: 'necromancy', name: 'Necromancy', realm: 'The Hollow Crypt', color: '#7dff9b', glyph: '☠', level: 2, chapter: 2,
    needs: { key: 'radiance', label: 'Radiance', hint: 'Research Radiance at the Spell Tome in your Study' },
    blurb: 'A moonlit graveyard where the dead do not rest. Weigh souls, piece together the ossuary and lift its haunts.',
    puzzles: [
      { id: 'scales', name: 'The Soul Scales', puzzle: 'scales', difficulty: 1, xp: 220, color: 0x7dff9b,
        intro: 'Place every bone on a pan. The scales only still when both sides weigh the same.' },
      { id: 'ossuary', name: 'The Ossuary Seal', puzzle: 'slider', difficulty: 1, xp: 260, color: 0x9dffc0,
        intro: 'The seal was shattered. Slide the bone tiles back until the skull is whole.' },
    ],
    trial: { name: 'Quiet the Restless', goal: 6, xp: 300, desc: 'Banish 6 restless spirits rising from the graves.' },
    spell: { id: 'siphon', name: 'Soul Siphon', key: 'passive', desc: 'Banishing a foe restores 15 mana and yields double essence.' },
    gift: { id: 'sight', name: 'Spirit Sight', desc: 'See what hides from the living: the safe way through collapsed tunnels, and wraiths inside a blizzard.' },
  },
  {
    id: 'geomancy', name: 'Geomancy', realm: 'The Sundered Deep', color: '#dca468', glyph: '⛰', level: 3, chapter: 3,
    needs: { key: 'sight', label: 'Spirit Sight', hint: 'Reach Initiate in Necromancy to learn Spirit Sight' },
    blurb: 'A mountain hollowed into a cavern of crystal and fungus-light. Roll the boulders, align the ore seams, and still the trembling earth.',
    puzzles: [
      { id: 'boulders', name: 'The Boulder Run', puzzle: 'boulders', difficulty: 1, xp: 260, color: 0xdca468,
        intro: 'Push the boulders onto the pressure plates. A boulder rolls until something stops it — order matters.' },
      { id: 'strata', name: 'The Strata Lock', puzzle: 'strata', difficulty: 1, xp: 300, color: 0xffb347,
        intro: 'Slide the layers of rock until the ore veins join into one seam, top to bottom.' },
    ],
    trial: { name: 'Still the Deep', goal: 6, xp: 340, desc: 'Banish 6 crag golems woken by the tremors.' },
    spell: { id: 'earthstair', name: 'Earthen Stair', key: 'T', mana: 18, desc: 'Raise a stone pillar ahead of you. Chain three to climb, bridge lava and chasms, or wall off a spirit.' },
  },
  {
    id: 'cryomancy', name: 'Cryomancy', realm: 'The Glacial Hollow', color: '#8fe3ff', glyph: '❄', level: 5, chapter: 4,
    needs: { key: 'earth', label: 'Earth', hint: 'Reach Initiate in Geomancy to learn the Earth attunement' },
    blurb: 'An aurora-lit ice field where every step slides. Guide a rune across the frozen lake and bend starlight through crystal.',
    puzzles: [
      { id: 'iceslide', name: 'The Frozen Lake', puzzle: 'iceslide', difficulty: 1, xp: 360, color: 0x8fe3ff,
        intro: 'Push the rune stone. On ice it slides until something stops it. Reach the glowing sigil.' },
      { id: 'prism', name: 'The Crystal Prism', puzzle: 'mirrors', difficulty: 1, xp: 380, color: 0xc9f4ff,
        intro: 'Turn the ice mirrors to bend the starbeam into the frozen heart.' },
    ],
    trial: { name: 'Weather the Blizzard', goal: 8, xp: 420, desc: 'Banish 8 frost wraiths while the ice pulls at your feet.' },
    spell: { id: 'frostwalk', name: 'Frostwalk', key: 'passive', desc: 'Water freezes beneath your feet — walk across any lake.' },
  },
  {
    id: 'pyromancy', name: 'Pyromancy', realm: 'The Ember Caldera', color: '#ff8a3c', glyph: '🔥', level: 6, chapter: 5,
    needs: { key: 'frost', label: 'Frost', hint: 'Reach Initiate in Cryomancy to learn the Frost attunement' },
    blurb: 'A living volcano of basalt and lava. Channel flame through the conduits and restack the ember forge — without stepping in the magma.',
    puzzles: [
      { id: 'conduit', name: 'The Flame Conduit', puzzle: 'conduit', difficulty: 1, xp: 300, color: 0xff8a3c,
        intro: 'Turn the channels so fire flows from the heart-flame to every brazier.' },
      { id: 'forge', name: 'The Ember Forge', puzzle: 'hanoi', difficulty: 1, xp: 320, color: 0xffc35a,
        intro: 'Move the whole stack of embers to the last anvil. A larger ember may never rest on a smaller one.' },
    ],
    trial: { name: 'Temper the Caldera', goal: 8, xp: 380, desc: 'Banish 8 fire imps. Lava drains mana — stay on the black rock.' },
    spell: { id: 'fireball', name: 'Fireball', key: 'R', mana: 20, desc: 'A blazing orb that bursts on impact, striking every foe nearby.' },
  },
];
export const MASTERY_RANKS = ['Unstudied', 'Initiate', 'Adept', 'Master', 'Grandmaster'];

// Every school has its own "tower" to raise inside its realm, built stage by stage like the
// Arcane tower but shaped by its element. Stages need the realm's own material plus valley
// resources, and later stages need deeper mastery (rank = puzzles + trial completed).
// Completing a sanctum makes you Grandmaster of the school and grants its boon.
export const SANCTUMS = {
  necromancy: {
    name: "The Titan's Ossuary", resource: 'bone',
    blurb: "Master Aldric's tower in the Crypt fell the night he vanished. Raise a cathedral of the dead inside a fallen god's ribs, and the dead will rest again.",
    steadies: 'The dead stay down: the fog pulls back, the bog drains, and fewer graves open each night.',
    boon: { name: 'Legion of Bone', desc: 'Soul Siphon restores 30 mana, and every foe you banish anywhere leaves Grave Bone.' },
    stages: [
      { id: 'titan', name: 'The Titan Unearthed', rank: 0, xp: 220, cost: { bone: 12, stone: 10 },
        lore: 'Dig until the ribs of a fallen god break the soil.' },
      { id: 'nave', name: 'The Ossuary Nave', rank: 1, xp: 300, cost: { bone: 20, stone: 22, wood: 12 },
        lore: 'A chapel walled with a thousand watching skulls.' },
      { id: 'wells', name: 'The Soul Wells', rank: 1, xp: 360, cost: { bone: 24, essence: 10, crystal: 8, ecto: 6 },
        lore: 'Four wells where the departed wait their turn — filled with ectoplasm, swirling.' },
      { id: 'belfry', name: 'The Skull Belfry', rank: 2, xp: 440, cost: { bone: 32, stone: 28, crystal: 12, heartstone: 8, golemheart: 1 },
        lore: "The titan's own skull, raised high on a heartstone frame that can bear its weight." },
      { id: 'crown', name: 'The Lich Crown', rank: 3, xp: 600, cost: { bone: 40, essence: 20, crystal: 18, cinder: 3 }, guardian: 'lich',
        lore: 'A crown of tombstones orbits a heart kept safe in glass. A phylactery is forged, not carved.' },
    ],
  },
  geomancy: {
    name: 'The Heartstone Hold', resource: 'heartstone',
    blurb: "Aldric's tower in the Deep was carved into the mountain itself. Cut it back out of the living rock — from a cave mouth to the Colossus waking.",
    steadies: 'The ground holds: tremors come less often and softer, blocked tunnels clear, and the mine lift runs again.',
    boon: { name: 'Bedrock', desc: 'Earth stones knock down every foe around their impact, and tremors anywhere do half as much.' },
    stages: [
      { id: 'mouth', name: 'The Cave Mouth', rank: 0, xp: 220, cost: { heartstone: 12, stone: 10 },
        lore: 'A carved gate and stair cut from the living rock, braziers either side.' },
      { id: 'ancestors', name: 'The Hall of Ancestors', rank: 1, xp: 300, cost: { heartstone: 20, stone: 16, ecto: 6 },
        lore: 'Colossal geomancers carved flanking the gate — the carved dead must be woken.' },
      { id: 'geode', name: 'The Crystal Geode', rank: 1, xp: 360, cost: { heartstone: 24, crystal: 10, frost: 10 },
        lore: 'A split geode bursting from the mountain. The great crystals only grow in the cold.' },
      { id: 'lift', name: 'The Deep Lift', rank: 2, xp: 440, cost: { heartstone: 30, wood: 20, ember: 8, cinder: 2 },
        lore: 'A great wheel and smelted chains, hauling ore up the mountain face.' },
      { id: 'crown', name: "The Mountain's Crown", rank: 3, xp: 600, cost: { heartstone: 40, crystal: 18, golemheart: 3 }, guardian: 'king',
        lore: 'The Colossus wakes only when its king falls — and a crown of stones circles its brow.' },
    ],
  },
  cryomancy: {
    name: 'The Aurora Spire', resource: 'frost',
    blurb: "Aldric's northern tower lies shattered on the ice. Grow a palace from living ice around a frozen heart, and the long winter will break.",
    steadies: 'Winter loosens: blizzards shorten, the glacier edge pulls back, and the aurora flickers back on.',
    boon: { name: "Winter's Crown", desc: 'A chill aura slows every foe near you by half.' },
    stages: [
      { id: 'heart', name: 'The Frozen Heart', rank: 0, xp: 220, cost: { frost: 12, crystal: 6 },
        lore: 'A heart of ice that has never stopped beating.' },
      { id: 'halls', name: 'The Glacier Halls', rank: 1, xp: 300, cost: { frost: 20, stone: 18, crystal: 8, heartstone: 10 },
        lore: 'Walls of clear ice you can almost see through, on heartstone footings.' },
      { id: 'galleries', name: 'The Icicle Galleries', rank: 1, xp: 360, cost: { frost: 24, stone: 14, essence: 8, ecto: 4 },
        lore: 'A spiral bridge of ice winding up the glacier, its windows glazed with spirit-glass.' },
      { id: 'rose', name: 'The Snowflake Rose', rank: 2, xp: 440, cost: { frost: 32, crystal: 14, essence: 12, ember: 8 },
        lore: 'A rose window of frost, annealed in fire, turning as slowly as the seasons.' },
      { id: 'crown', name: 'The Aurora Crown', rank: 3, xp: 600, cost: { frost: 40, crystal: 22, essence: 18, cinder: 2 }, guardian: 'queen',
        lore: 'Needles of ice tall enough to comb the aurora, with lenses that hold light.' },
    ],
  },
  pyromancy: {
    name: 'The Forge-Heart', resource: 'ember',
    blurb: "Aldric's forge-tower sank into the caldera. Found a forge on the basalt, bury it in a volcano of your own making, and the mountain will stop building to burst.",
    steadies: 'The volcano calms: eruptions come less often, lava rivers crust into paths, and the ash thins.',
    boon: { name: 'Heart of the Forge', desc: 'Fireball costs 12 mana, bursts twice as wide and strikes harder.' },
    stages: [
      { id: 'foundry', name: 'The Magma Foundry', rank: 0, xp: 220, cost: { ember: 12, stone: 12 },
        lore: 'A causeway of basalt columns, anvils, and a moat of liquid fire.' },
      { id: 'hall', name: 'The Crucible Hall', rank: 1, xp: 300, cost: { ember: 20, stone: 26, wood: 10, bone: 12 },
        lore: 'Six walls of black stone and doors that glow like coals. Bone-char fluxes the crucible.' },
      { id: 'bellows', name: 'Bellows & Chimneys', rank: 1, xp: 360, cost: { ember: 24, wood: 22, crystal: 8, frost: 10 },
        lore: 'Great bellows breathe; brass chimneys roar at the sky inside cooling jackets of ice.' },
      { id: 'mantle', name: 'The Mantle', rank: 2, xp: 440, cost: { ember: 32, stone: 40, essence: 10, rimecore: 4, heartstone: 16 },
        lore: 'Clothe the forge in a mountain — bedrock and quenching, so the volcano does not collapse.' },
      { id: 'phoenix', name: 'The Phoenix Crown', rank: 3, xp: 600, cost: { ember: 40, crystal: 18, essence: 20 }, guardian: 'tyrant',
        lore: 'Upon the crater rim, the firebird wakes — but only once its jailer falls.' },
    ],
  },
};
export const GATE_POS = { x: 0, z: -30 }; // (retired) the old gate circle north of the courtyard
// The way to each realm: a pass through the valley's mountain ring in that realm's direction on the
// atlas, ending at a chasm of mist crossed by a rope bridge. `a` is the heading (atan2(z, x)).
// LIP is where the road meets the chasm; the bridge runs out to END, where the mist takes you.
export const PASS_LIP = 150, PASS_END = 181;
export const REALM_PASSES = {
  necromancy: { a: Math.PI },          // west
  geomancy: { a: -Math.PI / 2 },       // north
  cryomancy: { a: 0.25 },              // east (a little south of due east, round a pond)
  pyromancy: { a: Math.PI / 2 + 0.1 }, // south
};
// A point `s` along a pass and `l` to its side (positive to the right looking out).
export const passPoint = (id, s, l = 0) => {
  const a = REALM_PASSES[id].a, ux = Math.cos(a), uz = Math.sin(a);
  return { x: ux * s - uz * l, z: uz * s + ux * l };
};
