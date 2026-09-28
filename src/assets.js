import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addRim } from './style.js';

// Blender-built model libraries (tools/blender/*.py → assets/models/*.glb).
// Each top-level node is one prop; prop(name) returns a fresh, shadow-casting copy.
// If the file is missing the game falls back to its procedural furniture.

const lib = {};
const rimmed = new WeakSet();

function loadLibrary(url) {
  return new GLTFLoader().loadAsync(url)
    .then((gltf) => {
      for (const node of [...gltf.scene.children]) {
        node.position.set(0, 0, 0); // props are laid out in a row in the .blend
        node.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (rimmed.has(m)) return;
            rimmed.add(m);
            // Match the clay look: soft rim light, emissive parts keep their glow.
            m.envMapIntensity = 0;
            addRim(m, 0.25);
          });
        });
        lib[node.name] = node;
      }
      return Object.keys(lib);
    })
    .catch((err) => { console.warn(`Model library ${url} unavailable, using procedural fallbacks.`, err); return []; });
}

// Furniture for the tower rooms, plus hero pieces for the school sanctums
// (tools/blender/build_sanctums.py → assets/models/sanctums.glb).
export const assetsReady = Promise.all([
  loadLibrary('assets/models/furniture.glb'),
  loadLibrary('assets/models/sanctums.glb'),
  loadLibrary('assets/models/deep.glb'),
  loadLibrary('assets/models/bosses.glb'),
  loadLibrary('assets/models/characters.glb'),
]).then(() => Object.keys(lib));

export function hasProp(name) { return !!lib[name]; }

// Returns a wrapper group so callers can add children (books, candles…) without inheriting prop scale.
export function prop(name, scale = null) {
  const src = lib[name];
  if (!src) return null;
  const g = new THREE.Group();
  const c = src.clone(true);
  if (scale) c.scale.set(...scale);
  g.add(c);
  g.userData.prop = name;
  return g;
}

export function propNames() { return Object.keys(lib); }
