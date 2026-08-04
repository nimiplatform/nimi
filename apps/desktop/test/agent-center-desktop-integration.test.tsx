import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AgentCenterI18n,
  AgentCenterSharedAIConfigProjection,
} from '@nimiplatform/kit/features/agent-center';
import type { NimiRuntimeAgentAutonomySnapshot } from '@nimiplatform/sdk/runtime';
import { createDesktopAgentCenterAvatarPreviewAdapter } from '../src/shell/renderer/features/chat/chat-agent-center-avatar-preview-adapter.js';
import {
  createDesktopAgentCenterAutonomyAdapter,
  DesktopAgentAutonomyRevisionConflictError,
} from '../src/shell/renderer/features/chat/chat-agent-center-autonomy-adapter.js';
import type { DesktopRendererAvatarHandoffPort } from '../src/shell/renderer/renderer/avatar-handoff-port.js';
import { changeLocale, i18n, initI18n } from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

const appRoot = path.resolve(import.meta.dirname, '..');
type AgentCenterModule = typeof import('@nimiplatform/kit/features/agent-center');
let AgentCenter: AgentCenterModule['AgentCenter'];
let buildAgentCenterState: AgentCenterModule['buildAgentCenterState'];
let createFirstPartyAgentCenterSession: AgentCenterModule['createFirstPartyAgentCenterSession'];
const identity = {
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'runtime-source:1',
  localAgentRef: 'local-agent:1',
};

function handoff(overrides: Partial<DesktopRendererAvatarHandoffPort> = {}): DesktopRendererAvatarHandoffPort {
  return {
    available: () => true,
    list: async () => [],
    launch: async () => ({ opened: false }),
    close: async () => ({ opened: false }),
    ...overrides,
  };
}

function desktopAgentCenterI18n(): AgentCenterI18n {
  return {
    t: (key, values) => i18n.t(key, values) as string,
  };
}

function projectSharedAIConfigIntents(
  capabilities: AgentCenterSharedAIConfigProjection['aiConfig']['capabilities'],
): AgentCenterSharedAIConfigProjection['intents'] {
  return capabilities.map((intent) => {
    const route = intent.route.oneofKind;
    if (route !== 'local' && route !== 'cloud') {
      throw new Error(`Test AIConfig capability ${intent.capabilityContract} has no route.`);
    }
    return {
      capability: intent.capabilityContract,
      route,
      requiredFeatures: [...intent.requiredFeatures],
    };
  });
}

async function desktopAgentCenterSession() {
  // Agent Center reads the singular Runtime-owned AIConfig shared by every
  // LocalAgent; selected Agent identity remains outside configuration calls.
  let projection: AgentCenterSharedAIConfigProjection = {
    aiConfig: {
      owner: {
        owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
      },
      capabilities: [],
    },
    capabilities: [],
    intents: [],
  };
  const session = createFirstPartyAgentCenterSession({
    identity,
    sharedAIConfig: {
      async get() {
        return projection;
      },
      async overwrite(input) {
        const capabilities = [...input.capabilities];
        projection = {
          aiConfig: { ...projection.aiConfig, capabilities },
          capabilities: capabilities.map((intent) => intent.capabilityContract),
          intents: projectSharedAIConfigIntents(capabilities),
        };
        return projection;
      },
    },
  });
  await session.refresh();
  return session;
}

test.before(async () => {
  ({
    AgentCenter,
    buildAgentCenterState,
    createFirstPartyAgentCenterSession,
  } = await import('@nimiplatform/kit/features/agent-center'));
  await initI18n();
});

