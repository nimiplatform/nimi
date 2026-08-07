import { describe, expect, it, vi } from 'vitest';
import { ReasonCode } from '@nimiplatform/kit/core/sdk-contract';

import {
  createNimiElectronDesktopAccountHostForBinding,
  isElectronDesktopAccountCommand,
  type NimiElectronDesktopAccountBinding,
} from '../src/main/desktop-account-host.js';
import {
  createNimiElectronDeveloperModeHostForBinding,
  isElectronDeveloperModeCommand,
} from '../src/main/developer-mode-host.js';
import { createNimiElectronFixedRuntimeLifecycleHostForBinding } from '../src/main/runtime-lifecycle-host.js';
import { createElectronRuntimeBridgeCommandNames } from '../src/main/runtime.js';
import {
  createNimiElectronLocalDevelopmentControlForBinding,
  type NimiElectronLocalDevelopmentBinding,
} from '../src/main/local-development-control.js';

function accountBinding(
  overrides: Partial<NimiElectronDesktopAccountBinding> = {},
): NimiElectronDesktopAccountBinding {
  const ok = async () => ({ status: 'ok' as const, value: { accepted: true } });
  return {
    desktopAccountSessionStatus: ok,
    desktopAccountSessionEventsOpen: ok,
    desktopAccountSessionEventsNext: ok,
    desktopAccountSessionEventsClose: ok,
    desktopAccountBeginLogin: ok,
    desktopAccountCompleteLogin: ok,
    desktopAccountInvokeRealmUnary: ok,
    desktopAccountLogout: ok,
    desktopAccountSwitchAccount: ok,
    ...overrides,
  };
}

