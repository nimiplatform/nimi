import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const AGENT_HANDLE = `agent_ref_${'A'.repeat(43)}`;
const COMMANDS = Object.freeze({
  sharedGet: 'nimi.shell.localApp.sharedAgentAIConfigGet',
  sharedOverwrite: 'nimi.shell.localApp.sharedAgentAIConfigOverwrite',
  sharedOptions: 'nimi.shell.localApp.sharedAgentAIConfigLocalOptions',
  autonomySnapshot: 'nimi.shell.localApp.agentAutonomySnapshot',
  autonomyUpdate: 'nimi.shell.localApp.agentUpdateAutonomy',
  presentationSnapshot: 'nimi.shell.localApp.agentPresentationSnapshot',
  presentationCommit: 'nimi.shell.localApp.agentCommitPresentation',
  managerSnapshot: 'nimi.shell.localApp.agentManagerSnapshot',
  memoryInspect: 'nimi.shell.localApp.agentMemoryInspect',
  memoryCorrect: 'nimi.shell.localApp.agentMemoryCorrect',
  memoryForget: 'nimi.shell.localApp.agentMemoryForget',
  memorySwitch: 'nimi.shell.localApp.agentMemorySwitch',
  memoryDelete: 'nimi.shell.localApp.agentMemoryDelete',
});
const PARTICIPATION = [
  { role: 'conversation.primary', capabilityContract: 'text.generate' },
  { role: 'memory.embedding', capabilityContract: 'text.embed' },
  { role: 'conversation.input.voice', capabilityContract: 'audio.transcribe' },
  { role: 'conversation.output.voice', capabilityContract: 'audio.synthesize' },
  { role: 'conversation.realtime', capabilityContract: 'realtime.interact' },
  { role: 'conversation.action.image', capabilityContract: 'image.generate' },
];

test('Agent Center uses only the covered SDK nominal handle evidence', async () => {
  const { projectZhiyuAuthorizedAgentCenterHandle } = await loadIdentityModule();
  const evidence = authorizedEvidence();
  const handle = projectZhiyuAuthorizedAgentCenterHandle(evidence);

  assert.equal(handle, AGENT_HANDLE);
  assert.equal(projectZhiyuAuthorizedAgentCenterHandle({
    ...evidence,
    inventory: { ...evidence.inventory, localAgents: [] },
  }), null);
});

test('production Agent Center requires only the covered nominal handle', async () => {
  const { resolveZhiyuProductionAgentCenterBinding } = await loadFactoryModule();
  const { createZhiyuCanonicalAgentCenterSession } = await loadCanonicalSessionModule();

  assert.equal(resolveZhiyuProductionAgentCenterBinding(null), null);
  assert.equal(createZhiyuCanonicalAgentCenterSession(null, 'anchor-current', null), null);

  const binding = resolveZhiyuProductionAgentCenterBinding(AGENT_HANDLE);
  const session = createZhiyuCanonicalAgentCenterSession(AGENT_HANDLE, 'anchor-current', binding);
  assert.ok(session);
  assert.equal(session.getSnapshot().phase, 'loading');
});

