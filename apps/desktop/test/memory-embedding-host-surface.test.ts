import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopMemoryEmbeddingServiceSource = readFileSync(
  path.resolve(process.cwd(), 'src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.ts'),
  'utf-8',
);

test('desktop memory embedding service exposes Runtime-owned inspect, bind, and cutover only', async () => {
  const { createDesktopMemoryEmbeddingConfigService } = await import(
    '../src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.js'
  );
  const calls: Array<{ method: string; request: Record<string, unknown> }> = [];
  const runtime = {
    appId: 'desktop-test',
    auth: {
      registerApp: async () => ({ accepted: true }),
    },
    grants: {
      authorizeExternalPrincipal: async (request: {
        scopes: string[];
        appId?: string;
        subjectUserId?: string;
        externalPrincipalId?: string;
        policyVersion?: string;
        issuedScopeCatalogVersion?: string;
      }) => ({
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
      async inspectMemoryEmbeddingRuntime(request: Record<string, unknown>) {
        calls.push({ method: 'inspect', request });
        return {
          textEmbedIntentPresent: true,
          textEmbedSourceKind: 'local',
          configRevision: '7',
          resolutionState: 'resolved',
          canonicalBankStatus: 'bound_equivalent',
          blockedReasonCode: '',
          operationReadiness: { bindAllowed: false, cutoverAllowed: false },
        };
      },
      async requestMemoryEmbeddingRuntimeBind(request: Record<string, unknown>) {
        calls.push({ method: 'bind', request });
        return {
          outcome: 'already_bound',
          blockedReasonCode: '',
          canonicalBankStatusAfter: 'bound_equivalent',
          pendingCutover: false,
        };
      },
      async requestMemoryEmbeddingRuntimeCutover(request: Record<string, unknown>) {
        calls.push({ method: 'cutover', request });
        return {
          outcome: 'already_current',
          blockedReasonCode: '',
          canonicalBankStatusAfter: 'bound_equivalent',
        };
      },
    },
  };
  const service = createDesktopMemoryEmbeddingConfigService({
    getRuntime: () => runtime as never,
    getAppId: () => 'desktop-test',
    getSubjectUserId: () => 'user-1',
  });
  const request = {
    targetRef: {
      kind: 'agent-core' as const,
      localAgentRef: 'local-agent:user-1:agent-local-1',
    },
  };

  const inspect = await service.memoryEmbeddingRuntime.inspect(request);
  const bind = await service.memoryEmbeddingRuntime.requestBind(request);
  const cutover = await service.memoryEmbeddingRuntime.requestCutover(request);

  assert.equal('memoryEmbeddingConfig' in service, false);
  assert.equal(inspect.textEmbedIntentPresent, true);
  assert.equal(inspect.textEmbedSourceKind, 'local');
  assert.equal(inspect.configRevision, 7);
  assert.equal(inspect.resolutionState, 'resolved');
  assert.equal(bind.outcome, 'already_bound');
  assert.equal(bind.pendingCutover, false);
  assert.equal(cutover.outcome, 'already_current');
  assert.deepEqual(calls.map((call) => call.method), ['inspect', 'bind', 'cutover']);
  assert.equal('bindingIntentSnapshot' in calls[0]!.request, false);
});

test('desktop memory embedding runtime service delegates Runtime composition to SDK', () => {
  assert.doesNotMatch(
    desktopMemoryEmbeddingServiceSource,
    new RegExp(['createNimiProtectedHostMemory', 'EmbeddingConfigSurface'].join('')),
  );
  assert.match(desktopMemoryEmbeddingServiceSource, /createNimiProtectedHostMemoryEmbeddingRuntimeSurface/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /memoryEmbeddingConfig/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /localStorage/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /desktop-memory-embedding-config-storage/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /withRuntimeMemoryScopes/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /buildNimiMemoryEmbeddingAgentCoreLocator/);
  assert.doesNotMatch(
    desktopMemoryEmbeddingServiceSource,
    new RegExp(['buildNimiMemoryEmbedding', 'BindingIntentSnapshot'].join('')),
  );
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectNimiMemoryEmbeddingRuntimeState/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectNimiMemoryEmbeddingBindResult/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectNimiMemoryEmbeddingCutoverResult/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /projectUnavailableNimiMemoryEmbeddingRuntimeState/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /function normalizeResolutionState/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /function normalizeCanonicalBankStatus/);
  assert.doesNotMatch(desktopMemoryEmbeddingServiceSource, /function runtimeReasonCodeName/);
});
