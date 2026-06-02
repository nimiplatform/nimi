import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  AuthorizeExternalPrincipalResponse,
  RegisterAppResponse,
  RuntimeReasonCode,
  buildMemoryEmbeddingBindingIntentSnapshot,
  createEmptyMemoryEmbeddingConfig,
  type MemoryEmbeddingConfig,
} from '@nimiplatform/sdk/runtime';
import { createDesktopMemoryEmbeddingScopeRef } from '../src/shell/renderer/app-shell/providers/desktop-memory-embedding-scope';

const desktopMemoryEmbeddingServiceSource = readFileSync(
  path.resolve(process.cwd(), 'src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.ts'),
  'utf-8',
);

test('desktop memory embedding service composes Runtime-owned intent through SDK surfaces', async () => {
  const { createDesktopMemoryEmbeddingConfigService } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.js'
  );
  const calls: Array<{ method: string; request: Record<string, unknown> }> = [];
  let intent: ReturnType<typeof buildMemoryEmbeddingBindingIntentSnapshot>;
  const runtime = {
    appId: 'desktop-test',
    auth: {
      registerApp: async () => RegisterAppResponse.create({ accepted: true }),
    },
    appAuth: {
      authorizeExternalPrincipal: async (request: {
        scopes: string[];
        appId?: string;
        subjectUserId?: string;
        externalPrincipalId?: string;
        policyVersion?: string;
        issuedScopeCatalogVersion?: string;
      }) => AuthorizeExternalPrincipalResponse.create({
        tokenId: `token-${request.scopes.join('-')}`,
        secret: 'secret',
        appId: request.appId,
        subjectUserId: request.subjectUserId,
        externalPrincipalId: request.externalPrincipalId,
        effectiveScopes: request.scopes,
        policyVersion: request.policyVersion,
        issuedScopeCatalogVersion: request.issuedScopeCatalogVersion,
        canDelegate: false,
      }),
    },
    memory: {
      async getMemoryEmbeddingRuntimeIntent(request: Record<string, unknown>) {
        calls.push({ method: 'get', request });
        return {
          bindingIntentPresent: Boolean(intent),
          bindingIntent: intent,
        };
      },
      async setMemoryEmbeddingRuntimeIntent(request: Record<string, unknown>) {
        calls.push({ method: 'set', request });
        intent = request.bindingIntent as typeof intent;
        return {
          bindingIntentPresent: Boolean(intent),
          bindingIntent: intent,
        };
      },
      async inspectMemoryEmbeddingRuntime(request: Record<string, unknown>) {
        calls.push({ method: 'inspect', request });
        return {
          bindingIntentPresent: Boolean(intent),
          bindingSourceKind: intent?.sourceKind || '',
          resolutionState: intent ? 'resolved' : 'missing',
          canonicalBankStatus: 'bound_equivalent',
          blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
          operationReadiness: { bindAllowed: false, cutoverAllowed: false },
        };
      },
      async requestMemoryEmbeddingRuntimeBind(request: Record<string, unknown>) {
        calls.push({ method: 'bind', request });
        return {
          outcome: 'already_bound',
          blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
          pendingCutover: false,
        };
      },
      async requestMemoryEmbeddingRuntimeCutover(request: Record<string, unknown>) {
        calls.push({ method: 'cutover', request });
        return {
          outcome: 'already_current',
          blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
        };
      },
    },
  };
  const service = createDesktopMemoryEmbeddingConfigService({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });
  const scopeRef = createDesktopMemoryEmbeddingScopeRef();
  const request = {
    scopeRef,
    targetRef: {
      kind: 'agent-core' as const,
      localAgentRef: 'local-agent:user-1:agent-local-1',
    },
  };
  const updates: MemoryEmbeddingConfig[] = [];
  const unsubscribe = service.memoryEmbeddingConfig.subscribe(request, (config) => {
    updates.push(config);
  });
  const committed = await service.memoryEmbeddingConfig.update(request, {
    ...createEmptyMemoryEmbeddingConfig(scopeRef),
    sourceKind: 'local',
    bindingRef: {
      kind: 'local',
      targetId: 'nomic-embed-local',
    },
  });
  const config = await service.memoryEmbeddingConfig.get(request);
  const inspect = await service.memoryEmbeddingRuntime.inspect(request);
  const bind = await service.memoryEmbeddingRuntime.requestBind(request);
  const cutover = await service.memoryEmbeddingRuntime.requestCutover(request);
  unsubscribe();

  assert.equal(updates.length, 1);
  assert.equal(committed.sourceKind, 'local');
  assert.deepEqual(config.bindingRef, {
    kind: 'local',
    targetId: 'nomic-embed-local',
  });
  assert.equal(inspect.bindingIntentPresent, true);
  assert.equal(inspect.bindingSourceKind, 'local');
  assert.equal(inspect.resolutionState, 'resolved');
  assert.equal(bind.outcome, 'already_bound');
  assert.equal(bind.pendingCutover, false);
  assert.equal(cutover.outcome, 'already_current');
  assert.deepEqual(calls.map((call) => call.method), ['set', 'get', 'inspect', 'bind', 'cutover']);
  assert.equal('bindingIntentSnapshot' in calls[2]!.request, false);
});

test('desktop memory embedding runtime service delegates Runtime composition to SDK', () => {
  assert.match(desktopMemoryEmbeddingServiceSource, /createProtectedHostMemoryEmbeddingConfigSurface/);
  assert.match(desktopMemoryEmbeddingServiceSource, /createProtectedHostMemoryEmbeddingRuntimeSurface/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /localStorage/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /desktop-memory-embedding-config-storage/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /withRuntimeMemoryScopes/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /buildMemoryEmbeddingAgentCoreLocator/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /buildMemoryEmbeddingBindingIntentSnapshot/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectMemoryEmbeddingRuntimeState/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectMemoryEmbeddingBindResult/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectMemoryEmbeddingCutoverResult/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectUnavailableMemoryEmbeddingRuntimeState/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /function normalizeResolutionState/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /function normalizeCanonicalBankStatus/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /function runtimeReasonCodeName/);
});
