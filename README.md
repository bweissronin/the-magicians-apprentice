# The Magician's Apprentice

A third-person Three.js fantasy game. **Master Aldric is gone.** He walked into the Veil to stop his first apprentice, Veyra, and the five towers bound to him fell behind him: his own tower in the valley and one in each elemental realm beyond the mist at the valley's edge. You are his apprentice. Rebuild the towers, and every stone you raise pins the Veil back down and steadies part of the world. Along the way you learn five elements, study the creatures that leak through the tears, drive four old rulers out of the ruins, and face the Unraveller above the Arcane Spire.

## Run it

No build step and no dependencies. Three.js loads from jsDelivr through an import map. Serve the folder with any static server:

```bash
python3 serve.py 5180
```

Then open http://localhost:5180.

## Controls

| Input | Action |
|---|---|
| W / S (or ↑ / ↓) | Walk forward / back — the camera always trails behind |
| A / D (or ← / →), mouse | Turn (click the game to capture the mouse; mouse Y tilts the camera) |
| Shift | Sprint |
| C | Dodge: a quick dash (forward with W, sideways with A/D, otherwise back), untouchable mid-dash |
| Space | Jump · hold in the air to Levitate (Lv 7) |
| E | Interact · **hold** to harvest |
| Left click | The attuned bolt — homes in on the locked target (else fires ahead) |
| 1 – 5 | Attune the bolt: Arcane · Radiance · Earth · Frost · Fire (each learned in the story) |
| Tab | Target next foe (hunting foes are locked automatically) |
| Q | Blink (Lv 3) |
| F | Starfall Nova (Lv 9) |
| R | Fireball (Master of Pyromancy) |
| T | Earthen Stair (Master of Geomancy) |
| B | The bestiary journal |
| V | Satchel: show or hide your resources (icon, name and count, plus “of N” when the next build needs them) |
| J | Quest log. Opens on **Do next**: up to four actions (open chapter goals, and each tower's next floor or stage with only what's still missing, whatever you can raise right now first). Click a line or a missing material to **pin** it and the HUD marker leads there, crossing a bridge first if it's in another land. Beside it: the chapter, the Veil's seals and a row of pips per tower; click through for the story so far or every floor and stage of one tower |
| M | World atlas: click a land, or pick it in the side panel, for its progress, landmarks and travel. A gold star marks your current goal |
| I | Room guide — what this tower room is for (outside: the whole tower) |
| K | Schools of Magic: one tab per school (← / → to browse) with its rank ladder, steps to mastery and rewards |
| P | Tower plans |
| Esc | Pause |

## The story

| Chapter | Where | Needs | Earns |
|---|---|---|---|
| I · The Empty Tower | The valley | — | Aldric's letter (Quill has it), the Foundation and Study, **Radiance** (3 Shadow Silk + 4 Aether Crystal at the Spell Tome) |
| II · The Hollow Calls | Hollow Crypt (Lv 2) | Radiance | **Spirit Sight** at Necromancy Initiate, Grave Bone, Ectoplasm |
| III · The Sundered Deep | Sundered Deep (Lv 3) | Spirit Sight | **Earth** at Geomancy Initiate, Heartstone, Golem Hearts, Earthen Stair at Master |
| IV · The White Silence | Glacial Hollow (Lv 5) | Earth | **Frost** at Cryomancy Initiate, Frost Shards, Rime Cores |
| V · The Burning Heart | Ember Caldera (Lv 6) | Frost | **Fire** at Pyromancy Initiate, Ember Cores, Cinder Hearts |
| VI · Return and Reckoning | Every realm | Every element | The four guardians driven out of Aldric's towers |
| VII · The Convergence | Above the Arcane Spire | One of every material and reagent | The Unraveller, and Aldric's return |

**First visits get a bird's-eye tour.** The first time you start a game, and the first time you cross into each realm, the camera lifts into a slow flight. It shows the fallen tower and each landmark, captioned as it holds on them, and then settles back behind you. Any key or a click skips it (`?scenario=…&tour=1` shows it in the debug scenarios).

**Every tower room explains itself.** The first time you enter a room of Aldric's tower or a sanctum, its guide opens. It lists what you can do there, why it's worth doing, and a live status line ("3 upgrades affordable now", "Ready to drink", "2 of 4 Echo Stones heard"). It also says what's upstairs, or what the floor above would add once raised. Press **I** any time to reopen it; outside a tower, I shows the whole tower as a directory, and you can read any raised room's guide from there. Stations you haven't used yet carry a floating ✦ sparkle and a *Not tried yet* tag until you do (`&guide=1` shows all this in the debug scenarios).

