// Touch controls for phones and tablets: a virtual joystick (walk + turn), action buttons,
// and drag-anywhere-else to look. Everything feeds the same Input state the keyboard uses,
// so gameplay code doesn't know (or care) which device is driving it.

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    document.body.classList.add('touch');
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="stick" id="stick"><div class="knob"></div></div>
      <div class="tbtns">
        <button data-act="cast" class="tb big" aria-label="Cast Arcane Bolt">✦</button>
        <button data-act="use" class="tb" aria-label="Interact or hold to harvest">E</button>
        <button data-act="jump" class="tb" aria-label="Jump">⤒</button>
        <button data-act="blink" class="tb sm" aria-label="Blink">➶</button>
        <button data-act="target" class="tb sm" aria-label="Target next foe">◎</button>
        <button data-act="dodge" class="tb sm" aria-label="Dodge">⤳</button>
      </div>
      <button class="tb menu" data-act="menu" aria-label="Pause menu">☰</button>`;
    document.getElementById('hud').appendChild(root);
    this.bindStick(root.querySelector('#stick'));
    root.querySelectorAll('[data-act]').forEach((b) => this.bindButton(b));
    this.bindLook(game.canvas);
  }

  press(code, down) {
    const k = this.input.keys;
    if (down) { if (!k.has(code)) this.input.pressedKeys.add(code); k.add(code); } else k.delete(code);
  }

  bindStick(el) {
    const knob = el.firstElementChild;
    let id = null, cx = 0, cy = 0;
    const R = 46;
    const update = (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.min(R, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
      const nx = (Math.cos(a) * d) / R, ny = (Math.sin(a) * d) / R;
      knob.style.transform = `translate(${nx * R}px, ${ny * R}px)`;
      this.press('KeyW', ny < -0.35); this.press('KeyS', ny > 0.45);
      this.press('KeyA', nx < -0.4); this.press('KeyD', nx > 0.4);
    };
    el.addEventListener('pointerdown', (e) => {
      id = e.pointerId; el.setPointerCapture(id);
      const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      update(e.clientX, e.clientY); e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) update(e.clientX, e.clientY); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; knob.style.transform = '';
      ['KeyW', 'KeyS', 'KeyA', 'KeyD'].forEach((c) => this.press(c, false));
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  bindButton(b) {
    const g = this.game, act = b.dataset.act;
    const map = { use: 'KeyE', jump: 'Space', blink: 'KeyQ' };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      g.audio.init(); g.audio.resume();
      b.classList.add('down');
      if (map[act]) {
        this.press(map[act], true);
        // Dialogue advances on E like the keyboard.
        if (act === 'use' && g.mode === 'dialogue') g.ui.advanceDialogue();
      } else if (act === 'cast') this.input.clicked = true;
      else if (act === 'dodge') g.player.wantDodge = true;
      else if (act === 'target' && g.mode === 'play') { if (!g.magic.cycleTarget(g.player)) g.ui.toast('No wisps in range to target', '#c04dff'); }
      else if (act === 'menu') { if (g.mode === 'play') g.pause(); else if (g.mode === 'paused') g.resume(); }
    });
    const up = () => { b.classList.remove('down'); if (map[act]) this.press(map[act], false); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  }

  // Drag on the open game view to look around (turn + tilt).
  bindLook(canvas) {
    let id = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || id !== null) return; id = e.pointerId; lx = e.clientX; ly = e.clientY; });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.input.mouseDX += (e.clientX - lx) * 1.6; this.input.mouseDY += (e.clientY - ly) * 1.2;
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === id) id = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  }
}
