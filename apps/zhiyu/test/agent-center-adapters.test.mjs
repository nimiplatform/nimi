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
});

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
  const { createZhiyuProductionAgentCenterSession } = await loadFactoryModule();

  assert.equal(createZhiyuProductionAgentCenterSession(null), null);

  const session = createZhiyuProductionAgentCenterSession(AGENT_HANDLE);
  assert.ok(session);
  assert.equal(session.getSnapshot().phase, 'loading');
});

test('production Agent Center routes all seven configuration operations through the public local-App client', async () => {
  const { createZhiyuProductionAgentCenterSession } = await loadFactoryModule();
  const host = createAgentConfigureHost();
  const previousHook = globalThis.__NIMI_ELECTRON_TEST__;
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke: host.invoke,
    listen: () => () => undefined,
  };

  try {
    const session = createZhiyuProductionAgentCenterSession(AGENT_HANDLE);
    assert.ok(session);
    await session.refresh();

    const readySnapshot = session.getSnapshot();
    assert.equal(readySnapshot.phase, 'ready');
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
    assert.equal(session.getSnapshot().state.appearance.avatarImportDisabled, true);
    await session.listSharedAIConfigOptions({
      kind: 'local-loadouts',
      capabilityContract: 'text.generate',
    });

    const replacementCapabilities = [{
      capabilityContract: 'text.generate',
      requiredFeatures: ['input.image'],
      route: { oneofKind: 'local', local: { loadoutRef: 'loadout:text' } },
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
          backendKind: 'sprite2d',
          avatarAssetRef: '',
          expressionProfileRef: '',
          idlePreset: 'idle-breathe',
          interactionPolicyRef: '',
          defaultVoiceReference: 'voice_ref_1',
          avatarAutoplay: false,
          backgroundAssetRef: '',
        },
        importedAssets: [],
      },
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

test('production adapter positively binds the shared Kit session to the public configuration namespace', async () => {
  const source = await readFile(path.join(root, 'src/production/agent-center-adapters.ts'), 'utf8');

  assert.match(source, /createAppAgentCenterSession/u);
  assert.match(source, /getZhiyuLocalAppClient\(\)\.agentConfigure/u);
  assert.doesNotMatch(source, /ownerUserId|runtimeSourceRef|localAgentRef/u);
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
    route: { oneofKind: 'local', local: { loadoutRef: 'loadout:text' } },
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
    presentationRevision,
  });

  return {
    invocations,
    async invoke(command, payload) {
      invocations.push({ command, payload });
      const input = payload?.payload;
      switch (command) {
        case COMMANDS.sharedGet:
          return { config: sharedProjection(), revision: aiConfigRevision, effectiveSelections: [] };
        case COMMANDS.sharedOverwrite:
          assert.equal(input.expectedRevision, aiConfigRevision);
          capabilities = [...input.capabilities];
          aiConfigRevision = String(BigInt(aiConfigRevision) + 1n);
          return {
            outcome: 'committed', config: sharedProjection(), revision: aiConfigRevision,
            effectiveSelections: [], reasonCode: 'REASON_CODE_UNSPECIFIED',
          };
        case COMMANDS.sharedOptions:
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
          profile = { ...input.intent, revision: presentationRevision };
          return presentationProjection();
        default:
          throw new Error(`Unexpected shell command: ${command}`);
      }
    },
  };
}

function presentationProfile(overrides) {
  return {
    backendKind: 'sprite2d',
    avatarAssetRef: '',
    expressionProfileRef: '',
    idlePreset: 'idle-breathe',
    interactionPolicyRef: '',
    defaultVoiceReference: 'voice_ref_1',
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
