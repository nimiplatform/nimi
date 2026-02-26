import type {
  AiEmbedNodeConfig,
  AiGenerateNodeConfig,
  AiImageNodeConfig,
  AiStreamNodeConfig,
  AiSttNodeConfig,
  AiTtsNodeConfig,
  AiVideoNodeConfig,
  BranchNodeConfig,
  ExtractNodeConfig,
  MergeNodeConfig,
  NoopNodeConfig,
  ScriptNodeConfig,
  TemplateNodeConfig,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './generated/runtime/v1/workflow';
import {
  WorkflowExecutionMode,
  WorkflowNodeType,
  WorkflowResumeStrategy,
} from './generated/runtime/v1/workflow';

export type WorkflowNodeBase = {
  nodeId: string;
  dependsOn?: readonly string[];
  retryMaxAttempts?: number;
  retryBackoff?: string;
  executionMode?: WorkflowExecutionMode;
  resumeStrategy?: WorkflowResumeStrategy;
  callbackRef?: string;
};

function createNode(base: WorkflowNodeBase, nodeType: WorkflowNodeType, typeConfig: WorkflowNode['typeConfig']): WorkflowNode {
  return {
    nodeId: String(base.nodeId || '').trim(),
    nodeType,
    dependsOn: [...(base.dependsOn || [])],
    typeConfig,
    retryMaxAttempts: Number(base.retryMaxAttempts || 0),
    retryBackoff: String(base.retryBackoff || '').trim(),
    executionMode: base.executionMode ?? WorkflowExecutionMode.INLINE,
    resumeStrategy: base.resumeStrategy ?? WorkflowResumeStrategy.AUTO,
    callbackRef: String(base.callbackRef || '').trim(),
  };
}

export function workflowEdge(input: {
  fromNodeId: string;
  fromOutput: string;
  toNodeId: string;
  toInput: string;
}): WorkflowEdge {
  return {
    fromNodeId: String(input.fromNodeId || '').trim(),
    fromOutput: String(input.fromOutput || '').trim(),
    toNodeId: String(input.toNodeId || '').trim(),
    toInput: String(input.toInput || '').trim(),
  };
}

export function workflowDefinition(input: {
  workflowType: string;
  nodes: readonly WorkflowNode[];
  edges?: readonly WorkflowEdge[];
}): WorkflowDefinition {
  return {
    workflowType: String(input.workflowType || '').trim(),
    nodes: [...input.nodes],
    edges: [...(input.edges || [])],
  };
}

export function aiGenerateNode(input: WorkflowNodeBase & { config: AiGenerateNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_AI_GENERATE, {
    oneofKind: 'aiGenerateConfig',
    aiGenerateConfig: input.config,
  });
}

export function aiStreamNode(input: WorkflowNodeBase & { config: AiStreamNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_AI_STREAM, {
    oneofKind: 'aiStreamConfig',
    aiStreamConfig: input.config,
  });
}

export function aiEmbedNode(input: WorkflowNodeBase & { config: AiEmbedNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_AI_EMBED, {
    oneofKind: 'aiEmbedConfig',
    aiEmbedConfig: input.config,
  });
}

export function aiImageNode(input: WorkflowNodeBase & { config: AiImageNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_AI_IMAGE, {
    oneofKind: 'aiImageConfig',
    aiImageConfig: input.config,
  });
}

export function aiVideoNode(input: WorkflowNodeBase & { config: AiVideoNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_AI_VIDEO, {
    oneofKind: 'aiVideoConfig',
    aiVideoConfig: input.config,
  });
}

export function aiTtsNode(input: WorkflowNodeBase & { config: AiTtsNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_AI_TTS, {
    oneofKind: 'aiTtsConfig',
    aiTtsConfig: input.config,
  });
}

export function aiSttNode(input: WorkflowNodeBase & { config: AiSttNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_AI_STT, {
    oneofKind: 'aiSttConfig',
    aiSttConfig: input.config,
  });
}

export function extractNode(input: WorkflowNodeBase & { config: ExtractNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_TRANSFORM_EXTRACT, {
    oneofKind: 'extractConfig',
    extractConfig: input.config,
  });
}

export function templateNode(input: WorkflowNodeBase & { config: TemplateNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_TRANSFORM_TEMPLATE, {
    oneofKind: 'templateConfig',
    templateConfig: input.config,
  });
}

export function scriptNode(input: WorkflowNodeBase & { config: ScriptNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_TRANSFORM_SCRIPT, {
    oneofKind: 'scriptConfig',
    scriptConfig: input.config,
  });
}

export function branchNode(input: WorkflowNodeBase & { config: BranchNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_CONTROL_BRANCH, {
    oneofKind: 'branchConfig',
    branchConfig: input.config,
  });
}

export function mergeNode(input: WorkflowNodeBase & { config: MergeNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_CONTROL_MERGE, {
    oneofKind: 'mergeConfig',
    mergeConfig: input.config,
  });
}

export function noopNode(input: WorkflowNodeBase & { config?: NoopNodeConfig }): WorkflowNode {
  return createNode(input, WorkflowNodeType.WORKFLOW_NODE_CONTROL_NOOP, {
    oneofKind: 'noopConfig',
    noopConfig: input.config || {},
  });
}
