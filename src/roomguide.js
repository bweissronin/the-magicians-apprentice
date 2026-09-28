import { UPGRADES, POTIONS, SHRINES, TOWER_FLOORS, SANCTUMS, SCHOOLS, RESOURCES } from './data.js';

// Room guides: what the apprentice can do in each tower room, and why it's worth doing.
// Shown the first time you step into a room, and any time after with [I] (inside a tower it
// opens on the room you're in; outside it opens on the tower directory).
// Arcane rooms are keyed by their station; sanctum rooms by the station kind every school shares.

const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const affordable = (s, list, costOf) => list.filter((x) => { const c = costOf(x); return c && s.canAfford(c); });

const ARCANE = {
  trophies: {
    gist: 'Your checklist of rune-shrine Sigils',
    blurb: 'The foot of Aldric\'s tower — and yours, now. Every Sigil you win at a rune shrine comes to rest here.',
    does: [{ icon: '◆', what: 'Admire your Sigils', how: 'See which of the five rune shrines you have attuned, and which trial each of the others holds.',
      value: 'Every new floor of the tower costs an Arcane Sigil. This hall shows you where the next one is waiting.',
      status: (g) => `${g.state.shrines.length} of ${SHRINES.length} Sigils gathered` }],
  },
  upgrades: {
    gist: 'Research spell upgrades · the Bestiary',
    blurb: 'A quiet room of candles and ink, where first spells are made stronger.',
    does: [
      { icon: '✦', what: 'Study the Spell Tome', how: `Spend essence, crystal and reagents on permanent upgrades: ${UPGRADES.map((u) => u.name).join(', ')}.`,
        value: 'The only place to strengthen your spells — and where you learn the Radiance attunement [2], which makes spirits solid and dazzles crystal eyes.',
        status: (g) => {
          const s = g.state, ready = affordable(s, UPGRADES, (u) => (s.up(u.id) < u.max && (!u.requires || s.hasSpell(u.requires)) ? u.cost[s.up(u.id)] : null));
          return ready.length ? `${count(ready.length, 'upgrade')} affordable now: ${ready.map((u) => u.name).join(', ')}` : 'Nothing affordable yet — the Tome lists what each rank needs';
        } },
      { icon: '📖', station: 'bestiary', what: 'Read the Bestiary', how: 'Aldric\'s notes on every creature you have met: their weaknesses, their ranks, and what they drop.',
        value: 'Tells you which creature carries the reagent a recipe needs — track it and it goes on your quest line. Also opens anywhere with [B].',
        status: (g) => `${Object.values(g.state.bestiary).filter((b) => b.seen).length} creatures recorded` },
    ],
  },
  hints: {
    gist: 'Puzzle hints for your next shrine · lore',
    blurb: 'Shelves that remember every word read aloud to them.',
    does: [{ icon: '❦', what: 'Consult the Lectern', how: 'Step-by-step hints for the next shrine puzzle you haven\'t solved, and a page of Aldric\'s lore each visit.',
      value: 'Stuck on a shrine? The lectern explains how its puzzle works — and how to beat it.',
      status: (g) => { const n = SHRINES.find((x) => !g.state.shrines.includes(x.id)); return n ? `Next trial: ${n.name}` : 'Every shrine is attuned'; } }],
  },
  brew: {
    gist: 'Brew potions from essence',
    blurb: 'Where base matter is persuaded to become something finer.',
    does: [{ icon: '⚗', what: 'Brew at the Cauldron', how: `Distil essence into potions you drink on the spot: ${POTIONS.map((p) => p.name).join(', ')}.`,
      value: 'Timed boosts — refill your mana, run faster, harvest more, or keep wisps off you before a hard fight.',
      status: (g) => {
        const s = g.state, on = POTIONS.filter((p) => s.hasBuff(p.id)), can = affordable(s, POTIONS, (p) => p.cost);
        return [on.length ? `Active: ${on.map((p) => p.name).join(', ')}` : '', `${count(can.length, 'potion')} you can brew now`].filter(Boolean).join(' · ');
      } }],
  },
  travel: {
    gist: 'Fast travel to attuned shrines',
    blurb: 'The sky is a book. Here you learn to read it.',
    does: [{ icon: '✧', what: 'Look through the Telescope', how: 'Fold the sky and step out at your courtyard or at any rune shrine you have attuned.',
      value: 'Saves the long walk across the valley. Every shrine you attune adds a destination.',
      status: (g) => `${count(g.state.shrines.length + 1, 'destination')} charted` }],
  },
  lookout: {
    gist: 'The balcony · the last seal',
    blurb: 'A tower that holds every element — and pins the Veil shut for good.',
    does: [{ icon: '☄', what: 'Step onto the Spire Balcony', how: 'A slow look over the whole valley from the top of the tower.',
      value: 'The Spire is the last seal. Once all four guardians have fallen, go to the tower door outside to face what waits above it.',
      status: (g) => `${g.state.guardians.length} of 4 guardians defeated` }],
  },
};