describe('Electron protected Desktop account host', () => {
  it('pins the exact renderer-safe account commands and forwards only nested DTOs', async () => {
    const begin = vi.fn(async (input: unknown) => ({
      status: 'ok' as const,
      value: { accepted: true, input },
    }));
    const host = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountBeginLogin: begin,
    }));
    const payload = {
      redirectUri: 'http://127.0.0.1:43210/callback',
      callbackOrigin: 'http://127.0.0.1:43210',
      requestedScopes: ['profile.read'],
      ttlSeconds: 120,
    };
    await expect(host.invoke('runtime_account_begin_login', { payload })).resolves.toEqual({
      accepted: true,
      input: payload,
    });
    expect(begin).toHaveBeenCalledWith(payload);
    await expect(host.invoke('runtime_account_begin_login', {
      payload,
      caller: { appId: 'forged' },
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });

    for (const command of [
      'runtime_account_session_status',
      'runtime_account_session_events_open',
      'runtime_account_session_events_close',
      'runtime_account_begin_login',
      'runtime_account_complete_login',
      'runtime_account_invoke_realm_unary',
      'runtime_account_logout',
      'runtime_account_switch_account',
    ]) {
      expect(isElectronDesktopAccountCommand(command)).toBe(true);
    }
    expect(isElectronDesktopAccountCommand('runtime_account_permission_owner_unary')).toBe(false);
    expect(isElectronDesktopAccountCommand('runtime_bridge_unary')).toBe(false);
    expect(isElectronDesktopAccountCommand('runtime_account_issue_binding')).toBe(false);
  });

  it('cancels a native stream that finishes opening after host shutdown', async () => {
    let releaseOpen: ((outcome: { status: 'ok'; value: { streamId: string } }) => void) | undefined;
    const open = vi.fn(() => new Promise<{ status: 'ok'; value: { streamId: string } }>((resolve) => {
      releaseOpen = resolve;
    }));
    const close = vi.fn(async () => ({ status: 'ok' as const, value: { closed: true } }));
    const host = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountSessionEventsOpen: open,
      desktopAccountSessionEventsClose: close,
    }));
    const pending = host.invoke(
      'runtime_account_session_events_open',
      { afterSequence: '0' },
      {
        eventChannelPrefix: 'nimi:runtime:event:',
        sender: { send: () => undefined },
      },
    );
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    host.close();
    releaseOpen?.({ status: 'ok', value: { streamId: 'account-session-late' } });

    await expect(pending).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
    expect(close).toHaveBeenCalledWith({ streamId: 'account-session-late' });
  });

  it('pumps only the redacted account event stream and closes the native receiver', async () => {
    const event = {
      sequence: '11',
      deliveryKind: 'live',
      state: 'refresh-pending',
      reasonCode: 1,
      accountReasonCode: 1,
      accountProjection: {
        accountId: 'account-1',
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
      },
      replayTruncated: false,
    };
    const next = vi.fn()
      .mockResolvedValueOnce({ status: 'ok' as const, value: { completed: false, event } })
      .mockResolvedValueOnce({ status: 'ok' as const, value: { completed: true } });
    const close = vi.fn(async () => ({ status: 'ok' as const, value: { closed: true } }));
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const host = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountSessionEventsOpen: async (input) => ({
        status: 'ok' as const,
        value: { streamId: `account-session-${input.afterSequence}` },
      }),
      desktopAccountSessionEventsNext: next,
      desktopAccountSessionEventsClose: close,
    }));

    await expect(host.invoke(
      'runtime_account_session_events_open',
      { afterSequence: '10' },
      {
        eventChannelPrefix: 'nimi:runtime:event:',
        sender: { send: (channel, payload) => sent.push({ channel, payload }) },
      },
    )).resolves.toEqual({ streamId: 'account-session-10' });
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent).toEqual([
      {
        channel: 'nimi:runtime:event:runtime_account_session_events',
        payload: { streamId: 'account-session-10', eventType: 'next', event },
      },
      {
        channel: 'nimi:runtime:event:runtime_account_session_events',
        payload: { streamId: 'account-session-10', eventType: 'completed' },
      },
    ]);
    await expect(host.invoke(
      'runtime_account_session_events_close',
      { streamId: 'account-session-10' },
    )).resolves.toEqual({});
    expect(close).toHaveBeenCalledWith({ streamId: 'account-session-10' });
  });

  it('closes the native receiver when a streamed outcome is malformed', async () => {
    const close = vi.fn(async () => ({ status: 'ok' as const, value: { closed: true } }));
    const sent: unknown[] = [];
    const host = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountSessionEventsOpen: async () => ({
        status: 'ok' as const,
        value: { streamId: 'account-session-malformed' },
      }),
      desktopAccountSessionEventsNext: async () => ({
        status: 'ok' as const,
        value: { completed: 'not-a-boolean' },
      }),
      desktopAccountSessionEventsClose: close,
    }));

    await host.invoke(
      'runtime_account_session_events_open',
      { afterSequence: '0' },
      {
        eventChannelPrefix: 'nimi:runtime:event:',
        sender: { send: (_channel, payload) => sent.push(payload) },
      },
    );
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledWith({ streamId: 'account-session-malformed' });
    });
    expect(sent).toEqual([{
      streamId: 'account-session-malformed',
      eventType: 'error',
      error: expect.objectContaining({ reasonCode: 'runtime-service-untrusted' }),
    }]);
  });

  it('projects a native stream denial as the exact renderer-safe error envelope', async () => {
    const close = vi.fn(async () => ({ status: 'ok' as const, value: { closed: false } }));
    const sent: unknown[] = [];
    const host = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountSessionEventsOpen: async () => ({
        status: 'ok' as const,
        value: { streamId: 'account-session-denied' },
      }),
      desktopAccountSessionEventsNext: async () => ({
        status: 'error' as const,
        reasonCode: 'runtime-service-unavailable',
        retryable: true,
      }),
      desktopAccountSessionEventsClose: close,
    }));

    await host.invoke(
      'runtime_account_session_events_open',
      { afterSequence: '0' },
      {
        eventChannelPrefix: 'nimi:runtime:event:',
        sender: { send: (_channel, payload) => sent.push(payload) },
      },
    );
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledWith({ streamId: 'account-session-denied' });
    });
    expect(sent).toEqual([{
      streamId: 'account-session-denied',
      eventType: 'error',
      error: expect.objectContaining({
        code: 'runtime-service-unavailable',
        reasonCode: 'runtime-service-unavailable',
        actionHint: 'retry_protected_desktop_account_operation',
        source: 'runtime',
      }),
    }]);
  });

  it('preserves bounded Runtime denial reasons and rejects malformed native outcomes', async () => {
    const denied = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountSessionStatus: async () => ({
        status: 'error' as const,
        reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
        retryable: false,
      }),
    }));
    await expect(denied.invoke('runtime_account_session_status', {})).rejects.toMatchObject({
      code: 'runtime-permission-denied',
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
    });

    const malformed = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountSessionStatus: async () => ({ status: 'ok' as const, value: 'unsafe' }),
    }));
    await expect(malformed.invoke('runtime_account_session_status', {})).rejects.toMatchObject({
      code: 'runtime-service-untrusted',
      reasonCode: 'runtime-service-untrusted',
    });
  });
});

describe('Electron fixed Runtime lifecycle host', () => {
  it('projects SCM truth as a managed fixed-service lifecycle', async () => {
    const host = createNimiElectronFixedRuntimeLifecycleHostForBinding({
      fixedRuntimeServiceStatus: async () => ({
        status: 'ok' as const,
        value: { running: true, state: 'running', releaseVersion: '0.1.0', releasePosture: 'release' },
      }),
      fixedRuntimeServiceStart: async () => ({
        status: 'ok' as const,
        value: { running: true, state: 'running', releasePosture: 'non_release' },
      }),
      fixedRuntimeServiceRestart: async () => ({
        status: 'ok' as const,
        value: { running: true, state: 'running', releasePosture: 'non_release' },
      }),
    }, '127.0.0.1:46371');
    const commands = createElectronRuntimeBridgeCommandNames();
    await expect(host.invoke(commands.status, commands)).resolves.toEqual({
      running: true,
      managed: true,
      launchMode: 'RELEASE',
      grpcAddr: '127.0.0.1:46371',
      version: '0.1.0',
    });

    await expect(host.invoke(commands.start, commands)).resolves.toEqual({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:46371',
    });
  });
});

