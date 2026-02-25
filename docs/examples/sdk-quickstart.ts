/**
 * Nimi SDK Quick Start
 *
 * Run: npx tsx docs/examples/sdk-quickstart.ts
 */

import { createNimiClient } from '@nimiplatform/sdk';
import {
  FallbackPolicy,
  Modal,
  ModelStatus,
  RoutePolicy,
  RuntimeHealthStatus,
} from '@nimiplatform/sdk/runtime';

const APP_ID = 'example.quickstart';

const client = createNimiClient({
  appId: APP_ID,
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const runtime = client.runtime!;

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
  const response = await runtime.ai.generate(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/qwen2.5',
      modal: Modal.TEXT,
      input: [{ role: 'user', name: 'user', content: 'What is the Nimi platform?' }],
      systemPrompt: '',
      tools: [],
      temperature: 0,
      topP: 1,
      maxTokens: 256,
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 30000,
    },
    {
      idempotencyKey: crypto.randomUUID(),
    },
  );

  console.log('Resolved model:', response.modelResolved);
  console.log('Trace ID:', response.traceId);
  console.log('Output struct:', JSON.stringify(response.output, null, 2));
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
