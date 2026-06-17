import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '@nimiplatform/sdk/realm';
import { buildRuntimeLocalAgentRef, fromNimiRuntimeProtoStruct } from '@nimiplatform/sdk/runtime';

import { launchAgentConversationFromDisplay } from '../src/shell/renderer/features/chat/agent-conversation-launcher.js';
import {
  buildAgentConversationAnchorMetadata,
  ensureThreadAnchorBindingForTarget,
} from '../src/shell/renderer/features/chat/chat-agent-shell-host-actions-helpers.js';
import { toAgentFriendTargetsFromSocialSnapshot } from '../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import { openRealmAgentLocalChat } from '../src/shell/renderer/features/explore/realm-agent-friend-actions.js';
import { clearAgentConversationAnchorBinding } from '../src/shell/renderer/app-shell/providers/agent-conversation-anchor-binding-storage.js';
import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { realmSocialData } from '../src/shell/renderer/features/social/data/realm-social-data.js';
import { runLocalAgentProvisionCourierPass } from '../src/shell/renderer/infra/local-agent-courier/provision-courier.js';
import {
  buildAgentEffectiveCapabilityResolution,
  clearDesktopTestNimiClientSession,
  createDesktopTestNimiClientSession,
  createEmptyNimiAIConfig,
  createLocalTextProjection,
  createNimiConversationAISnapshot,
  streamChatAgentRuntimeAgentTurn,
} from './chat-agent-local-mode-test-utils.js';

const CBDB_REALM_AGENT_ID = 'cbdb-song-slice-real-20260614-agent-8af2c5ca8a';
const CBDB_VIEWER_ID = 'cbdb-chain-agent-chat-verifier-user';
const CBDB_LOCAL_AGENT_REF = `local-agent:${CBDB_VIEWER_ID}:${CBDB_REALM_AGENT_ID}`;
const CBDB_PROVISION_INTENT_ID = 'cbdb-chain-agent-chat-verifier-intent';
const CBDB_REVIEWED_COMMUNICATION_STYLE = 'Reviewed CBDB chain verifier: measured Song-literati register.';