test('Desktop Agent Center drawer delegates snapshot refresh to the Kit store', async () => {
  const settingsSource = await readFile(path.join(
    appRoot,
    'src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
  ), 'utf8');
  const runtimeSource = await readFile(path.join(
    appRoot,
    'src/shell/renderer/features/chat/chat-agent-shell-adapter-runtime.ts',
  ), 'utf8');

  assert.doesNotMatch(settingsSource, /\.loadSnapshot\(/u);
  assert.doesNotMatch(settingsSource, /boundedContext|runtimeAgentAIConfigReadiness|runtimeAgentAIConfigError/u);
  assert.match(settingsSource, /session=\{input\.runtimeAgentCenterAdapter\}/u);
  assert.doesNotMatch(settingsSource, /runtimeLoadInput|AgentCenterStateInput|runtimeAdapter=/u);
  assert.match(runtimeSource, /createFirstPartyAgentCenterSession\(\{/u);
  assert.match(runtimeSource, /autonomy:\s*createDesktopAgentCenterAutonomyAdapter\(runtimeAgentInspect\)/u);
  assert.match(runtimeSource, /sharedAIConfig:\s*runtimeAgentCenterSharedAIConfig/u);
  assert.doesNotMatch(runtimeSource, /runtimeAgentAIConfigAdapter\.(?:readiness|aiProfile)/u);
  assert.doesNotMatch(settingsSource, /\.\.\.input\.runtimeAgentCenterAdapter|appearanceAdapter=/u);
});

test('Desktop Behavior binding enables only with autonomy revision and preserves typed stale conflicts', async () => {
  const revised: NimiRuntimeAgentAutonomySnapshot = {
    revision: '8',
    mode: 'medium',
    enabled: true,
    budgetExhausted: false,
    usedTokensInWindow: 12,
    dailyTokenBudget: 500,
    maxTokensPerHook: 50,
    windowStartedAt: '2026-07-29T00:00:00.000Z',
    suspendedUntil: null,
  };
  const autonomy = createDesktopAgentCenterAutonomyAdapter({
    getAutonomySnapshot: async () => revised,
    updateAutonomy: async (input) => ({
      outcome: 'conflict',
      conflict: {
        category: 'autonomy-revision-conflict',
        reasonCode: 'AGENT_AUTONOMY_REVISION_CONFLICT',
        expectedRevision: input.expectedRevision,
        actionHint: 'refresh_autonomy_snapshot',
        message: 'stale autonomy revision',
      },
    }),
  });

  const loaded = await autonomy.load(identity);
  const enabledState = buildAgentCenterState({ autonomy: loaded });
  assert.equal(enabledState.autonomyRevision, '8');
  assert.equal(enabledState.autonomy.controlsDisabled, false);

  await assert.rejects(
    autonomy.update(identity, {
      expectedRevision: '7',
      enabled: false,
      mode: 'off',
      dailyTokenBudget: 500,
      maxTokensPerHook: 50,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DesktopAgentAutonomyRevisionConflictError);
      assert.equal(error.category, 'autonomy-revision-conflict');
      assert.equal(error.reasonCode, 'AGENT_AUTONOMY_REVISION_CONFLICT');
      assert.equal(error.expectedRevision, '7');
      return true;
    },
  );

  const disabledState = buildAgentCenterState({ autonomy: { ...loaded, revision: null } });
  assert.equal(disabledState.autonomyRevision, null);
  assert.equal(disabledState.autonomy.controlsDisabled, true);
  assert.match(disabledState.autonomy.disabledReason || '', /revision unavailable/u);
});

test('Desktop Avatar preview carrier makes the strict ready projection reachable', async () => {
  const avatarAssetRef = 'live2d_0123456789ab';
  const previewMaterialRef = `agent-center-avatar-asset:account:agent:live2d:${avatarAssetRef}`;
  let previewCalls = 0;
  const adapter = createDesktopAgentCenterAvatarPreviewAdapter({
    avatarHandoff: handoff({
      preview: async (input) => {
        previewCalls += 1;
        assert.deepEqual(input, {
          agentId: identity.localAgentRef,
          avatarAssetRef,
          backendKind: 'live2d',
          previewMaterialRef,
          backendCapabilityProfileRef: 'avatar.live2d.capability-profile:1',
        });
        return {
          state: 'ready',
          tier: 'avatar_preview_service',
          avatarAssetRef,
          backendKind: 'live2d',
          previewMaterialRef,
          previewImageRef: '/__nimi/avatar-preview/ready.png',
          visiblePixels: 64,
          nonPlaceholder: true,
          warnings: ['avatar_preview_service:live2d'],
        };
      },
    }),
  });
  const projection = await adapter.resolvePreview({
    identity,
    accountId: 'account-1',
    backendKind: 'live2d',
    avatarAssetRef,
    backendCapabilityProfileRef: 'avatar.live2d.capability-profile:1',
    previewMaterialRef,
  });

  assert.equal(previewCalls, 1);
  assert.equal(projection.state, 'ready');
  if (projection.state !== 'ready') throw new Error('committed effect did not render');
  assert.equal(projection.previewImageRef, '/__nimi/avatar-preview/ready.png');
  assert.equal(projection.visiblePixels, 64);
});

test('Desktop Avatar preview carrier preserves renderer failure as typed failed', async () => {
  const adapter = createDesktopAgentCenterAvatarPreviewAdapter({
    avatarHandoff: handoff({
      preview: async (input) => ({
        state: 'failed',
        tier: 'avatar_preview_service',
        avatarAssetRef: input.avatarAssetRef,
        backendKind: input.backendKind,
        previewMaterialRef: input.previewMaterialRef,
        previewImageRef: null,
        visiblePixels: null,
        nonPlaceholder: false,
        reasonCode: 'invalid_manifest',
        reason: 'Avatar renderer produced no visible pixels.',
        warnings: [],
      }),
    }),
  });
  const result = await adapter.resolvePreview({
    identity,
    accountId: 'account-1',
    backendKind: 'vrm',
    avatarAssetRef: 'vrm_0123456789ab',
    previewMaterialRef: 'agent-center-avatar-asset:account:agent:vrm:vrm_0123456789ab',
  });

  assert.equal(result.state, 'failed');
  assert.equal(result.nonPlaceholder, false);
  assert.match(result.reason, /no visible pixels/u);
});

test('Desktop Avatar preview adapter stays typed unavailable when the carrier is absent', async () => {
  const adapter = createDesktopAgentCenterAvatarPreviewAdapter({ avatarHandoff: handoff() });
  const result = await adapter.resolvePreview({
    identity,
    accountId: 'account-1',
    backendKind: 'vrm',
    avatarAssetRef: 'vrm_0123456789ab',
    previewMaterialRef: 'agent-center-avatar-asset:account:agent:vrm:vrm_0123456789ab',
  });

  assert.equal(result.state, 'unavailable');
  assert.equal(result.nonPlaceholder, false);
  assert.equal(result.previewImageRef, null);
  assert.match(result.reason, /does not expose.*preview projection carrier/u);
});

test('Desktop Avatar preview adapter rejects cross-origin URLs and raw paths through the shared predicate', async () => {
  for (const previewImageRef of ['https://example.com/avatar.png', 'C:\\avatars\\ren.png']) {
    const adapter = createDesktopAgentCenterAvatarPreviewAdapter({
      avatarHandoff: handoff({
        preview: async (input) => ({
          state: 'ready',
          tier: 'avatar_preview_service',
          avatarAssetRef: input.avatarAssetRef,
          backendKind: input.backendKind,
          previewMaterialRef: input.previewMaterialRef,
          previewImageRef,
          visiblePixels: 64,
          nonPlaceholder: true,
          warnings: [],
        }),
      }),
    });
    const result = await adapter.resolvePreview({
      identity,
      accountId: 'account-1',
      backendKind: 'live2d',
      avatarAssetRef: 'live2d_0123456789ab',
      previewMaterialRef: 'agent-center-avatar-asset:account:agent:live2d:live2d_0123456789ab',
    });

    assert.equal(result.state, 'failed');
    assert.equal(result.nonPlaceholder, false);
    assert.match(result.reason, /not controlled by the current Desktop origin/u);
  }
});

test('Desktop locale seam renders Appearance and Behavior in zh through one session', async () => {
  await changeLocale('zh');
  const session = await desktopAgentCenterSession();
  const appearance = renderToStaticMarkup(
    <AgentCenter activeSection="appearance" chrome="embedded" i18n={desktopAgentCenterI18n()} session={session} />,
  );
  const behavior = renderToStaticMarkup(
    <AgentCenter activeSection="behavior" chrome="embedded" i18n={desktopAgentCenterI18n()} session={session} />,
  );
  assert.match(appearance, />外观</u);
  assert.match(appearance, /尚未(?:导入|配置).*Avatar/u);
  assert.match(behavior, /让伙伴在合适的时候出现/u);
  assert.doesNotMatch(appearance, /permission-posture|posture-group/u);
});
