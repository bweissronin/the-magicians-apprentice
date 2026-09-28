// Dev-only scenarios, enabled with ?scenario=<name>. Used for automated visual checks.
import { SHRINES, TOWER_FLOORS, ROOMS, SCHOOLS } from './data.js';

export function runScenario(game, name) {
  const s = game.state;
  // Scenarios skip the first-meeting pauses (they'd freeze automated checks) unless &fresh=1.
  const start = () => {
    game.startGame(false); game.input.lock = () => {};
    if (!new URLSearchParams(location.search).get('fresh')) Object.values(s.bestiary).forEach((b) => { b.seen = true; b.rumour = true; });
    // First-visit tours too (add &tour=1 to watch them).
    if (!new URLSearchParams(location.search).get('tour')) s.story.toured = { valley: true, necromancy: true, geomancy: true, cryomancy: true, pyromancy: true };
    // And first-visit room guides (add &guide=1 to see them; stations then show as untried too).
    if (!new URLSearchParams(location.search).get('guide')) {
      const kinds = ['mastery', 'transmute', 'restore', 'chronicle', 'lookout'];
      s.guide.rooms = [...ROOMS.map((_, i) => `arcane:${i}`), ...SCHOOLS.flatMap((d) => kinds.map((_, i) => `${d.id}:${i}`))];
      s.guide.used = [...ROOMS.map((r) => `arcane:${r.station}`), 'arcane:bestiary', ...SCHOOLS.flatMap((d) => kinds.map((k) => `${d.id}:${k}`))];
    }
  };
  // A seasoned apprentice: letter read, Radiance learned, every gate open.
  const veteran = () => { s.talkedToMentor = true; s.story.letter = true; s.upgrades.radiance = 1; ['necromancy', 'geomancy', 'cryomancy', 'pyromancy'].forEach((k) => { s.grandfathered[k] = true; }); };
  const scenarios = {
    title() {},
    play() { start(); },
    gather() {
      start();
      s.talkedToMentor = true;
      const n = game.resources.nodes.find((x) => x.type === 'tree');
      game.player.place(n.x + 2, n.z + 2, 0.8);
    },
    tower() {
      start();
      s.talkedToMentor = true;
      s.level = 9; s.floors = TOWER_FLOORS.length;
      game.tower.setFloors(s.floors);
      SHRINES.forEach((x) => { s.shrines.push(x.id); game.shrines.markSolved(x.id, false); });
      game.player.place(0, 30, 0);
      game.player.camDist = 18; game.player.camPitch = 0.25;
    },
    night() { scenarios.tower(); game.world.time = 0.95; },
    build() { start(); s.talkedToMentor = true; s.inv.wood = 40; s.inv.stone = 40; game.openBuild(); },
    puzzle1() { start(); s.talkedToMentor = true; game.openShrine(game.shrines.list[0]); },
    puzzle2() { start(); s.talkedToMentor = true; game.openShrine(game.shrines.list[1]); },
    puzzle3() { start(); s.talkedToMentor = true; game.openShrine(game.shrines.list[4]); },
    shrine() { start(); const sh = game.shrines.list[0]; game.player.place(sh.x, sh.z + 12, 0); },
    // Close-up character portraits: a locked camera orbiting slowly around the subject.
    portrait() {
      start(); s.talkedToMentor = true;
      const p = game.player; p.place(game.mentor.x + 3.2, game.mentor.z + 1, 0);
      p.facing = 0.3;
      const who = new URLSearchParams(location.search).get('who') || 'player';
      const ang = +(new URLSearchParams(location.search).get('ang') || 0.4);
      game.startCinematic(1e9, (t, cam) => {
        const c = who === 'mentor' ? game.mentor.mesh.position : p.pos;
        const yaw = (who === 'mentor' ? game.mentor.mesh.rotation.y : p.mesh.rotation.y) + ang;
        const d = who === 'mentor' ? 4.4 : 3.6;
        cam.position.set(c.x + Math.sin(yaw) * d, c.y + 1.7, c.z + Math.cos(yaw) * d);
        cam.lookAt(c.x, c.y + (who === 'mentor' ? 1.5 : 1.3), c.z);
      });
      game.ui.hide();
    },
    // ?scenario=room&floor=N — a fully built tower, standing inside room N.
    room() {
      scenarios.tower();
      Object.assign(s.inv, { wood: 80, stone: 80, crystal: 60, essence: 60 });
      const f = +(new URLSearchParams(location.search).get('floor') || 0);
      setTimeout(() => game.enterTower(f, 'door'), 300);
    },
    // ?scenario=gallery — every Blender prop lined up in an empty room for inspection.
    async gallery() {
      const { assetsReady, prop, propNames } = await import('./assets.js');
      await assetsReady;
      scenarios.room();
      setTimeout(() => {
        const room = game.interior.room;
        room.children.slice().forEach((c, i) => { if (i > 0) room.remove(c); }); // keep the shell only
        const names = propNames();
        names.forEach((n, i) => {
          const p = prop(n);
          const row = Math.floor(i / 6), col = i % 6;
          p.position.set(-6.5 + col * 2.6, 0, -5 + row * 3.6);
          room.add(p);
        });
        game.startCinematic(1e9, (t, cam) => { cam.position.set(0, 9, 11); cam.lookAt(0, 0.8, -1); });
        game.ui.hide();
        window.__galleryReady = names;
      }, 900);
    },
    // ?scenario=realm&school=necromancy|pyromancy|cryomancy — standing in that realm at level 8.
    realm() {
      start(); veteran(); s.level = 8;
      const q = new URLSearchParams(location.search), id = q.get('school') || 'necromancy';
      setTimeout(() => game.enterRealm(id), 300);
      // &foes=N: spawn N creatures in front of the player to see them in their own world.
      const n = +(q.get('foes') || 0);
      if (n) setTimeout(() => {
        const P = game.player.pos;
        for (let i = 0; i < n; i++) {
          const spot = { x: P.x + (i - (n - 1) / 2) * 3.4, z: P.z - 7 - (i % 2) * 2 };
          const was = game.magic.arena.spawn; game.magic.arena.spawn = () => spot;
          game.magic.spawnWisp(P); game.magic.arena.spawn = was;
        }
        window.__foesReady = true;
      }, 1500);
    },
    // ?scenario=landmark&school=X&i=0..3|overview — a camera on each far landmark of a realm.
    landmark() {
      const q = new URLSearchParams(location.search), id = q.get('school') || 'necromancy', which = q.get('i') || '0';
      start(); veteran(); s.level = 8;
      setTimeout(() => game.enterRealm(id), 300);
      setTimeout(() => {
        const r = game.realm;
        game.magic.update = () => {};
        if (which === 'overview') {
          game.player.place(0, 20, 0);
          game.startCinematic(1e9, (t, c) => { c.position.set(0, 190, 150); c.lookAt(0, 0, -10); });
          r.chunks.forEach((ch) => { ch.visible = true; }); r.scene.fog.density *= 0.25;
          game.realms.cullT = 1e9;
        } else {
          const L = r.land.landmarks[+which], a = Math.atan2(-L.x, -L.z) + (+(q.get('ang') || 0.5));
          game.player.place(L.ex, L.ez, 0);
          game.startCinematic(1e9, (t, c) => {
            const d = L.r * 1.6 + 14, y = r.heightAt(L.x, L.z);
            c.position.set(L.x + Math.sin(a) * d, y + L.r * 0.7 + 8, L.z + Math.cos(a) * d);
            c.lookAt(L.x, y + 3, L.z);
          });
        }
        game.ui.hide();
        window.__landmarkReady = true;
      }, 1800);
    },
    // ?scenario=sanctum&school=X&stages=N[&cam=orbit|front|none] — that realm with N sanctum stages raised.
    sanctum() {
      const q = new URLSearchParams(location.search);
      const id = q.get('school') || 'necromancy', n = +(q.get('stages') ?? 5), cam = q.get('cam') || 'orbit';
      start(); veteran(); s.level = 8;
      s.sanctums[id] = n;
      Object.keys(s.inv).forEach((k) => { s.inv[k] = 200; });
      setTimeout(() => game.enterRealm(id), 300);
      setTimeout(() => {
        const r = game.realm;
        game.player.place(0, -8, 0);
        if (cam === 'none') return;
        const ang = +(q.get('ang') ?? 0.5), dist = +(q.get('dist') ?? 0);
        game.startCinematic(1e9, (t, c) => {
          const sc = r.sanctum.world, top = r.sanctum.top;
          const a = cam === 'orbit' ? ang + t * 0.12 : ang;
          const d = dist || 22 + top * 0.8;
          c.position.set(sc.x + Math.sin(a) * d, sc.y + top * 0.45 + 5, sc.z + Math.cos(a) * d);
          c.lookAt(sc.x, sc.y + top * 0.42, sc.z);
        });
        game.ui.hide();
        window.__sanctumReady = true;
      }, 1400);
    },
    // ?scenario=bestiary[&kind=specter|imp|wraith|shade] — the creatures posed for inspection.
    async bestiary() {
      const { makeCreature } = await import('./creatures.js');
      const q = new URLSearchParams(location.search), only = q.get('kind');
      start(); s.talkedToMentor = true;
      game.magic.update = () => {}; // keep real wisps away
      const kinds = only ? [only] : ['shade', 'specter', 'bones', 'golem', 'imp', 'wraith'];
      const base = { x: 30, z: 40 };
      game.player.place(base.x, base.z + 30, 0);
      const list = kinds.map((k, i) => {
        const c = makeCreature(k), x = base.x + (i - (kinds.length - 1) / 2) * 3.2, z = base.z;
        c.group.position.set(x, game.world.constructor ? 0 : 0, z);
        game.scene.add(c.group);
        return { c, x, z };
      });
      const { heightAt } = await import('./world.js');
      const w = { chasing: q.get('chase') === '1', flash: 0, vel: { x: 0, z: 0 } };
      game.world.time = +(q.get('time') ?? 0.35);
      game.startCinematic(1e9, (t, cam) => {
        list.forEach(({ c, x, z }, i) => { c.group.position.y = heightAt(x, z) + c.hover; c.tick(1 / 60, t + i, w); c.group.rotation.y = Math.sin(t * 0.4) * 0.35; });
        const d = only ? 4.2 : 9.5, a = +(q.get('ang') ?? 0.15);
        const y = heightAt(base.x, base.z) + 1.6;
        cam.position.set(base.x + Math.sin(a) * d, y + 0.6, base.z + Math.cos(a) * d);
        cam.lookAt(base.x, y + 0.2, base.z);
      });
      game.ui.hide();
      window.__bestiaryReady = true;
    },
    gates() {
      start(); veteran(); s.level = 5;
      game.player.place(0, -14, 0); game.player.camDist = 16; game.player.camPitch = 0.5;
    },
    dialogue() { start(); game.player.place(game.mentor.x + 1.5, game.mentor.z + 2, 0.6); game.talkToMentor(); },
  };
  (scenarios[name] || scenarios.title)();
}