test('CBDB Agent Chat anchor metadata carries Realm profile context without caller system prompt', () => {
  const metadata = buildAgentConversationAnchorMetadata({
    ownerUserId: CBDB_VIEWER_ID,
    realmAgentId: CBDB_REALM_AGENT_ID,
    localAgentRef: CBDB_LOCAL_AGENT_REF,
    displayName: 'CBDB Su Zhe',
    handle: 'su-zhe',
    avatarUrl: 'https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
    defaultVoiceReference: 'preset_voice_id:zh_narrator',
    speechSynthesis: {
      modelId: 'speech/qwen3tts',
      routePolicy: 'local',
    },
    avatarAutoplay: true,
    worldId: 'cbdb-song-slice-real-20260614-world',
    worldName: 'CBDB Song slice',
    bio: 'Reviewed sparse CBDB profile for Runtime prompt validation.',
    ownershipType: 'WORLD_OWNED',
    greeting: 'Ask what the record supports before imagining.',
    builtinDocsContext: null,
    ownerSettingsProjection: {
      agentRuleVersion: 4,
      selectedOwnerSettingFields: [
        'communication.contentStyle',
        'positioning.positioning',
      ],
      communicationStyle: 'measured Song-dynasty scholarly register',
    },
  });

  assert.deepEqual(metadata, {
    surface: 'desktop-agent-chat',
    realmProfileContext: {
      displayName: 'CBDB Su Zhe',
      handle: 'su-zhe',
      realmAgentId: CBDB_REALM_AGENT_ID,
      localAgentRef: CBDB_LOCAL_AGENT_REF,
      avatarUrl: 'https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
      defaultVoiceReference: 'preset_voice_id:zh_narrator',
      avatarAutoplay: true,
      speechModelId: 'speech/qwen3tts',
      speechRoutePolicy: 'local',
      worldId: 'cbdb-song-slice-real-20260614-world',
      worldName: 'CBDB Song slice',
      description: 'Reviewed sparse CBDB profile for Runtime prompt validation.',
      greeting: 'Ask what the record supports before imagining.',
      ownershipType: 'WORLD_OWNED',
      ownerScope: 'forge-imported-system',
      sourceProfile: 'cbdb-historical',
      agentRuleVersion: 4,
      communicationStyle: 'measured Song-dynasty scholarly register',
      selectedOwnerSettingFields: [
        'communication.contentStyle',
        'positioning.positioning',
      ],
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'systemPrompt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'system_prompt'), false);
  assert.equal(JSON.stringify(metadata).includes('agentRules'), false);
  assert.equal(JSON.stringify(metadata).includes('"rules"'), false);
  assert.equal(JSON.stringify(metadata).includes('statement'), false);
});

test('CBDB AgentFriend target parses reviewed owner settings projection from social snapshot', () => {
  const targets = toAgentFriendTargetsFromSocialSnapshot({
    ownerUserId: CBDB_VIEWER_ID,
    friends: [{
      id: CBDB_REALM_AGENT_ID,
      isAgent: true,
      displayName: 'CBDB Su Zhe',
      handle: 'su-zhe',
      avatarUrl: 'https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
      bio: 'Reviewed sparse CBDB profile for Runtime prompt validation.',
      agentProfile: {
        ownershipType: 'WORLD_OWNED',
        worldId: 'cbdb-song-slice-real-20260614-world',
        greeting: 'Ask what the record supports before imagining.',
        dna: {
          voice: {
            voiceId: 'zh_narrator',
            description: 'Reviewed Song literati narrator with measured cadence.',
            speechModelId: 'speech/qwen3tts',
            speechRoutePolicy: 'local',
          },
        },
        ownerSettingsProjection: {
          agentRuleVersion: 4,
          selectedOwnerSettingFields: [
            'communication.contentStyle',
            'communication.contentStyle',
            'boundaries.allowedThemes',
          ],
          communicationStyle: 'measured Song-dynasty scholarly register',
        },
        rules: {
          'behavioral:style:content': {
            statement: 'Do not carry raw rule statements into Desktop chat metadata.',
          },
        },
      },
    }],
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.localAgentRef, CBDB_LOCAL_AGENT_REF);
  assert.equal(targets[0]?.defaultVoiceReference, 'preset_voice_id:zh_narrator');
  assert.deepEqual(targets[0]?.speechSynthesis, {
    modelId: 'speech/qwen3tts',
    routePolicy: 'local',
  });
  assert.deepEqual(targets[0]?.presentationProfile, {
    backendKind: 'sprite2d',
    avatarAssetRef: 'profile_media_url:https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
    expressionProfileRef: null,
    idlePreset: 'cbdb.reviewed-portrait.static',
    interactionPolicyRef: 'cbdb.reviewed-portrait.readonly',
    defaultVoiceReference: 'preset_voice_id:zh_narrator',
  });
  assert.deepEqual(targets[0]?.ownerSettingsProjection, {
    agentRuleVersion: 4,
    selectedOwnerSettingFields: [
      'boundaries.allowedThemes',
      'communication.contentStyle',
    ],
    communicationStyle: 'measured Song-dynasty scholarly register',
  });
  const metadata = buildAgentConversationAnchorMetadata(targets[0]!);
  assert.equal(JSON.stringify(metadata).includes('Do not carry raw rule statements'), false);
  assert.equal(JSON.stringify(metadata).includes('"rules"'), false);
});

test('CBDB AgentFriend social snapshot opens Runtime anchor with reviewed owner settings metadata', async () => {
  clearDesktopTestNimiClientSession();
  clearAgentConversationAnchorBinding(CBDB_LOCAL_AGENT_REF);
  useAppStore.getState().setAuthSession({
    id: CBDB_VIEWER_ID,
    email: 'cbdb-chain-agent-chat-verifier@nimi.test',
  });

  const targets = toAgentFriendTargetsFromSocialSnapshot({
    ownerUserId: CBDB_VIEWER_ID,
    friends: [{
      id: CBDB_REALM_AGENT_ID,
      isAgent: true,
      displayName: 'CBDB Su Zhe',
      handle: 'su-zhe',
      avatarUrl: 'https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
      worldId: 'cbdb-song-slice-real-20260614-world',
      worldName: 'CBDB Song slice',
      bio: 'Reviewed sparse CBDB profile for Runtime prompt validation.',
      agentProfile: {
        ownershipType: 'WORLD_OWNED',
        greeting: 'Ask what the record supports before imagining.',
        dna: {
          voice: {
            voiceId: 'zh_narrator',
            description: 'Reviewed Song literati narrator with measured cadence.',
            speechModelId: 'speech/qwen3tts',
            speechRoutePolicy: 'local',
          },
        },
        ownerSettingsProjection: {
          agentRuleVersion: 1,
          selectedOwnerSettingFields: [
            'communication.contentStyle',
            'boundaries.allowedThemes',
          ],
          communicationStyle: CBDB_REVIEWED_COMMUNICATION_STYLE,
        },
        rules: {
          'behavioral:style:content': {
            statement: 'Do not leak raw Studio owner-setting statements into Runtime anchor metadata.',
          },
        },
      },
    }],
  });
  const target = targets[0];
  assert.ok(target);

  const initializeCalls: Array<Record<string, unknown>> = [];
  const openAnchorCalls: Array<Record<string, unknown>> = [];
  const presentationProfileCalls: Array<Record<string, unknown>> = [];
  const selectedThreads: unknown[] = [];
  const cacheWrites: Array<{ queryKey: unknown; value: unknown }> = [];

  createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.cbdb-agent-chat-anchor-open',
    runtime: {
      appId: 'nimi.desktop.test.cbdb-agent-chat-anchor-open',
      auth: {
        registerApp: async () => ({ accepted: true }),
      },
      account: {
        getAccountSessionStatus: async () => ({
          state: 3,
          accountProjection: { accountId: CBDB_VIEWER_ID },
        }),
        getAccessToken: async () => ({
          accepted: true,
          accessToken: 'desktop-test-account-access-token',
        }),
        refreshAccountSession: async () => ({ accepted: true }),
      },
      appAuth: {
        authorizeExternalPrincipal: async () => ({
          tokenId: 'desktop-test-token',
          secret: 'desktop-test-secret',
        }),
      },
      grants: {
        authorizeExternalPrincipal: async () => ({
          tokenId: 'desktop-test-token',
          secret: 'desktop-test-secret',
        }),
      },
      agents: {
        getAgent: async () => ({ agent: null }),
        initializeAgent: async (request: Record<string, unknown>) => {
          initializeCalls.push(request);
          return {
            agent: {
              agentId: request.localAgentRef,
              localAgentRef: request.localAgentRef,
              ownerUserId: request.ownerUserId,
              realmAgentId: request.realmAgentId,
              displayName: request.displayName,
              lifecycleStatus: 2,
            },
          };
        },
        openConversationAnchor: async (request: Record<string, unknown>) => {
          openAnchorCalls.push(request);
          return {
            snapshot: {
              anchor: {
                conversationAnchorId: 'cbdb-anchor-reviewed-settings-1',
                agentId: CBDB_LOCAL_AGENT_REF,
                subjectUserId: CBDB_VIEWER_ID,
                status: 1,
                lastTurnId: '',
                lastMessageId: '',
                localAgentRef: CBDB_LOCAL_AGENT_REF,
                ownerUserId: CBDB_VIEWER_ID,
                realmAgentId: CBDB_REALM_AGENT_ID,
              },
              activeTurnId: '',
              activeStreamId: '',
            },
          };
        },
        getConversationAnchorSnapshot: async () => {
          throw new Error('unexpected existing anchor lookup');
        },
        setAgentPresentationProfile: async (request: Record<string, unknown>) => {
          presentationProfileCalls.push(request);
          return {};
        },
      },
    },
  });

  try {
    const result = await ensureThreadAnchorBindingForTarget({
      input: {
        currentComposerTextRef: { current: 'draft should be cleared after thread creation' },
        queryClient: {
          setQueryData: (queryKey: unknown, value: unknown) => {
            cacheWrites.push({ queryKey, value });
          },
        },
        syncSelectionToThread: (thread: unknown) => {
          selectedThreads.push(thread);
        },
      } as Parameters<typeof ensureThreadAnchorBindingForTarget>[0]['input'],
      target,
      thread: null,
    });

    assert.equal(result.anchorBinding.conversationAnchorId, 'cbdb-anchor-reviewed-settings-1');
    assert.equal(result.anchorBinding.localAgentRef, CBDB_LOCAL_AGENT_REF);
    assert.equal(result.thread.localAgentRef, CBDB_LOCAL_AGENT_REF);
    assert.equal(cacheWrites.length, 1);
    assert.equal(selectedThreads.length, 1);
    assert.equal(initializeCalls.length, 1);
    assert.equal(presentationProfileCalls.length, 1);
    assert.equal(presentationProfileCalls[0]?.agentId, CBDB_LOCAL_AGENT_REF);
    assert.deepEqual(presentationProfileCalls[0]?.mutation, {
      oneofKind: 'profile',
      profile: {
        backendKind: 3,
        avatarAssetRef: 'profile_media_url:https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
        expressionProfileRef: '',
        idlePreset: 'cbdb.reviewed-portrait.static',
        interactionPolicyRef: 'cbdb.reviewed-portrait.readonly',
        defaultVoiceReference: 'preset_voice_id:zh_narrator',
      },
    });
    assert.deepEqual(initializeCalls.map((request) => ({
      localAgentRef: request.localAgentRef,
      ownerUserId: request.ownerUserId,
      realmAgentId: request.realmAgentId,
      displayName: request.displayName,
      worldId: request.worldId,
    })), [{
      localAgentRef: CBDB_LOCAL_AGENT_REF,
      ownerUserId: CBDB_VIEWER_ID,
      realmAgentId: CBDB_REALM_AGENT_ID,
      displayName: 'CBDB Su Zhe',
      worldId: 'cbdb-song-slice-real-20260614-world',
    }]);
    assert.equal(openAnchorCalls.length, 1);
    assert.equal(openAnchorCalls[0]?.localAgentRef, CBDB_LOCAL_AGENT_REF);
    assert.equal(openAnchorCalls[0]?.ownerUserId, CBDB_VIEWER_ID);
    assert.equal(openAnchorCalls[0]?.realmAgentId, CBDB_REALM_AGENT_ID);

    const metadata = fromNimiRuntimeProtoStruct(
      openAnchorCalls[0]?.metadata as Parameters<typeof fromNimiRuntimeProtoStruct>[0],
    );
    assert.deepEqual(metadata, {
      surface: 'desktop-agent-chat',
      realmProfileContext: {
        displayName: 'CBDB Su Zhe',
        handle: 'su-zhe',
        realmAgentId: CBDB_REALM_AGENT_ID,
        localAgentRef: CBDB_LOCAL_AGENT_REF,
        avatarUrl: 'https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
        defaultVoiceReference: 'preset_voice_id:zh_narrator',
        speechModelId: 'speech/qwen3tts',
        speechRoutePolicy: 'local',
        worldId: 'cbdb-song-slice-real-20260614-world',
        worldName: 'CBDB Song slice',
        description: 'Reviewed sparse CBDB profile for Runtime prompt validation.',
        greeting: 'Ask what the record supports before imagining.',
        ownershipType: 'WORLD_OWNED',
        ownerScope: 'forge-imported-system',
        sourceProfile: 'cbdb-historical',
        agentRuleVersion: 1,
        communicationStyle: CBDB_REVIEWED_COMMUNICATION_STYLE,
        selectedOwnerSettingFields: [
          'boundaries.allowedThemes',
          'communication.contentStyle',
        ],
      },
    });
    const serializedMetadata = JSON.stringify(metadata);
    assert.equal(serializedMetadata.includes('Do not leak raw Studio owner-setting statements'), false);
    assert.equal(serializedMetadata.includes('"rules"'), false);
    assert.equal(serializedMetadata.includes('agentRules'), false);
    assert.equal(serializedMetadata.includes('systemPrompt'), false);
    assert.equal(serializedMetadata.includes('system_prompt'), false);
  } finally {
    clearAgentConversationAnchorBinding(CBDB_LOCAL_AGENT_REF);
    clearDesktopTestNimiClientSession();
    useAppStore.getState().clearAuthSession();
  }
});

test('CBDB Agent Detail Open Agent Chat uses AgentFriend social snapshot target', async () => {
  clearDesktopTestNimiClientSession();
  useAppStore.getState().setAuthSession({
    id: CBDB_VIEWER_ID,
    email: 'cbdb-chain-agent-chat-verifier@nimi.test',
  });

  const originalLoadSocialSnapshot = realmSocialData.loadSocialSnapshot;
  const initializeCalls: Array<Record<string, unknown>> = [];
  const presentationProfileCalls: Array<Record<string, unknown>> = [];
  const selectedTargets: Array<{ source: string; targetId: string | null }> = [];
  const selections: Array<{ localAgentRef: string | null; targetId: string | null }> = [];
  const chatModes: string[] = [];
  const activeTabs: string[] = [];

  realmSocialData.loadSocialSnapshot = async () => ({
    friends: [{
      id: CBDB_REALM_AGENT_ID,
      isAgent: true,
      displayName: 'CBDB Su Zhe',
      handle: 'su-zhe',
      avatarUrl: 'https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
      worldId: 'cbdb-song-slice-real-20260614-world',
      worldName: 'CBDB Song slice',
      bio: 'Reviewed sparse CBDB profile for Runtime prompt validation.',
      agentProfile: {
        ownershipType: 'WORLD_OWNED',
        greeting: 'Ask what the record supports before imagining.',
        dna: {
          voice: {
            voiceId: 'zh_narrator',
            description: 'Reviewed Song literati narrator with measured cadence.',
            speechModelId: 'speech/qwen3tts',
            speechRoutePolicy: 'local',
          },
        },
        ownerSettingsProjection: {
          agentRuleVersion: 1,
          selectedOwnerSettingFields: [
            'communication.contentStyle',
            'boundaries.allowedThemes',
          ],
          communicationStyle: CBDB_REVIEWED_COMMUNICATION_STYLE,
        },
      },
    }],
    agents: [],
    groups: [],
    pendingReceived: [],
    pendingSent: [],
    blocked: [],
  });

  createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.cbdb-agent-detail-open-chat',
    runtime: {
      appId: 'nimi.desktop.test.cbdb-agent-detail-open-chat',
      auth: {
        registerApp: async () => ({ accepted: true }),
      },
      account: {
        getAccountSessionStatus: async () => ({
          state: 3,
          accountProjection: { accountId: CBDB_VIEWER_ID },
        }),
        getAccessToken: async () => ({
          accepted: true,
          accessToken: 'desktop-test-account-access-token',
        }),
        refreshAccountSession: async () => ({ accepted: true }),
      },
      appAuth: {
        authorizeExternalPrincipal: async () => ({
          tokenId: 'desktop-test-token',
          secret: 'desktop-test-secret',
        }),
      },
      grants: {
        authorizeExternalPrincipal: async () => ({
          tokenId: 'desktop-test-token',
          secret: 'desktop-test-secret',
        }),
      },
      agents: {
        getAgent: async () => ({ agent: null }),
        initializeAgent: async (request: Record<string, unknown>) => {
          initializeCalls.push(request);
          return {
            agent: {
              agentId: request.localAgentRef,
              localAgentRef: request.localAgentRef,
              ownerUserId: request.ownerUserId,
              realmAgentId: request.realmAgentId,
              displayName: request.displayName,
              lifecycleStatus: 2,
            },
          };
        },
        setAgentPresentationProfile: async (request: Record<string, unknown>) => {
          presentationProfileCalls.push(request);
          return {};
        },
      },
    },
  });

  try {
    await openRealmAgentLocalChat(
      {
        realmAgentId: CBDB_REALM_AGENT_ID,
        displayName: 'Minimal detail display name',
        handle: 'minimal-detail-handle',
        avatarUrl: null,
        worldId: null,
        worldName: null,
        bio: null,
      },
      {
        setActiveTab: (tab) => {
          activeTabs.push(tab);
        },
        setChatMode: (mode) => {
          chatModes.push(mode);
        },
        setSelectedTargetForSource: (source, targetId) => {
          selectedTargets.push({ source, targetId });
        },
        setAgentConversationSelection: (selection) => {
          selections.push(selection);
        },
      },
    );

    assert.deepEqual(selectedTargets, [{ source: 'agent', targetId: CBDB_LOCAL_AGENT_REF }]);
    assert.deepEqual(selections, [{ localAgentRef: CBDB_LOCAL_AGENT_REF, targetId: CBDB_LOCAL_AGENT_REF }]);
    assert.deepEqual(chatModes, ['agent']);
    assert.deepEqual(activeTabs, ['chat']);
    assert.equal(initializeCalls.length, 1);
    assert.deepEqual(initializeCalls.map((request) => ({
      localAgentRef: request.localAgentRef,
      ownerUserId: request.ownerUserId,
      realmAgentId: request.realmAgentId,
      displayName: request.displayName,
      worldId: request.worldId,
    })), [{
      localAgentRef: CBDB_LOCAL_AGENT_REF,
      ownerUserId: CBDB_VIEWER_ID,
      realmAgentId: CBDB_REALM_AGENT_ID,
      displayName: 'CBDB Su Zhe',
      worldId: 'cbdb-song-slice-real-20260614-world',
    }]);
    assert.equal(presentationProfileCalls.length, 1);
    assert.deepEqual(presentationProfileCalls[0]?.mutation, {
      oneofKind: 'profile',
      profile: {
        backendKind: 3,
        avatarAssetRef: 'profile_media_url:https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png',
        expressionProfileRef: '',
        idlePreset: 'cbdb.reviewed-portrait.static',
        interactionPolicyRef: 'cbdb.reviewed-portrait.readonly',
        defaultVoiceReference: 'preset_voice_id:zh_narrator',
      },
    });
  } finally {
    realmSocialData.loadSocialSnapshot = originalLoadSocialSnapshot;
    clearDesktopTestNimiClientSession();
    useAppStore.getState().clearAuthSession();
  }
});

