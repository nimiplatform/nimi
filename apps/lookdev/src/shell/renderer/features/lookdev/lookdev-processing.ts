import type { ImageGenerateInput, Runtime } from '@nimiplatform/sdk/runtime';
import { buildEvaluationSystemPrompt, buildGenerationPrompt } from './prompting.js';
import { parseEvaluationJson, validateEvaluation } from './evaluation.js';
import type { LookdevAuditEvent, LookdevAuditEventKind, LookdevAuditEventScope, LookdevAuditEventSeverity, LookdevEvaluationResult, LookdevImageArtifact, LookdevItem, LookdevPolicySnapshot, LookdevWorldStylePack } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAuditEvent(input: {
  batchId: string;
  kind: LookdevAuditEventKind;
  scope: LookdevAuditEventScope;
  severity: LookdevAuditEventSeverity;
  itemId?: string;
  agentId?: string;
  agentDisplayName?: string;
  count?: number;
  detail?: string;
  occurredAt?: string;
}): LookdevAuditEvent {
  return {
    eventId: createId('lookdev-audit'),
    batchId: input.batchId,
    occurredAt: input.occurredAt || nowIso(),
    kind: input.kind,
    scope: input.scope,
    severity: input.severity,
    itemId: input.itemId,
    agentId: input.agentId,
    agentDisplayName: input.agentDisplayName,
    count: input.count,
    detail: input.detail,
  };
}

function normalizeArtifact(result: Awaited<ReturnType<Runtime['media']['image']['generate']>>, prompt: string): LookdevImageArtifact {
  const artifact = result.artifacts[0];
  if (!artifact) {
    throw new Error('LOOKDEV_IMAGE_ARTIFACT_MISSING');
  }
  const artifactRecord = artifact as unknown as Record<string, unknown>;
  let url = String(artifactRecord.url || artifact.uri || '').trim();
  if (!url && artifact.bytes && artifact.bytes.length > 0) {
    let binary = '';
    for (const byte of artifact.bytes) {
      binary += String.fromCharCode(byte);
    }
    const mimeType = String(artifact.mimeType || 'image/png').trim() || 'image/png';
    url = `data:${mimeType};base64,${globalThis.btoa(binary)}`;
  }
  if (!url) {
    throw new Error('LOOKDEV_IMAGE_URL_MISSING');
  }
  return {
    url,
    mimeType: String(artifact.mimeType || 'image/png').trim() || 'image/png',
    width: artifact.width || undefined,
    height: artifact.height || undefined,
    traceId: String(result.trace?.traceId || '').trim() || undefined,
    artifactId: String(artifact.artifactId || '').trim() || undefined,
    promptSnapshot: prompt,
    createdAt: nowIso(),
  };
}

function resolveTargetRoute(target: LookdevPolicySnapshot['generationTarget'] | LookdevPolicySnapshot['evaluationTarget']): 'local' | 'cloud' {
  return target.route === 'local' || target.source === 'local' ? 'local' : 'cloud';
}

function resolveTargetConnectorId(target: LookdevPolicySnapshot['generationTarget'] | LookdevPolicySnapshot['evaluationTarget']): string | undefined {
  const route = resolveTargetRoute(target);
  const connectorId = String(target.connectorId || '').trim();
  if (route === 'cloud' && connectorId) {
    return connectorId;
  }
  return undefined;
}

export async function evaluateLookdevImage(runtime: Runtime, item: LookdevItem, image: LookdevImageArtifact, policy: LookdevPolicySnapshot): Promise<LookdevEvaluationResult> {
  if (!policy.evaluationTarget.modelId) {
    throw new Error('LOOKDEV_VISION_TARGET_MISSING');
  }
  if (resolveTargetRoute(policy.evaluationTarget) === 'cloud' && !resolveTargetConnectorId(policy.evaluationTarget)) {
    throw new Error('LOOKDEV_VISION_TARGET_MISSING');
  }
  const artifactId = String(image.artifactId || '').trim();
  if (!artifactId) {
    throw new Error('LOOKDEV_EVALUATION_ARTIFACT_REQUIRED');
  }
  const response = await runtime.ai.text.generate({
    model: policy.evaluationTarget.modelId,
    ...(resolveTargetConnectorId(policy.evaluationTarget)
      ? { connectorId: resolveTargetConnectorId(policy.evaluationTarget) }
      : {}),
    route: resolveTargetRoute(policy.evaluationTarget),
    system: buildEvaluationSystemPrompt(policy.autoEvalPolicy.scoreThreshold),
    input: [{
      role: 'user',
      content: [
        { type: 'text', text: `Evaluate ${item.agentDisplayName} portrait candidate.` },
        {
          type: 'artifact_ref',
          artifactId,
          mimeType: String(image.mimeType || 'image/png').trim() || 'image/png',
          displayName: `${item.agentDisplayName} candidate`,
        },
      ],
    }],
    temperature: 0,
    maxTokens: 600,
  });
  const parsed = parseEvaluationJson(response.text);
  return validateEvaluation(parsed, policy.autoEvalPolicy.scoreThreshold);
}

