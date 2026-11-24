import { describe, expect, it, vi } from 'vitest';
import { TypedEmitter } from '../../src/core/events';

interface TestEvents {
  ping: { n: number };
  done: { ok: boolean };
}

describe('TypedEmitter', () => {
  it('entrega o payload aos ouvintes do evento, na ordem de registro', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const calls: string[] = [];
    emitter.on('ping', ({ n }) => calls.push(`a${n}`));
    emitter.on('ping', ({ n }) => calls.push(`b${n}`));
    emitter.on('done', () => calls.push('done'));

    emitter.emit('ping', { n: 1 });

    expect(calls).toEqual(['a1', 'b1']);
  });

  it('para de entregar depois de cancelar a inscrição', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    const off = emitter.on('ping', listener);

    off();
    off();
    emitter.emit('ping', { n: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  it('once entrega uma única vez', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.once('ping', listener);

    emitter.emit('ping', { n: 1 });
    emitter.emit('ping', { n: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ n: 1 });
  });

  it('um ouvinte que lança não impede os demais e é reportado', () => {
    const onError = vi.fn();
    const emitter = new TypedEmitter<TestEvents>(onError);
    const failure = new Error('falha no ouvinte');
    const after = vi.fn();
    emitter.on('ping', () => {
      throw failure;
    });
    emitter.on('ping', after);

    expect(() => emitter.emit('ping', { n: 1 })).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, 'ping');
  });

  it('ouvinte removido durante a emissão ainda recebe a emissão em curso', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const second = vi.fn();
    emitter.on('ping', () => emitter.off('ping', second));
    emitter.on('ping', second);

    emitter.emit('ping', { n: 1 });
    emitter.emit('ping', { n: 2 });

    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clear remove todos os ouvintes', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('ping', listener);
    emitter.on('done', listener);

    emitter.clear();
    emitter.emit('ping', { n: 1 });
    emitter.emit('done', { ok: true });

    expect(listener).not.toHaveBeenCalled();
  });
});
