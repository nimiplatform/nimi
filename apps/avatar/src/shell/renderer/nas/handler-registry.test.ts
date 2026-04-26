import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
let eventListener: ((event: { payload: Record<string, unknown> }) => void) | null = null;
let sourceByPath = new Map<string, string>();
let disposedSources: string[] = [];
const oldHandlerSource = 'export default { async execute() {} }; // old handler';
const newHandlerSource = 'export default { async execute() {} }; // new handler';
const invalidHandlerSource = 'export default { async execute() { syntax-error } };';

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
      dispose: vi.fn(() => disposedSources.push(source)),
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
      dispose: vi.fn(() => disposedSources.push(source)),
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
    sourceByPath = new Map();
    disposedSources = [];
    eventListener = null;
  });

  it('atomically swaps a valid reloaded registry and exposes the retired registry for disposal', async () => {
    const { createHandlerRegistry, populateRegistry, reloadRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return sourceByPath.get(args.path ?? '') ?? oldHandlerSource;
      }
      throw new Error(`unexpected command ${command}`);
    });
    sourceByPath.set('/model/runtime/nimi/activity/happy.js', oldHandlerSource);
    await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy.js'));

    sourceByPath.set('/model/runtime/nimi/activity/happy.js', newHandlerSource);
    const result = await reloadRegistry(registry, createManifest('/model/runtime/nimi/activity/happy.js'), {
      reloadMode: 'update',
    });

    expect(result.applied).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.retiredRegistry?.activity.get('happy')?.handler.meta?.description).toContain('old handler');
    expect(registry.activity.get('happy')?.handler.meta?.description).toContain('new handler');
  });

  it('rejects invalid reloads without replacing the active registry', async () => {
    const { createHandlerRegistry, populateRegistry, reloadRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return sourceByPath.get(args.path ?? '') ?? oldHandlerSource;
      }
      throw new Error(`unexpected command ${command}`);
    });
    sourceByPath.set('/model/runtime/nimi/activity/happy.js', oldHandlerSource);
    await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy.js'));

    sourceByPath.set('/model/runtime/nimi/activity/happy.js', invalidHandlerSource);
    const result = await reloadRegistry(registry, createManifest('/model/runtime/nimi/activity/happy.js'), {
      reloadMode: 'update',
    });

    expect(result.applied).toBe(false);
    expect(result.validationErrors.join('\n')).toContain('invalid module');
    expect(registry.activity.get('happy')?.handler.meta?.description).toContain('old handler');
  });

  it('emits avatar.model.script.reloaded after a watched NAS directory changes', async () => {
    const { createHandlerRegistry, populateRegistry, startNasHandlerHotReload, NAS_HANDLERS_CHANGED_EVENT } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    const emitted: Array<{ name: string; detail: Record<string, unknown> }> = [];
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return sourceByPath.get(args.path ?? '') ?? oldHandlerSource;
      }
      if (command === 'nimi_avatar_scan_nas_handlers') {
        return {
          activity: [{ file_stem: 'happy', absolute_path: '/model/runtime/nimi/activity/happy.js' }],
          event: [],
          continuous: [],
          config_json_path: null,
        };
      }
      return undefined;
    });
    sourceByPath.set('/model/runtime/nimi/activity/happy.js', oldHandlerSource);
    await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy.js'));

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
    sourceByPath.set('/model/runtime/nimi/activity/happy.js', newHandlerSource);
    eventListener?.({
      payload: {
        watcher_id: watcherId,
        nimi_dir: '/model/runtime/nimi',
        changed_files: ['activity/happy.js'],
        reload_mode: 'update',
      },
    });
    await flushAsync();

    expect(registry.activity.get('happy')?.handler.meta?.description).toContain('new handler');
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
    expect(disposedSources.some((source) => source.includes('old handler'))).toBe(true);
  });

  it('applies remove-mode atomically and leaves the removed registry disposable', async () => {
    const { createHandlerRegistry, populateRegistry, reloadRegistry, disposeRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return sourceByPath.get(args.path ?? '') ?? oldHandlerSource;
      }
      throw new Error(`unexpected command ${command}`);
    });
    sourceByPath.set('/model/runtime/nimi/activity/happy.js', oldHandlerSource);
    await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy.js'));

    const result = await reloadRegistry(registry, {
      activity: [],
      event: [],
      continuous: [],
      configJsonPath: null,
    }, {
      reloadMode: 'remove',
    });

    expect(result.applied).toBe(true);
    expect(registry.activity.size).toBe(0);
    expect(result.retiredRegistry?.activity.get('happy')?.handler.meta?.description).toContain('old handler');
    disposeRegistry(result.retiredRegistry!);
    expect(disposedSources.some((source) => source.includes('old handler'))).toBe(true);
  });

  it('bundles confined runtime/nimi/lib named imports before registering a handler', async () => {
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    sourceByPath.set(
      '/model/runtime/nimi/activity/happy.js',
      'import { clamp } from "../lib/clamp.js"; export default { async execute() { clamp(1, 0, 2); } };',
    );
    sourceByPath.set(
      '/model/runtime/nimi/lib/clamp.js',
      'export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }',
    );
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return sourceByPath.get(args.path ?? '');
      }
      throw new Error(`unexpected command ${command}`);
    });

    const result = await populateRegistry(registry, createManifest('/model/runtime/nimi/activity/happy.js'));

    expect(result.validationErrors).toEqual([]);
    expect(registry.activity.get('happy')?.handler.meta?.description).toContain('function clamp');
    expect(registry.activity.get('happy')?.handler.meta?.description).not.toContain('import { clamp }');
  });

  it('rejects duplicate normalized activity ids and unknown event handler filenames', async () => {
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'nimi_avatar_read_text_file') {
        return 'export default { async execute() {} };';
      }
      throw new Error(`unexpected command ${command}`);
    });

    const result = await populateRegistry(registry, {
      activity: [
        { file_stem: 'ext:grateful', absolute_path: '/model/runtime/nimi/activity/ext:grateful.js' },
        { file_stem: 'ext_grateful', absolute_path: '/model/runtime/nimi/activity/ext_grateful.js' },
      ],
      event: [
        { file_stem: 'unknown_event_name', absolute_path: '/model/runtime/nimi/event/unknown_event_name.js' },
      ],
      continuous: [],
      configJsonPath: null,
    });

    expect(result.validationErrors.join('\n')).toContain('duplicate normalized activity handler id ext_grateful');
    expect(result.validationErrors.join('\n')).toContain('unknown_event_name has no matching event');
    expect(registry.event.size).toBe(0);
  });

  it('reads app-local config.json as NAS config without treating it as handler authority', async () => {
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    sourceByPath.set('/model/runtime/nimi/config.json', '{"nas_version":"1.0","features":{"drag_physics":true}}');
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return sourceByPath.get(args.path ?? '');
      }
      throw new Error(`unexpected command ${command}`);
    });

    const result = await populateRegistry(registry, {
      activity: [],
      event: [],
      continuous: [],
      configJsonPath: '/model/runtime/nimi/config.json',
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.config).toEqual({ nas_version: '1.0', features: { drag_physics: true } });
    expect(registry.config).toEqual(result.config);
  });
});
