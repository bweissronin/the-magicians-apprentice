import * as THREE from 'three';

// See-through scenery: anything standing between the camera and the apprentice (a tree, a
// wall, a tombstone) is dithered away inside a soft capsule along the line of sight, so the
// player and whatever they're fighting stay visible. Works on merged/batched meshes because it
// is decided per fragment, in world space, not per object. Shadows are untouched (the shadow
// pass uses its own depth material), so a cut tree still shades the ground.
export const CUT = {
  uCutA: { value: new THREE.Vector3() }, // camera
  uCutB: { value: new THREE.Vector3() }, // the apprentice's chest
  uCutR: { value: 0 },                   // capsule radius; 0 switches it off
};

export function addCutout(m) {
  if (m.userData.cut || m.transparent || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
  m.userData.cut = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, CUT);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cutP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutP = instanceMatrix * cutP;
        #endif
        vCutW = (modelMatrix * cutP).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;\nuniform vec3 uCutA, uCutB;\nuniform float uCutR;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uCutR > 0.0) {
          vec3 ab = uCutB - uCutA;
          float h = clamp(dot(vCutW - uCutA, ab) / dot(ab, ab), 0.0, 1.0);
          // Narrow near the lens (so the ground under the camera never opens up), full width
          // mid-way, and stopping short of the apprentice so the ground at their feet stays.
          float r = uCutR * smoothstep(0.08, 0.45, h) * (1.0 - smoothstep(0.86, 0.94, h));
          float f = r > 0.05 ? smoothstep(r, r * 0.45, length(vCutW - uCutA - ab * h)) : 0.0;
          // 4x4 ordered dither: a soft, stable screen-door fade rather than a hard hole.
          vec2 q2 = floor(gl_FragCoord.xy), q1 = floor(q2 * 0.5);
          float bayer = fract(dot(q1, vec2(0.5, q1.y * 0.75))) * 0.25 + fract(dot(q2, vec2(0.5, q2.y * 0.75))) + 0.03;
          if (f * 1.02 > bayer) discard;
        }`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|cut';
  m.needsUpdate = true;
}

// Give every opaque scenery material under `root` the cutout. Subtrees flagged
// userData.noCut (the apprentice, creatures, terrain, water, sky) are left alone.
export function cutoutScene(root) {
  const visit = (o) => {
    if (o.userData.noCut) return;
    if (o.isMesh || o.isInstancedMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(addCutout);
    for (const c of o.children) visit(c);
  };
  visit(root);
}
