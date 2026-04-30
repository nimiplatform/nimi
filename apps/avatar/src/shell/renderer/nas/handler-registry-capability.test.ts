// Wave 1 (step 3) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// NAS handler-registry capability gating: when the loaded backend
// kind is `vrm` and a handler module declares
// `requires: ['live2d-extension']`, populateRegistry MUST reject the
// handler and surface a validation error (design-04 §"NAS handler
// signature hard-cut" + packet acceptance_invariants
// "NAS handler-registry rejects handler with requires
// live2d-extension when loaded model is VRM").

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const requiresLive2DSource =
  'export default { requires: [\'live2d-extension\'], async execute() {} };';
const neutralSource =
  'export default { async execute() {} };';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock('./handler-sandbox.js', () => ({
  createSandboxedActivityOrEventHandler: async (source: string) => {
    return {
      meta: { description: source },
      requires: source.includes('live2d-extension')
        ? (['live2d-extension'] as const)
        : undefined,
      execute: vi.fn(async () => undefined),
      dispose: vi.fn(),
    };
  },
  createSandboxedContinuousHandler: async (source: string) => {
    return {
      meta: { description: source },
      fps: 30,
      requires: source.includes('live2d-extension')
        ? (['live2d-extension'] as const)
        : undefined,
      update: vi.fn(),
      dispose: vi.fn(),
    };
  },
}));

function createManifest(stem: string, kind: 'activity' | 'event' | 'continuous') {
  return {
    activity: kind === 'activity' ? [{ file_stem: stem, absolute_path: `/model/runtime/nimi/activity/${stem}.js` }] : [],
    event: kind === 'event' ? [{ file_stem: stem, absolute_path: `/model/runtime/nimi/event/${stem}.js` }] : [],
    continuous: kind === 'continuous' ? [{ file_stem: stem, absolute_path: `/model/runtime/nimi/continuous/${stem}.js` }] : [],
    configJsonPath: null,
  };
}

describe('NAS handler-registry capability gating', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return args.path?.includes('live2d') ? requiresLive2DSource : neutralSource;
      }
      throw new Error(`unexpected command ${command}`);
    });
  });

  it('rejects an activity handler that requires live2d-extension on a VRM backend', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (_cmd: string, _args: { path?: string }) => requiresLive2DSource);
    const result = await populateRegistry(
      registry,
      createManifest('happy', 'activity'),
      { backendKind: 'vrm' },
    );
    expect(result.validationErrors.join('\n')).toMatch(/requires 'live2d-extension'.*backend kind is 'vrm'/);
    expect(registry.activity.has('happy')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rejects a continuous handler that requires live2d-extension on a VRM backend', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (_cmd: string, _args: { path?: string }) => requiresLive2DSource);
    const result = await populateRegistry(
      registry,
      createManifest('gaze', 'continuous'),
      { backendKind: 'vrm' },
    );
    expect(result.validationErrors.join('\n')).toContain("requires 'live2d-extension'");
    expect(registry.continuous.has('gaze')).toBe(false);
    warnSpy.mockRestore();
  });

  it('admits the same handler on a Live2D backend with requiresLive2DExtension flag set', async () => {
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (_cmd: string, _args: { path?: string }) => requiresLive2DSource);
    const result = await populateRegistry(
      registry,
      createManifest('happy', 'activity'),
      { backendKind: 'live2d' },
    );
    expect(result.validationErrors).toEqual([]);
    expect(registry.activity.get('happy')?.requiresLive2DExtension).toBe(true);
  });

  it('admits a neutral handler with no requires regardless of backend kind', async () => {
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    const registry = createHandlerRegistry();
    invokeMock.mockImplementation(async (_cmd: string, _args: { path?: string }) => neutralSource);
    const result = await populateRegistry(
      registry,
      createManifest('happy', 'activity'),
      { backendKind: 'vrm' },
    );
    expect(result.validationErrors).toEqual([]);
    expect(registry.activity.get('happy')?.requiresLive2DExtension).toBeFalsy();
  });
});
