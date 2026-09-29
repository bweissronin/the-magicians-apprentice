import * as THREE from 'three';
import { heightAt, WATER_LEVEL, WORLD_RADIUS } from './world.js';
import { clamp, damp } from './util.js';
import { buildApprentice } from './characters.js';

export class Player {
  constructor(scene, camera, input) {
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.mesh = buildApprentice();
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(0, 5, 20);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.onGround = false;
    this.speed = 7;
    this.camYaw = Math.PI;
    this.camPitch = 0.6; // low enough to see the path ahead; lower draws far more of the realms
    this.camDist = 13;
    this.camTarget = new THREE.Vector3();
    this.walkPhase = 0;
    this.castT = 0;
    this.gatherT = 0;
    this.frozen = false;
    this.canFloat = false;
    this.stepAcc = 0;
    this.shake = 0;
    this.moving = false;
  }

  // Swap in the sculpted model once characters.glb has loaded (the first build, made before the
  // libraries arrive, uses the procedural stand-in).
  rebuildModel() {
    const old = this.mesh, m = buildApprentice();
    m.position.copy(old.position); m.rotation.copy(old.rotation); m.visible = old.visible;
    if (old.parent) { old.parent.add(m); old.parent.remove(old); }
    this.mesh = m;
  }

  // Indoors the tower rooms supply a flat floor and a circular wall instead of the terrain.
  setIndoor(room) { this.indoor = room; }
  // Terrain height, raised by any walkable structure (shrine platforms) registered in `surfaces`.
  groundAt(x, z) {
    if (this.indoor) return this.indoor.heightAt ? this.indoor.heightAt(x, z) : this.indoor.floorY;
    let h = heightAt(x, z);
    for (const fn of this.surfaces || []) h = Math.max(h, fn(x, z));
    return h;
  }

  place(x, z, yaw = Math.PI) {
    // Resolve teleports from the ground up: height-aware surfaces (bridges, balconies) are only
    // stood on when reached by walking, never because of where you were before the jump.
    this.pos.y = -1e6;
    this.pos.set(x, this.groundAt(x, z), z);
    this.camTarget.set(x, this.pos.y + 2.1, z);
    this.vel.set(0, 0, 0);
    this.camYaw = yaw;
    this.facing = yaw + Math.PI;
    this.mesh.position.copy(this.pos);
  }

