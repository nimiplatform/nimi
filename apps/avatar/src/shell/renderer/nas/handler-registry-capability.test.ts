import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const requiresLive2DSource =
  'export default { requires: [\'live2d-extension\'], async execute() {} };';
const neutralSource =
  'export default { async execute() {} };';

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

async function populateWithSource(stem: string, kind: 'activity' | 'event' | 'continuous', source: string, backendKind: 'vrm' | 'live2d' | 'nimi2d') {
  const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
  const registry = createHandlerRegistry();
  invokeMock.mockImplementation(async (_cmd: string, _args: { path?: string }) => source);
  const result = await populateRegistry(
    registry,
    createManifest(stem, kind),
    { backendKind },
  );
  return { registry, result };
}

describe('NAS handler-registry retired capability gating', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (globalThis as unknown as { __NIMI_TAURI_TEST__?: unknown }).__NIMI_TAURI_TEST__ = {
      invoke: (...args: unknown[]) => invokeMock(...args),
      listen: async () => () => undefined,
    };
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file') {
        return args.path?.includes('live2d') ? requiresLive2DSource : neutralSource;
      }
      throw new Error(`unexpected command ${command}`);
    });
  });

  it('rejects an activity handler that declares retired live2d-extension on a VRM backend', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registry, result } = await populateWithSource('happy', 'activity', requiresLive2DSource, 'vrm');
    expect(result.validationErrors.join('\n')).toContain('NAS handler capability declarations are retired for creator code');
    expect(registry.activity.has('happy')).toBe(false);
    errorSpy.mockRestore();
  });

  it('rejects a continuous handler that declares retired live2d-extension on a VRM backend', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registry, result } = await populateWithSource('gaze', 'continuous', requiresLive2DSource, 'vrm');
    expect(result.validationErrors.join('\n')).toContain('NAS handler capability declarations are retired for creator code');
    expect(registry.continuous.has('gaze')).toBe(false);
    errorSpy.mockRestore();
  });

  it('rejects a handler that declares retired live2d-extension on a Nimi2D backend', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registry, result } = await populateWithSource('happy', 'activity', requiresLive2DSource, 'nimi2d');
    expect(result.validationErrors.join('\n')).toContain('NAS handler capability declarations are retired for creator code');
    expect(registry.activity.has('happy')).toBe(false);
    errorSpy.mockRestore();
  });

  it('rejects a handler that declares retired live2d-extension on a Live2D backend', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { registry, result } = await populateWithSource('happy', 'activity', requiresLive2DSource, 'live2d');
    expect(result.validationErrors.join('\n')).toContain('NAS handler capability declarations are retired for creator code');
    expect(registry.activity.has('happy')).toBe(false);
    errorSpy.mockRestore();
  });

  it('admits a neutral handler with no requires regardless of backend kind', async () => {
    const { registry, result } = await populateWithSource('happy', 'activity', neutralSource, 'vrm');
    expect(result.validationErrors).toEqual([]);
    expect(registry.activity.has('happy')).toBe(true);
  });
});
