/**
 * Nimi SDK Quick Start
 *
 * Run: npx tsx examples/sdk-quickstart.ts
 */

import { Runtime } from '@nimiplatform/sdk';
import {
  ModelStatus,
  RuntimeHealthStatus,
} from '@nimiplatform/sdk/runtime';

const APP_ID = 'example.quickstart';

const runtime = new Runtime({
  appId: APP_ID,
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

async function checkHealth() {
  const health = await runtime.audit.getRuntimeHealth({});
  console.log('Runtime status:', RuntimeHealthStatus[health.status]);
  console.log('Reason:', health.reason || '(none)');
  console.log('Queue depth:', health.queueDepth);
  console.log('Active workflows:', health.activeWorkflows);
}

async function listModels() {
  const response = await runtime.model.list({});
  if ((response.models || []).length === 0) {
    console.log('No models registered.');
    return;
  }

  for (const model of response.models) {
    console.log(`- ${model.modelId} (${ModelStatus[model.status]})`);
  }
}

async function generateText() {
  const response = await runtime.ai.text.generate({
    model: 'local/qwen2.5',
    subjectUserId: 'local-user',
    input: 'What is the Nimi platform?',
    maxTokens: 256,
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 30000,
  });

  console.log('Resolved model:', response.trace.modelResolved || '(unknown)');
  console.log('Trace ID:', response.trace.traceId || '(none)');
  console.log('Text:', response.text);
  console.log('Finish reason:', response.finishReason);
  console.log('Usage:', response.usage);
}

async function main() {
  console.log('=== Runtime Health ===');
  await checkHealth();

  console.log('\n=== Models ===');
  await listModels();

  console.log('\n=== Generate ===');
  await generateText();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
