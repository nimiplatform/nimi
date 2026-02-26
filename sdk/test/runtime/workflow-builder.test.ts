import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aiEmbedNode,
  aiGenerateNode,
  aiImageNode,
  aiSttNode,
  aiStreamNode,
  aiTtsNode,
  aiVideoNode,
  branchNode,
  extractNode,
  mergeNode,
  noopNode,
  scriptNode,
  templateNode,
  workflowDefinition,
  workflowEdge,
} from '../../src/runtime/workflow-builder.js';

import { MergeStrategy, WorkflowExecutionMode, WorkflowNodeType, WorkflowResumeStrategy } from '../../src/runtime/generated/runtime/v1/workflow.js';

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

test('workflow builder covers node factories and base defaults/overrides', () => {
  const stream = aiStreamNode({
    nodeId: ' stream ',
    dependsOn: [' source '],
    retryMaxAttempts: 2,
    retryBackoff: ' 100ms ',
    executionMode: WorkflowExecutionMode.EXTERNAL_ASYNC,
    resumeStrategy: WorkflowResumeStrategy.MANUAL,
    callbackRef: ' callback://demo ',
    config: {
      modelId: 'cloud/litellm',
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
  assert.equal(stream.nodeId, 'stream');
  assert.equal(stream.retryMaxAttempts, 2);
  assert.equal(stream.retryBackoff, '100ms');
  assert.equal(stream.executionMode, WorkflowExecutionMode.EXTERNAL_ASYNC);
  assert.equal(stream.resumeStrategy, WorkflowResumeStrategy.MANUAL);
  assert.equal(stream.callbackRef, 'callback://demo');

  const embed = aiEmbedNode({
    nodeId: 'embed',
    config: {
      modelId: 'local/embed',
      routePolicy: 0,
      fallback: 0,
      timeoutMs: 0,
      inputs: ['x'],
    },
  });
  assert.equal(embed.typeConfig.oneofKind, 'aiEmbedConfig');

  const image = aiImageNode({
    nodeId: 'image',
    config: {
      modelId: 'local/image',
      routePolicy: 0,
      fallback: 0,
      timeoutMs: 0,
      prompt: 'p',
    },
  });
  assert.equal(image.nodeType, WorkflowNodeType.WORKFLOW_NODE_AI_IMAGE);

  const video = aiVideoNode({
    nodeId: 'video',
    config: {
      modelId: 'local/video',
      routePolicy: 0,
      fallback: 0,
      timeoutMs: 0,
      prompt: 'p',
    },
  });
  assert.equal(video.nodeType, WorkflowNodeType.WORKFLOW_NODE_AI_VIDEO);

  const tts = aiTtsNode({
    nodeId: 'tts',
    config: {
      modelId: 'local/tts',
      routePolicy: 0,
      fallback: 0,
      timeoutMs: 0,
      text: 'hello',
    },
  });
  assert.equal(tts.typeConfig.oneofKind, 'aiTtsConfig');

  const stt = aiSttNode({
    nodeId: 'stt',
    config: {
      modelId: 'local/stt',
      mimeType: 'audio/wav',
      routePolicy: 0,
      fallback: 0,
      timeoutMs: 0,
      audioBytes: new Uint8Array([1, 2, 3]),
    },
  });
  assert.equal(stt.typeConfig.oneofKind, 'aiSttConfig');

  const extract = extractNode({
    nodeId: 'extract',
    config: {
      jsonPath: '$.answer',
      sourceInput: 'output',
    },
  });
  assert.equal(extract.typeConfig.oneofKind, 'extractConfig');

  const script = scriptNode({
    nodeId: 'script',
    config: {
      runtime: 'js',
      code: 'return input;',
      timeoutMs: 10,
      memoryLimitBytes: '1024',
    },
  });
  assert.equal(script.typeConfig.oneofKind, 'scriptConfig');

  const branch = branchNode({
    nodeId: 'branch',
    config: {
      condition: 'true',
      trueTarget: 'a',
      falseTarget: 'b',
    },
  });
  assert.equal(branch.typeConfig.oneofKind, 'branchConfig');

  const merge = mergeNode({
    nodeId: 'merge',
    config: {
      strategy: MergeStrategy.ALL,
      minCompleted: 1,
    },
  });
  assert.equal(merge.typeConfig.oneofKind, 'mergeConfig');

  const noop = noopNode({
    nodeId: 'noop',
  });
  assert.equal(noop.typeConfig.oneofKind, 'noopConfig');
});

test('workflow helpers normalize edge/definition defaults', () => {
  const edge = workflowEdge({
    fromNodeId: ' from ',
    fromOutput: ' out ',
    toNodeId: ' to ',
    toInput: ' in ',
  });
  assert.deepEqual(edge, {
    fromNodeId: 'from',
    fromOutput: 'out',
    toNodeId: 'to',
    toInput: 'in',
  });

  const onlyTemplate = templateNode({
    nodeId: 'single',
    config: {
      template: '{{x}}',
      outputMimeType: 'text/plain',
    },
  });
  const definition = workflowDefinition({
    workflowType: ' demo ',
    nodes: [onlyTemplate],
  });
  assert.equal(definition.workflowType, 'demo');
  assert.equal(definition.edges.length, 0);
  assert.equal(definition.nodes.length, 1);
  assert.equal(definition.nodes[0]?.executionMode, WorkflowExecutionMode.INLINE);
  assert.equal(definition.nodes[0]?.resumeStrategy, WorkflowResumeStrategy.AUTO);
});
