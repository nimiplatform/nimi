/**
 * Entity Image Generation Client — Forge (FG-CONTENT-008)
 *
 * Two-stage prompt engine: truth data brief → AI prompt refinement → image generation.
 * Upload-bind pipeline: generate → upload to CF → finalize → bind to entity.
 */

import { getPlatformClient } from '@nimiplatform/sdk';
import type { JsonObject } from '@renderer/bridge/types.js';
import { getResolvedAiParams } from '@renderer/hooks/use-ai-config.js';
import {
  createImageDirectUpload,
  finalizeResource,
} from './content-data-client.js';
import { updateAgent } from './agent-data-client.js';
import { batchUpsertWorldResourceBindings } from './world-data-client.js';

// ── Types ────────────────────────────────────────────────────

export type ImageGenTarget =
  | 'agent-avatar'
  | 'agent-portrait'
  | 'world-banner'
  | 'world-icon'
  | 'custom';

export type ImageGenEntityContext = {
  target: ImageGenTarget;
  /** Agent DNA object (identity, biological, appearance fields) */
  agentDna?: JsonObject | null;
  /** Agent soul prime structured data (backstory, coreValues, etc.) */
  agentSoulPrime?: {
    backstory?: string;
    coreValues?: string;
    personalityDescription?: string;
    guidelines?: string;
    catchphrase?: string;
  } | null;
  /** Agent display name */
  agentName?: string;
  /** Agent concept text */
  agentConcept?: string;
  /** World name */
  worldName?: string;
  /** World description */
  worldDescription?: string;
  /** World overview text */
  worldOverview?: string;
  /** World visual guide (from meta:visual:catalog rule) */
  worldVisualGuide?: JsonObject | null;
  /** World setting summary (from knowledgeGraph.worldSetting) */
  worldSetting?: string;
  /** User-provided freeform prompt addition */
  userPrompt?: string;
  /** Style override */
  style?: string;
  /** Aspect ratio override */
  aspectRatio?: string;
};

export type ImageGenPhase =
  | 'composing_prompt'
  | 'generating'
  | 'uploading'
  | 'binding'
  | 'done'
  | 'failed';

export type ImageGenCandidate = {
  id: string;
  url: string;
  prompt: string;
  negativePrompt: string;
  timestamp: number;
};

export type ImageGenResult = {
  candidates: ImageGenCandidate[];
  composedPrompt: string;
  composedNegativePrompt: string;
};

export type UploadAndBindResult = {
  resourceId: string;
  url: string;
};

// ── Brief Assembly ───────────────────────────────────────────

