import * as THREE from 'three';

// three.js bakes the number of lights in a scene into every lit material's shader, so a floor or
// stage that brings its own lamp would make the whole scene recompile the moment it appears
// (seconds, in a realm). A bank holds dark stand-ins for every light a structure will ever add;
// as each real light arrives, one stand-in steps out, and the count never changes.
export class LightBank {
  constructor(parent) {
    this.parent = parent;
    this.slots = [];
  }

  // Hold room for `n` lights still to come (replacing whatever was held before).
  hold(n) {
    while (this.slots.length < n) {
      const l = new THREE.PointLight('#000000', 0, 1);
      l.position.set(0, -400, 0);
      this.parent.add(l);
      this.slots.push(l);
    }
    this.slots.forEach((l, i) => { l.visible = i < n; });
  }

  // `group` is about to show its lights: step aside for them.
  admit(group) {
    let n = 0;
    group.traverse((o) => { if (o.isLight && o.visible) n++; });
    for (const l of this.slots) { if (!n) break; if (l.visible) { l.visible = false; n--; } }
  }
}

// How many lights a built group carries.
export function lightsIn(group) {
  let n = 0;
  group.traverse((o) => { if (o.isLight) n++; });
  return n;
}
