import * as THREE from 'three';
import { heightAt } from './world.js';
import { MENTOR_POS, SHRINES, TOWER_FLOORS, SCHOOLS, SANCTUMS } from './data.js';
import { buildMentor } from './characters.js';
import { prop } from './assets.js';
import { clay } from './style.js';
import { ALDRIC_LETTER, chapterOf, CHAPTERS, stability, chapterGoals, GUARDIANS } from './story.js';

// Quill: Master Aldric's old owl, who stayed behind when the master went into the Veil. Perched
// by the ruined tower, he keeps Aldric's letter, reads from his notes, and reacts to progress.
// (Aldric himself only appears at the very end — his model is kept here, hidden, for that.)
export class Mentor {
  constructor(scene) {
    this.x = MENTOR_POS.x; this.z = MENTOR_POS.z;
    this.name = 'Quill';
    this.mesh = new THREE.Group();
    this.mesh.position.set(this.x, heightAt(this.x, this.z), this.z);
    scene.add(this.mesh);
    // The perch: a weathered T-post with a little brass nameplate.
    const wood = clay('#6a4a30', { key: 'perchWood' });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.5, 8), wood); post.position.y = 0.75;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), wood); bar.rotation.z = Math.PI / 2; bar.position.y = 1.52;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.16, 10), clay('#8a8096', { key: 'arch#8a8096' })); foot.position.y = 0.08;
    [post, bar, foot].forEach((m) => { m.castShadow = m.receiveShadow = true; this.mesh.add(m); });
    this.bird = new THREE.Group(); this.bird.position.y = 1.56; this.mesh.add(this.bird);
    this.headY = 2.3;
    this.built = false;
    this.buildBird();
    // Aldric, waiting for the ending.
    this.aldric = buildMentor(); this.aldric.visible = false; scene.add(this.aldric);
  }

  // Aldric's sculpted model, once characters.glb has loaded.
  rebuildAldric() {
    const old = this.aldric, m = buildMentor();
    m.position.copy(old.position); m.rotation.copy(old.rotation); m.visible = old.visible;
    if (old.parent) { old.parent.add(m); old.parent.remove(old); }
    this.aldric = m;
  }

  // Uses the Blender owl once loaded; a chunky procedural owl until then.
  buildBird() {
    const body = prop('quill_body');
    this.bird.clear();
    this.wings = [];
    if (body) {
      body.scale.setScalar(1.45); this.bird.add(body);
      [1, -1].forEach((side) => {
        const w = prop('quill_wing'); if (!w) return;
        w.scale.set(1.45 * side, 1.45, 1.45); w.position.set(side * 0.254, 0.62, -0.044); this.bird.add(w); this.wings.push({ w, side });
      });
      this.built = true;
    } else {
      const f = clay('#8a7a66', { key: 'owlFeather' }), belly = clay('#d8ccb4', { key: 'owlBelly' });
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), f); b.scale.set(1, 1.2, 0.95); b.position.y = 0.38; this.bird.add(b);
      const bl = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), belly); bl.scale.set(1, 1.15, 0.6); bl.position.set(0, 0.34, 0.16); this.bird.add(bl);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), f); h.position.y = 0.86; this.bird.add(h);
      [-0.11, 0.11].forEach((x) => {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), new THREE.MeshStandardMaterial({ color: '#ffd36b', emissive: '#ffb000', emissiveIntensity: 0.8 })); e.position.set(x, 0.9, 0.22); this.bird.add(e);
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: '#1b1410' })); p.position.set(x, 0.9, 0.3); this.bird.add(p);
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), f); tuft.position.set(x * 1.6, 1.12, 0); tuft.rotation.z = -x * 2; this.bird.add(tuft);
      });
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), clay('#c9a24a', { key: 'owlBeak' })); beak.rotation.x = Math.PI / 2 + 0.4; beak.position.set(0, 0.82, 0.28); this.bird.add(beak);
      [1, -1].forEach((side) => { const w = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), f); w.scale.set(0.4, 1, 0.8); const g = new THREE.Group(); w.position.y = -0.18; g.add(w); g.position.set(side * 0.3, 0.52, 0); this.bird.add(g); this.wings.push({ w: g, side }); });
    }
    this.bird.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  get collider() { return { x: this.x, z: this.z, radius: 0.7 }; }

  update(dt, elapsed, playerPos) {
    if (!this.built && prop('quill_body')) this.buildBird();
    // Idle life: a slow breathing bob, a head that tracks you, and the odd wing stretch.
    this.bird.position.y = 1.56 + Math.sin(elapsed * 1.6) * 0.012;
    this.flapT = (this.flapT ?? 4) - dt;
    if (this.flapT < 0) this.flapT = 5 + Math.random() * 6;
    const flap = this.flapT < 0.8 ? Math.sin((0.8 - this.flapT) / 0.8 * Math.PI * 3) * 0.9 : 0;
    this.wings.forEach(({ w, side }) => { w.rotation.z = side * (0.05 + Math.max(0, flap)); });
    const d = Math.hypot(playerPos.x - this.x, playerPos.z - this.z);
    const target = d < 14 ? Math.atan2(playerPos.x - this.x, playerPos.z - this.z) : Math.sin(elapsed * 0.3) * 0.8;
    let dy = target - this.bird.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.bird.rotation.y += dy * Math.min(1, dt * (d < 14 ? 4 : 1));
    this.bird.rotation.z = Math.sin(elapsed * 0.9) * 0.05; // the curious owl head-tilt
  }

  // The letter first; then chapter-aware advice.
  dialogue(state) {
    if (!state.talkedToMentor || !state.story.letter) {
      return [
        'Hoo. HOO. You\'re awake — finally. Don\'t look at the tower. …You looked at the tower.',
        'The master is gone. Walked into the Veil three nights ago, and his tower and every one of his sanctums fell down behind him. This one. The four beyond the bridges at the valley’s edge. All of them.',
        'He left you this. I\'ve been sitting on it. Not literally. Mostly not literally.',
        ...ALDRIC_LETTER.map((l) => `“${l}”`),
        'So. We rebuild. Timber from the trees, stone from the boulders — hold [E] near them. The plans are on the altar by the steps.',
        'And mind the rifts in the sky after dark. Things drip out of them. Click to bolt them — press [B] for the master\'s bestiary. I\'ll be right here. Judging.',
      ];
    }
    if (state.finale) {
      return ['He\'s home. Thanks to you. I\'ve decided to stop being grumpy about it for at least a week.', 'The Veil holds. Wander as you like — though the master says there are always more books to shelve.'];
    }
    const ch = chapterOf(state), C = CHAPTERS[ch - 1];
    const lines = [`${C.title}. ${C.blurb}`];
    const goal = chapterGoals(state, ch).find((g) => !g.done);
    const next = TOWER_FLOORS[state.floors];
    if (ch === 1 || (goal && /Raise the/.test(goal.text) && next)) {
      if (next && state.level < next.level) lines.push(`The ${next.name} needs a level ${next.level} mage. Harvest, bolt things, solve the shrines — you'll get there.`);
      if (next?.cost.sigil && state.inv.sigil < next.cost.sigil) {
        const shrine = SHRINES.find((s) => !state.shrines.includes(s.id));
        if (shrine) lines.push(shrine.level > state.level ? `The next Sigil sleeps in the ${shrine.name}, but it only answers a level ${shrine.level} mage.` : `You'll want a Sigil. The ${shrine.name} — follow the gold marker.`);
      }
      if (next?.cost.silk && state.inv.silk < next.cost.silk) lines.push('Shadow Silk comes off the wisps. They only come out at night, the cowards.');
    }
    if (goal) lines.push(`Next, I'd say: ${goal.text.replace(/<[^>]+>/g, '')}.`);
    const seals = stability(state);
    lines.push(seals < 25 ? `The Veil holds by ${seals} of its 25 seals. Every stone you set, the master carries a little less.` : 'All twenty-five seals hold. I can almost hear him humming.');
    if (ch === 6) {
      const left = Object.entries(GUARDIANS).filter(([id]) => !state.guardians.includes(id)).map(([, g]) => g.name);
      if (left.length) lines.push(`Still squatting in the master's sanctums: ${left.join(', ')}. Bring every element you've got.`);
    }
    const flavour = [
      'The master once tried to teach me Radiance. I set a curtain on fire. We don\'t talk about the curtain.',
      'Hoo. That\'s not a question, it\'s just what I say.',
      'Stand up straight. He always said a Magician should stand like a tower. Not a fallen one.',
      'I have read every book in the library. Twice. The second time was out of spite.',
    ];
    lines.push(flavour[Math.floor(Math.random() * flavour.length)]);
    return lines;
  }
}
export { SCHOOLS, SANCTUMS };
