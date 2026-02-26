import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aiGenerateNode,
  templateNode,
  workflowDefinition,
  workflowEdge,
} from '../../src/runtime/workflow-builder.js';

import { WorkflowNodeType } from '../../src/runtime/generated/runtime/v1/workflow.js';

test('workflow builder creates typed nodes and edges', () => {
  const source = templateNode({
    nodeId: 'source',
    config: {
      template: 'hello',
      outputMimeType: 'text/plain',
    },
  });
  const generate = aiGenerateNode({
    nodeId: 'generate',
    dependsOn: ['source'],
    config: {
      modelId: 'local/default',
      modal: 1,
      systemPrompt: '',
      tools: [],
      temperature: 0,
      topP: 0,
      maxTokens: 0,
      routePolicy: 0,
      fallback: 0,
      timeoutMs: 0,
      prompt: '',
    },
  });
  const edge = workflowEdge({
    fromNodeId: 'source',
    fromOutput: 'text',
    toNodeId: 'generate',
    toInput: 'prompt',
  });

  const definition = workflowDefinition({
    workflowType: 'demo',
    nodes: [source, generate],
    edges: [edge],
  });

  assert.equal(source.nodeType, WorkflowNodeType.WORKFLOW_NODE_TRANSFORM_TEMPLATE);
  assert.equal(source.typeConfig.oneofKind, 'templateConfig');
  assert.equal(generate.nodeType, WorkflowNodeType.WORKFLOW_NODE_AI_GENERATE);
  assert.equal(generate.typeConfig.oneofKind, 'aiGenerateConfig');
  assert.equal(definition.nodes.length, 2);
  assert.equal(definition.edges.length, 1);
  assert.equal(definition.edges[0]?.toInput, 'prompt');
});
