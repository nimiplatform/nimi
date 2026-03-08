import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRuntimeClient,
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

        const localModels = await client.local.listLocalModels({});
        assert.ok(Array.isArray(localModels.models), 'local.listLocalModels should return array');
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk-runtime contract failed: ${detail}`);
  }
});