test('production Agent Center routes the complete configuration family through the public local-App client', async () => {
  const { resolveZhiyuProductionAgentCenterBinding } = await loadFactoryModule();
  const { createZhiyuCanonicalAgentCenterSession } = await loadCanonicalSessionModule();
  const host = createAgentConfigureHost();
  const previousHook = globalThis.__NIMI_ELECTRON_TEST__;
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: host.invoke,
    listen: () => () => undefined,
  };

  try {
    const binding = resolveZhiyuProductionAgentCenterBinding(AGENT_HANDLE);
    const session = createZhiyuCanonicalAgentCenterSession(AGENT_HANDLE, 'anchor-current', binding);
    assert.ok(session);
    await session.refresh();

    const readySnapshot = session.getSnapshot();
    assert.equal(
      readySnapshot.phase,
      'ready',
      `${readySnapshot.error || 'Agent Center did not become ready'}; invocations=${JSON.stringify(host.invocations)}`,
    );
    assert.equal(readySnapshot.error, null);
    assert.deepEqual(readySnapshot.state.sections, [
      'overview',
      'appearance',
      'behavior',
      'ai-config',
      'cognition',
      'advanced',
    ]);
    assert.equal(
      session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0]?.capabilityContract,
      'text.generate',
    );
    assert.deepEqual(session.getSnapshot().state.participation, PARTICIPATION);
    assert.deepEqual(session.getSnapshot().state.autonomy, {
      revision: '7',
      enabled: true,
      mode: 'low',
      usedTokensInWindow: 12,
      dailyTokenBudget: 4096,
      maxTokensPerHook: 512,
      windowStartedAt: '2025-06-15T15:06:40.000Z',
      suspendedUntil: null,
      budgetExhausted: false,
      controlsDisabled: false,
      disabledReason: null,
    });
    assert.equal(session.getSnapshot().state.appearance.presentationRevision, '3');
    assert.equal(session.getSnapshot().state.appearance.avatarAutoplay, true);
    assert.equal(session.getSnapshot().state.appearance.previousSelection?.avatarAutoplay, false);
    assert.equal(session.getSnapshot().state.appearance.avatarImportDisabled, false);
    assert.deepEqual(
      session.getSnapshot().state.appearance.voiceCatalog.options.filter((option) => option.kind === 'voice_asset_id'),
      [{
        reference: 'voice_asset_id:voice-custom-production',
        kind: 'voice_asset_id',
        name: 'voice-custom-production',
        supportedLangs: [],
      }],
    );
    assert.deepEqual(host.invocations.find((entry) => entry.command === COMMANDS.managerSnapshot)?.payload, {
      payload: { agentHandle: AGENT_HANDLE, conversationAnchorId: 'anchor-current' },
    });
    await session.listSharedAIConfigOptions({
      kind: 'local-loadouts',
      capabilityContract: 'text.generate',
    });

    const replacementCapabilities = [{
      capabilityContract: 'text.generate',
      requiredFeatures: ['input.image'],
      route: { oneofKind: 'local', local: {} },
    }];
    await session.overwriteSharedAIConfig({
      expectedRevision: '1',
      capabilities: replacementCapabilities,
      displayProvenance: { source: 'zhiyu-test' },
      agentHandle: AGENT_HANDLE,
    });
    assert.deepEqual(
      session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities,
      replacementCapabilities,
    );

    await session.updateAutonomy({
      expectedRevision: '7',
      enabled: false,
      mode: 'medium',
      dailyTokenBudget: 2048,
      maxTokensPerHook: 256,
    });
    assert.deepEqual(session.getSnapshot().state.autonomy, {
      revision: '8',
      enabled: false,
      mode: 'medium',
      usedTokensInWindow: 12,
      dailyTokenBudget: 2048,
      maxTokensPerHook: 256,
      windowStartedAt: '2025-06-15T15:06:40.000Z',
      suspendedUntil: null,
      budgetExhausted: false,
      controlsDisabled: false,
      disabledReason: null,
    });

    assert.equal(typeof session.appearance.setAvatarAutoplay, 'function');
    await session.appearance.setAvatarAutoplay(false);
    assert.equal(session.getSnapshot().state.appearance.presentationRevision, '4');
    assert.equal(session.getSnapshot().state.appearance.avatarAutoplay, false);

    const memoryId = session.getSnapshot().state.cognition.memory?.items[0]?.memoryId;
    assert.equal(memoryId, 'memory-1');
    await session.correctMemory({ memoryId, correctedContent: 'User prefers compact replies.' });
    await session.forgetMemory({ memoryIds: [memoryId], confirmed: true });
    await session.setMemoryEnabled(false);
    await session.deleteAllMemory({ confirmed: true });
    assert.equal(session.getSnapshot().state.cognition.memory?.items.length, 0);

    const initialSharedGet = host.invocations.find((entry) => entry.command === COMMANDS.sharedGet);
    assert.deepEqual(initialSharedGet?.payload, {});
    const sharedOverwrite = host.invocations.find((entry) => entry.command === COMMANDS.sharedOverwrite);
    assert.deepEqual(sharedOverwrite?.payload, {
      payload: { expectedRevision: '1', capabilities: replacementCapabilities },
    });
    assert.doesNotMatch(JSON.stringify(sharedOverwrite?.payload), /agentHandle/u);

    const autonomyUpdate = host.invocations.find((entry) => entry.command === COMMANDS.autonomyUpdate);
    assert.deepEqual(autonomyUpdate?.payload, {
      payload: {
        agentHandle: AGENT_HANDLE,
        expectedAutonomyRevision: '7',
        intent: {
          enabled: false,
          config: {
            mode: 'medium',
            dailyTokenBudget: 2048,
            maxTokensPerHook: 256,
          },
        },
      },
    });

    const presentationCommit = host.invocations.find((entry) => entry.command === COMMANDS.presentationCommit);
    assert.deepEqual(presentationCommit?.payload, {
      payload: {
        agentHandle: AGENT_HANDLE,
        expectedPresentationRevision: '3',
        intent: {
          avatarAutoplay: false,
        },
        importedAssets: [],
      },
    });

    assert.deepEqual(host.invocations.find((entry) => entry.command === COMMANDS.memoryCorrect)?.payload, {
      payload: { agentHandle: AGENT_HANDLE, memoryId: 'memory-1', correctedContent: 'User prefers compact replies.' },
    });
    assert.deepEqual(host.invocations.find((entry) => entry.command === COMMANDS.memoryForget)?.payload, {
      payload: { agentHandle: AGENT_HANDLE, memoryIds: ['memory-1'], confirmed: true },
    });

    const observedCommands = [...new Set(host.invocations.map((entry) => entry.command))].sort();
    assert.deepEqual(observedCommands, Object.values(COMMANDS).sort());
    for (const invocation of host.invocations) {
      if ([COMMANDS.sharedGet, COMMANDS.sharedOverwrite, COMMANDS.sharedOptions].includes(invocation.command)) {
        assert.doesNotMatch(JSON.stringify(invocation.payload), new RegExp(AGENT_HANDLE, 'u'));
      } else {
        assert.equal(invocation.payload?.payload?.agentHandle, AGENT_HANDLE);
      }
    }
  } finally {
    if (previousHook === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousHook;
  }
});