// Sanctum stations, shared by every school; `t` carries the school's own names.
const SANCTUM = {
  mastery: {
    gist: (t) => `Your mastery of ${t.school}`,
    does: (t) => [{ icon: t.glyph, what: null, how: `Open your record of ${t.school}: its puzzles, its trial and your mastery rank. Same as [K] anywhere.`,
      value: 'Mastery ranks teach this school\'s spells and unlock the next stages of the sanctum — check here for what the next rank needs.',
      status: (g) => `Mastery: ${g.state.masteryTitle(t.id)}` }],
  },
  transmute: {
    gist: (t) => `Turn essence into ${t.res}`,
    does: (t) => [{ icon: '⟳', what: null, how: `Turn 8 Mana Essence into 6 ${t.res}, as often as you like.`,
      value: `A shortcut when you're a few ${t.res} short of the next sanctum stage.`,
      status: (g) => `Mana Essence ${g.state.inv.essence}/8 · ${t.res} ${g.state.inv[t.resId] || 0}` }],
  },
  restore: {
    gist: () => 'Full mana and a ward',
    does: (t) => [{ icon: '❂', what: null, how: 'Refill your mana and take a two-minute ward against this realm\'s creatures. The waters settle again after 90 seconds.',
      value: `Top up here before you take on a haunt or the guardian of ${t.realm}.`,
      status: (g) => { const left = Math.ceil((g.restoreReady || 0) - g.elapsed); return left > 0 ? `Settling — ready in ${left}s` : 'Ready to drink'; } }],
  },
  chronicle: {
    gist: () => 'The echoes you have heard',
    does: (t) => [{ icon: '❡', what: null, how: 'Read the story of every stage you have raised here, and of every Echo Stone you have heard out in the realm.',
      value: `Echo Stones sit at ${t.realm}'s four landmarks, once their haunts are lifted. Each one heard writes another page.`,
      status: (g) => `${g.state.echoes.filter((e) => e.startsWith(t.id + ':')).length} of 4 Echo Stones heard` }],
  },
  lookout: {
    gist: () => 'A view over the whole realm',
    does: (t) => [{ icon: '☄', what: null, how: `A slow flight over ${t.realm} from the sanctum's crown.`,
      value: 'Spot landmarks and haunted ground you haven\'t reached yet. The atlas [M] marks them too.',
      status: (g) => `${g.state.haunts.filter((h) => h.startsWith(t.id + ':')).length} of 4 haunts lifted` }],
  },
};

function schoolInfo(id) {
  const d = SCHOOLS.find((x) => x.id === id), resId = SANCTUMS[id].resource;
  return { id, school: d.name, realm: d.realm, glyph: d.glyph, res: RESOURCES[resId].name, resId };
}

// Keys used to remember which rooms have been introduced and which stations used.
export const roomKey = (def, floor) => `${def.id}:${floor}`;
export const stationKey = (def, station) => `${def.id}:${station}`;

// Everything a guide page needs for one room of `def` (a tower definition from interior.js /
// sanctum-rooms.js). `stations` are the room's live interactables, for their in-world labels.
export function roomGuide(game, def, floor, stations = []) {
  const s = game.state, room = def.rooms[floor], arcane = def.id === 'arcane';
  const used = (st) => s.guide.used.includes(stationKey(def, st));
  let blurb, does, eyebrow;
  if (arcane) {
    const g = ARCANE[room.station];
    blurb = g.blurb; eyebrow = `Aldric's Tower · Floor ${floor + 1}`;
    does = g.does.map((d) => ({ ...d, station: d.station || room.station, what: d.what }));
  } else {
    const t = schoolInfo(def.id), g = SANCTUM[room.station], stage = SANCTUMS[def.id].stages[floor];
    blurb = stage?.lore || ''; eyebrow = `${t.glyph} ${SANCTUMS[def.id].name} · Floor ${floor + 1}`;
    const label = stations.find((x) => x.station === room.station)?.label || room.name;
    does = g.does(t).map((d) => ({ ...d, station: room.station, what: label }));
  }
  does = does.map((d) => ({ ...d, status: d.status(game), used: used(d.station) }));
  // What lies above: the next floor if it's built, or what raising it would add.
  const next = def.rooms[floor + 1];
  let above = null;
  if (next) {
    const built = floor + 1 < def.floors(s);
    const gist = arcane ? ARCANE[next.station].gist : SANCTUM[next.station].gist(schoolInfo(def.id));
    above = built ? { built, text: `Stairs up to ${next.name} — ${gist.toLowerCase()}.` }
      : { built, text: `${next.name} isn't raised yet. Once it is: ${gist.toLowerCase()}. ${arcane ? `Raise ${TOWER_FLOORS[floor + 1].name} from the tower plans [P] outside (level ${TOWER_FLOORS[floor + 1].level}).` : `Raise ${SANCTUMS[def.id].stages[floor + 1].name} at the cornerstone.`}` };
  }
  return { eyebrow, title: room.name, blurb, does, above };
}

// One line per room of the tower, built or not.
export function towerDirectory(game, def) {
  const s = game.state, arcane = def.id === 'arcane', built = def.floors(s), t = arcane ? null : schoolInfo(def.id);
  return {
    title: arcane ? 'Aldric\'s Tower' : SANCTUMS[def.id].name,
    eyebrow: arcane ? 'Your tower' : `${t.glyph} ${t.realm}`,
    rows: def.rooms.map((room, i) => {
      const g = arcane ? ARCANE[room.station] : SANCTUM[room.station];
      const stations = arcane ? g.does.map((d) => d.station || room.station) : [room.station];
      const fresh = i < built && stations.some((st) => !s.guide.used.includes(stationKey(def, st)));
      const how = arcane ? TOWER_FLOORS[i] : SANCTUMS[def.id].stages[i];
      return { floor: i, name: room.name, gist: arcane ? g.gist : g.gist(t), built: i < built, fresh,
        lock: i < built ? '' : arcane ? `Raise ${how.name} · level ${how.level}` : `Raise ${how.name} at the cornerstone` };
    }),
  };
}
