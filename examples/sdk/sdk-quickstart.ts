/**
 * Nimi SDK Quick Start
 *
 * Run: npx tsx examples/sdk/sdk-quickstart.ts
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
  const models = response.models || [];
  if (models.length === 0) {
    console.log('No models registered yet.');
    console.log('Next step (local): cd runtime && go run ./cmd/nimi model pull --model-ref local/qwen2.5@latest --source official --json');
    console.log('Next step (cloud): export provider API key (for example NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=...) and restart runtime');
  }

  for (const model of models) {
    console.log(`- ${model.modelId} (${ModelStatus[model.status]})`);
  }
  return models;
}

async function generateText() {
  const response = await runtime.ai.text.generate({
    model: 'local/qwen2.5',
    subjectUserId: 'local-user',
    input: 'What is the Nimi platform?',
    maxTokens: 256,
    route: 'local',
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
  const models = await listModels();
  if (!models || models.length === 0) {
    console.log('\n=== Generate ===');
    console.log('Skipped: no model available yet.');
    return;
  }

  console.log('\n=== Generate ===');
  try {
    await generateText();
  } catch (error) {
    const reasonCode = typeof error === 'object' && error && 'reasonCode' in error
      ? String((error as { reasonCode?: unknown }).reasonCode || '')
      : '';

    if (reasonCode === 'AI_LOCAL_MODEL_UNAVAILABLE') {
      console.log('Generate failed: AI_LOCAL_MODEL_UNAVAILABLE');
      console.log('Fix: cd runtime && go run ./cmd/nimi model pull --model-ref local/qwen2.5@latest --source official --json');
      return;
    }

    if (reasonCode === 'AI_REQUEST_CREDENTIAL_INVALID') {
      console.log('Generate failed: AI_REQUEST_CREDENTIAL_INVALID');
      console.log('Fix: set provider credentials (for example NIMI_RUNTIME_CLOUD_GEMINI_API_KEY), then restart runtime');
      return;
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
