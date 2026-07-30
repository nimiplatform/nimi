import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiDesktopPermissionOwnerRuntimeClient,
  NimiRuntimeAccountCaller,
} from '@nimiplatform/sdk/runtime';
import { LocalAppPermissionOwnerPosture } from '@nimiplatform/sdk/runtime/generated';
import {
  createDesktopLocalAppPermissionOwnerPort,
} from '../src/shell/renderer/features/apps/local-app-permission-owner.js';

const caller = { appId: 'nimi.desktop' } as NimiRuntimeAccountCaller;

function createRuntime(overrides: Partial<NimiDesktopPermissionOwnerRuntimeClient> = {}) {
  const calls: Array<{ name: string; input: unknown }> = [];
  const runtime = {
    async listLocalAppPermissionRequests(input: unknown) {
      calls.push({ name: 'list', input });
      return {
        accepted: true,
        reasonCode: 1,
        requests: [
          {
            localAppPrincipalId: 'principal-1',
            displayAppId: 'com.example.zhiyu',
            permissionId: 'agents.interact',
            reason: 'Continue this conversation with my Agent',
            ownerRevision: '7',
          },
          {
            localAppPrincipalId: 'principal-2',
            displayAppId: 'internal-row',
            permissionId: 'not-admitted',
            reason: 'hidden',
            ownerRevision: '1',
          },
        ],
      };
    },
    subscribeLocalAppPermissionRequests() {
      return (async function* () { /* focused unary test */ })();
    },
    async listLocalAppPermissionOwnerProjections(input: unknown) {
      calls.push({ name: 'list-projections', input });
      return {
        accepted: true,
        reasonCode: 1,
        permissions: [{
          localAppPrincipalId: 'principal-1',
          displayAppId: 'com.example.zhiyu',
          permissionId: 'agents.interact',
          posture: LocalAppPermissionOwnerPosture.GRANTED,
          coveredAgents: [{ localAgentId: 'agent-1', displayName: 'Mira' }],
          ownerRevision: '8',
        }],
      };
    },
    async getLocalAppPermissionOwnerProjection(input: { localAppPrincipalId: string }) {
      calls.push({ name: 'projection', input });
      return {
        accepted: true,
        reasonCode: 1,
        permissions: [{
          localAppPrincipalId: input.localAppPrincipalId,
          displayAppId: 'com.example.zhiyu',
          permissionId: 'agents.interact',
          posture: LocalAppPermissionOwnerPosture.REVOKED,
          coveredAgents: [],
          ownerRevision: '9',
        }],
      };
    },
    async decideLocalAppPermission(input: unknown) {
      calls.push({ name: 'decide', input });
      return { accepted: true, posture: 3, ownerRevision: '8', reasonCode: 1 };
    },
    async revokeLocalAppPermission(input: unknown) {
      calls.push({ name: 'revoke', input });
      return { accepted: true, posture: 4, ownerRevision: '9', reasonCode: 1 };
    },
    ...overrides,
  } as unknown as NimiDesktopPermissionOwnerRuntimeClient;
  return { runtime, calls };
}

test('owner binding filters the admitted intent and keeps Runtime authority fields out of presentation data', async () => {
  const { runtime } = createRuntime();
  const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });

  assert.deepEqual(await port.listPending(), [{
    requestKey: 'principal-1',
    displayAppId: 'com.example.zhiyu',
    permissionId: 'agents.interact',
    reason: 'Continue this conversation with my Agent',
    ownerRevision: '7',
  }]);
});

test('synthetic five-item inbox rows preserve each permission through independent decision plumbing', async () => {
  const permissionIds = [
    'agents.interact',
    'agents.configure',
    'memory.read',
    'agents.voice',
    'agents.delegate',
  ] as const;
  const { runtime, calls } = createRuntime({
    listLocalAppPermissionRequests: async () => ({
      accepted: true,
      reasonCode: 1,
      requests: permissionIds.map((permissionId) => ({
        localAppPrincipalId: 'principal-1',
        displayAppId: 'com.example.zhiyu',
        permissionId,
        reason: `Synthetic reason for ${permissionId}`,
        ownerRevision: '7',
      })),
    }),
    getLocalAppPermissionOwnerProjection: async () => ({
      accepted: true,
      reasonCode: 1,
      permissions: [{
        localAppPrincipalId: 'principal-1',
        displayAppId: 'com.example.zhiyu',
        permissionId: 'agents.configure',
        posture: LocalAppPermissionOwnerPosture.REVOKED,
        coveredAgents: [],
        ownerRevision: '8',
      }],
    }),
  });
  const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });

  assert.deepEqual((await port.listPending()).map((row) => row.permissionId), permissionIds);
  await port.approve({
    requestKey: 'principal-1',
    permissionId: 'agents.configure',
    expectedOwnerRevision: '7',
  });
  assert.deepEqual(calls.find((call) => call.name === 'decide')?.input, {
    caller,
    localAppPrincipalId: 'principal-1',
    permissionId: 'agents.configure',
    approved: true,
    expectedOwnerRevision: '7',
  });
});

