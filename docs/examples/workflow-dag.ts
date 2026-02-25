/**
 * Workflow DAG Example
 *
 * Run: npx tsx docs/examples/workflow-dag.ts
 */

import { createNimiClient } from '@nimiplatform/sdk';
import {
  aiGenerateNode,
  FallbackPolicy,
  Modal,
  RuntimeReasonCode,
  RoutePolicy,
  workflowDefinition,
  workflowEdge,
  WorkflowEventType,
  WorkflowStatus,
} from '@nimiplatform/sdk/runtime';

const APP_ID = 'example.workflow';

const client = createNimiClient({
  appId: APP_ID,
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const runtime = client.runtime!;

function buildDefinition() {
  return workflowDefinition({
    workflowType: 'text.summary.translate',
    nodes: [
      aiGenerateNode({
        nodeId: 'summarize',
        config: {
          modelId: 'local/qwen2.5',
          modal: Modal.TEXT,
          systemPrompt: 'Summarize the prompt in one sentence.',
          tools: [],
          temperature: 0.2,
          topP: 1,
          maxTokens: 128,
          routePolicy: RoutePolicy.LOCAL_RUNTIME,
          fallback: FallbackPolicy.DENY,
          timeoutMs: 30000,
          prompt: 'Nimi is an AI-native platform combining local runtime and cloud realm.',
        },
      }),
      aiGenerateNode({
        nodeId: 'translate',
        config: {
          modelId: 'local/qwen2.5',
          modal: Modal.TEXT,
          systemPrompt: 'Translate the input into Japanese.',
          tools: [],
          temperature: 0.2,
          topP: 1,
          maxTokens: 128,
          routePolicy: RoutePolicy.LOCAL_RUNTIME,
          fallback: FallbackPolicy.DENY,
          timeoutMs: 30000,
          prompt: '',
        },
      }),
    ],
    edges: [
      workflowEdge({
        fromNodeId: 'summarize',
        fromOutput: 'text',
        toNodeId: 'translate',
        toInput: 'input',
      }),
    ],
  });
}

async function submitWorkflow() {
  const response = await runtime.workflow.submit(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      definition: buildDefinition(),
      timeoutMs: 120000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  console.log('task:', response.taskId, 'accepted:', response.accepted, 'reason:', RuntimeReasonCode[response.reasonCode]);
  return response.taskId;
}

async function watchEvents(taskId: string) {
  const stream = await runtime.workflow.subscribeEvents({ taskId });

  for await (const event of stream) {
    const type = WorkflowEventType[event.eventType];
    const reason = RuntimeReasonCode[event.reasonCode];

    console.log('[event]', type, 'node:', event.nodeId || '-', 'progress:', event.progressPercent, 'reason:', reason);

    if (
      event.eventType === WorkflowEventType.WORKFLOW_EVENT_COMPLETED
      || event.eventType === WorkflowEventType.WORKFLOW_EVENT_FAILED
      || event.eventType === WorkflowEventType.WORKFLOW_EVENT_CANCELED
    ) {
      return;
    }
  }
}

async function getFinalStatus(taskId: string) {
  const result = await runtime.workflow.get({ taskId });
  console.log('status:', WorkflowStatus[result.status]);
  console.log('reason:', RuntimeReasonCode[result.reasonCode]);
  console.log('nodes:', result.nodes.map((node) => `${node.nodeId}:${WorkflowStatus[node.status]}`).join(', '));
}

async function main() {
  const taskId = await submitWorkflow();
  await watchEvents(taskId);
  await getFinalStatus(taskId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
