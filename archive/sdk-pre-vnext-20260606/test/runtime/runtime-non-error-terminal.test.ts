import assert from 'node:assert/strict';
import test from 'node:test';

import { Runtime, RuntimeMethodIds, setNodeGrpcBridge, type NodeGrpcBridge } from '../../src/runtime/index.js';
import {
  ExecuteScenarioResponse,
  FinishReason,
  RoutePolicy,
} from '../../src/runtime/generated/runtime/v1/ai';
import { textGenerateOutput } from '../helpers/runtime-ai-shapes.js';

const APP_ID = 'nimi.runtime.non-error-terminal.test';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

async function runGenerateWithFinishReason(finishReason: FinishReason): Promise<string> {
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId !== RuntimeMethodIds.ai.executeScenario) {
        throw new Error(`unexpected method: ${input.methodId}`);
      }
      return ExecuteScenarioResponse.toBinary(
        ExecuteScenarioResponse.create({
          output: textGenerateOutput('non-error-terminal'),
          finishReason,
          routeDecision: RoutePolicy.LOCAL,
          modelResolved: 'local/test',
          traceId: 'trace-non-error-terminal',
        }),
      );
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'terminal-user' },
    });
    const result = await runtime.ai.text.generate({ model: 'local/test', input: 'hi' });
    return result.finishReason;
  } finally {
    clearNodeGrpcBridge();
  }
}

test('Runtime projects AI_FINISH_LENGTH as finishReason instead of throwing', async () => {
  const finishReason = await runGenerateWithFinishReason(FinishReason.LENGTH);
  assert.equal(finishReason, 'length');
});

test('Runtime projects AI_FINISH_CONTENT_FILTER as finishReason instead of throwing', async () => {
  const finishReason = await runGenerateWithFinishReason(FinishReason.CONTENT_FILTER);
  assert.equal(finishReason, 'content-filter');
});
