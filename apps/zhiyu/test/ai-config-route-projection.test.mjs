import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu agent route readiness reads selected NimiAIConfig target refs for required product capabilities', async () => {
  const module = await importRouteModule();
  const scopeRef = module.createZhiyuAgentHomeAIScopeRef();
  const targetRef = {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: 'local-runtime:text-ready',
  };
  const config = {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': targetRef,
        'text.embed': targetRef,
        'image.generate': targetRef,
        'audio.synthesize': targetRef,
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
  const seen = [];
  const routeRuntime = {
    async resolve(input) {
      seen.push(['resolve', input.capability, input.targetRef]);
      return {
        capability: input.capability,
        source: 'local-runtime',
        targetRef: input.targetRef,
        resolvedBindingRef: `local:${input.capability}:text-ready`,
        provider: 'local',
        model: 'runtime-text-model',
        localAssetId: 'local-text-asset',
      };
    },
    async checkHealth(input) {
      seen.push(['health', input.capability, input.targetRef]);
      return {
        healthy: true,
        status: 'healthy',
        provider: 'local',
        detail: '',
        actionHint: 'none',
      };
    },
    async describe(input) {
      seen.push(['describe', input.capability, input.resolvedBindingRef]);
      return {
        capability: input.capability,
        metadataKind: input.capability,
        metadataVersion: 'v1',
        resolvedBindingRef: input.resolvedBindingRef,
        metadata: input.capability === 'text.generate'
          ? {
              supportsThinking: true,
              traceModeSupport: 'separate',
              supportsImageInput: false,
              supportsAudioInput: false,
              supportsVideoInput: false,
              supportsArtifactRefInput: false,
            }
          : {},
      };
    },
  };

  const route = await module.probeZhiyuAgentRouteReadiness({
    config,
    routeRuntime,
  });

  assert.equal(route.ready, true);
  assert.equal(route.reasonCode, 'runtime-route-ready');
  assert.equal(route.capability, 'text.generate');
  assert.equal(route.aiConfigScopeOwnerId, 'nimi.zhiyu');
  assert.deepEqual(route.enabledCapabilities, [
    'text.generate',
    'audio.synthesize',
    'audio.transcribe',
    'voice_workflow.voice_clone',
    'voice_workflow.voice_design',
    'image.generate',
    'image.edit',
    'video.generate',
    'text.embed',
  ]);
  assert.deepEqual(route.bindingCapabilities, {
    'text.generate': 'text.generate',
    'audio.synthesize': 'audio.synthesize',
    'audio.transcribe': 'audio.transcribe',
    'voice_workflow.voice_clone': 'voice_workflow.voice_clone',
    'voice_workflow.voice_design': 'voice_workflow.voice_design',
    'image.generate': 'image.generate',
    'image.edit': 'image.edit',
    'video.generate': 'video.generate',
    'text.embed': 'text.embed',
  });
  assert.deepEqual(route.targetRefKinds, {
    'text.generate': 'local-runtime',
    'audio.synthesize': 'local-runtime',
    'audio.transcribe': null,
    'voice_workflow.voice_clone': null,
    'voice_workflow.voice_design': null,
    'image.generate': 'local-runtime',
    'image.edit': null,
    'video.generate': null,
    'text.embed': 'local-runtime',
  });
  assert.equal(route.executionBinding.route, 'local');
  assert.equal(route.executionBinding.modelId, 'runtime-text-model');
  assert.deepEqual(route.executionBinding.targetRef, targetRef);
  assert.deepEqual(seen.find((entry) => entry[0] === 'resolve' && entry[1] === 'text.generate')?.[2], targetRef);
});

test('Zhiyu agent route readiness fails closed until AIConfig text target is selected', async () => {
  const module = await importRouteModule();
  const config = {
    scopeRef: module.createZhiyuAgentHomeAIScopeRef(),
    capabilities: {
      targetRefs: {
        'image.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-runtime:image-ready',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };

  const route = await module.probeZhiyuAgentRouteReadiness({
    config,
    routeRuntime: {
      async resolve() {
        throw new Error('route runtime must not be called without text.generate selection');
      },
      async checkHealth() {
        throw new Error('route runtime must not be called without text.generate selection');
      },
      async describe() {
        throw new Error('route runtime must not be called without text.generate selection');
      },
    },
  });

  assert.equal(route.ready, false);
  assert.equal(route.reasonCode, 'zhiyu-ai-config-route-selection-required');
  assert.equal(route.executionBinding, null);
  assert.equal(route.targetRefKinds['text.generate'], null);
  assert.equal(route.targetRefKinds['image.generate'], 'local-runtime');
  assert.equal(route.targetRefKinds['audio.synthesize'], null);
  assert.equal(route.targetRefKinds['audio.transcribe'], null);
  assert.equal(route.targetRefKinds['voice_workflow.voice_clone'], null);
  assert.equal(route.targetRefKinds['voice_workflow.voice_design'], null);
  assert.equal(route.targetRefKinds['image.edit'], null);
  assert.equal(route.targetRefKinds['video.generate'], null);
  assert.equal(route.targetRefKinds['text.embed'], null);
});

test('Zhiyu agent turn readiness requires both execution binding and Runtime authority binding evidence', async () => {
  const module = await importRouteModule();
  const missingBinding = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    executionBindingReady(),
    module.resolveZhiyuRuntimeAgentBindingDecision(),
  );

  assert.equal(missingBinding.ready, false);
  assert.equal(missingBinding.reasonCode, 'ZHIYU_RUNTIME_AGENT_BINDING_REQUIRED');
  assert.equal(missingBinding.actionHint, 'attach_runtime_scoped_binding_or_admitted_host_equivalence');

  const ready = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    executionBindingReady(),
    module.resolveZhiyuRuntimeAgentBindingDecision({
      scopedBinding: {
        bindingId: 'binding-ready',
        bindingHandle: 'runtime.binding/binding-ready',
        runtimeAppId: 'runtime.agent',
        appInstanceId: 'nimi.zhiyu.local',
        windowId: 'window-ready',
        agentId: 'runtime-local-agent:opaque',
        conversationAnchorId: 'conversation-anchor:opaque',
        worldId: 'world-ready',
      },
    }),
  );

  assert.equal(ready.ready, true);
  assert.equal(ready.reasonCode, 'runtime-turn-ready');
});

async function importRouteModule() {
  const outputPath = path.join(await buildRouteModule(), 'agent-route-readiness.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildRouteModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-ai-config-route-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/agent-route-readiness.ts')],
    outfile: path.join(buildDir, 'agent-route-readiness.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  }).catch(async (error) => {
    const text = await readFile(path.join(root, 'src/shell/agent-chat/agent-route-readiness.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu agent route readiness: ${error.message}\nsource length=${text.length}`);
  });
  return buildDir;
}

function conversationReady(overrides = {}) {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'conversation-anchor-open',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'Runtime-owned conversation anchor is open.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    ...overrides,
  };
}

function executionBindingReady() {
  return {
    route: 'local',
    modelId: 'runtime-model:opaque',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:runtime-model-opaque',
    },
  };
}
