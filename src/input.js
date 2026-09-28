// Keyboard/mouse state with per-frame "pressed" edges and pointer-lock mouse deltas.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.mouseDown = false; this.clicked = false;
    this.locked = false;
    this.dragging = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      if (['Space', 'Tab'].includes(e.code) && this.locked) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; if (this.locked) this.clicked = true; }
      if (e.button === 2) this.dragging = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.dragging = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += e.deltaY; }, { passive: true });
  }

  lock() {
    if (document.body.classList.contains('touch')) return; // touch devices steer with on-screen controls
    try {
      const p = this.canvas.requestPointerLock?.();
      p?.catch?.(() => {});
    } catch { /* not allowed in this context */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.pressedKeys.has(code); }

  endFrame() {
    this.pressedKeys.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.clicked = false;
  }
}
