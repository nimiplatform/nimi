import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('./handler-sandbox.js', () => ({
  createSandboxedActivityOrEventHandler: async (source: string, path: string) => {
    if (!/\bexecute\s*\(/.test(source)) {
      throw new Error(`missing execute: ${path}`);
    }
    return {
      meta: { description: source },
      execute: vi.fn(async () => undefined),
      dispose: vi.fn(),
    };
  },
  createSandboxedContinuousHandler: async (source: string, path: string) => {
    if (!/\bupdate\s*\(/.test(source)) {
      throw new Error(`missing update: ${path}`);
    }
    return {
      meta: { description: source },
      fps: /\bfps:\s*60\b/.test(source) ? 60 : 30,
      update: vi.fn(),
      dispose: vi.fn(),
    };
  },
}));

const fixtureNimiDir = path.resolve(process.cwd(), 'fixtures/nas-runtime-examples/runtime/nimi');

function fixturePath(relative: string): string {
  return `${fixtureNimiDir}/${relative}`;
}

describe('NAS creator runtime examples', () => {
  it('loads runnable activity, event, continuous, lib, and config fixtures through the NAS registry', async () => {
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file' && args.path) {
        return readFile(args.path, 'utf8');
      }
      throw new Error(`unexpected command ${command}`);
    });
    const registry = createHandlerRegistry();

    const result = await populateRegistry(registry, {
      nimiDir: fixtureNimiDir,
      activity: [{ file_stem: 'greet', absolute_path: fixturePath('activity/greet.js') }],
      event: [{ file_stem: 'avatar_user_click', absolute_path: fixturePath('event/avatar_user_click.js') }],
      continuous: [{ file_stem: 'eye_tracker', absolute_path: fixturePath('continuous/eye_tracker.js') }],
      configJsonPath: fixturePath('config.json'),
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.config).toEqual(expect.objectContaining({
      nas_version: '1.0',
      model_id: 'wave-2-fixture',
    }));
    expect(registry.activity.get('greet')?.handler.meta?.description).toContain('async function waveSequence');
    expect(registry.event.get('avatar.user.click')?.sourcePath).toBe(fixturePath('event/avatar_user_click.js'));
    expect(registry.continuous.get('eye_tracker')?.fps).toBe(60);
  });

  it('treats malformed creator fixtures as negative acceptance evidence', async () => {
    const { createHandlerRegistry, populateRegistry } = await import('./handler-registry.js');
    invokeMock.mockImplementation(async (command: string, args: { path?: string }) => {
      if (command === 'nimi_avatar_read_text_file' && args.path) {
        return readFile(args.path, 'utf8');
      }
      throw new Error(`unexpected command ${command}`);
    });
    const registry = createHandlerRegistry();

    const result = await populateRegistry(registry, {
      nimiDir: fixtureNimiDir,
      activity: [{
        file_stem: 'malformed_missing_execute',
        absolute_path: fixturePath('activity/malformed_missing_execute.js'),
      }],
      event: [],
      continuous: [],
      configJsonPath: null,
    });

    expect(result.validationErrors.join('\n')).toContain('missing execute');
    expect(registry.activity.has('malformed_missing_execute')).toBe(false);
  });
});