  // Camera-relative forward on the ground plane.
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
  }

  aimDir(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  update(dt, colliders, audio) {
    const inp = this.input;
    const ud = this.mesh.userData;
    // Character-relative controls: A/D (or mouse X) turn the apprentice, W/S walk
    // forward/back, and the camera always trails directly behind wherever they face.
    let turn = 0, mz = 0;
    if (!this.frozen) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) mz += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) mz -= 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) turn += 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) turn -= 1;
      this.facing += turn * 2.6 * dt - inp.mouseDX * 0.0025 * (this.sensitivity ?? 1);
    }
    this.camPitch = clamp(this.camPitch + inp.mouseDY * 0.002 * (this.sensitivity ?? 1) * (this.invertY ? -1 : 1), 0.15, 1.3);
    this.camDist = clamp(this.camDist + inp.wheel * 0.01, 6, 24);

    const wish = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(mz);
    const moving = mz !== 0;
    this.moving = moving;
    const groundH = this.groundAt(this.pos.x, this.pos.z);
    const inWater = !this.indoor && !this.frostwalk && groundH < WATER_LEVEL - 0.3;
    let speed = this.speed * (this.speedMul || 1) * (inp.down('ShiftLeft') || inp.down('ShiftRight') ? 1.65 : 1);
    if (this.indoor && !this.indoor.heightAt) speed *= 0.7; // rooms are cosy; walk, don't sprint into the furniture
    if (mz < 0) speed *= 0.6; // backpedal is slower
    if (inWater) speed *= 0.5;

    // Swing the camera boom to sit behind the character (shortest way round).
    const behind = this.facing + Math.PI;
    let dYaw = behind - this.camYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    this.camYaw += dYaw * (1 - Math.exp(-dt * 7));
    // Traction < 1 (realm ice) keeps momentum: you glide and have to plan your stops.
    const accel = (this.onGround ? 14 : 4) * (this.traction ?? 1);
    this.vel.x = damp(this.vel.x, wish.x * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wish.z * speed, accel, dt);

    // Dodge [C]: a quick dash — forward with W, sideways with A/D, otherwise a hop back — with
    // a moment where nothing can touch you. Free, but on a short cooldown.
    this.dodgeCd = Math.max(0, (this.dodgeCd || 0) - dt);
    this.grace = Math.max(0, (this.grace || 0) - dt);
    if (!this.frozen && (inp.pressed('KeyC') || this.wantDodge) && this.dodgeCd <= 0) {
      const a = mz > 0 ? this.facing : mz < 0 ? this.facing + Math.PI : turn ? this.facing + turn * Math.PI / 2 : this.facing + Math.PI;
      this.dodgeDir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      this.dodgeT = 0.22; this.dodgeCd = 1.4; this.grace = Math.max(this.grace, 0.45);
      this.justDodged = true;
    }
    this.wantDodge = false;
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      this.vel.x = this.dodgeDir.x * 17; this.vel.z = this.dodgeDir.z * 17;
    }

    // Jump / levitate.
    if (!this.frozen && inp.pressed('Space') && this.onGround) {
      this.vel.y = 8.5; this.onGround = false;
    }
    let g = 24;
    if (this.canFloat && !this.onGround && inp.down('Space') && this.vel.y < 0) { g = 3; this.vel.y = Math.max(this.vel.y, -2.2); this.floating = true; } else this.floating = false;
    this.vel.y -= g * dt;

    const next = this.pos.clone().addScaledVector(this.vel, dt);
    // Circle-vs-circle collision against trees, rocks, tower, shrines.
    for (const c of colliders) {
      // Optional vertical extent: stand on top of a solid (top), or walk beneath it (bottom).
      if (c.top !== undefined && next.y >= c.top - 0.35) continue;
      if (c.bottom !== undefined && next.y + 1.9 < c.bottom) continue;
      const dx = next.x - c.x, dz = next.z - c.z;
      const d = Math.hypot(dx, dz), min = c.radius + 0.45;
      if (d < min && d > 0.0001) {
        next.x = c.x + (dx / d) * min;
        next.z = c.z + (dz / d) * min;
      }
    }
    // Ledges: a walkable top too high to step onto (above a step, below your head) is a wall, so
    // you walk onto low platforms and bump into tall ones, never into them. Slide along the edge.
    const STEP = 0.75, HEAD = 2.0;
    const ledge = (x, z) => { const h = this.solidAt?.(x, z) ?? -Infinity; return h > this.pos.y + STEP && h < this.pos.y + HEAD; };
    if (ledge(next.x, next.z)) {
      if (!ledge(next.x, this.pos.z)) next.z = this.pos.z;
      else if (!ledge(this.pos.x, next.z)) next.x = this.pos.x;
      else { next.x = this.pos.x; next.z = this.pos.z; }
    }
    if (this.indoor) {
      // Circular room wall.
      const rr = Math.hypot(next.x, next.z), lim = this.indoor.radius - 0.6;
      if (rr > lim) { next.x *= lim / rr; next.z *= lim / rr; }
    } else {
      // Deep water acts as a soft wall; the world edge as a hard one.
      const nh = this.groundAt(next.x, next.z); // includes walkable surfaces such as Frost's ice floes
      if ((nh < WATER_LEVEL - 2.6 && !this.frostwalk) || nh < -6) { next.x = this.pos.x; next.z = this.pos.z; } // (-6: a chasm; ice won't hold there)
      const rr = Math.hypot(next.x, next.z);
      if (rr > WORLD_RADIUS) { next.x *= WORLD_RADIUS / rr; next.z *= WORLD_RADIUS / rr; }
    }

    // Frostwalk (Cryomancy mastery) freezes a footing on the water's surface.
    const floor = this.indoor ? this.groundAt(next.x, next.z) : Math.max(this.groundAt(next.x, next.z), this.frostwalk ? WATER_LEVEL : WATER_LEVEL - 1.2);
    if (next.y <= floor) { next.y = floor; this.vel.y = 0; this.onGround = true; } else if (next.y > floor + 0.15) this.onGround = false;
    this.pos.copy(next);

    // --- Animation ---
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * hs * 1.6;
    const m = this.mesh;
    m.position.copy(this.pos);
    let dy = this.facing - m.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * Math.min(1, dt * 12);
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.08 * Math.min(1, hs / 5);
    ud.body.position.y = bob + (this.floating ? Math.sin(performance.now() * 0.005) * 0.05 : 0);
    ud.body.rotation.x = Math.min(0.15, hs * 0.015);
    ud.robe.rotation.x = -Math.min(0.1, hs * 0.01);
    const castLift = Math.max(0, this.castT) * 4;
    // Harvesting is spellwork: blend into a channelling pose — staff raised with the orb
    // tracing slow circles, off-hand lifted palm-out toward the target.
    this.channel = damp(this.channel ?? 0, this.gatherT > 0 ? 1 : 0, 10, dt);
    const ch = this.channel, ct = this.gatherT * 6;
    const walkK = Math.min(1, hs / 5) * (1 - ch);
    ud.armL.userData.baseZ ??= ud.armL.rotation.z;
    ud.armR.userData.baseZ ??= ud.armR.rotation.z;
    ud.armL.rotation.x = Math.sin(this.walkPhase) * 0.5 * walkK + ch * (-1.15 + Math.sin(ct * 0.7) * 0.12);
    ud.armL.rotation.z = ud.armL.userData.baseZ + ch * 0.2;
    ud.armR.rotation.x = -Math.sin(this.walkPhase) * 0.3 * walkK - castLift * 0.6 + ch * (-1.4 + Math.sin(ct) * 0.22);
    ud.armR.rotation.z = ud.armR.userData.baseZ + ch * (Math.cos(ct) * 0.25 - 0.3);
    // Counter-rotate the staff so the orb points up-and-forward at the target instead of
    // swinging back over the shoulder when the arm is raised (arm pitch + staff pitch ≈ 45°).
    ud.staff.rotation.x = ch * (2.15 + Math.sin(ct) * 0.12);
    ud.body.rotation.x += ch * 0.07;
    ud.body.position.y += ch * Math.abs(Math.sin(ct * 0.5)) * 0.04;
    this.castT = Math.max(0, this.castT - dt);
    const now = performance.now() * 0.001;
    ud.hatSegs.forEach((s, i) => { if (i > 0) s.rotation.z = Math.sin(now * 3 + i) * 0.06 * (1 + hs * 0.1); });
    // Cape billows back with speed and ripples down its segments.
    const run = Math.min(1, hs / 10);
    ud.cape.forEach((c, i) => { c.rotation.x = 0.02 + run * (i === 0 ? 0.55 : 0.12) + Math.sin(now * 4 + i * 0.9 - this.walkPhase * 0.5) * (0.03 + run * 0.08) + (this.onGround ? 0 : 0.25); });
    // Boots step in time with the walk cycle.
    ud.boots.forEach((b, i) => {
      const ph = this.walkPhase + i * Math.PI;
      const k = Math.min(1, hs / 5);
      b.position.z = 0.1 + Math.sin(ph) * 0.14 * k;
      b.position.y = Math.max(0, Math.cos(ph)) * 0.06 * k;
    });
    // Blink every few seconds; head looks slightly toward travel direction.
    this.blinkT = (this.blinkT ?? 2) - dt;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3;
    const lid = this.blinkT < 0.12 ? 0.1 : 1;
    ud.eyes.forEach((e) => { e.scale.y = lid; });
    ud.head.rotation.z = Math.sin(now * 0.8) * 0.03;
    ud.orbRing.rotation.x = now * 2; ud.orbRing.rotation.y = now * 1.3;
    ud.potion.rotation.z = Math.sin(this.walkPhase) * 0.2 * Math.min(1, hs / 5);
    const pulse = 2.5 + Math.sin(performance.now() * 0.004) * 0.6 + castLift * 3 + ch * (1.0 + Math.sin(ct * 2) * 0.5);
    ud.orbMat.emissiveIntensity = pulse;
    ud.light.intensity = 3 + castLift * 12 + ch * 3;
    ud.orbRing.scale.setScalar(1 + ch * 0.4);

    if (this.onGround && hs > 1) {
      this.stepAcc += dt * hs;
      if (this.stepAcc > 2.4) { this.stepAcc = 0; audio?.play('step'); }
    }
    this.updateCamera(dt);
  }

  staffTip(out = new THREE.Vector3()) {
    return this.mesh.userData.orb.getWorldPosition(out);
  }

  updateCamera(dt) {
    // Look a little ahead of the apprentice; in combat, aim between them and the locked
    // target so both stay in frame.
    const target = this.pos.clone();
    if (this.combatFocus) {
      const mid = this.combatFocus.clone().sub(this.pos).setY(0).multiplyScalar(0.3);
      if (mid.length() > 5) mid.setLength(5);
      target.add(mid);
    }
    // On a portrait phone the touch buttons fill the bottom third: frame the apprentice a little
    // above centre (less look-ahead, aim nearer their feet) and stand the camera further back.
    const portrait = this.camera.aspect < 0.9;
    if (!this.combatFocus && (!this.indoor || this.indoor.heightAt)) {
      const ahead = portrait ? 0.5 : 3;
      target.x += Math.sin(this.facing) * ahead; target.z += Math.cos(this.facing) * ahead;
    }
    target.y += portrait ? 0.3 : 2.1;
    this.camTarget.lerp(target, 1 - Math.exp(-dt * 6));
    // Ease the boom out while a target is locked so player and wisp both fit on screen.
    const want = this.combatFocus ? Math.min(7, this.combatFocus.distanceTo(this.pos) * 0.35) : 0;
    this.combatZoom = damp(this.combatZoom ?? 0, want, 3, dt);
    // In a tight place (a mine, a cave), the boom draws in close and low behind you, and eases back out.
    const cap = this.boomCap?.();
    const boom = (this.camDist + this.combatZoom) * (portrait ? 1.3 : 1);
    this.boomLen = damp(this.boomLen ?? boom, cap ? Math.min(boom, cap) : boom, 5, dt);
    this.boomPitch = damp(this.boomPitch ?? this.camPitch, cap ? Math.min(this.camPitch, 0.2) : this.camPitch, 5, dt);
    const cp = Math.cos(this.boomPitch);
    const offset = new THREE.Vector3(Math.sin(this.camYaw) * cp, Math.sin(this.boomPitch), Math.cos(this.camYaw) * cp).multiplyScalar(this.boomLen);
    // Over-the-shoulder offset.
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    let camPos = this.camTarget.clone().add(offset);
    // Pull the camera in along its boom if it would end up inside a solid cylinder (the tower).
    for (const b of this.cameraBlockers?.() || []) {
      for (let k = 0; k < 12; k++) {
        const inside = Math.hypot(camPos.x - b.x, camPos.z - b.z) < b.r && camPos.y < b.top;
        if (!inside) break;
        camPos = this.camTarget.clone().lerp(camPos, 0.8);
      }
    }
    const minY = this.indoor ? this.groundAt(camPos.x, camPos.z) + (this.indoor.heightAt ? 0.8 : 1) : Math.max(heightAt(camPos.x, camPos.z), WATER_LEVEL) + 0.6;
    if (camPos.y < minY) camPos.y = minY;
    // Cavern realms have a roof: keep the camera beneath it.
    const maxY = this.indoor?.ceilingAt?.(camPos.x, camPos.z);
    if (maxY !== undefined && camPos.y > maxY - 2.5) camPos.y = Math.max(minY, maxY - 2.5);
    if (this.shakeEnabled === false) this.shake = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      camPos.x += (Math.random() - 0.5) * this.shake * 0.8;
      camPos.y += (Math.random() - 0.5) * this.shake * 0.8;
    }
    this.camera.position.copy(camPos);
    this.camera.lookAt(this.camTarget);
  }
}
