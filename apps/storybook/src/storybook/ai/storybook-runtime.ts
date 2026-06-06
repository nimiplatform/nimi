// Runtime readiness + dispatch entry for the app UI. Resolves the scaffold-managed
// platform client (AuthGate projection) and forwards to the generation layer. If
// the runtime projection is not ready, returns a typed unavailable instead of
// attempting any provider call.

import { getRuntimePlatformProjection } from '../../shell/auth/runtime-platform.js';
import { loadStorybookAIConfig } from './storybook-ai-config-store.js';
import { storybookAIUnavailable } from './storybook-unavailable.js';
import {
  generateBibleDraft,
  generateSceneText,
  generateChoiceSuggestions,
  generateAssetImage,
  type GenerationOutcome,
} from './storybook-generation.js';

export type StorybookRuntimeInspection = {
  status: 'ready' | 'unavailable';
  mode: string;
  detail: string;
};

export async function inspectStorybookRuntime(): Promise<StorybookRuntimeInspection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return { status: 'unavailable', mode: projection.mode, detail: projection.message };
  }
  try {
    await projection.client.runtime.health({});
    return { status: 'ready', mode: projection.mode, detail: 'Runtime session ready. Storybook routes AI through runtime.ai.* / runtime.media.* via an NimiAIConfig binding.' };
  } catch (error) {
    return { status: 'unavailable', mode: projection.mode, detail: error instanceof Error ? error.message : String(error || 'Runtime health check failed.') };
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runBibleDraft(input: { projectId: string; premise: string; styleHint?: string }): Promise<GenerationOutcome<string>> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    const unavailable = storybookAIUnavailable('text.generate', 'runtime-not-ready', projection.message);
    return { ...unavailable, run: { id: 'genrun-unready', projectId: input.projectId, kind: 'bible-draft', request: {}, provenance: { at: nowIso(), status: 'unavailable', reason: 'runtime-not-ready' }, outputRefs: [] } };
  }
  return generateBibleDraft(projection.client, { ...input, now: nowIso() }, loadStorybookAIConfig());
}

export async function runSceneText(input: { projectId: string; contextLines: string[]; instruction: string }): Promise<GenerationOutcome<string>> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    const unavailable = storybookAIUnavailable('text.generate', 'runtime-not-ready', projection.message);
    return { ...unavailable, run: { id: 'genrun-unready', projectId: input.projectId, kind: 'scene-text', request: {}, provenance: { at: nowIso(), status: 'unavailable', reason: 'runtime-not-ready' }, outputRefs: [] } };
  }
  return generateSceneText(projection.client, { ...input, now: nowIso() }, loadStorybookAIConfig());
}

export async function runChoiceSuggestions(input: { projectId: string; nodeText: string; count: number }): Promise<GenerationOutcome<string[]>> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    const unavailable = storybookAIUnavailable('text.generate', 'runtime-not-ready', projection.message);
    return { ...unavailable, run: { id: 'genrun-unready', projectId: input.projectId, kind: 'choice-suggestions', request: {}, provenance: { at: nowIso(), status: 'unavailable', reason: 'runtime-not-ready' }, outputRefs: [] } };
  }
  return generateChoiceSuggestions(projection.client, { ...input, now: nowIso() }, loadStorybookAIConfig());
}

export async function runAssetImage(input: { projectId: string; assetRef: string; description: string }): Promise<GenerationOutcome<{ artifactRef: string; mimeType: string }>> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    const unavailable = storybookAIUnavailable('image.generate', 'runtime-not-ready', projection.message);
    return { ...unavailable, run: { id: 'genrun-unready', projectId: input.projectId, kind: 'asset-image', request: {}, provenance: { at: nowIso(), status: 'unavailable', reason: 'runtime-not-ready' }, outputRefs: [] } };
  }
  return generateAssetImage(projection.client, { ...input, now: nowIso() });
}