function targetUsesNativeGeminiRequest(target: LookdevPolicySnapshot['generationTarget']): boolean {
  const provider = String(target.provider || '').trim().toLowerCase();
  const connectorId = String(target.connectorId || '').trim().toLowerCase();
  const endpoint = String(target.endpoint || '').trim().toLowerCase();
  const endpointIsOpenAI = endpoint.endsWith('/openai');
  if (endpointIsOpenAI) {
    return false;
  }
  return provider === 'gemini'
    || provider.startsWith('google:gemini')
    || connectorId === 'sys-cloud-gemini';
}

function targetSupportsRichImageParameters(target: LookdevPolicySnapshot['generationTarget']): boolean {
  const provider = String(target.provider || '').trim().toLowerCase();
  const endpoint = String(target.endpoint || '').trim().toLowerCase();
  if (!provider) {
    return false;
  }
  if (endpoint.endsWith('/openai')) {
    return true;
  }
  return provider === 'openai'
    || provider === 'stability'
    || provider === 'ideogram'
    || provider === 'flux'
    || provider === 'kling'
    || provider === 'glm'
    || provider === 'dashscope'
    || provider === 'kimi'
    || provider === 'minimax'
    || provider === 'volcengine';
}

function isCanonicalPortraitReferenceUrl(item: LookdevItem, value: string | null | undefined): value is string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  const existing = String(item.existingPortraitUrl || '').trim();
  if (existing && normalized === existing) {
    return true;
  }
  return false;
}

export async function generateLookdevItem(input: {
  runtime: Runtime;
  item: LookdevItem;
  policy: LookdevPolicySnapshot;
  worldStylePackSnapshot: LookdevWorldStylePack;
}): Promise<LookdevImageArtifact> {
  const { runtime, item, policy, worldStylePackSnapshot } = input;
  if (!policy.generationTarget.modelId) {
    throw new Error('LOOKDEV_IMAGE_TARGET_MISSING');
  }
  if (resolveTargetRoute(policy.generationTarget) === 'cloud' && !resolveTargetConnectorId(policy.generationTarget)) {
    throw new Error('LOOKDEV_IMAGE_TARGET_MISSING');
  }
  const prompt = buildGenerationPrompt(item, policy, worldStylePackSnapshot);
  const referenceImages = [
    item.referenceImageUrl,
    item.existingPortraitUrl,
  ].filter((value): value is string => isCanonicalPortraitReferenceUrl(item, value));

  const baseRequest: ImageGenerateInput = {
    model: policy.generationTarget.modelId,
    ...(resolveTargetConnectorId(policy.generationTarget)
      ? { connectorId: resolveTargetConnectorId(policy.generationTarget) }
      : {}),
    route: resolveTargetRoute(policy.generationTarget),
    prompt,
  };

  const request: ImageGenerateInput = targetUsesNativeGeminiRequest(policy.generationTarget)
    ? {
        ...baseRequest,
        ...(policy.generationPolicy.aspectRatio ? { aspectRatio: policy.generationPolicy.aspectRatio } : {}),
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      }
    : targetSupportsRichImageParameters(policy.generationTarget)
      ? {
          ...baseRequest,
          ...(policy.generationPolicy.aspectRatio ? { aspectRatio: policy.generationPolicy.aspectRatio } : {}),
          ...(referenceImages.length > 0 ? { referenceImages } : {}),
          negativePrompt: policy.generationPolicy.negativePrompt,
          style: policy.generationPolicy.style,
          n: 1,
          responseFormat: 'url' as const,
        }
      : baseRequest;

  const response = await runtime.media.image.generate(request);
  return normalizeArtifact(response, prompt);
}
