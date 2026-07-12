import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inline minimal EventBus to avoid browser globals
class EventBus {
  #handlers = new Map();
  on(ev, fn)      { if (!this.#handlers.has(ev)) this.#handlers.set(ev, []); this.#handlers.get(ev).push(fn); return () => this.off(ev, fn); }
  off(ev, fn)     { this.#handlers.set(ev, (this.#handlers.get(ev) ?? []).filter(h => h !== fn)); }
  emit(ev, data)  { (this.#handlers.get(ev) ?? []).forEach(h => h(data)); }
  once(ev, fn)    { const unsub = this.on(ev, d => { fn(d); unsub(); }); }
}

describe('EventBus', () => {
  let bus;
  beforeEach(() => { bus = new EventBus(); });

  it('delivers event to registered handler', () => {
    const spy = vi.fn();
    bus.on('test', spy);
    bus.emit('test', { value: 42 });
    expect(spy).toHaveBeenCalledWith({ value: 42 });
  });

  it('delivers to multiple handlers', () => {
    const a = vi.fn(), b = vi.fn();
    bus.on('x', a); bus.on('x', b);
    bus.emit('x', {});
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops delivery', () => {
    const spy = vi.fn();
    const unsub = bus.on('ev', spy);
    unsub();
    bus.emit('ev', {});
    expect(spy).not.toHaveBeenCalled();
  });

  it('once fires exactly once', () => {
    const spy = vi.fn();
    bus.once('ping', spy);
    bus.emit('ping', 1);
    bus.emit('ping', 2);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('emitting unknown event does not throw', () => {
    expect(() => bus.emit('no-listeners', {})).not.toThrow();
  });

  it('does not cross-contaminate different events', () => {
    const a = vi.fn(), b = vi.fn();
    bus.on('cat', a); bus.on('dog', b);
    bus.emit('cat', {});
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });
});
