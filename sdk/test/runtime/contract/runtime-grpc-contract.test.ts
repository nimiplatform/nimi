import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRuntimeProtectedScopeHelper,
  createRuntimeClient,
  MemoryBankScope,
  MemoryCanonicalClass,
  MemoryDistanceMetric,
  MemoryMigrationPolicy,
  MemoryRecordKind,
  Runtime,
  templateNode,
  workflowDefinition,
  workflowEdge,
} from '../../../src/runtime/index.js';
import { withRuntimeDaemon } from './helpers/runtime-daemon.js';

async function waitForWorkflowAccepted(endpoint: string): Promise<string> {
  const client = createRuntimeClient({
    appId: 'nimi.desktop',
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-runtime-contract',
    },
  });

  const source = templateNode({
    nodeId: 'source',
    config: {
      template: 'contract',
      outputMimeType: 'text/plain',
    },
  });
  const render = templateNode({
    nodeId: 'render',
    dependsOn: ['source'],
    config: {
      template: 'done: {{prompt.value}}',
      outputMimeType: 'text/plain',
    },
  });
  const definition = workflowDefinition({
    workflowType: 'sdk-runtime-contract',
    nodes: [source, render],
    edges: [workflowEdge({
      fromNodeId: 'source',
      fromOutput: 'text',
      toNodeId: 'render',
      toInput: 'prompt',
    })],
  });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const submit = await client.workflow.submit({
        appId: 'nimi.desktop',
        subjectUserId: 'user-contract',
        definition,
        timeoutMs: 30_000,
      });
      if (!submit.accepted || !submit.taskId) {
        throw new Error('workflow not accepted');
      }
      return submit.taskId;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }

  throw new Error(`runtime contract submit failed: ${String(lastError)}`);
}

test('sdk-runtime can submit/get workflow against runtime gRPC daemon', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 180_000,
}, async () => {
  try {
    await withRuntimeDaemon({
      appId: 'nimi.desktop',
      run: async ({ endpoint }) => {
        const taskId = await waitForWorkflowAccepted(endpoint);
        const client = createRuntimeClient({
          appId: 'nimi.desktop',
          transport: {
            type: 'node-grpc',
            endpoint,
          },
          defaults: {
            callerKind: 'desktop-core',
            callerId: 'sdk-runtime-contract',
          },
        });

        let status = 0;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const workflow = await client.workflow.get({ taskId });
          status = workflow.status;
          if (status === 4 || status === 5 || status === 6) {
            break;
          }
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
        }

        assert.equal(status, 4, 'workflow should complete');

        const localAssets = await client.local.listLocalAssets({});
        assert.ok(Array.isArray(localAssets.assets), 'local.listLocalAssets should return array');
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk-runtime contract failed: ${detail}`);
  }
});

test('sdk-runtime enforces protected authz for runtime memory and agent core gRPC surface', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 180_000,
}, async () => {
  try {
    await withRuntimeDaemon({
      appId: 'nimi.desktop',
      run: async ({ endpoint }) => {
        const subjectUserId = 'user-contract';
        const appId = 'nimi.desktop';
        const agentContext = { appId, subjectUserId };
        const runtime = new Runtime({
          appId,
          transport: {
            type: 'node-grpc',
            endpoint,
          },
          subjectContext: {
            subjectUserId,
          },
        });

        const protectedAccess = createRuntimeProtectedScopeHelper({
          runtime,
          getSubjectUserId: async () => subjectUserId,
        });

        const bank = await protectedAccess.withScopes(['runtime.memory.admin'], (options) => runtime.memory.createBank({
          context: agentContext,
          locator: {
            locator: {
              oneofKind: 'appPrivate',
              appPrivate: {
                accountId: 'acct-contract',
                appId,
              },
            },
          },
          embeddingProfile: {
            provider: 'local',
            modelId: 'text-embedding-3-small',
            dimension: 1536,
            distanceMetric: MemoryDistanceMetric.COSINE,
            version: 'v1',
            migrationPolicy: MemoryMigrationPolicy.REINDEX,
          },
          displayName: 'Contract Bank',
          metadata: undefined,
        }, options));
        assert.equal(bank.bank?.locator?.scope, MemoryBankScope.APP_PRIVATE);

        await protectedAccess.withScopes(['runtime.memory.write'], (options) => runtime.memory.retain({
          context: agentContext,
          bank: bank.bank?.locator,
          records: [
            {
              kind: MemoryRecordKind.SEMANTIC,
              canonicalClass: MemoryCanonicalClass.NONE,
              provenance: {
                sourceSystem: 'sdk.contract',
                sourceEventId: 'evt-memory-contract',
              },
              metadata: undefined,
              extensions: undefined,
              payload: {
                oneofKind: 'semantic',
                semantic: {
                  subject: 'Alice',
                  predicate: 'works_at',
                  object: 'Nimi',
                  confidence: 0.9,
                },
              },
            },
          ],
        }, options));

        const recall = await protectedAccess.withScopes(['runtime.memory.read'], (options) => runtime.memory.recall({
          context: agentContext,
          bank: bank.bank?.locator,
          query: {
            query: 'Where does Alice work?',
            limit: 5,
            includeInvalidated: false,
            kinds: [],
          },
        }, options));
        assert.equal(recall.hits.length, 1);

        const history = await protectedAccess.withScopes(['runtime.memory.read'], (options) => runtime.memory.history({
          context: agentContext,
          bank: bank.bank?.locator,
          query: {
            pageSize: 10,
            pageToken: '',
            includeInvalidated: false,
          },
        }, options));
        assert.equal(history.records.length, 1);

      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk-runtime protected authz contract failed: ${detail}`);
  }
});
