import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  NimiElectronLocalDevelopmentControl,
  NimiElectronLocalDevelopmentRegistration,
} from '@nimiplatform/kit/shell/electron/main';
import {
  ElectronLocalDevelopmentHost,
  resolveLocalDevelopmentRegistrationFailureState,
  sameLocalDevelopmentProject,
} from '../src-electron/local-development-host.js';
import type { ElectronLocalDevelopmentPlan } from '../src-electron/local-development-plan.js';

const HANDLE = '11'.repeat(32);
const SUPERVISOR = '22'.repeat(32);

function registration(
  overrides: Partial<NimiElectronLocalDevelopmentRegistration> = {},
): NimiElectronLocalDevelopmentRegistration {
  return {
    registrationHandle: HANDLE,
    project: {
      appId: 'example.local-app',
      displayName: 'Example Local App',
      canonicalProjectRoot: '/projects/example',
      canonicalManifestPath: '/projects/example/nimi.app.yaml',
      shell: 'electron',
      appAccess: ['realm.data', 'future.unknown'],
      sourceGeneration: 3,
      declarationGeneration: 4,
    },
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

function control(overrides: Partial<NimiElectronLocalDevelopmentControl> = {}): NimiElectronLocalDevelopmentControl {
  return {
    register: async () => registration(),
    listRegistrations: async () => [registration()],
    removeRegistration: async () => undefined,
    launch: async () => ({ processId: 10, bindDeadlineUnixMs: Date.now() + 10_000 }),
    hostRunning: async () => false,
    terminateHost: async () => undefined,
    endRun: async () => undefined,
    ...overrides,
  };
}

function plan(): ElectronLocalDevelopmentPlan {
  return {
    appId: 'example.local-app',
    displayName: 'Example Local App',
    projectRoot: '/projects/example',
    rendererOrigin: 'http://127.0.0.1:1420',
    electronExecutable: '/runtime/electron',
    mainEntry: '/projects/example/dist/main.js',
  };
}

describe('Desktop Electron local-development registration host', () => {
  it('projects registration selectors without exposing management handles', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    const rows = await host.invoke('local_development_registrations_list', {}) as Array<Record<string, unknown>>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.appId, 'example.local-app');
    assert.deepEqual(rows[0]?.appAccess, ['realm.data', 'future.unknown']);
    assert.equal(rows[0]?.sourceGeneration, 3);
    assert.equal(rows[0]?.declarationGeneration, 4);
    assert.match(String(rows[0]?.selector), /^dev-project-/u);
    assert.equal(JSON.stringify(rows).includes(HANDLE), false);
  });

  it('removes by renderer selector and never accepts the private handle directly', async () => {
    const removed: string[] = [];
    const host = new ElectronLocalDevelopmentHost(control({
      removeRegistration: async (handle) => { removed.push(handle); },
    }), '/tmp');
    const [row] = await host.invoke('local_development_registrations_list', {}) as Array<{ selector: string }>;

    assert.deepEqual(await host.invoke('local_development_registration_remove', {
      payload: { selector: row!.selector },
    }), { selector: row!.selector, removed: true });
    assert.deepEqual(removed, [HANDLE]);

    await assert.rejects(
      host.invoke('local_development_registration_remove', { payload: { selector: HANDLE } }),
      /local-development-selector-invalid/u,
    );
  });

  it('physically rejects retired decision commands', async () => {
    const host = new ElectronLocalDevelopmentHost(control(), '/tmp');
    await assert.rejects(
      host.invoke('local_development_decide', { payload: {} }),
      /local-development-command-unavailable/u,
    );
  });

  it('compares the Runtime-resolved registration to the exact launch project', () => {
    assert.equal(sameLocalDevelopmentProject(registration(), plan()), true);
    assert.equal(sameLocalDevelopmentProject(registration({
      project: { ...registration().project, appId: 'other.app' },
    }), plan()), false);
  });

  it('separates transport failures from registration failures', () => {
    assert.equal(resolveLocalDevelopmentRegistrationFailureState('runtime-service-unavailable'), 'runtime-unavailable');
    assert.equal(resolveLocalDevelopmentRegistrationFailureState('local-app-developer-mode-disabled'), 'registration-unavailable');
  });

  it('keeps supervisor identifiers independent from registration handles', async () => {
    const seen: string[] = [];
    const appControl = control({
      register: async ({ supervisorRunId }) => {
        seen.push(supervisorRunId);
        return registration();
      },
    });
    await appControl.register({
      expectedAppId: 'example.local-app',
      projectRoot: '/projects/example',
      shell: 'electron',
      supervisorRunId: SUPERVISOR,
    });
    assert.deepEqual(seen, [SUPERVISOR]);
    assert.notEqual(SUPERVISOR, HANDLE);
  });
});