test('canonical renderer binds the single shared Kit session to the production public configuration namespace', async () => {
  const adapterSource = await readFile(path.join(root, 'src/production/agent-center-adapters.ts'), 'utf8');
  const canonicalSource = await readFile(path.join(root, 'src/renderer/agent-center-session.ts'), 'utf8');

  assert.doesNotMatch(adapterSource, /createAppAgentCenterSession/u);
  assert.match(canonicalSource, /createAppAgentCenterSession/u);
  assert.match(adapterSource, /const localAppClient = getZhiyuLocalAppClient\(\)/u);
  assert.match(adapterSource, /client:\s*localAppClient\.agentConfigure/u);
  assert.doesNotMatch(adapterSource, /voiceAssetsClient|localAppClient\.ai\.voiceAssets/u);
  assert.match(canonicalSource, /conversationAnchorId/u);
  assert.match(adapterSource, /createAgentCenterShellHostMechanics\(createAgentCenterShellBridge\(\)\)/u);
  assert.doesNotMatch(`${adapterSource}\n${canonicalSource}`, /ownerUserId|runtimeSourceRef|localAgentRef/u);
});

test('window focus refreshes the stable Agent Center session without adding session polling', async () => {
  const source = await readFile(path.join(root, 'src/shell/app/App.tsx'), 'utf8');

  assert.match(
    source,
    /const handleWindowFocus = \(\) => \{\s*void refreshAgentInventory\(\);\s*void agentCenterSession\?\.refresh\(\);\s*\}/u,
  );
  const intervalStart = source.indexOf('const interval = window.setInterval');
  const focusListenerStart = source.indexOf("window.addEventListener('focus'", intervalStart);
  assert.ok(intervalStart >= 0 && focusListenerStart > intervalStart);
  assert.doesNotMatch(source.slice(intervalStart, focusListenerStart), /agentCenterSession/u);
});

