# Graphics & Usability Review

**Date:** 2026-09-25 · **Build:** local (`python3 serve.py 5180`) · **Benchmark:** 1440×900, Chrome on Apple Silicon

The review covered 18 captured states: title, exploration by day and night, harvesting, combat, a shrine, all three puzzles, the build panel, dialogue, the tower rooms, the legend, the pause menu, a 390 px phone and a 1024 px laptop. It measured draw calls, triangles, render CPU time and load time per scene. Findings were ranked against what a large-studio release is expected to ship.

## Scorecard

| Area | Before | After this pass | Studio bar |
|---|---|---|---|
| Draw calls per frame (valley / tower view) | 2,528 / 4,631 | **812 / 1,213** | < 1,000 on web |
| Triangles per frame, all passes | 8.4 M | **4.0 M** | 2–5 M |
| CPU render time per frame | 6.0 ms | **1.7 ms** | < 4 ms |
| Antialiasing | lost in post-processing (jaggies) | **4× MSAA through the whole chain** | MSAA / TAA |
| Graphics options | none | **Auto / Low / Medium / High presets** | ✔ |
| Settings (audio, sensitivity, invert-Y, comfort) | mute button only | **full Settings panel, saved** | ✔ |
| Touch / phone support | not playable | **joystick, action buttons, drag-look, compact HUD** | ✔ |
| Combat feedback | no hit confirmation | **hit flash, floating damage, kill pop + shake** | ✔ |
| Notification spam | identical toasts stacked 3–6 high | **merged into one "×N" toast** | ✔ |
| Loading | title could show before fonts/models loaded | **held until models + fonts ready** | ✔ |

## Fixed in this pass

**Rendering and detail**
- **GPU batching of the valley** (`src/resources.js`). The 328 harvestable nodes are baked into one mesh per material per 70 m chunk, and each node owns a slice of the vertex buffer. Grow, shrink and shake re-upload only that slice. Chunking keeps frustum and shadow culling working.
- **Static merging** (`src/merge.js`). Props, tower floors, the build hologram and both character rigs are collapsed per material. Every animated "bone" stays live.
- **MSAA render target** for the post-processing chain. The canvas `antialias` flag does nothing once an EffectComposer is in use.
- **Drifting cloud shadows** over the terrain, for motion and depth in wide shots.
- **Lighter scatter geometry.** Grass tufts, daisies and pebbles were over-tessellated for their on-screen size, and daisies no longer cast shadows.

**Usability**
- **Settings panel** (`src/settings.js`), reachable from the title and pause screens. It has quality presets plus *Auto*, which watches real frame times for about 4 s and steps down if the median is over 22 ms. It also has master and ambient volume, mouse sensitivity, invert-Y, a camera-shake toggle and a key-hint toggle.
- **Touch controls** (`src/touch.js`), with a compact small-screen HUD layout. On phones the quest collapses to its title, spells move onto the touch buttons, and the minimap scales down.
- **Safe-area layout.** The objective waypoint and world labels no longer overlap HUD panels or centre-screen banners.
- **Combat readability:** per-wisp hit flash, floating damage numbers, and a "Banished!" pop with a light screen shake.
- **Toast stacking**, and a **bug fix**: Settings opened from the title screen appeared *behind* the title.

## Roadmap to studio parity (not yet done)

Ordered by impact on how "big studio" the game feels.

### P1: highest impact
1. **Skeletal animation.** This is the largest remaining gap. The characters are rigid parts moved by code. Build rigged glTF characters in Blender with idle, walk, run, cast, harvest and celebrate clips, and play them with `AnimationMixer` blend trees. *Effort: large.*
2. **Warm UI art direction.** The dark-purple HUD clashes with the cosy clay world. Restyle it in parchment and wood with chunky bevels, as in the reference, and replace Unicode glyphs (✦ ➶ ☁) with drawn icons. *Effort: medium.*
3. **Music and positional audio.** Everything is currently synthesized. Add composed day, night and interior tracks with crossfades, positional sound (PannerNode) for the fire, cauldron and wisps, and surface-aware footsteps. *Effort: medium.*
4. **Spell VFX.** The particles are points only. Add ribbon trails for bolts, ground decals for impacts and Nova, a heat-haze distortion pass, and wisp death dissolves. *Effort: medium.*

### P2: polish expected at launch
5. **Camera collision** with trees and props (today only the tower blocks the camera), plus smarter framing in tight interiors.
6. **Gamepad support** (Gamepad API) and **key rebinding**.
7. **Accessibility:** colour-blind-safe palettes for runes and the ley-line puzzle, subtitles or captions for important sounds, text-size scaling, and a hold-to-toggle option for harvesting.
8. **Onboarding:** a guided first five minutes with contextual prompts (first harvest, first build, first wisp) instead of one long dialogue.
9. **Distance LOD and impostors** for trees beyond about 80 m, and a painted horizon or skybox layer so distant terrain doesn't band.

### P3: production pipeline
10. **Build step** (Vite): bundle, minify and fingerprint assets, and **vendor Three.js** so the game doesn't depend on a CDN and can run offline or as a PWA.
11. **Asset compression**: Draco or meshopt for `furniture.glb` (1.7 MB) and KTX2 textures.
12. **Move the automated Playwright suites into the repo** (`tests/`) and run them in CI. They cover about 85 checks: gameplay, camera, targeting, the tower, clearance, settings and touch.
13. **Save slots and export/import**, plus crash/error telemetry.

## How to verify
- Performance: open DevTools → Performance, or use Settings → Quality to compare presets.
- Phone layout: DevTools device toolbar (enable touch), or open the LAN address on a phone.
