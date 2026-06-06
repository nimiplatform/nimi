import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRealmMasterAgent,
  loadNimiRealmAgentDetails,
  loadNimiRealmCreatorAgents,
  type NimiRealmAgentProfileApi,
} from './index';
import { ReasonCode } from '../types';

test('Realm agent profile helper loads by id and enriches world projection', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm = {
    agents: {
      async getAgent(request) {
        calls.push({ method: 'getAgent', request });
        return { id: 'agent-1', isAgent: true, worldId: 'world-1' };
      },
      async getAgentByHandle(request) {
        calls.push({ method: 'getAgentByHandle', request });
        return { id: 'agent-by-handle', isAgent: true };
      },
      async creatorControllerCreateAgent(request) {
        calls.push({ method: 'creatorControllerCreateAgent', request });
        return { id: 'creator-agent-1', handle: request.body.handle };
      },
      async creatorControllerListAgents(request) {
        calls.push({ method: 'creatorControllerListAgents', request });
        return [{ id: 'creator-agent-1', isAgent: true }];
      },
    },
    world: {
      async worldControllerGetWorld(request) {
        calls.push({ method: 'worldControllerGetWorld', request });
        return { id: 'world-1', name: 'World', bannerUrl: 'https://media.nimi.test/world.png' };
      },
    },
  } as unknown as NimiRealmAgentProfileApi;

  const detail = await loadNimiRealmAgentDetails(realm, 'agent-1');
  assert.equal(detail.id, 'agent-1');
  assert.equal(detail.worldName, 'World');
  assert.equal(detail.worldBannerUrl, 'https://media.nimi.test/world.png');

  const created = await createNimiRealmMasterAgent(realm, {
    worldId: ' world-1 ',
    handle: ' creator ',
    concept: ' concept ',
  });
  assert.equal(created.id, 'creator-agent-1');
  assert.equal((await loadNimiRealmCreatorAgents(realm))[0]?.id, 'creator-agent-1');

  assert.deepEqual(calls.map((call) => call.method), [
    'getAgent',
    'worldControllerGetWorld',
    'creatorControllerCreateAgent',
    'creatorControllerListAgents',
  ]);
  assert.deepEqual(calls[0]?.request, { path: { id: 'agent-1' } });
  assert.deepEqual(calls[1]?.request, { path: { id: 'world-1' } });
  assert.deepEqual(calls[2]?.request, {
    path: {},
    body: {
      handle: 'creator',
      concept: 'concept',
      worldId: 'world-1',
      ownershipType: 'MASTER_OWNED',
    },
  });
});

test('Realm agent profile helper falls back to handle after not-found id', async () => {
  const calls: string[] = [];
  const notFound = Object.assign(new Error('missing'), { reasonCode: ReasonCode.REALM_NOT_FOUND });
  const realm = {
    agents: {
      async getAgent() {
        calls.push('getAgent');
        throw notFound;
      },
      async getAgentByHandle(request) {
        calls.push(`getAgentByHandle:${request.path.handle}`);
        return { id: 'agent-by-handle', handle: request.path.handle, isAgent: true };
      },
      async creatorControllerCreateAgent() {
        return { id: 'created' };
      },
      async creatorControllerListAgents() {
        return [];
      },
    },
    world: {
      async worldControllerGetWorld() {
        return {};
      },
    },
  } as unknown as NimiRealmAgentProfileApi;

  const detail = await loadNimiRealmAgentDetails(realm, 'guide');
  assert.equal(detail.id, 'agent-by-handle');
  assert.deepEqual(calls, ['getAgent', 'getAgentByHandle:guide']);
});

test('Realm agent profile helper fails closed on invalid identifiers', async () => {
  const realm = {
    agents: {
      async getAgent() { return {}; },
      async getAgentByHandle() { return {}; },
      async creatorControllerCreateAgent() { return {}; },
      async creatorControllerListAgents() { return []; },
    },
    world: {
      async worldControllerGetWorld() { return {}; },
    },
  } as unknown as NimiRealmAgentProfileApi;

  await assert.rejects(
    () => loadNimiRealmAgentDetails(realm, ''),
    (error: unknown) => (error as { code?: string }).code === 'AGENT_ID_REQUIRED',
  );
  await assert.rejects(
    () => loadNimiRealmAgentDetails(realm, '@guide'),
    (error: unknown) => (error as { code?: string }).code === 'HANDLE_PREFIX_UNSUPPORTED',
  );
  await assert.rejects(
    () => loadNimiRealmAgentDetails(realm, 'not-agent'),
    (error: unknown) => (error as { code?: string }).code === 'AGENT_PROFILE_NOT_FOUND',
  );
});
