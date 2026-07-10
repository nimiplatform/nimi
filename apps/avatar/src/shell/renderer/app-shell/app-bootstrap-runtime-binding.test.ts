import { describe, expect, it } from 'vitest';
import type { NimiClient } from '@nimiplatform/sdk';

import {
  createAvatarAccountCaller,
  createAvatarBindingOnlyAccountCaller,
  createAvatarRuntimeMediatedRealm,
  resolveLaunchAgentIdentity,
} from './app-bootstrap-runtime-binding.js';
import { AccountCallerMode } from '@nimiplatform/sdk/runtime/wire-types';

describe('Avatar shared-auth caller posture', () => {
  it('keeps mediated Realm construction in the shared Avatar Runtime session entry', async () => {
    const calls: unknown[] = [];
    const realm = createAvatarRuntimeMediatedRealm({
      appId: 'nimi.avatar',
      runtime: {
        account: {
          invokeRealmUnary: async (request: unknown) => {
            calls.push(request);
            return { accepted: true, responseJson: '[]' };
          },
        },
      },
    } as unknown as NimiClient);
    await expect(realm.core.unary({
      methodId: 'WorldPublicController_listWorlds',
      body: { path: {}, query: {} },
    } as never)).resolves.toEqual([]);
    expect(calls).toEqual([
      expect.objectContaining({
        caller: createAvatarAccountCaller('nimi.avatar'),
        methodId: 'WorldPublicController_listWorlds',
      }),
    ]);
  });

  it('uses the same first-party identity that the trusted Electron host stamps', () => {
    expect(createAvatarAccountCaller('nimi.avatar')).toEqual({
      appId: 'nimi.avatar',
      appInstanceId: 'nimi.avatar.local-first-party',
      deviceId: 'nimi-avatar-local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    });
  });

  it('constructs binding-only identity without upgrading it to first-party', () => {
    expect(createAvatarBindingOnlyAccountCaller('nimi.avatar')).toEqual({
      appId: 'nimi.avatar',
      appInstanceId: 'nimi.avatar.binding-only',
      deviceId: 'desktop-avatar-host',
      mode: AccountCallerMode.DESKTOP_LAUNCHED_AVATAR,
      scopes: [],
    });
  });
});

describe('resolveLaunchAgentIdentity', () => {
  it('resolves explicit Runtime-owned local-agent launch identity', () => {
    expect(resolveLaunchAgentIdentity({
      agentId: 'local-agent:opaque-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    })).toEqual({
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    });
  });

  it('fails closed when launch identity omits explicit Runtime provenance', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'agent-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-1',
    })).toThrow(/requires explicit localAgentRef and runtimeSourceRef/u);
  });

  it('fails closed when launch owner does not match Runtime account projection', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'local-agent:opaque-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-2',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    })).toThrow(/ownerUserId does not match Runtime account projection/u);
  });

  it('fails closed when agentId is not the Runtime-owned localAgentRef', () => {
    expect(() => resolveLaunchAgentIdentity({
      agentId: 'agent-1',
      accountId: 'owner-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:opaque-1',
    })).toThrow(/agentId to equal localAgentRef/u);
  });
});
