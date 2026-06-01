// High-level Storybook generation requests with app-local provenance. These build
// `generation-run` records (request + provenance + output refs) whether the call
// succeeds OR fails. On failure they carry a typed unavailable state — never a
// fabricated artifact. Provider/model are recorded as provenance only, sourced
// from the AIConfig binding the runtime resolved; they are not Storybook truth.

import type { AIConfig } from '@nimiplatform/sdk/ai';
import type { PlatformClient } from '@nimiplatform/sdk';
import { mintId } from '../engine/ids.js';
import { invokeStorybookText, invokeStorybookImage } from './storybook-runtime-invokers.js';
import { type StorybookAIUnavailable } from './storybook-unavailable.js';

export type GenerationRunKind = 'bible-draft' | 'scene-text' | 'choice-suggestions' | 'asset-image';

export type GenerationProvenance = {
  at: string;
  route?: 'local' | 'cloud';
  model?: string;
  /** Provider/model abstraction ref: AIConfig hash, not a named provider. */
  configHash?: string;
  traceId?: string;
  status: 'succeeded' | 'unavailable';
  reason?: string;
};

export type GenerationRun = {
  id: string;
  projectId: string;
  kind: GenerationRunKind;
  request: Record<string, unknown>;
  provenance: GenerationProvenance;
  outputRefs: string[];
};

export type GenerationOutcome<T> =
  | { ok: true; value: T; run: GenerationRun }
  | (StorybookAIUnavailable & { run: GenerationRun });

function startRun(projectId: string, kind: GenerationRunKind, request: Record<string, unknown>): GenerationRun {
  return { id: mintId('genrun'), projectId, kind, request, provenance: { at: '', status: 'unavailable' }, outputRefs: [] };
}

export async function generateBibleDraft(
  client: PlatformClient,
  input: { projectId: string; premise: string; styleHint?: string; now: string },
  config?: AIConfig,
): Promise<GenerationOutcome<string>> {
  const run = startRun(input.projectId, 'bible-draft', { premise: input.premise, styleHint: input.styleHint });
  const directive = '你是一个互动叙事的设定助理。请基于给定前提，产出一段简洁、可被创作者审阅的 Storybook Bible 草案（世界、基调、风格指纹、节奏）。不要编造与前提冲突的硬设定。';
  const result = await invokeStorybookText(client, { prompt: input.premise + (input.styleHint ? `\n风格倾向：${input.styleHint}` : ''), directive, surfaceId: 'nimi.storybook.studio.bible' }, config);
  if (!result.ok) {
    return { ...result, run: { ...run, provenance: { at: input.now, status: 'unavailable', reason: result.reason } } };
  }
  const provenance: GenerationProvenance = { at: input.now, route: result.route, model: result.model, configHash: result.configHash, traceId: result.traceId, status: 'succeeded' };
  return { ok: true, value: result.text, run: { ...run, provenance, outputRefs: [run.id] } };
}

export async function generateSceneText(
  client: PlatformClient,
  input: { projectId: string; contextLines: string[]; instruction: string; now: string },
  config?: AIConfig,
): Promise<GenerationOutcome<string>> {
  const run = startRun(input.projectId, 'scene-text', { instruction: input.instruction });
  const directive = '你在一个受约束的互动叙事运行中生成场景文本。仅依据提供的上下文，不要引入新的硬设定或泄露私密事实。';
  const prompt = `${input.contextLines.join('\n')}\n\n指令：${input.instruction}`;
  const result = await invokeStorybookText(client, { prompt, directive, surfaceId: 'nimi.storybook.play.scene' }, config);
  if (!result.ok) {
    return { ...result, run: { ...run, provenance: { at: input.now, status: 'unavailable', reason: result.reason } } };
  }
  const provenance: GenerationProvenance = { at: input.now, route: result.route, model: result.model, configHash: result.configHash, traceId: result.traceId, status: 'succeeded' };
  return { ok: true, value: result.text, run: { ...run, provenance, outputRefs: [run.id] } };
}

export async function generateChoiceSuggestions(
  client: PlatformClient,
  input: { projectId: string; nodeText: string; count: number; now: string },
  config?: AIConfig,
): Promise<GenerationOutcome<string[]>> {
  const run = startRun(input.projectId, 'choice-suggestions', { count: input.count });
  const directive = `为当前场景生成 ${input.count} 个简短、互不重复的玩家选项，每行一个，不要编号。选项应可让玩家在不打字的情况下推进。`;
  const result = await invokeStorybookText(client, { prompt: input.nodeText, directive, surfaceId: 'nimi.storybook.play.choices' }, config);
  if (!result.ok) {
    return { ...result, run: { ...run, provenance: { at: input.now, status: 'unavailable', reason: result.reason } } };
  }
  const labels = result.text
    .split('\n')
    .map((line) => line.replace(/^[\s\-*0-9.、)]+/, '').trim())
    .filter(Boolean)
    .slice(0, input.count);
  const provenance: GenerationProvenance = { at: input.now, route: result.route, model: result.model, configHash: result.configHash, traceId: result.traceId, status: 'succeeded' };
  return { ok: true, value: labels, run: { ...run, provenance, outputRefs: [run.id] } };
}

export async function generateAssetImage(
  client: PlatformClient,
  input: { projectId: string; assetRef: string; description: string; now: string },
): Promise<GenerationOutcome<{ artifactRef: string; mimeType: string }>> {
  const run = startRun(input.projectId, 'asset-image', { assetRef: input.assetRef, description: input.description });
  const result = await invokeStorybookImage(client, { prompt: input.description, surfaceId: 'nimi.storybook.studio.asset' });
  if (!result.ok) {
    return { ...result, run: { ...run, provenance: { at: input.now, status: 'unavailable', reason: result.reason } } };
  }
  if (!result.firstArtifactRef || !result.firstArtifactMime) {
    // Runtime accepted the job but returned no usable artifact: this is NOT success.
    return {
      ok: false,
      capability: 'image.generate',
      reason: 'runtime-call-failed',
      message: `Image job ${result.jobId} (state=${result.jobState}) returned no usable artifact.`,
      actionHint: '检查运行时图像生成路由与配额后重试。缺失的产物不会被当作成功。',
      run: { ...run, provenance: { at: input.now, status: 'unavailable', reason: 'no-artifact' } },
    };
  }
  const provenance: GenerationProvenance = { at: input.now, status: 'succeeded' };
  return {
    ok: true,
    value: { artifactRef: result.firstArtifactRef, mimeType: result.firstArtifactMime },
    run: { ...run, provenance, outputRefs: [result.firstArtifactRef] },
  };
}
