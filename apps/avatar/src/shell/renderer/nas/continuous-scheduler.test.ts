import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle } from '../driver/types.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';
import { ContinuousScheduler } from './continuous-scheduler.js';
import { createHandlerRegistry } from './handler-registry.js';

const bundle = { app: { cursor_x: 10, cursor_y: 20, window: { width: 100, height: 100 } } } as AgentDataBundle;
const projection = { setSignal: vi.fn() } as unknown as EmbodimentProjectionApi;

function setNow(value: number): void {
  vi.spyOn(performance, 'now').mockReturnValue(value);
}

describe('NAS continuous scheduler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('honors enabled=false and runs enabled handlers by filename order', () => {
    const registry = createHandlerRegistry();
    const disabled = vi.fn();
    const enabled = vi.fn();
    registry.continuous.set('b_disabled', {
      kind: 'continuous',
      id: 'b_disabled',
      fps: 60,
      handler: { enabled: false, update: disabled },
      sourcePath: '/model/runtime/nimi/continuous/b_disabled.js',
    });
    registry.continuous.set('a_enabled', {
      kind: 'continuous',
      id: 'a_enabled',
      fps: 60,
      handler: { update: enabled },
      sourcePath: '/model/runtime/nimi/continuous/a_enabled.js',
    });
    setNow(100);
    const scheduler = new ContinuousScheduler(registry, () => bundle, projection);

    expect(scheduler.tick(100)).toEqual([
      expect.objectContaining({ id: 'a_enabled', status: 'success' }),
    ]);
    expect(enabled).toHaveBeenCalledOnce();
    expect(disabled).not.toHaveBeenCalled();
  });

  it('reports async continuous update contract violations', () => {
    const registry = createHandlerRegistry();
    registry.continuous.set('async_update', {
      kind: 'continuous',
      id: 'async_update',
      fps: 60,
      handler: { update: vi.fn(async () => undefined) },
      sourcePath: '/model/runtime/nimi/continuous/async_update.js',
    });
    setNow(100);
    const scheduler = new ContinuousScheduler(registry, () => bundle, projection);

    expect(scheduler.tick(100)).toEqual([
      expect.objectContaining({
        id: 'async_update',
        status: 'async_contract_violation',
        error: 'NAS continuous update must be synchronous and must not return a Promise',
      }),
    ]);
  });

  it('records over-budget updates and skips the next frame interval', () => {
    const registry = createHandlerRegistry();
    const update = vi.fn();
    registry.continuous.set('slow', {
      kind: 'continuous',
      id: 'slow',
      fps: 60,
      handler: { update },
      sourcePath: '/model/runtime/nimi/continuous/slow.js',
    });
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const current = now;
      now += 12;
      return current;
    });
    const scheduler = new ContinuousScheduler(registry, () => bundle, projection);

    expect(scheduler.tick(100)[0]).toEqual(expect.objectContaining({
      id: 'slow',
      status: 'over_budget',
    }));
    update.mockClear();
    expect(scheduler.tick(105)).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it('skips reentrant updates when a previous update is still running', () => {
    const registry = createHandlerRegistry();
    registry.continuous.set('stuck', {
      kind: 'continuous',
      id: 'stuck',
      fps: 60,
      handler: { update: vi.fn(async () => undefined) },
      sourcePath: '/model/runtime/nimi/continuous/stuck.js',
    });
    setNow(100);
    const scheduler = new ContinuousScheduler(registry, () => bundle, projection);
    expect(scheduler.tick(100)[0]).toEqual(expect.objectContaining({
      id: 'stuck',
      status: 'async_contract_violation',
    }));

    expect(scheduler.tick(120)[0]).toEqual(expect.objectContaining({
      id: 'stuck',
      status: 'skipped_reentrant',
    }));
  });
});