test('CBDB seeded RealmAgent enters Agent Chat only through the AgentFriend LocalAgentRef', async () => {
  const localAgentRef = buildRuntimeLocalAgentRef({
    ownerUserId: CBDB_VIEWER_ID,
    realmAgentId: CBDB_REALM_AGENT_ID,
  });
  const selectedTargets: Array<{ source: string; targetId: string | null }> = [];
  const selections: Array<{ localAgentRef: string | null; targetId: string | null }> = [];
  const chatModes: string[] = [];
  const activeTabs: string[] = [];

  const result = await launchAgentConversationFromDisplay({
    target: {
      ownerUserId: CBDB_VIEWER_ID,
      realmAgentId: CBDB_REALM_AGENT_ID,
      localAgentRef,
      displayName: '蘇轍',
      handle: 'su-zhe',
      avatarUrl: null,
      worldId: 'cbdb-song-slice-real-20260614-world',
      worldName: 'CBDB Song slice',
      bio: null,
      ownershipType: 'WORLD_OWNED',
      greeting: null,
      builtinDocsContext: null,
    },
    setSelectedTargetForSource: (source, targetId) => {
      selectedTargets.push({ source, targetId });
    },
    setAgentConversationSelection: (selection) => {
      selections.push(selection);
    },
    setChatMode: (mode) => {
      chatModes.push(mode);
    },
    setActiveTab: (tab) => {
      activeTabs.push(tab);
    },
  });

  assert.equal(localAgentRef, CBDB_LOCAL_AGENT_REF);
  assert.deepEqual(result, {
    interaction: 'chat',
    routedSurface: 'agent-conversation',
  });
  assert.deepEqual(selectedTargets, [{ source: 'agent', targetId: localAgentRef }]);
  assert.deepEqual(selections, [{ localAgentRef, targetId: localAgentRef }]);
  assert.deepEqual(chatModes, ['agent']);
  assert.deepEqual(activeTabs, ['chat']);
});