test('approve grants the account Agent scope without an Agent selector', async () => {
  const { runtime, calls } = createRuntime();
  const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });

  const projection = await port.approve({
    requestKey: 'principal-1',
    permissionId: 'agents.interact',
    expectedOwnerRevision: '7',
  });

  assert.deepEqual(calls.map((call) => call.name), ['decide', 'projection']);
  assert.deepEqual(calls[0]?.input, {
    caller,
    localAppPrincipalId: 'principal-1',
    permissionId: 'agents.interact',
    approved: true,
    expectedOwnerRevision: '7',
  });
  assert.equal(projection.posture, 'revoked');
  assert.deepEqual(projection.coveredAgents, []);
});

test('owner binding lists durable app ownership with display-only Agent projections', async () => {
  const { runtime } = createRuntime();
  const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });

  assert.deepEqual(await port.listProjections(), [{
    requestKey: 'principal-1',
    displayAppId: 'com.example.zhiyu',
    permissionId: 'agents.interact',
    posture: 'granted',
    coveredAgents: [{ agentKey: 'agent-1', displayName: 'Mira' }],
    ownerRevision: '8',
  }]);
});

test('granted owner projection accepts an account scope with no current Agents', async () => {
  const { runtime } = createRuntime({
    listLocalAppPermissionOwnerProjections: async () => ({
      accepted: true,
      reasonCode: 1,
      permissions: [{
        localAppPrincipalId: 'principal-1',
        displayAppId: 'com.example.zhiyu',
        permissionId: 'agents.interact',
        posture: LocalAppPermissionOwnerPosture.GRANTED,
        coveredAgents: [],
        ownerRevision: '8',
      }],
    }),
  });
  const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });

  assert.deepEqual((await port.listProjections())[0]?.coveredAgents, []);
});

test('owner projection rejects malformed, duplicate, legacy, and non-granted Agent coverage', async () => {
  const base = {
    localAppPrincipalId: 'principal-1',
    displayAppId: 'com.example.zhiyu',
    permissionId: 'agents.interact',
    posture: LocalAppPermissionOwnerPosture.GRANTED,
    coveredAgents: [{ localAgentId: 'agent-1', displayName: 'Mira' }],
    ownerRevision: '8',
  };
  const invalid = [
    {
      ...base,
      posture: LocalAppPermissionOwnerPosture.REVOKED,
    },
    {
      ...base,
      coveredAgents: [
        ...base.coveredAgents,
        { localAgentId: 'agent-1', displayName: 'Other' },
      ],
    },
    {
      ...base,
      coveredAgents: [{ localAgentId: ' agent-1', displayName: 'Mira' }],
    },
    {
      ...base,
      coveredAgents: [{ localAgentId: 'agent-1', displayName: ' ' }],
    },
    {
      ...base,
      coveredAgents: [{
        localAgentId: 'agent-1',
        displayName: 'Mira',
        selectorHandle: 'legacy-selector',
      }],
    },
    {
      ...base,
      selectedAgents: [],
    },
  ];

  for (const permission of invalid) {
    const { runtime } = createRuntime({
      listLocalAppPermissionOwnerProjections: async () => ({
        accepted: true,
        reasonCode: 1,
        permissions: [permission],
      }),
    });
    const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });
    await assert.rejects(port.listProjections(), /Desktop permission/u);
  }
});

test('revoke removes the whole account Agent scope without an Agent selector', async () => {
  const { runtime, calls } = createRuntime();
  const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });

  const projection = await port.revoke({
    requestKey: 'principal-1',
    permissionId: 'agents.interact',
  });

  assert.deepEqual(calls.map((call) => call.name), ['revoke', 'projection']);
  assert.deepEqual(calls[0]?.input, {
    caller,
    localAppPrincipalId: 'principal-1',
    permissionId: 'agents.interact',
  });
  assert.equal(projection.posture, 'revoked');
  assert.deepEqual(projection.coveredAgents, []);
});

test('Runtime rejection remains a typed failure instead of pseudo-success', async () => {
  const { runtime } = createRuntime({
    listLocalAppPermissionRequests: async () => ({ accepted: false, requests: [], reasonCode: 8 }),
  });
  const port = createDesktopLocalAppPermissionOwnerPort({ runtime: () => runtime, caller: () => caller });

  await assert.rejects(port.listPending(), (error: unknown) => (
    error instanceof Error
    && error.message === 'Desktop permission management is unavailable.'
    && 'reasonCode' in error
  ));
});