describe('Electron Developer Mode host', () => {
  it('uses only the protected native status/set pair', async () => {
    const set = vi.fn(async ({ enabled }: { readonly enabled: boolean }) => ({
      status: 'ok' as const,
      value: {
        state: enabled ? 'enabled' : 'disabled',
        enabled,
        revision: 2,
        reasonCode: 'action-executed',
        retryable: false,
      },
    }));
    const host = createNimiElectronDeveloperModeHostForBinding({
      desktopDeveloperModeStatus: async () => ({ status: 'ok' as const, value: {} }),
      desktopDeveloperModeSet: set,
    });
    await expect(host.invoke('developer_mode_set', { payload: { enabled: true } }))
      .resolves.toMatchObject({ state: 'enabled', enabled: true });
    expect(set).toHaveBeenCalledWith({ enabled: true });
    expect(isElectronDeveloperModeCommand('developer_mode_status')).toBe(true);
    expect(isElectronDeveloperModeCommand('developer_mode_set')).toBe(true);
    expect(isElectronDeveloperModeCommand('local_development_decide')).toBe(false);
  });
});

describe('Electron local-development protected control', () => {
  const registrationHandle = '66'.repeat(32);
  const supervisorRunId = '77'.repeat(32);
  const project = {
    appId: 'com.nimi.zhiyu.dev',
    displayName: 'Zhiyu Development',
    canonicalProjectRoot: 'D:\\workspace\\nimi\\apps\\zhiyu',
    canonicalManifestPath: 'D:\\workspace\\nimi\\apps\\zhiyu\\nimi.app.yaml',
    shell: 'electron',
    appAccess: ['realm.data', 'future.unknown'],
    sourceGeneration: 2,
    declarationGeneration: 3,
  };
  const registration = {
    registrationHandle,
    project,
    registeredAtUnixMs: 1_800_000_000_000,
    updatedAtUnixMs: 1_800_000_000_100,
  };

  function binding(overrides: Partial<NimiElectronLocalDevelopmentBinding> = {}): NimiElectronLocalDevelopmentBinding {
    const ok = async (value: unknown) => ({ status: 'ok' as const, value });
    return {
      desktopRegisterLocalDevelopmentProject: async () => ok(registration),
      desktopListLocalDevelopmentRegistrations: async () => ok([registration]),
      desktopRemoveLocalDevelopmentRegistration: async () => ok({ removed: true }),
      desktopLaunchLocalDevelopmentHost: async () => ok({ processId: 4242, bindDeadlineUnixMs: Date.now() + 5_000 }),
      desktopLocalDevelopmentHostRunning: async () => ok({ running: true }),
      desktopTerminateLocalDevelopmentHost: async () => ok({ terminated: true }),
      desktopEndLocalDevelopmentRun: async () => ok({ ended: true }),
      ...overrides,
    };
  }

  it('carries private registration handles only through the main-process typed control', async () => {
    const register = vi.fn(binding().desktopRegisterLocalDevelopmentProject);
    const launch = vi.fn(binding().desktopLaunchLocalDevelopmentHost);
    const control = createNimiElectronLocalDevelopmentControlForBinding(binding({
      desktopRegisterLocalDevelopmentProject: register,
      desktopLaunchLocalDevelopmentHost: launch,
    }));
    const result = await control.register({
      expectedAppId: project.appId,
      projectRoot: project.canonicalProjectRoot,
      shell: 'electron',
      supervisorRunId,
    });
    expect(result.registrationHandle).toBe(registrationHandle);
    expect(result.project.appAccess).toEqual(['realm.data', 'future.unknown']);
    expect(register).toHaveBeenCalledWith({
      expectedAppId: project.appId,
      projectRoot: project.canonicalProjectRoot,
      shell: 'electron',
      supervisorRunId,
    });
    await expect(control.listRegistrations()).resolves.toHaveLength(1);
    await expect(control.launch({
      registrationHandle,
      supervisorRunId,
      shell: 'electron',
      hostExecutablePath: 'D:\\electron.exe',
      rendererOrigin: 'http://127.0.0.1:1468',
      hostArguments: ['D:\\main.js'],
      workingDirectory: project.canonicalProjectRoot,
    })).resolves.toMatchObject({ processId: 4242 });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ registrationHandle, supervisorRunId }));
  });

  it('rejects malformed native registration projections', async () => {
    const control = createNimiElectronLocalDevelopmentControlForBinding(binding({
      desktopListLocalDevelopmentRegistrations: async () => ({
        status: 'ok' as const,
        value: [{ ...registration, bearer: 'forbidden' }],
      }),
    }));
    await expect(control.listRegistrations()).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
  });

  it('removes registrations without returning deleted identity material', async () => {
    const remove = vi.fn(binding().desktopRemoveLocalDevelopmentRegistration);
    const control = createNimiElectronLocalDevelopmentControlForBinding(binding({
      desktopRemoveLocalDevelopmentRegistration: remove,
    }));
    await expect(control.removeRegistration(registrationHandle)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({ registrationHandle });
  });
});
