// Central place that owns every recurring timer in the app, so refresh
// rates for each data source live in one file instead of being scattered
// setInterval() calls.
class Scheduler {
  constructor() {
    this._tasks = new Map();
  }

  // register a task that runs immediately, then every `intervalMs`
  register(name, intervalMs, fn) {
    this.unregister(name);
    const run = () => {
      Promise.resolve(fn()).catch(err => console.error(`[Scheduler] task "${name}" failed`, err));
    };
    run();
    const id = setInterval(run, intervalMs);
    this._tasks.set(name, id);
  }

  unregister(name) {
    const id = this._tasks.get(name);
    if (id) clearInterval(id);
    this._tasks.delete(name);
  }

  stopAll() {
    this._tasks.forEach(id => clearInterval(id));
    this._tasks.clear();
  }
}

export const scheduler = new Scheduler();
