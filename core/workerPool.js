/**
 * EarthOS WorkerPool — manages a pool of DataWorkers.
 * Keeps the main thread free: heavy processing goes to background threads.
 */

const WORKER_URL = new URL('../workers/dataWorker.js', import.meta.url);

class WorkerPool {
  #workers  = [];
  #queue    = [];
  #pending  = new Map();   // taskId → {resolve, reject}
  #taskId   = 0;
  #size;

  constructor(size = navigator.hardwareConcurrency ?? 2) {
    this.#size = Math.min(size, 4); // cap at 4
  }

  init() {
    for (let i = 0; i < this.#size; i++) {
      const w = new Worker(WORKER_URL, { type: 'module' });
      w.idle = true;
      w.onmessage = ({ data }) => this.#onMessage(w, data);
      w.onerror   = (e)       => this.#onError(w, e);
      this.#workers.push(w);
    }
    return this;
  }

  /**
   * Run a task in a worker. Returns a promise that resolves with the result.
   * source: task handler name in dataWorker.js
   * payload: data to pass
   */
  run(source, payload) {
    return new Promise((resolve, reject) => {
      const taskId = String(++this.#taskId);
      this.#pending.set(taskId, { resolve, reject });
      const task = { type: 'TASK', taskId, source, payload };

      const idle = this.#workers.find(w => w.idle);
      if (idle) {
        this.#dispatch(idle, task);
      } else {
        this.#queue.push(task);
      }
    });
  }

  terminate() {
    for (const w of this.#workers) w.terminate();
    this.#workers  = [];
    this.#queue    = [];
    this.#pending.clear();
  }

  get size() { return this.#size; }

  #dispatch(worker, task) {
    worker.idle = false;
    worker.postMessage(task);
  }

  #onMessage(worker, data) {
    worker.idle = true;
    const { taskId, events, error } = data;
    const p = this.#pending.get(taskId);
    if (p) {
      this.#pending.delete(taskId);
      error ? p.reject(new Error(error)) : p.resolve(events);
    }
    // Pick next queued task
    if (this.#queue.length) this.#dispatch(worker, this.#queue.shift());
  }

  #onError(worker, e) {
    worker.idle = true;
    console.error('[WorkerPool] Worker error:', e.message);
  }
}

export const workerPool = new WorkerPool();
export default workerPool;