test('Agent and handle changes dispose the old Manager Session and clear Agent-scoped evidence before reload', async () => {
  const source = await readFile(path.join(root, 'src/shell/app/App.tsx'), 'utf8');

  assert.match(source, /useEffect\(\(\) => \(\) => \{\s*agentCenterSession\?\.dispose\(\);\s*\}, \[agentCenterSession\]\);/u);
  const selection = source.slice(
    source.indexOf('function handleSelectLocalAgent'),
    source.indexOf('function handleRetryAgentCenter'),
  );
  assert.match(selection, /agentCenterSession\?\.invalidate\(\);\s*agentCenterSession\?\.dispose\(\);/u);
  assert.match(selection, /setEvidence\(\(current\) => \(\{\s*\.\.\.initial,\s*runtime: current\.runtime,\s*auth: current\.auth,\s*inventory: current\.inventory,/u);
  assert.ok(selection.indexOf('agentCenterSession?.dispose()') < selection.indexOf('setSelectedAgentHandle(agentHandle)'));
  assert.match(source, /createZhiyuCanonicalAgentCenterSession\([\s\S]*agentCenterBinding,[\s\S]*resourcePackController,[\s\S]*\)/u);

  const homeLoad = source.slice(
    source.indexOf('const home = await bindings.app.projection.loadHome'),
    source.indexOf('}, [bindings, selectedAgentHandle, selectedLocalAgentRefreshKey])'),
  );
  assert.match(homeLoad, /if \(!active\) \{\s*return;\s*\}/u);
});

function authorizedEvidence() {
  return {
    conversation: { agentHandle: AGENT_HANDLE },
    localAgent: { agentHandle: AGENT_HANDLE },
    inventory: {
      ownerUserId: null,
      localAgents: [{ agentHandle: AGENT_HANDLE }],
    },
  };
}

function createAgentConfigureHost() {
  const invocations = [];
  let capabilities = [{
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  }];
  let aiConfigRevision = '1';
  let autonomy = {
    enabled: true,
    dailyTokenBudget: 4096,
    maxTokensPerHook: 512,
    mode: 'low',
    revision: '7',
  };
  let presentationRevision = '3';
  let profile = presentationProfile({ revision: '3', avatarAutoplay: true });
  let previousProfile = presentationProfile({ revision: '2', avatarAutoplay: false });
  let memoryEnabled = true;
  let forgottenMemoryCount = 0;
  let memories = [{
    memoryId: 'memory-1',
    content: 'User prefers concise replies.',
    epistemicStatus: 'explicit',
    lifecycle: 'current',
    occurredAt: '2025-06-15T15:06:40.000Z',
    updatedAt: '2025-06-15T15:06:40.000Z',
    sourceExplanation: 'Committed conversation fact.',
  }];

  const sharedProjection = () => ({
    owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
    capabilities,
  });
  const autonomyProjection = () => ({
    enabled: autonomy.enabled,
    config: {
      dailyTokenBudget: autonomy.dailyTokenBudget,
      maxTokensPerHook: autonomy.maxTokensPerHook,
      minHookInterval: null,
      suspendUntil: null,
      mode: autonomy.mode,
    },
    usedTokensInWindow: 12,
    windowStartedAt: { seconds: '1750000000', nanos: 0 },
    budgetExhausted: false,
    suspendedUntil: null,
    autonomyRevision: autonomy.revision,
  });
  const presentationProjection = () => ({
    profile,
    previousProfile,
    defaultVoiceReference: profile.defaultVoiceReference,
    avatarAutoplay: profile.avatarAutoplay,
    presentationRevision,
    resourcePackSelection: null,
  });
  const memoryProjection = (outcome = 'ready') => ({
    outcome,
    enabled: memoryEnabled,
    adoptionRequired: false,
    items: memories,
    currentCount: memories.filter((item) => item.lifecycle === 'current').length,
    supersededCount: memories.filter((item) => item.lifecycle === 'superseded').length,
    forgottenCount: forgottenMemoryCount,
    nextPageToken: null,
  });
  const managerProjection = () => ({
    lifecycleStatus: 'active',
    executionState: 'idle',
    statusText: 'Ready',
    currentEmotion: 'calm',
    source: {
      ready: true,
      state: 'ready',
      reasonCode: 'none',
      capturedAt: { seconds: '1750000000', nanos: 0 },
      coverageSections: [{
        section: 'identity', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0,
      }],
      lorebookReady: true,
      lorebookItemCount: 1,
      lorebookEstimatedTokens: '64',
    },
    context: {
      ready: true,
      state: 'ready',
      reasonCode: 'none',
      lanes: [{
        laneId: 'source_identity', state: 'included', includedItemCount: 1,
        omittedItemCount: 0, truncatedItemCount: 0, allocatedTokens: '64', usedTokens: '32',
      }],
      inputBudgetTokens: '1024',
      usedTokens: '32',
      requiredInputTokens: '32',
      requiredContextWindowTokens: '256',
      truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
      transcriptTurnCount: 1,
      memoryItemCount: memories.filter((item) => item.lifecycle === 'current').length,
      mediaCount: 0,
      toolCount: 0,
      sourceAdapterStatus: 'ready',
      sourceSelectionStatus: 'ready',
      conversationSummaryStatus: 'absent',
      privateRecallCount: memories.filter((item) => item.lifecycle === 'current').length,
    },
    actionAvailability: Object.fromEntries([
      'getSharedAIConfig', 'overwriteSharedAIConfig', 'readAutonomy', 'updateAutonomy',
      'inspectMemory', 'correctMemory', 'forgetMemory', 'switchMemory', 'deleteAllMemory',
      'replaceAppearance', 'restorePreviousAppearance',
    ].map((action) => [action, action === 'restorePreviousAppearance' && !previousProfile
      ? { state: 'unavailable', reason: 'previous-presentation-unavailable' }
      : { state: 'available', reason: null }])),
  });

  return {
    invocations,
    async invoke(command, payload) {
      invocations.push({ command, payload });
      const input = payload?.payload;
      switch (command) {
        case COMMANDS.sharedGet:
          return { config: sharedProjection(), revision: aiConfigRevision, effectiveSelections: [], participation: PARTICIPATION };
        case COMMANDS.sharedOverwrite:
          assert.equal(input.expectedRevision, aiConfigRevision);
          capabilities = [...input.capabilities];
          aiConfigRevision = String(BigInt(aiConfigRevision) + 1n);
          return {
            outcome: 'committed', config: sharedProjection(), revision: aiConfigRevision,
            effectiveSelections: [], participation: PARTICIPATION, reasonCode: 'REASON_CODE_UNSPECIFIED',
          };
        case COMMANDS.sharedOptions:
          if (payload?.kind === 'voice-assets') {
            return { kind: 'voice-assets', options: [{ voiceAssetId: 'voice-custom-production' }], truncated: false };
          }
          if (payload?.kind === 'preset-voices') {
            return { kind: 'preset-voices', options: [], truncated: false };
          }
          return { kind: 'local-loadouts', options: [], truncated: false };
        case COMMANDS.autonomySnapshot:
          return autonomyProjection();
        case COMMANDS.autonomyUpdate:
          assert.equal(input.expectedAutonomyRevision, autonomy.revision);
          autonomy = {
            enabled: input.intent.enabled ?? autonomy.enabled,
            dailyTokenBudget: input.intent.config.dailyTokenBudget,
            maxTokensPerHook: input.intent.config.maxTokensPerHook,
            mode: input.intent.config.mode,
            revision: String(BigInt(autonomy.revision) + 1n),
          };
          return autonomyProjection();
        case COMMANDS.presentationSnapshot:
          return presentationProjection();
        case COMMANDS.presentationCommit:
          assert.equal(input.expectedPresentationRevision, presentationRevision);
          previousProfile = profile;
          presentationRevision = String(BigInt(presentationRevision) + 1n);
          profile = { ...profile, ...input.intent, revision: presentationRevision };
          return presentationProjection();
        case COMMANDS.managerSnapshot:
          return managerProjection();
        case COMMANDS.memoryInspect:
          return memoryProjection();
        case COMMANDS.memoryCorrect:
          memories = memories.map((item) => item.memoryId === input.memoryId
            ? { ...item, content: input.correctedContent, updatedAt: '2025-06-15T15:07:00.000Z' }
            : item);
          return { outcome: 'committed', affectedMemoryIds: [input.memoryId], projection: memoryProjection('committed') };
        case COMMANDS.memoryForget:
          forgottenMemoryCount += memories.filter((item) => input.memoryIds.includes(item.memoryId)).length;
          memories = memories.filter((item) => !input.memoryIds.includes(item.memoryId));
          return { outcome: 'forgotten', affectedMemoryIds: input.memoryIds, projection: memoryProjection('forgotten') };
        case COMMANDS.memorySwitch:
          memoryEnabled = input.enabled;
          return { outcome: 'committed', affectedMemoryIds: [], projection: memoryProjection('committed') };
        case COMMANDS.memoryDelete: {
          const affectedMemoryIds = memories.map((item) => item.memoryId);
          memories = [];
          forgottenMemoryCount = 0;
          return { outcome: 'deleted', affectedMemoryIds, projection: memoryProjection('deleted') };
        }
        default:
          throw new Error(`Unexpected shell command: ${command}`);
      }
    },
  };
}

function presentationProfile(overrides) {
  return {
    backendKind: 'vrm',
    avatarAssetRef: 'asset://avatar/current',
    expressionProfileRef: '',
    idlePreset: 'idle-breathe',
    interactionPolicyRef: '',
    defaultVoiceReference: 'preset_voice_id:serena',
    avatarAutoplay: false,
    backgroundAssetRef: '',
    ...overrides,
  };
}

let factoryModule;
async function loadFactoryModule() {
  factoryModule ||= importBundledModule('src/production/agent-center-adapters.ts');
  return factoryModule;
}

let canonicalSessionModule;
async function loadCanonicalSessionModule() {
  canonicalSessionModule ||= importBundledModule('src/renderer/agent-center-session.ts');
  return canonicalSessionModule;
}

let identityModule;
async function loadIdentityModule() {
  identityModule ||= importBundledModule('src/shell/agent/agent-center-handle.ts');
  return identityModule;
}

async function importBundledModule(entryPoint) {
  const output = (await build({
    entryPoints: [path.join(root, entryPoint)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}