function extractDnaField(dna: JsonObject | null | undefined, ...path: string[]): string {
  if (!dna) return '';
  let current: unknown = dna;
  for (const key of path) {
    if (!current || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === 'string') return current.trim();
  if (Array.isArray(current)) return current.filter(Boolean).join(', ');
  return '';
}

function section(label: string, content: string): string {
  const trimmed = content.trim();
  return trimmed ? `[${label}]\n${trimmed}` : '';
}

export function assembleAgentAvatarBrief(ctx: ImageGenEntityContext): string {
  const parts: string[] = [];
  parts.push('Generate a character avatar portrait (head and shoulders, centered composition).');

  if (ctx.agentName) {
    parts.push(section('Character Name', ctx.agentName));
  }

  const dna = ctx.agentDna;
  if (dna) {
    const identity = extractDnaField(dna, 'identity', 'species');
    const gender = extractDnaField(dna, 'biological', 'gender');
    const age = extractDnaField(dna, 'biological', 'visualAge');
    const ethnicity = extractDnaField(dna, 'biological', 'ethnicity');
    const bioLine = [gender, age, ethnicity, identity].filter(Boolean).join(', ');
    if (bioLine) parts.push(section('Biological', bioLine));

    const hair = extractDnaField(dna, 'appearance', 'hair');
    const eyes = extractDnaField(dna, 'appearance', 'eyes');
    const skin = extractDnaField(dna, 'appearance', 'skin');
    const fashionStyle = extractDnaField(dna, 'appearance', 'fashionStyle');
    const signatureItems = extractDnaField(dna, 'appearance', 'signatureItems');
    const appearanceLine = [hair, eyes, skin, fashionStyle, signatureItems].filter(Boolean).join('; ');
    if (appearanceLine) parts.push(section('Appearance', appearanceLine));

    const artStyle = extractDnaField(dna, 'appearance', 'artStyle');
    if (artStyle) parts.push(section('Art Style', artStyle));
  }

  if (ctx.agentConcept) {
    parts.push(section('Character Concept', ctx.agentConcept));
  }

  if (ctx.worldVisualGuide) {
    const guide = stringifyVisualGuide(ctx.worldVisualGuide);
    if (guide) parts.push(section('World Visual Guide', guide));
  }

  if (ctx.userPrompt) {
    parts.push(section('Additional Instructions', ctx.userPrompt));
  }

  return parts.join('\n\n');
}

export function assembleAgentPortraitBrief(ctx: ImageGenEntityContext): string {
  const parts: string[] = [];
  parts.push('Generate a full-body character portrait with environment context.');

  if (ctx.agentName) {
    parts.push(section('Character Name', ctx.agentName));
  }

  const dna = ctx.agentDna;
  if (dna) {
    const identity = extractDnaField(dna, 'identity', 'species');
    const role = extractDnaField(dna, 'identity', 'role');
    const gender = extractDnaField(dna, 'biological', 'gender');
    const age = extractDnaField(dna, 'biological', 'visualAge');
    const height = extractDnaField(dna, 'biological', 'heightCm');
    const bioLine = [gender, age, identity, role, height ? `${height}cm` : ''].filter(Boolean).join(', ');
    if (bioLine) parts.push(section('Character', bioLine));

    const hair = extractDnaField(dna, 'appearance', 'hair');
    const eyes = extractDnaField(dna, 'appearance', 'eyes');
    const skin = extractDnaField(dna, 'appearance', 'skin');
    const fashionStyle = extractDnaField(dna, 'appearance', 'fashionStyle');
    const signatureItems = extractDnaField(dna, 'appearance', 'signatureItems');
    const artStyle = extractDnaField(dna, 'appearance', 'artStyle');
    const appearanceParts = [hair, eyes, skin, fashionStyle, signatureItems, artStyle].filter(Boolean);
    if (appearanceParts.length > 0) parts.push(section('Appearance', appearanceParts.join('; ')));
  }

  if (ctx.agentSoulPrime?.backstory) {
    parts.push(section('Backstory', ctx.agentSoulPrime.backstory));
  }
  if (ctx.agentConcept) {
    parts.push(section('Concept', ctx.agentConcept));
  }

  if (ctx.worldName || ctx.worldSetting) {
    parts.push(section('World Context', [ctx.worldName, ctx.worldSetting].filter(Boolean).join(' — ')));
  }

  if (ctx.worldVisualGuide) {
    const guide = stringifyVisualGuide(ctx.worldVisualGuide);
    if (guide) parts.push(section('World Visual Guide', guide));
  }

  if (ctx.userPrompt) {
    parts.push(section('Additional Instructions', ctx.userPrompt));
  }

  return parts.join('\n\n');
}

export function assembleWorldBannerBrief(ctx: ImageGenEntityContext): string {
  const parts: string[] = [];
  parts.push('Generate a cinematic wide-format banner image for a world (16:9 aspect ratio).');

  if (ctx.worldName) {
    parts.push(section('World Name', ctx.worldName));
  }
  if (ctx.worldDescription) {
    parts.push(section('World Description', ctx.worldDescription));
  }
  if (ctx.worldOverview) {
    parts.push(section('World Overview', ctx.worldOverview));
  }

  if (ctx.worldVisualGuide) {
    const guide = stringifyVisualGuide(ctx.worldVisualGuide);
    if (guide) parts.push(section('Visual Guide', guide));
  }

  if (ctx.worldSetting) {
    parts.push(section('World Setting', ctx.worldSetting));
  }

  if (ctx.userPrompt) {
    parts.push(section('Additional Instructions', ctx.userPrompt));
  }

  return parts.join('\n\n');
}

export function assembleWorldIconBrief(ctx: ImageGenEntityContext): string {
  const parts: string[] = [];
  parts.push('Generate a square icon/emblem for a world (1:1 aspect ratio, iconic, clean composition).');

  if (ctx.worldName) {
    parts.push(section('World Name', ctx.worldName));
  }
  if (ctx.worldDescription) {
    const desc = ctx.worldDescription.length > 200 ? ctx.worldDescription.slice(0, 200) + '...' : ctx.worldDescription;
    parts.push(section('World Description', desc));
  }

  if (ctx.worldVisualGuide) {
    const guide = stringifyVisualGuide(ctx.worldVisualGuide);
    if (guide) parts.push(section('Visual Guide', guide));
  }

  if (ctx.userPrompt) {
    parts.push(section('Additional Instructions', ctx.userPrompt));
  }

  return parts.join('\n\n');
}

function stringifyVisualGuide(guide: JsonObject): string {
  if (!guide || typeof guide !== 'object') return '';
  const entries = Object.entries(guide)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return entries.join('\n');
}

// ── AI Prompt Refinement (Stage 2) ───────────────────────────

const PROMPT_REFINEMENT_SYSTEM = `You are an expert image prompt engineer. Given a structured brief about a character or world, output an optimized image generation prompt.

Rules:
- Output EXACTLY two sections: PROMPT: and NEGATIVE:
- The PROMPT section should be a comma-separated list of descriptive tags and phrases, optimized for Stable Diffusion / SDXL models
- Include composition, lighting, quality tags (masterpiece, best quality, etc.) as appropriate
- The NEGATIVE section should list things to avoid (low quality, bad anatomy, etc.)
- Keep total prompt under 300 tokens
- Do NOT include character names in the prompt — describe appearance only
- Respect the art style and visual guide if provided

Example output format:
PROMPT: masterpiece, best quality, 1girl, silver hair, blue eyes, medieval armor, forest background, dramatic lighting, detailed face
NEGATIVE: low quality, worst quality, bad anatomy, blurry, watermark, text`;

export async function composeImagePrompt(brief: string): Promise<{ prompt: string; negativePrompt: string }> {
  const { runtime } = getPlatformClient();
  const textParams = getResolvedAiParams('text');

  const result = await runtime.ai.text.generate({
    model: textParams.model,
    connectorId: textParams.connectorId,
    route: textParams.route,
    input: brief,
    system: PROMPT_REFINEMENT_SYSTEM,
    maxTokens: 600,
    temperature: 0.7,
  });

  const text = String(result.text || '');
  return parsePromptResponse(text);
}

function parsePromptResponse(text: string): { prompt: string; negativePrompt: string } {
  const promptMatch = text.match(/PROMPT:\s*([\s\S]*?)(?=NEGATIVE:|$)/i);
  const negativeMatch = text.match(/NEGATIVE:\s*([\s\S]*?)$/i);

  const prompt = (promptMatch?.[1] || text).trim();
  const negativePrompt = (negativeMatch?.[1] || '').trim();

  return { prompt, negativePrompt };
}

// ── Brief Assembly Router ────────────────────────────────────

function assembleBrief(ctx: ImageGenEntityContext): string {
  switch (ctx.target) {
    case 'agent-avatar':
      return assembleAgentAvatarBrief(ctx);
    case 'agent-portrait':
      return assembleAgentPortraitBrief(ctx);
    case 'world-banner':
      return assembleWorldBannerBrief(ctx);
    case 'world-icon':
      return assembleWorldIconBrief(ctx);
    case 'custom':
      return ctx.userPrompt || '';
  }
}

function resolveAspectRatio(ctx: ImageGenEntityContext): string {
  if (ctx.aspectRatio) return ctx.aspectRatio;
  switch (ctx.target) {
    case 'agent-avatar':
    case 'world-icon':
      return '1:1';
    case 'world-banner':
      return '16:9';
    case 'agent-portrait':
      return '9:16';
    case 'custom':
      return '1:1';
  }
}

// ── Image Generation ─────────────────────────────────────────

export async function generateEntityImage(
  ctx: ImageGenEntityContext,
  onPhase?: (phase: ImageGenPhase) => void,
): Promise<ImageGenResult> {
  onPhase?.('composing_prompt');

  const brief = assembleBrief(ctx);
  let composedPrompt: string;
  let composedNegativePrompt: string;

  if (ctx.target === 'custom' && ctx.userPrompt && !brief.includes('[')) {
    // For custom mode with plain text, use prompt directly without AI refinement
    composedPrompt = ctx.userPrompt;
    composedNegativePrompt = '';
  } else {
    const refined = await composeImagePrompt(brief);
    composedPrompt = refined.prompt;
    composedNegativePrompt = refined.negativePrompt;
  }

  onPhase?.('generating');

  const { runtime } = getPlatformClient();
  const imageParams = getResolvedAiParams('image');

  const result = await runtime.media.image.generate({
    model: imageParams.model,
    connectorId: imageParams.connectorId,
    route: imageParams.route,
    prompt: composedPrompt,
    negativePrompt: composedNegativePrompt || undefined,
    aspectRatio: resolveAspectRatio(ctx),
    style: ctx.style,
    n: 1,
    responseFormat: 'url',
  });

  const candidates: ImageGenCandidate[] = result.artifacts.map((artifact) => {
    let imageUrl = artifact.uri || '';
    if (!imageUrl && artifact.bytes && artifact.bytes.length > 0) {
      const b64 = btoa(String.fromCharCode(...artifact.bytes));
      imageUrl = `data:${artifact.mimeType || 'image/png'};base64,${b64}`;
    }
    return {
      id: artifact.artifactId || crypto.randomUUID(),
      url: imageUrl,
      prompt: composedPrompt,
      negativePrompt: composedNegativePrompt,
      timestamp: Date.now(),
    };
  });

  onPhase?.('done');

  return {
    candidates,
    composedPrompt,
    composedNegativePrompt,
  };
}

// ── Upload & Bind Pipeline ───────────────────────────────────

export async function uploadImageToCloudflare(imageUrl: string): Promise<UploadAndBindResult> {
  const session = await createImageDirectUpload();
  const record = session && typeof session === 'object' && !Array.isArray(session)
    ? session as JsonObject
    : {};
  const uploadUrl = String(record.uploadUrl || '');
  const resourceId = String(record.resourceId || record.id || '');

  if (!uploadUrl) {
    throw new Error('FORGE_IMAGE_UPLOAD_NO_URL');
  }

  const response = await fetch(imageUrl);
  const blob = await response.blob();

  const formData = new FormData();
  formData.append('file', blob, `${resourceId || crypto.randomUUID()}.png`);
  let uploadResponse = await fetch(uploadUrl, { method: 'POST', body: formData });
  if (!uploadResponse.ok) {
    uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': blob.type || 'image/png' },
    });
  }

  if (!uploadResponse.ok) {
    throw new Error(`FORGE_IMAGE_UPLOAD_FAILED: ${uploadResponse.status}`);
  }

  const finalized = await finalizeResource(resourceId, {});
  const finalRecord = finalized && typeof finalized === 'object' && !Array.isArray(finalized)
    ? finalized as JsonObject
    : {};
  const deliveredUrl = String(finalRecord.url || '');

  return {
    resourceId,
    url: deliveredUrl || imageUrl,
  };
}