Chapter changes are announced, and **J** opens the quest log: the chapter's goals, the Veil's 25 seals (your tower's first five floors plus five stages in each realm's sanctum), what each tower steadies, and Aldric's letter.

**Quill**, the master's old owl, replaces Aldric by the ruined tower: he keeps the letter, reads from Aldric's notes, and gives chapter-aware advice. Aldric himself only appears at the very end.

**The valley is wounded, and heals as you build.** At the start, Aldric's tower lies as rubble with his staff standing in it. Six rifts split the night sky and wisps drip from them (one closes per Arcane floor, and one ley line relights toward the valley's edge). Amber fissures cross the tower grounds (closing with the Heartstone Hold), frost creeps over the lake at dusk (until the Aurora Spire stands), ash falls and reddens the sky (until the Forge-Heart is quenched), and spirits rise from the old graves at night (until the Titan's Ossuary is raised).

## Combat: locks and keys

**Mana is your life.** Creatures don't wound you; they drain mana. A hit that lands while your well is already empty makes you **falter**. You wake at the courtyard, or at the realm's sanctum door, having dropped a fifth of your common materials. Sigils and creature drops are never lost, and any haunt or guardian fight is called off. The mana bar pulses red when you're low and something is hunting you. Dodge [C] costs nothing and gives a moment of immunity.

One bolt, five attunements, each with its own spellwork (`src/boltfx.js`): a violet orb in a turning rune ring, a rayed sun that strikes shafts of light, a glowing boulder that throws rubble, a spread of ice shards that raises spikes, and a flickering fireball that bursts in a swelling blast. Every bolt flashes at the staff, drags a tapered ribbon trail and lands with a shockwave, all additive glow over a saturated body so it reads in daylight, with no extra lights. Every creature wards against some elements and is weak to others: **weak** is double damage and a stagger, **resisted** is a quarter (or nothing with *Scholar wards* on in Settings), and a few pairings combine:
- Frost ×3 **freezes** a foe, and Arcane or Earth then **shatters** it.
- **Radiance** leaves a pool of light: spirits inside it turn solid, and golems' crystal eyes are dazzled, opening their chests to Arcane.
- **Earth** is a lobbed stone. It breaks armour of any kind, knocks foes down and smothers lava pools.
- **Thermal shock:** Frost then Fire splits anything made of stone.

| Creature | Home | Warded against | Weak to | Carries |
|---|---|---|---|---|
| Shadow Wisp | The valley at night | — | Arcane | Shadow Silk |
| Restless Spirit | Hollow Crypt | Arcane (passes through unless it stands in light) | Radiance | Ectoplasm |
| Bone Soldier | The Bone Fields haunt | Arcane, Frost | Earth | Grave Bone |
| Crag Golem | Sundered Deep | Arcane, Fire (stone plates) | Radiance (dazzle), Earth (cracks plates) | Golem Heart |
| Frost Wraith | Glacial Hollow | Frost (and ice armour that chips everything else) | Fire, Earth | Rime Core |
| Fire Imp | Ember Caldera | Fire heals it | Frost (killed raw it bursts into a lava pool) | Cinder Heart |

**Ranks follow place, hour and chapter, never your level.** *Common* creatures live near the gates. *Elders* roam the outer reaches, the night and haunted ground, and every realm once you've opened the next chapter's gate. Each Elder adds a rule: Hollow Wisps are invisible away from crystals, Grave Wardens split in two if they leave the light, Elder Golems regrow their plates, Rime Wraiths refreeze, and Forge Imps flee to lava to heal. *Dreads* are named creatures at the heart of each haunt; halfway down, their ward shifts to whatever element was hurting them.

**Every kill says why it mattered:** the reagent pop-up names every recipe it's needed for and your progress toward each.

**The bestiary journal** (B, or the lectern in your Study) is Aldric's half-finished book. Entries fill in as you play:
- a rumour when the chapter arrives
- the page when you first meet the creature (time stops while Quill reads Aldric's note)
- each ward as you try that element
- what it carries, first as a hint and then with every recipe once you've recovered one
- an Elder note when you meet one
- a perk once you've banished enough of them: Dusk Ward, Lantern Keeper, Bonebreaker, Stonebreaker, Icebreaker or Ember Harvest

Missing reagents in any build plan link to the creature that carries them, and **Track** pins a creature to your quest line.

## A living world

- **Spells touch the world.** With nothing to hit, Frost, Fire and Radiance bolts come down about 14 m ahead:
  - Frost freezes water into an ice floe you can walk on (chain a few to cross), and cools lava.
  - Fire scorches grass, boils water into steam and melts floes.
  - Radiance wakes a patch of glowing flowers that outlast its light.
- **Valley wildlife:**
  - Flocks wheel overhead by day and climb away if you run beneath them; bats circle the tower at night.
  - Butterflies gather at the flowers near you and scatter when you get close.
  - Rabbits hop about the meadows and bolt from you.
  - Fish leap from the lakes.
- **Soundscape:** each place has its own ambient bed that crossfades as you travel, plus one-shot sounds that belong there:
  - valley: breeze, birdsong by day, crickets and an owl at night;
  - Crypt: a low moan, crows, a far-off bell;
  - Deep: cave hum and drips;
  - Hollow: gale, cracking ice;
  - Caldera: rumble, lava pops and hisses;
  - tower rooms: a crackling hearth.

  It follows the Ambient music setting.

## The loop

1. **Gather**: Timber, Stone, Aether Crystal (Lv 2) and Mana Essence (Lv 3) in the valley; each realm has its own material (Grave Bone, Heartstone, Frost Shard, Ember Core). Creatures carry the reagents. Chain harvests (the next node within 7 s) for up to 48% faster gathering. Until the Study stands, *Aldric's charm* doubles valley timber and stone. The satchel [V] shows only what you hold plus what the next build needs, each with its icon, name and count; fold it to a chip with V (the choice is remembered).
2. **Solve shrines**: five Rune Shrines grant the **Arcane Sigils** the upper floors need: *Echoing Runes* (memory), *Ley-Line Nexus* (lights-out) and *Astral Lock* (coupled rings).
3. **Build the Arcane tower**: Foundation, Study, Library, Alchemy Lab, Observatory and the Arcane Spire. The Spire is a tower that holds every element: it needs every realm's material and one of every reagent. Step inside to use each floor's station, including the Study's Spell Tome (Radiance, Empowered Bolt, Deep Well, Swift Blink, Green Thumb, Deep Stair, Glacial Stride) and its bestiary lectern.
4. **Master the schools**: at each edge of the valley, in its direction on the atlas, a road climbs to where the mountain stands up in front of it, and the way goes in: **the Old Mine** to the Sundered Deep (a timber-shored adit, rails running down into the dark), **the Cinder Road** to the Ember Caldera (a basalt cleft with braziers and a lava channel), **the Glacier Cave** to the Glacial Hollow (an arch of blue ice under snow) and **the Barrow Gate** to the Hollow Crypt (standing stones and an iron gate into a hillside barrow). Walk a few steps in and you're through; the same mouth is cut into the cliffs at the realm's edge, so you step out of the very place you went in, and a road leads from it into the land (the fade takes that land's colour: dark underground, white in the ice). A locked way is caved in, walled with cooled lava, frozen shut or chained, and says what opens it. Each realm also shows on the valley's horizon over the mountains: a crag bristling with crystal spires, a volcano (gullied flanks banded ash to rust, a ragged breached rim, a glowing crater lake, lava running down the gullies into pools, a smoking shoulder cone, dark foothills, and a column of smoke lit orange from below with embers rising), snow peaks, a ruined cathedral with lit windows. Each mouth is dressed for its land: the mine's pickaxe sign, barrels, ore sacks, loading platform and lantern post; the Cinder Road's rune-banded obsidian obelisks, lava fall, cooled flows, vents and charred banners; the Glacier Cave's snowy pines, frozen waterfall, ice crystals, sled and rope railing; the Barrow Gate's rune-cut standing stones, dead trees with lanterns, cairns, candles, moss and skull keystone. Before you reach the pass, each realm is already seeping into the valley: snow and pines toward the Glacial Hollow, grey grass, graves and mist toward the Hollow Crypt, russet rock and crystals toward the Sundered Deep, and ash, basalt and glowing cracks toward the Ember Caldera. You hear it too. The ways open onto four realms, each as wide as the valley, with two puzzles, four landmarks, a hazard and a creature. Initiate rank teaches the school's element (or Spirit Sight); Master grants its spell.
   | School | Realm | Puzzles | Hazard | Mastery spell |
   |---|---|---|---|---|
   | ☠ Necromancy | The Hollow Crypt | Soul Scales, Ossuary Seal | Bogs; spirits rising from graves | Soul Siphon |
   | ⛰ Geomancy | **The Sundered Deep**: a cavern under a vaulted, stalactite-hung roof with a skylight, an underground river, crystal and fungus light | **Boulder Run** (boulders roll until stopped), **Strata Lock** (slide rock layers until one ore seam runs marker to marker; each layer has a single through-vein, branches fizzle out, and stapled layers drag the one below) | **Tremors**: dust falls, then a stalactite crashes onto the marked circle; an Earthen Stair gives cover | **Earthen Stair [T]**: raise stone pillars to climb, bridge lava and chasms, or wall off foes |
   | ❄ Cryomancy | The Glacial Hollow | Frozen Lake, Crystal Prism | Ice, blizzards (wraiths hide in them without Spirit Sight) | Frostwalk |
   | 🔥 Pyromancy | The Ember Caldera | Flame Conduit, Ember Forge | Lava rivers and pools | Fireball |
5. **Clear the haunts**: every landmark is haunted. Walking in wakes three waves and a named Dread, with one twist that uses the element rules:
   | Realm | Haunts |
   |---|---|
   | ☠ Crypt | Drowned Chapel (keep three soul lanterns lit with Radiance) · Bone Fields (waves alternate spirits and bone soldiers) · Weeping Mausoleums (a ward totem shields everything until struck with the element in its sockets) · Hangman's Hill (foes are only visible in light) |
   | ⛰ Deep | Flooded Mine (lead three lost miners' spirits to the lift) · Great Geode (crystal golems reflect Radiance until Earth cracks them) · Fungal Cathedral (darkness) · Sleeping Colossus (the roof keeps falling) |
   | ❄ Glacier | Frozen Armada (the whole bay is ice) · Giant's Rest (totem) · Aurora Stones (keep the watch-fires lit with Fire) · Hollow Caves (darkness) |
   | 🔥 Caldera | Salamander Bridges (lava wells up around you) · Great Vent (eruptions under your feet) · Sunken Forge (totem) · Obsidian Forest (darkness) |

   Clearing a haunt lights the landmark for good, doubles the harvest around it and unlocks its **Echo Stone**. The first haunt cleared in a realm completes that school's trial.
6. **Rebuild the realm towers**: each realm's tower is raised in five stages at its cornerstone. Stages cost the realm's material, valley resources and **materials and reagents from other realms**, each with an in-world reason: a heartstone bell-frame for the Skull Belfry, ectoplasm to wake the carved ancestors, frost-grown geode crystals, Rime Cores to quench the volcano. Every stage steadies its land, and the fifth needs its **guardian** driven out.
   | Tower | Stages | Steadies | Boon |
   |---|---|---|---|
   | ☠ Titan's Ossuary | Titan Unearthed → Nave → Soul Wells → Skull Belfry → Lich Crown | The dead rest | Legion of Bone |
   | ⛰ **The Heartstone Hold** | **Cave Mouth** (a carved gate and stair in a crag) → **Hall of Ancestors** (colossal geomancer statues) → **Crystal Geode** (a split geode bursting from the flank) → **Deep Lift** (a winch wheel, a rising cage, rails up the face) → **Mountain's Crown** (the mountain's face opens its eyes under a crown of floating stones) | Tremors fade; with the fifth stage the Colossus holds the roof | **Bedrock**: Earth stones knock down everything around them; tremors hit half as hard |
   | ❄ Aurora Spire | Frozen Heart → Glacier Halls → Icicle Galleries → Snowflake Rose → Aurora Crown | Winter loosens | Winter's Crown |
   | 🔥 Forge-Heart | Magma Foundry → Crucible Hall → Bellows & Chimneys → Mantle → Phoenix Crown | The volcano calms | Heart of the Forge |

   Every tower is walkable inside: one themed room per stage. The Heartstone Hold's are the Gatehall, Ancestor Gallery, Geode Chamber, Lift Hall and Throne of Stone.
7. **Drive out the guardians** (challenge them at the cornerstone once stage 4 stands). Each fight has three phases:
   | Guardian | Phase 1 | Phase 2 | Phase 3 |
   |---|---|---|---|
   | The Lich King | Shielded by three phylacteries; break them with Radiance | Splits into spirits that are solid only in light | Bone armour: Earth or Fire, then strike |
   | The Mountain King | Heartstone plates: dazzle, then crack | Burrows; jump the shockwaves or stand on an Earthen Stair | Bare core: Frost, then Fire |
   | The Winter Queen | Ice armour (Frost heals her) | Blizzard: light the watch-fires with Fire to see her | Mirror clones: the real one casts a shadow |
   | The Molten Tyrant | Lava plates: freeze, then shatter | Heals in lava: smother the pools with Earth | Bursts into imps: Frost, then Arcane |
8. **The Convergence**: with the Spire raised and the guardians gone, ascend from the tower door to a dais of light above the Spire. Veyra, the Unraveller:
   - opens her sigil to one element at a time;
   - then borrows the guardians' shields;
   - finally hides behind five ward orbs that must break in the order the Echo Stones foretold: light, stone, frost, flame, then arcane.

   Win, and the Veil closes and Aldric steps out of it.
9. **The world atlas** (M) is Aldric's map of the Veiled Lands, amended as you build:
   - Each tower shows as a ruin, rising or restored, with pips for its stages.
   - Ley lines light as towers rise, and the Veil's cracks heal into gold stitches.
   - Sealed realms sit under fog, and each landmark shows as a "?" until you've seen it.
   - Haunts, cleared lanterns and heard Echo Stones are all marked.
   - Click a realm for its chart. Raised towers are waypoints: travel between them.

Progress autosaves to `localStorage` every 30 s and after every milestone. Older saves migrate: realms you had already opened stay open.

## Code map

| File | Responsibility |
|---|---|
| `src/main.js` | Game orchestrator: modes, interaction, cinematics, main loop |
| `src/data.js` | All tuning: costs, XP curve, spells, shrines, floors |
| `src/state.js` | Serialisable progression state + event emitter |
| `src/world.js` | Procedural terrain (`heightAt`), sky shader, water, grass, day/night |
| `src/player.js` | Apprentice model, movement, collision, third-person camera |
| `src/resources.js` | Harvestable nodes (trees, rocks, crystals, blooms) |
| `src/tower.js` | Procedural tower floors, build animation, altar, hologram preview |
| `src/shrines.js` / `src/puzzles.js` | Shrine world objects / puzzle UIs |
| `src/boltfx.js` | The staff bolts' look: per-element projectiles, ribbon trails, cast flashes, impacts (shockwaves, light shafts, rubble, ice spikes, fireballs) and fizzles, under one AO-hidden root |
| `src/magic.js` | The attuned bolt, spells, Earthen Stair, light/lava pools, and every creature: spawning, ranks, wards, freezing, armour, movement |
| `src/bestiary.js` | Elements, creature definitions, ranks, the damage rules (`resolveHit`), and "needed for" recipe lookup |
| `src/journal.js` | The bestiary journal (B): each creature's live 3D model on a pedestal at the centre, a portrait roster, and cards for weaknesses, drops and study |
| `src/creaturestage.js` | The bestiary's little studio: renders a creature's in-game model (a silhouette until met) and the roster portraits |
| `src/story.js` | Chapters, Aldric's letter, Veil stability, and the valley's healing scars (rifts, ley lines, fissures, frost, ash, graves, ruins) |
| `src/questlog.js` / `src/atlas.js` | Quest log (J): the do-next list with map pins, story so far and per-tower detail, and the ready-to-raise notice / world atlas and realm charts with travel (M) |
| `src/haunts.js` | The sixteen haunts and their twists |
| `src/tour.js` | First-visit bird's-eye tours of the valley and each realm |
| `src/spellworld.js` | Spells that touch the world: Frost's walkable ice floes, Fire's scorch marks and steam, Radiance's glowing flowers |
| `src/wildlife.js` | Valley wildlife: flocks and bats, butterflies, rabbits and leaping fish (instanced; they shy from the apprentice) |
| `src/soundscape.js` | Place-by-place ambience: crossfading noise beds and one-shot sounds per realm, the valley by day and night, and tower rooms |
| `src/cutout.js` | See-through scenery: a dithered capsule between camera and apprentice, cut per fragment so it works on merged meshes |
| `src/schoolsui.js` | Schools of Magic page: school tabs with progress rings, rank ladder, mastery steps and rewards |
| `src/roomguide.js` | Room guides: what each tower and sanctum room offers, its value and live status |
| `src/bosses.js` | The four guardian fights and the Unraveller |
| `src/deep.js` | The Sundered Deep: cavern roof, river, tremors, landmarks, life, Heartstone node |
| `src/puzzles-deep.js` | The Boulder Run and Strata Lock puzzles |
| `src/npc.js` | Quill, Aldric's owl, and chapter-aware dialogue (Aldric's model waits here for the ending) |
| `src/ui.js` | HUD, minimap, quest tracker, waypoint, dialogue, build panel |
| `src/audio.js` | Fully synthesised WebAudio SFX + ambient pad |
| `src/particles.js` | Pooled additive GPU particle system |
| `src/style.js` | Art direction: palette, `clay()` rim-lit material, painted tileable textures |
| `src/characters.js` | The apprentice and Master Aldric rigs (sculpted parts from `characters.glb`, procedural stand-ins until it loads) with animation hooks |
| `src/props.js` | Courtyard set dressing: lanterns, hedges, barrels, crates, fence |
| `src/settings.js` | Settings panel: quality presets (with Auto), audio, sensitivity, comfort options |
| `src/touch.js` | Touch controls: virtual joystick, action buttons, drag-to-look |
| `src/merge.js` | Static mesh batching (merge per material, animated parts kept live) |
| `src/realms.js` | Elemental realms (terrain, sky, props, hazards, creatures, altars) |
| `src/crossings.js` | The ways to the realms: a themed mouth at the end of each pass (mine, cleft, ice cave, barrow; barred while locked) with its twin standing in the realm, the realms on the valley's horizon (height-hazed so they rise out of the mist), and the props and weather where each realm bleeds into the valley |
| `src/creatures.js` | Enemy creatures and guardians: sculpted toy-troop bodies from `characters.glb` with limbs animated at their joints (procedural fallbacks), shader-waved cloth/mist ribbons, per-creature hit flash |
| `src/realmlands.js` | The wider lands of each realm: hills, paths, landmark set pieces, groves and outcrops, instanced ground cover, echo stones, bog/lava/ice zones and auto-bridges |
| `src/sanctum-rooms.js` | The sanctums' interiors: 15 themed rooms and their stations, using the tower interior system |
| `src/realmlife.js` | The realms' living layer: swamps, scattered graves, the ghost carriage, procession, crows, geysers, lavafalls, dragon skeleton, mine carts, elk herd, fishing camp, wolves, snow devils |
| `src/sanctums.js` | The three school sanctums: stage builders, walkable surfaces, lava zones, holograms, animation |
| `src/puzzles-schools.js` | The six school puzzles: scales, sliding tiles, conduit, Hanoi, ice slide, mirrors |
| `src/interior.js` | Tower interiors: dollhouse-cutaway rooms, furniture, stairs and stations; keeps pads clear and checks rooms are walkable |
| `src/assets.js` | Loads the Blender furniture library (`assets/models/furniture.glb`) with procedural fallbacks |
| `tools/blender/build_furniture.py` | Blender script that models and exports the furniture library |
| `tools/blender/build_sanctums.py` | Blender script for the sanctum hero pieces: titan skull and jaw, vertebra, bell, phoenix, bellows, crucible, anvil, ice heart |
| `tools/blender/build_deep.py` | Blender script for the Deep and the story: the Crag Golem's parts, Colossus face and eyes, geode, giant mushroom, dripstones, ancestor statue, lift wheel, minecart, heartstone cluster, boulder, king's crown, Quill the owl, Aldric's staff, tower rubble |
| `tools/blender/build_characters.py` | Blender script for the characters in a chunky, glossy toy-troop style: the apprentice, Aldric, the six common foes and the four guardians plus Veyra, split into animatable parts |
| `tools/blender/build_atlas.py` | Renders the world atlas in a chunky 2.5D toy style: floating islands with props, rift-crack masks and every rope bridge (intact and broken) as WebP layers in `assets/ui/atlas/` |
| `tools/blender/kit.py` | The shared Blender modelling kit used by `build_characters.py` (primitives, voxel-remesh sculpting, garments, sweeps, publish/export) |
| `tools/blender/build_bosses.py` | Blender script for the guardians (Lich King, Winter Queen, Molten Tyrant), the Unraveller, and haunt props (soul lantern, ward totem, miner spirit, bone soldier, phylactery, element orb) |
| `src/roomui.js` | Room station panels: upgrades, hints, brewing, star chart, trophies |
| `src/debug.js` | `?scenario=<name>` states for visual testing (`tower`, `night`, `puzzle1`, and more) |

## Rebuilding the furniture models

The tower furniture (bookshelves, desk, bed, cauldron, fireplace, throne, telescope and more) is modelled in code with Blender and exported to `assets/models/furniture.glb`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_furniture.py
```

The sanctum hero pieces are sculpted the same way. Organic shapes are fused from primitives with a voxel remesh, carved with booleans and then decimated, and everything is exported to `assets/models/sanctums.glb`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_sanctums.py
```

The Deep and story pieces (`build_deep.py` → `deep.glb`) and the older boss models (`build_bosses.py` → `bosses.glb`) rebuild the same way.

The characters — the apprentice, Aldric, every common foe and the guardians — are sculpted in a chunky, glossy "toy troop" style (big heads and hands, stubby bodies, soft fused forms, bold colour blocking) and exported to `assets/models/characters.glb`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_characters.py
```

The apprentice is a chibi young wizard in dusty lavender: a wide, floppy, notch-edged hat with a hooked tip and a swirl-patterned band, a hooded coat open over a sage tunic, zigzag-patterned cream trims, a belt with a ring buckle and pouch, a medallion, and a gnarled staff whose crescent top cradles the glowing orb. The trims and band are UV-mapped strips; the game paints their patterns (`src/characters.js`, `trimTexture` / `bandTexture`).

Each colour region is fused from primitives into its own smooth shell, and the shells intersect, so every colour border is a clean curve. Glowing eyes, cores and magma stay separate so the game can pulse and hit-flash them. Every creature is split into a body and limbs whose origin sits on the joint (shoulder, hip, wing root), and the game animates those joints. `CHAR_ONLY=imp,golem` builds just those, and `CHAR_OUT=…` writes somewhere else for a quick look.

The world atlas (M) is a render too, in a bright, chunky 2.5D toy style: `build_atlas.py` models the five lands as floating islands (the same seeded outlines as `src/atlas.js`) with a thick rounded top over layered bands of earth and stone, boulders hanging beneath, grey rim stones and each land's props: round trees in the valley, gravestones and dead trees in the Crypt, crystals in the Deep, snowy pines and ice in the Hollow, a lava volcano in the Caldera. Rope-and-plank bridges join them. It writes layered WebP images to `assets/ui/atlas/`: `base` (the islands), an `energy-<land>` mask of each island's glowing rift cracks, and each bridge, intact and broken. The game stacks them over a sky with clouds, under the SVG labels, and tints each island's rift light from violet toward gold as it heals. The camera is tilted, but world Y is pre-stretched so the island tops land exactly on the SVG's 1000×700 coordinates. Every named place is modelled where the map marks it (the crypts, the sinking chapel, the geode, the mine, the giant mushrooms, the colossus, the frozen armada, the giant's sword, the aurora stones, the ice cave, the obsidian grove, the forge, the vent volcano, the lava bridges, and the valley's rune stones), and each land's tower is rendered three times (`tower-<land>-ruin|rising|restored`) so the map shows the state you've reached. Unexplored places sit under a fog cloud; landmark names appear when you pick a land or hover the place. Rebuild after changing island positions or shapes (keep `PLACE` in both files in step):

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_atlas.py
```

To inspect the creatures, open `?scenario=bestiary` (add `&kind=specter|imp|wraith|shade|golem|bones`, `&chase=1`, `&time=0.9` for night), or `?scenario=realm&school=…&foes=3` to meet them in their realm. To fly over a realm, open `?scenario=landmark&school=…&i=overview` (or `&i=0`–`3` for each landmark). To see a sanctum at any stage, open `?scenario=sanctum&school=necromancy|geomancy|pyromancy|cryomancy&stages=0-5`.

When a room is built, anything that would overlap a stairs pad, the exit or a station is slid clear automatically, and solid furniture gets colliders trimmed to keep every pad reachable on foot.

See [docs/REVIEW.md](docs/REVIEW.md) for the graphics & usability review and the roadmap to studio-level polish.
