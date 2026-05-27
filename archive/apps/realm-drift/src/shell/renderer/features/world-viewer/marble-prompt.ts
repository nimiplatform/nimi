import type { WorldDetailWithAgents, WorldviewData, WorldScene, WorldLorebook } from '../world-browser/world-browser-data.js';
import { getPlatformClient } from '@nimiplatform/sdk';

export type WorldReferenceBundle = {
  world: WorldDetailWithAgents;
  worldview: WorldviewData;
  scenes: WorldScene[];
  lorebooks: WorldLorebook[];
};

function sanitizePromptText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/{/g, '\\u007b')
    .replace(/}/g, '\\u007d')
    .replace(/`/g, '\\u0060')
    .trim();
}

/**
 * Phase 1: Assemble raw world data into structured context string.
 */
export function assembleRawContext(ctx: WorldReferenceBundle): string {
  const parts: string[] = [];

  // World identity
  parts.push(`World: ${sanitizePromptText(ctx.world.name)}`);
  if (ctx.world.description) parts.push(`Description: ${sanitizePromptText(ctx.world.description)}`);
  if (ctx.world.genre) parts.push(`Genre: ${sanitizePromptText(ctx.world.genre)}`);
  if (ctx.world.era) parts.push(`Era: ${sanitizePromptText(ctx.world.era)}`);
  if (ctx.world.themes && ctx.world.themes.length > 0) {
    parts.push(`Themes: ${ctx.world.themes.map((value) => sanitizePromptText(value)).join(', ')}`);
  }

  // Worldview
  const worldviewParts: string[] = [];
  if (ctx.worldview.timeModel) worldviewParts.push(`Time Model: ${sanitizePromptText(ctx.worldview.timeModel)}`);
  if (ctx.worldview.spaceTopology) worldviewParts.push(`Space Topology: ${sanitizePromptText(ctx.worldview.spaceTopology)}`);
  if (ctx.worldview.coreSystem) worldviewParts.push(`Core System: ${sanitizePromptText(ctx.worldview.coreSystem)}`);
  if (ctx.worldview.causality) worldviewParts.push(`Causality: ${sanitizePromptText(ctx.worldview.causality)}`);
  if (ctx.worldview.languages) worldviewParts.push(`Languages: ${sanitizePromptText(ctx.worldview.languages)}`);
  if (ctx.worldview.resources) worldviewParts.push(`Resources: ${sanitizePromptText(ctx.worldview.resources)}`);
  if (ctx.worldview.locations) worldviewParts.push(`Locations: ${sanitizePromptText(ctx.worldview.locations)}`);
  if (ctx.worldview.visualGuide) worldviewParts.push(`Visual Guide: ${sanitizePromptText(ctx.worldview.visualGuide)}`);
  if (worldviewParts.length > 0) {
    parts.push('');
    parts.push('Worldview:');
    parts.push(worldviewParts.join('\n'));
  }

  // Scenes (up to 3 per RD-MARBLE-002)
  if (ctx.scenes.length > 0) {
    parts.push('');
    parts.push('Key Locations:');
    for (const scene of ctx.scenes.slice(0, 3)) {
      const desc = scene.description ? ` - ${sanitizePromptText(scene.description)}` : '';
      parts.push(`  • ${sanitizePromptText(scene.name)}${desc}`);
    }
  }

  // Lorebooks (up to 5, filtered per RD-MARBLE-002)
  if (ctx.lorebooks.length > 0) {
    parts.push('');
    parts.push('Lore Entries:');
    for (const entry of ctx.lorebooks.slice(0, 5)) {
      const content = entry.content ? ` - ${sanitizePromptText(entry.content).slice(0, 200)}` : '';
      parts.push(`  • ${sanitizePromptText(entry.title)}${content}`);
    }
  }

  // Agents as inhabitants
  if (ctx.world.agents.length > 0) {
    parts.push('');
    parts.push('Inhabitants:');
    for (const agent of ctx.world.agents.slice(0, 10)) {
      const bio = agent.bio ? ` - ${sanitizePromptText(agent.bio)}` : '';
      parts.push(`  • ${sanitizePromptText(agent.name)}${bio}`);
    }
  }

  return parts.join('\n');
}

/**
 * Phase 2: Use LLM to translate raw context into a visual scene description
 * optimized for 3D world generation.
 *
 * Falls back to direct concatenation if LLM is unavailable.
 */
export async function composeMarblePrompt(
  ctx: WorldReferenceBundle,
  signal?: AbortSignal,
): Promise<string> {
  const rawContext = assembleRawContext(ctx);
  const fallbackPrompt = `Create a single 3D scene from this sanitized world reference:\n\n${rawContext}`;

  try {
    const { runtime } = getPlatformClient();
    const systemPrompt = [
      'You are a 3D environment description writer. Given structured world data,',
      'produce a vivid, spatially-detailed visual description of this world as a',
      'single explorable 3D environment. Focus on:',
      '- Physical landscape and architecture',
      '- Lighting, atmosphere, and weather',
      '- Key visual landmarks and spatial relationships',
      '- Materials, textures, and color palette',
      '- Scale and perspective',
      '',
      'Output a single paragraph (max 2000 characters) describing what this world',
      'LOOKS like as a 3D scene. Do not include character names, plot points, or',
      'abstract concepts — only visual, spatial, and atmospheric details.',
    ].join('\n');

    const output = await runtime.ai.text.stream({
      model: 'auto',
      input: `Translate this world data into a visual 3D scene description:\n\n${rawContext}`,
      system: systemPrompt,
      route: 'cloud',
      metadata: { surfaceId: 'realm-drift-prompt-gen' },
      signal,
    });

    let result = '';
    for await (const part of output.stream) {
      if (signal?.aborted) break;
      if (part.type === 'delta') {
        result += part.text;
      }
      if (part.type === 'error') {
        throw new Error(String(part.error));
      }
    }

    if (result.trim()) {
      return result.trim();
    }
  } catch {
    // LLM unavailable — fall through to direct concatenation
  }

  return fallbackPrompt;
}

/**
 * Find the best image URL from world data for image-guided generation.
 */
export function findWorldImageUrl(ctx: WorldReferenceBundle): string | undefined {
  // Prefer world banner
  if (ctx.world.bannerUrl) return ctx.world.bannerUrl;
  // Then world icon
  if (ctx.world.iconUrl) return ctx.world.iconUrl;
  // Then first scene image
  for (const scene of ctx.scenes) {
    if (scene.imageUrl) return scene.imageUrl;
  }
  return undefined;
}