export async function uploadAndBindAgentAvatar(
  agentId: string,
  imageUrl: string,
  onPhase?: (phase: ImageGenPhase) => void,
): Promise<UploadAndBindResult> {
  onPhase?.('uploading');
  const uploaded = await uploadImageToCloudflare(imageUrl);

  onPhase?.('binding');
  await updateAgent(agentId, { avatarUrl: uploaded.url });

  onPhase?.('done');
  return uploaded;
}

export async function uploadAndBindWorldBanner(
  worldId: string,
  imageUrl: string,
  onPhase?: (phase: ImageGenPhase) => void,
): Promise<UploadAndBindResult> {
  onPhase?.('uploading');
  const uploaded = await uploadImageToCloudflare(imageUrl);

  onPhase?.('binding');
  await batchUpsertWorldResourceBindings(worldId, {
    bindingUpserts: [{
      objectType: 'RESOURCE',
      objectId: uploaded.resourceId,
      hostType: 'WORLD',
      hostId: worldId,
      bindingKind: 'PRESENTATION',
      bindingPoint: 'WORLD_BANNER',
      priority: 0,
    }],
  });

  onPhase?.('done');
  return uploaded;
}

export async function uploadAndBindWorldIcon(
  worldId: string,
  imageUrl: string,
  onPhase?: (phase: ImageGenPhase) => void,
): Promise<UploadAndBindResult> {
  onPhase?.('uploading');
  const uploaded = await uploadImageToCloudflare(imageUrl);

  onPhase?.('binding');
  await batchUpsertWorldResourceBindings(worldId, {
    bindingUpserts: [{
      objectType: 'RESOURCE',
      objectId: uploaded.resourceId,
      hostType: 'WORLD',
      hostId: worldId,
      bindingKind: 'PRESENTATION',
      bindingPoint: 'WORLD_ICON',
      priority: 0,
    }],
  });

  onPhase?.('done');
  return uploaded;
}
