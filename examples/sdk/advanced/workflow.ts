/**
 * Workflow DAG orchestration with two AI nodes.
 * Run: npx tsx examples/sdk/advanced/workflow.ts
 */

import { createPlatformClient } from '@nimiplatform/sdk';
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

const { runtime } = await createPlatformClient({
  appId: APP_ID,
  runtimeTransport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

const definition = workflowDefinition({
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
        routePolicy: RoutePolicy.LOCAL,
        fallback: FallbackPolicy.DENY,
        timeoutMs: 30000,
        prompt: 'Nimi is an AI runtime that spans local and cloud execution.',
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
        routePolicy: RoutePolicy.LOCAL,
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

const submission = await runtime.workflow.submit(
  {
    appId: APP_ID,
    subjectUserId: 'local-user',
    definition,
    timeoutMs: 120000,
  },
  { idempotencyKey: crypto.randomUUID() },
);

console.log('task:', submission.taskId, RuntimeReasonCode[submission.reasonCode]);

const events = await runtime.workflow.subscribeEvents({ taskId: submission.taskId });
for await (const event of events) {
  console.log('event:', WorkflowEventType[event.eventType], 'node:', event.nodeId || '-');
  if (
    event.eventType === WorkflowEventType.WORKFLOW_EVENT_COMPLETED
    || event.eventType === WorkflowEventType.WORKFLOW_EVENT_FAILED
    || event.eventType === WorkflowEventType.WORKFLOW_EVENT_CANCELED
  ) {
    break;
  }
}

const finalState = await runtime.workflow.get({ taskId: submission.taskId });
console.log('status:', WorkflowStatus[finalState.status]);
