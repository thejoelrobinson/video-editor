// Centralized requestAnimationFrame scheduler.
// Merges multiple rAF consumers into a single loop, sorted by priority.

export const PRIORITY = {
  PLAYBACK: 0,
  RENDER: 1,
  UI: 2
};

let nextId = 0;

export const rafScheduler = {
  _consumers: new Map(),  // id -> { callback, priority, active }
  _sorted: [],            // rebuilt on add/remove
  _running: false,
  _rafId: null,

  register(callback, priority) {
    const id = ++nextId;
    this._consumers.set(id, { callback, priority, active: false });
    this._rebuildSorted();
    return id;
  },

  unregister(id) {
    this._consumers.delete(id);
    this._rebuildSorted();
    if (this._consumers.size === 0) {
      this._stop();
    }
  },

  activate(id) {
    const consumer = this._consumers.get(id);
    if (!consumer || consumer.active) return;
    consumer.active = true;
    if (!this._running || !this._rafId) {
      this._running = true;
      this._rafId = requestAnimationFrame((ts) => this._tick(ts));
    }
  },

  deactivate(id) {
    const consumer = this._consumers.get(id);
    if (!consumer) return;
    consumer.active = false;
    // Check if any consumers are still active
    let anyActive = false;
    for (const [, c] of this._consumers) {
      if (c.active) { anyActive = true; break; }
    }
    if (!anyActive) {
      this._stop();
    }
  },

  _stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._running = false;
  },

  _rebuildSorted() {
    this._sorted = Array.from(this._consumers.entries())
      .sort(([, a], [, b]) => a.priority - b.priority);
  },

  _tick(timestamp) {
    let anyActive = false;
    for (const [, consumer] of this._sorted) {
      if (consumer.active) {
        anyActive = true;
        consumer.callback(timestamp);
      }
    }
    if (anyActive) {
      this._rafId = requestAnimationFrame((ts) => this._tick(ts));
    } else {
      this._running = false;
      this._rafId = null;
    }
  },

  cleanup() {
    this._stop();
    this._consumers.clear();
    this._sorted = [];
  }
};

export default rafScheduler;
