import { describe, expect, it, vi } from 'vitest';

import {
  createNimiElectronDesktopAccountHostForBinding,
  isElectronDesktopAccountCommand,
  type NimiElectronDesktopAccountBinding,
} from '../src/main/desktop-account-host.js';
import {
  createNimiElectronDeveloperModeHostForBinding,
  isElectronDeveloperModeCommand,
} from '../src/main/developer-mode-host.js';
import {
  createNimiElectronLocalAppGrantHostForBinding,
  isElectronLocalAppGrantCommand,
  type NimiElectronLocalAppGrantBinding,
} from '../src/main/local-app-grant-host.js';
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
    desktopAccountBeginLogin: ok,
    desktopAccountCompleteLogin: ok,
    desktopAccountInvokeRealmUnary: ok,
    desktopAccountLogout: ok,
    desktopAccountSwitchAccount: ok,
    ...overrides,
  };
}

describe('Electron protected Desktop account host', () => {
  it('pins the six renderer-safe account commands and forwards only nested DTOs', async () => {
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

    for (const command of [
      'runtime_account_session_status',
      'runtime_account_begin_login',
      'runtime_account_complete_login',
      'runtime_account_invoke_realm_unary',
      'runtime_account_logout',
      'runtime_account_switch_account',
    ]) {
      expect(isElectronDesktopAccountCommand(command)).toBe(true);
    }
    expect(isElectronDesktopAccountCommand('runtime_bridge_unary')).toBe(false);
    expect(isElectronDesktopAccountCommand('runtime_account_issue_binding')).toBe(false);
  });

  it('preserves bounded Runtime denial reasons and rejects malformed native outcomes', async () => {
    const denied = createNimiElectronDesktopAccountHostForBinding(accountBinding({
      desktopAccountSessionStatus: async () => ({
        status: 'error' as const,
        reasonCode: 'PRINCIPAL_UNAUTHORIZED',
        retryable: false,
      }),
    }));
    await expect(denied.invoke('runtime_account_session_status', {})).rejects.toMatchObject({
      code: 'runtime-permission-denied',
      reasonCode: 'PRINCIPAL_UNAUTHORIZED',
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
        accountGeneration: 1,
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

describe('Electron local-app grant host', () => {
  const requestId = '11'.repeat(32);
  const presenceChallengeId = '22'.repeat(32);
  const pendingGrantId = '33'.repeat(32);
  const grantId = '44'.repeat(32);

  function binding(overrides: Partial<NimiElectronLocalAppGrantBinding> = {}): NimiElectronLocalAppGrantBinding {
    return {
      desktopPendingLocalAppGrant: async () => ({
        status: 'ok' as const,
        value: {
          requestId,
          presenceChallengeId,
          pendingGrantId,
          operationId: 'runtime_agent.conversation.open',
          resourceRef: 'agent:agent-a',
          expiresAtUnixMs: Date.now() + 60_000,
        },
      }),
      desktopDecideLocalAppGrant: async () => ({
        status: 'ok' as const,
        value: {
          state: 'granted',
          grantId,
          operationId: 'runtime_agent.conversation.open',
          resourceRef: 'agent:agent-a',
        },
      }),
      desktopRevokeLocalAppGrant: async () => ({
        status: 'ok' as const,
        value: {
          state: 'revoked',
          grantId,
          operationId: 'runtime_agent.conversation.open',
          resourceRef: 'agent:agent-a',
        },
      }),
      ...overrides,
    };
  }

  it('keeps Runtime request, presence, pending-grant and grant identifiers behind selectors', async () => {
    const decide = vi.fn(binding().desktopDecideLocalAppGrant);
    const revoke = vi.fn(binding().desktopRevokeLocalAppGrant);
    const host = createNimiElectronLocalAppGrantHostForBinding(binding({
      desktopDecideLocalAppGrant: decide,
      desktopRevokeLocalAppGrant: revoke,
    }));
    const pending = await host.invoke('local_app_grant_pending_list', {}) as Array<Record<string, unknown>>;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ state: 'pending', reasonCode: 'local-app-presence-required' });
    expect(JSON.stringify(pending)).not.toContain(requestId);
    expect(JSON.stringify(pending)).not.toContain(presenceChallengeId);
    expect(JSON.stringify(pending)).not.toContain(pendingGrantId);

    const selector = String(pending[0]?.selector);
    const granted = await host.invoke('local_app_grant_decide', { payload: { selector, approved: true } });
    expect(granted).toMatchObject({ state: 'granted', reasonCode: 'action-executed' });
    expect(JSON.stringify(granted)).not.toContain(grantId);
    expect(decide).toHaveBeenCalledWith({ requestId, presenceChallengeId, approved: true });

    const grants = await host.invoke('local_app_grant_list', {}) as Array<Record<string, unknown>>;
    const controlSelector = String(grants[0]?.selector);
    const revoked = await host.invoke('local_app_grant_revoke', { payload: { selector: controlSelector } });
    expect(revoked).toMatchObject({ state: 'revoked', reasonCode: 'local-app-grant-revoked' });
    expect(revoke).toHaveBeenCalledWith({ grantId });
    expect(await host.invoke('local_app_grant_list', {})).toEqual([]);
  });

  it('pins only the four grant commands and restores a pending selector after native denial', async () => {
    const host = createNimiElectronLocalAppGrantHostForBinding(binding({
      desktopDecideLocalAppGrant: async () => ({
        status: 'error' as const,
        reasonCode: 'LOCAL_APP_GRANT_REQUIRED',
        retryable: false,
      }),
    }));
    const pending = await host.invoke('local_app_grant_pending_list', {}) as Array<Record<string, unknown>>;
    const selector = String(pending[0]?.selector);
    await expect(host.invoke('local_app_grant_decide', { payload: { selector, approved: true } }))
      .rejects.toMatchObject({ reasonCode: 'LOCAL_APP_GRANT_REQUIRED' });
    expect(await host.invoke('local_app_grant_pending_list', {})).toHaveLength(1);
    for (const command of [
      'local_app_grant_pending_list',
      'local_app_grant_decide',
      'local_app_grant_list',
      'local_app_grant_revoke',
    ]) expect(isElectronLocalAppGrantCommand(command)).toBe(true);
    expect(isElectronLocalAppGrantCommand('local_app_permission_request')).toBe(false);
  });
});

describe('Electron local-development protected control', () => {
  const evaluationId = '55'.repeat(32);
  const authorizationId = '66'.repeat(32);
  const supervisorRunId = '77'.repeat(32);
  const capabilityFingerprint = '88'.repeat(32);
  const project = {
    appId: 'com.nimi.zhiyu.dev',
    displayName: 'Zhiyu Development',
    canonicalProjectRoot: 'D:\\nimi-realm\\nimi\\apps\\zhiyu',
    canonicalManifestPath: 'D:\\nimi-realm\\nimi\\apps\\zhiyu\\nimi.app.yaml',
    shell: 'electron',
    accountId: 'account-a',
    requestedCapabilities: ['runtime_agent.conversation.open'],
    capabilityFingerprint,
  };
  const authorization = {
    authorizationId,
    project,
    state: 'active',
    persistence: 'allow-remember-project',
    authorizationGeneration: 1,
    approvedAtUnixMs: 1_800_000_000_000,
    updatedAtUnixMs: 1_800_000_000_100,
  };

  function binding(overrides: Partial<NimiElectronLocalDevelopmentBinding> = {}): NimiElectronLocalDevelopmentBinding {
    const ok = async (value: unknown) => ({ status: 'ok' as const, value });
    return {
      desktopEvaluateLocalDevelopmentProject: async () => ok({
        evaluationId,
        project,
        state: 'confirmation-required',
        confirmationRequired: true,
        authorization: null,
        evaluationExpiresAtUnixMs: 1_800_000_030_000,
      }),
      desktopDecideLocalDevelopmentProject: async () => ok(authorization),
      desktopReactivateLocalDevelopmentProject: async () => ok(authorization),
      desktopListLocalDevelopmentAuthorizations: async () => ok([authorization]),
      desktopRevokeLocalDevelopmentAuthorization: async () => ok({ ...authorization, state: 'revoked' }),
      desktopLaunchLocalDevelopmentHost: async () => ok({ processId: 4242, bindDeadlineUnixMs: Date.now() + 5_000 }),
      desktopLocalDevelopmentHostRunning: async () => ok({ running: true }),
      desktopTerminateLocalDevelopmentHost: async () => ok({ terminated: true }),
      desktopEndLocalDevelopmentRun: async () => ok({ ended: true }),
      ...overrides,
    };
  }

  it('carries private Runtime identifiers only through the main-process typed control', async () => {
    const evaluate = vi.fn(binding().desktopEvaluateLocalDevelopmentProject);
    const launch = vi.fn(binding().desktopLaunchLocalDevelopmentHost);
    const control = createNimiElectronLocalDevelopmentControlForBinding(binding({
      desktopEvaluateLocalDevelopmentProject: evaluate,
      desktopLaunchLocalDevelopmentHost: launch,
    }));
    const result = await control.evaluate({
      expectedAppId: project.appId,
      projectRoot: project.canonicalProjectRoot,
      shell: 'electron',
      supervisorRunId,
    });
    expect(result.evaluationId).toBe(evaluationId);
    expect(result.project.capabilityFingerprint).toBe(capabilityFingerprint);
    expect(evaluate).toHaveBeenCalledWith({
      expectedAppId: project.appId,
      projectRoot: project.canonicalProjectRoot,
      shell: 'electron',
      supervisorRunId,
    });
    await expect(control.listAuthorizations()).resolves.toHaveLength(1);
    await expect(control.launch({
      authorizationId,
      supervisorRunId,
      shell: 'electron',
      hostExecutablePath: 'D:\\electron.exe',
      rendererOrigin: 'http://127.0.0.1:1468',
      hostArguments: ['D:\\main.js'],
      workingDirectory: project.canonicalProjectRoot,
    })).resolves.toMatchObject({ processId: 4242 });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ authorizationId, supervisorRunId }));
  });

  it('rejects malformed native projections before Desktop can create a selector', async () => {
    const control = createNimiElectronLocalDevelopmentControlForBinding(binding({
      desktopListLocalDevelopmentAuthorizations: async () => ({
        status: 'ok' as const,
        value: [{ ...authorization, bearer: 'forbidden' }],
      }),
    }));
    await expect(control.listAuthorizations()).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
  });
});
