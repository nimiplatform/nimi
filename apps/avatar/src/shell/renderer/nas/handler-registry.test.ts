import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
let eventListener: ((event: { payload: Record<string, unknown> }) => void) | null = null;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (...args: unknown[]) => {
    listenMock(...args);
    eventListener = args[1] as typeof eventListener;
    return unlistenMock;
  },
}));

vi.mock('./handler-sandbox.js', () => ({
  createSandboxedActivityOrEventHandler: async (source: string, path: string) => {
    if (source.includes('syntax-error')) {
      throw new Error(`invalid module: ${path}`);
    }
    return {
      meta: { description: source },
      execute: vi.fn(async () => undefined),
      dispose: vi.fn(),
    };
  },
  createSandboxedContinuousHandler: async (source: string, path: string) => {
    if (source.includes('syntax-error')) {
      throw new Error(`invalid module: ${path}`);
    }
    return {
      meta: { description: source },
      fps: 30,
      update: vi.fn(),
      dispose: vi.fn(),
    };
  },
}));

function createManifest(path: string) {
  return {
    activity: [{ file_stem: 'happy', absolute_path: path }],
    event: [],
    continuous: [],
    configJsonPath: null,
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('NAS handler registry hot reload', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    eventListener = null;
  });

  it('atomically swaps a valid reloaded registry and exposes the retired registry for disposal', async () => {
    const { createHandlerRegistry, populateRegistry, reloadRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return args.path?.includes('v2') ? 'new handler' : 'old handler';
      }
      throw new Error(`unexpected command ${command}`);
    });
    await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy-v1.js'));

    const result = await reloadRegistry(registry, createManifest('/model/runtime/nimi/activity/happy-v2.js'), {
      reloadMode: 'update',
    });

    expect(result.applied).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.retiredRegistry?.activity.get('happy')?.handler.meta?.description).toBe('old handler');
    expect(registry.activity.get('happy')?.handler.meta?.description).toBe('new handler');
  });

  it('rejects invalid reloads without replacing the active registry', async () => {
    const { createHandlerRegistry, populateRegistry, reloadRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return args.path?.includes('bad') ? 'syntax-error' : 'old handler';
      }
      throw new Error(`unexpected command ${command}`);
    });
    await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy-v1.js'));

    const result = await reloadRegistry(registry, createManifest('/model/runtime/nimi/activity/happy-bad.js'), {
      reloadMode: 'update',
    });

    expect(result.applied).toBe(false);
    expect(result.validationErrors.join('\n')).toContain('invalid module');
    expect(registry.activity.get('happy')?.handler.meta?.description).toBe('old handler');
  });

  it('emits avatar.model.script.reloaded after a watched NAS directory changes', async () => {
    const { createHandlerRegistry, populateRegistry, startNasHandlerHotReload, NAS_HANDLERS_CHANGED_EVENT } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    const emitted: Array<{ name: string; detail: Record<string, unknown> }> = [];
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return args.path?.includes('v2') ? 'new handler' : 'old handler';
      }
      if (command === 'nimi_avatar_scan_nas_handlers') {
        return {
          activity: [{ file_stem: 'happy', absolute_path: '/model/runtime/nimi/activity/happy-v2.js' }],
          event: [],
          continuous: [],
          config_json_path: null,
        };
      }
      return undefined;
    });
    await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy-v1.js'));

    const stop = await startNasHandlerHotReload({
      modelId: 'ren',
      nimiDir: '/model/runtime/nimi',
      registry,
      emit: (event) => emitted.push(event),
    });
    expect(listenMock).toHaveBeenCalledWith(NAS_HANDLERS_CHANGED_EVENT, expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith('nimi_avatar_watch_nas_handlers', expect.objectContaining({
      nimiDir: '/model/runtime/nimi',
      watcherId: expect.stringMatching(/^nas-ren-/),
    }));

    const watcherId = (invokeMock.mock.calls.find((call) => call[0] === 'nimi_avatar_watch_nas_handlers')?.[1] as { watcherId: string }).watcherId;
    eventListener?.({
      payload: {
        watcher_id: watcherId,
        nimi_dir: '/model/runtime/nimi',
        changed_files: ['activity/happy.js'],
        reload_mode: 'update',
      },
    });
    await flushAsync();

    expect(registry.activity.get('happy')?.handler.meta?.description).toBe('new handler');
    expect(emitted).toContainEqual({
      name: 'avatar.model.script.reloaded',
      detail: expect.objectContaining({
        model_id: 'ren',
        changed_files: ['activity/happy.js'],
        reload_mode: 'update',
        applied: true,
        validation_errors: [],
      }),
    });

    await stop();
    expect(unlistenMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('nimi_avatar_unwatch_nas_handlers', { watcherId });
  });
});