test('CBDB seeded RealmAgent without LocalAgentRef does not open Agent Chat', async () => {
  let stateMutationCount = 0;

  await assert.rejects(
    () => launchAgentConversationFromDisplay({
      target: {
        ownerUserId: CBDB_VIEWER_ID,
        realmAgentId: CBDB_REALM_AGENT_ID,
        localAgentRef: '',
        displayName: '蘇轍',
        handle: 'su-zhe',
        avatarUrl: null,
        worldId: 'cbdb-song-slice-real-20260614-world',
        worldName: 'CBDB Song slice',
        bio: null,
        ownershipType: 'WORLD_OWNED',
        greeting: null,
        builtinDocsContext: null,
      },
      setSelectedTargetForSource: () => {
        stateMutationCount += 1;
      },
      setAgentConversationSelection: () => {
        stateMutationCount += 1;
      },
      setChatMode: () => {
        stateMutationCount += 1;
      },
      setActiveTab: () => {
        stateMutationCount += 1;
      },
    }),
    /Agent conversation launch requires localAgentRef/,
  );

  assert.equal(stateMutationCount, 0);
});

test('CBDB AgentFriend provision intent is consumed before the same LocalAgentRef runs an Agent Chat turn', async () => {
  clearDesktopTestNimiClientSession();
  const initializeCalls: Array<Record<string, unknown>> = [];
  const turnRequests: Array<{
    ownerUserId: string;
    realmAgentId: string;
    localAgentRef: string;
    conversationAnchorId: string;
    threadId?: string;
    requestId?: string;
  }> = [];
  const ackCalls: Array<{ intentId: string; outcome: string }> = [];
  let openProvisionIntent = true;

  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.cbdb-agent-chat-runtime-chain',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  (client as unknown as { runtime: unknown }).runtime = {
    agent: {
      turns: {
        subscribe: async () => ({
          async *[Symbol.asyncIterator]() {
            while (!turnRequests[0]?.requestId) {
              await Promise.resolve();
            }
            const requestId = turnRequests[0]?.requestId || '';
            yield {
              eventName: 'runtime.agent.turn.accepted' as const,
              localAgentRef: CBDB_LOCAL_AGENT_REF,
              conversationAnchorId: 'cbdb-anchor-1',
              turnId: 'cbdb-turn-1',
              streamId: 'cbdb-stream-1',
              detail: { requestId },
            };
            yield {
              eventName: 'runtime.agent.turn.structured' as const,
              localAgentRef: CBDB_LOCAL_AGENT_REF,
              conversationAnchorId: 'cbdb-anchor-1',
              turnId: 'cbdb-turn-1',
              streamId: 'cbdb-stream-1',
              detail: {
                kind: 'agent_resolved_message_action_envelope',
                payload: {
                  message: {
                    message_id: 'cbdb-assistant-1',
                    text: 'CBDB validation turn complete.',
                  },
                  actions: [],
                },
              },
            };
            yield {
              eventName: 'runtime.agent.turn.message_committed' as const,
              localAgentRef: CBDB_LOCAL_AGENT_REF,
              conversationAnchorId: 'cbdb-anchor-1',
              turnId: 'cbdb-turn-1',
              streamId: 'cbdb-stream-1',
              messageId: 'cbdb-assistant-1',
              detail: {
                messageId: 'cbdb-assistant-1',
                text: 'CBDB validation turn complete.',
              },
            };
            yield {
              eventName: 'runtime.agent.turn.completed' as const,
              localAgentRef: CBDB_LOCAL_AGENT_REF,
              conversationAnchorId: 'cbdb-anchor-1',
              turnId: 'cbdb-turn-1',
              streamId: 'cbdb-stream-1',
              detail: {
                terminalReason: 'stop',
              },
            };
          },
        }),
        request: async (request: {
          ownerUserId: string;
          realmAgentId: string;
          localAgentRef: string;
          conversationAnchorId: string;
          threadId?: string;
          requestId?: string;
        }) => {
          turnRequests.push(request);
          return { messageId: 'cbdb-runtime-request-message-1' };
        },
        interrupt: async () => undefined,
      },
    },
  };

  const runtimeWithTurns = (client as unknown as { runtime: Record<string, unknown> }).runtime;
  (client as unknown as { runtime: unknown }).runtime = {
    ...runtimeWithTurns,
    agents: {
      ...(runtimeWithTurns.agents as Record<string, unknown>),
      initializeAgent: async (request: Record<string, unknown>) => {
        initializeCalls.push(request);
        return {
          agent: {
            agentId: request.localAgentRef,
            localAgentRef: request.localAgentRef,
            ownerUserId: request.ownerUserId,
            realmAgentId: request.realmAgentId,
            displayName: request.displayName,
            lifecycleStatus: 2,
          },
        };
      },
      getAgent: async () => ({ agent: null }),
      terminateAgent: async () => ({ agent: null }),
    },
  };

  const callApi: Parameters<typeof runLocalAgentProvisionCourierPass>[0]['callApi'] =
    async <T>(task: (realm: Realm) => Promise<T>): Promise<T> => {
      const realm = {
        localAgentIntents: {
          listMyLocalAgentProvisionIntents: async () => ({
            items: openProvisionIntent
              ? [{
                id: CBDB_PROVISION_INTENT_ID,
                ownerUserId: CBDB_VIEWER_ID,
                realmAgentId: CBDB_REALM_AGENT_ID,
                localAgentRef: CBDB_LOCAL_AGENT_REF,
                status: 'OPEN',
                attempts: 0,
                availableAt: '2026-06-15T00:00:00.000Z',
                createdAt: '2026-06-15T00:00:00.000Z',
                ackedAt: null,
              }]
              : [],
          }),
          ackMyLocalAgentProvisionIntent: async (
            request: { path?: { intentId?: string }; body?: { outcome?: string } },
          ) => {
            const intentId = String(request.path?.intentId || '');
            const outcome = String(request.body?.outcome || '');
            ackCalls.push({ intentId, outcome });
            if (outcome === 'established') {
              openProvisionIntent = false;
            }
            return {
              id: intentId,
              status: outcome === 'established' ? 'ACKED' : 'OPEN',
            };
          },
        },
      } as unknown as Realm;
      return task(realm);
    };

  try {
    const courierResult = await runLocalAgentProvisionCourierPass({
      callApi,
      emitCourierError: () => {},
      getCurrentUser: () => ({ id: CBDB_VIEWER_ID }),
    });

    assert.deepEqual(courierResult, {
      pulled: 1,
      established: 1,
      substrateFailed: 0,
      deferred: 0,
    });
    assert.deepEqual(ackCalls, [{
      intentId: CBDB_PROVISION_INTENT_ID,
      outcome: 'established',
    }]);
    assert.equal(openProvisionIntent, false);
    assert.equal(initializeCalls.length, 1);
    assert.equal(initializeCalls[0]?.localAgentRef, CBDB_LOCAL_AGENT_REF);
    assert.equal(initializeCalls[0]?.ownerUserId, CBDB_VIEWER_ID);
    assert.equal(initializeCalls[0]?.realmAgentId, CBDB_REALM_AGENT_ID);
    assert.equal(initializeCalls[0]?.displayName, CBDB_REALM_AGENT_ID);
    assert.deepEqual(initializeCalls[0]?.context, {
      appId: 'nimi.desktop.test.cbdb-agent-chat-runtime-chain',
      subjectUserId: CBDB_VIEWER_ID,
      ownerUserId: CBDB_VIEWER_ID,
      realmAgentId: CBDB_REALM_AGENT_ID,
      localAgentRef: CBDB_LOCAL_AGENT_REF,
    });

    const projection = createLocalTextProjection();
    const agentResolution = buildAgentEffectiveCapabilityResolution({
      textProjection: projection,
    });
    const executionSnapshot = createNimiConversationAISnapshot({
      config: createEmptyNimiAIConfig(),
      capability: 'text.generate',
      projection,
      agentResolution,
    });
    const result = await streamChatAgentRuntimeAgentTurn({
      ownerUserId: CBDB_VIEWER_ID,
      realmAgentId: CBDB_REALM_AGENT_ID,
      localAgentRef: CBDB_LOCAL_AGENT_REF,
      conversationAnchorId: 'cbdb-anchor-1',
      threadId: 'cbdb-thread-1',
      userMessageId: 'cbdb-user-message-1',
      userText: 'validate cbdb agent chat',
      reasoningPreference: 'off',
      textExecutionSnapshot: executionSnapshot,
      imageExecutionSnapshot: null,
      imageParams: null,
      signal: new AbortController().signal,
    });
    const parts: Array<{ type: string; outputText?: string }> = [];
    for await (const part of result.stream) {
      parts.push(part as { type: string; outputText?: string });
    }

    assert.deepEqual(turnRequests.map((request) => ({
      ownerUserId: request.ownerUserId,
      realmAgentId: request.realmAgentId,
      localAgentRef: request.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
    })), [{
      ownerUserId: CBDB_VIEWER_ID,
      realmAgentId: CBDB_REALM_AGENT_ID,
      localAgentRef: CBDB_LOCAL_AGENT_REF,
      conversationAnchorId: 'cbdb-anchor-1',
      threadId: 'cbdb-thread-1',
    }]);
    assert.deepEqual(parts.map((part) => part.type), ['message-sealed', 'turn-completed']);
    assert.equal(parts[1]?.outputText, 'CBDB validation turn complete.');
  } finally {
    clearDesktopTestNimiClientSession();
  }
});
