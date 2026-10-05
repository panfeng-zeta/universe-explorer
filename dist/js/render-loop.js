// Sleep completely when the scene is still; keep one outstanding frame at most.
export class RenderLoop {
  constructor(draw, { request = callback => requestAnimationFrame(callback), cancel = id => cancelAnimationFrame(id), now = () => performance.now(), fps = 60 } = {}) {
    this.draw = draw; this.request = request; this.cancel = cancel; this.now = now;
    this.fps = fps; this.visible = true; this.disposed = false;
    this.pending = null; this.inFrame = false; this.dirty = false; this.last = null;
    this.tick = this.tick.bind(this);
  }
  invalidate() {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.visible || this.inFrame || this.pending !== null) return;
    if (this.last === null) this.last = this.now();
    this.pending = this.request(this.tick);
  }
  tick(now) {
    this.pending = null;
    if (this.disposed || !this.visible) return;
    const elapsed = now - this.last;
    if (elapsed + .5 < 1000 / this.fps) { this.pending = this.request(this.tick); return; }
    this.last = now; this.dirty = false; this.inFrame = true;
    let moving;
    try { moving = this.draw(Math.min(elapsed / 1000, .1), now); }
    finally { this.inFrame = false; }
    if (moving || this.dirty) this.invalidate();
    else this.last = null;
  }
  setVisible(value) {
    this.visible = value;
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = null; this.last = null;
    if (value) this.invalidate();
  }
  dispose() {
    this.disposed = true;
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = null;
  }
}
