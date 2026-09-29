// Keyboard + mouse state with per-frame edge detection and pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.down = new Set();   // pressed this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftDown: false, rightDown: false, wheel: 0 };
    this.locked = false;
    this.typing = false;     // true while the cheat console is open
    this.onKey = null;       // raw key listener (used by the cheat console)

    window.addEventListener('keydown', (e) => {
      if (this.onKey && this.onKey(e)) return;
      if (this.typing) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.down.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftDown = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightDown = true; }
    });
    window.addEventListener('mouseup', (e) => {
      this.dragging = false;
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      } else if (this.dragging) {
        // pointer lock unavailable: drag to look
        this.mouse.dx += e.clientX - this.lastX;
        this.mouse.dy += e.clientY - this.lastY;
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  // On-screen joystick + buttons for phones and tablets.
  setupTouch() {
    this.touch = true;
    document.body.classList.add('touch');
    const ui = document.getElementById('touch');
    ui.hidden = false;
    const stick = ui.querySelector('.stick'), knob = ui.querySelector('.knob');
    let stickId = null, lookId = null, cx = 0, cy = 0, lx = 0, ly = 0;
    const R = 55;
    const setStick = (x, y) => {
      let dx = (x - cx) / R, dy = (y - cy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) this.keys.delete(k);
      if (dy < -0.35) this.keys.add('KeyW');
      if (dy > 0.35) this.keys.add('KeyS');
      if (dx < -0.35) this.keys.add('KeyA');
      if (dx > 0.35) this.keys.add('KeyD');
    };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      setStick(t.clientX, t.clientY);
    }, { passive: false });
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) setStick(t.clientX, t.clientY);
        else if (t.identifier === lookId) {
          this.mouse.dx += (t.clientX - lx) * 1.8; this.mouse.dy += (t.clientY - ly) * 1.8;
          lx = t.clientX; ly = t.clientY;
        }
      }
      if (stickId !== null || lookId !== null) e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null; knob.style.transform = '';
          for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) this.keys.delete(k);
        }
        if (t.identifier === lookId) lookId = null;
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    for (const b of ui.querySelectorAll('button')) {
      const press = (e) => {
        e.preventDefault();
        b.classList.add('on');
        if (b.dataset.key) { this.down.add(b.dataset.key); this.keys.add(b.dataset.key); }
        if (b.dataset.mouse) { this.mouse.left = true; this.mouse.leftDown = true; }
        if (b.dataset.wheel) this.mouse.wheel += 1;
      };
      const release = (e) => {
        e.preventDefault();
        b.classList.remove('on');
        if (b.dataset.key) this.keys.delete(b.dataset.key);
        if (b.dataset.mouse) this.mouse.left = false;
      };
      b.addEventListener('touchstart', press, { passive: false });
      b.addEventListener('touchend', release, { passive: false });
      b.addEventListener('touchcancel', release, { passive: false });
    }
  }

  lock() {
    if (this.touch) return;
    if (!this.locked && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* ignore */ }
    }
  }

  key(code) { return this.keys.has(code); }
  pressed(code) { return this.down.has(code); }
  axis(neg, pos) { return (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0); }

  endFrame() {
    this.down.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftDown = false; this.mouse.rightDown = false;
  }
}
