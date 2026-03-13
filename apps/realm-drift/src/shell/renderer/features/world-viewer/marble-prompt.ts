import type { WorldDetailWithAgents, WorldviewData, WorldScene, WorldLorebook } from '../world-browser/world-browser-data.js';
import { getPlatformClient } from '@runtime/platform-client.js';

export type RawWorldContext = {
  world: WorldDetailWithAgents;
  worldview: WorldviewData;
  scenes: WorldScene[];
  lorebooks: WorldLorebook[];
};

/**
 * Phase 1: Assemble raw world data into structured context string.
 */
export function assembleRawContext(ctx: RawWorldContext): string {
  const parts: string[] = [];

  // World identity
  parts.push(`World: ${ctx.world.name}`);
  if (ctx.world.description) parts.push(`Description: ${ctx.world.description}`);
  if (ctx.world.genre) parts.push(`Genre: ${ctx.world.genre}`);
  if (ctx.world.era) parts.push(`Era: ${ctx.world.era}`);
  if (ctx.world.themes && ctx.world.themes.length > 0) {
    parts.push(`Themes: ${ctx.world.themes.join(', ')}`);
  }

  // Worldview
  const worldviewParts: string[] = [];
  if (ctx.worldview.description) worldviewParts.push(ctx.worldview.description);
  if (ctx.worldview.geography) worldviewParts.push(`Geography: ${ctx.worldview.geography}`);
  if (ctx.worldview.culture) worldviewParts.push(`Culture: ${ctx.worldview.culture}`);
  if (ctx.worldview.history) worldviewParts.push(`History: ${ctx.worldview.history}`);
  if (ctx.worldview.lore) worldviewParts.push(`Lore: ${ctx.worldview.lore}`);
  if (worldviewParts.length > 0) {
    parts.push('');
    parts.push('Worldview:');
    parts.push(worldviewParts.join('\n'));
  }

  // Scenes
  if (ctx.scenes.length > 0) {
    parts.push('');
    parts.push('Key Locations:');
    for (const scene of ctx.scenes.slice(0, 10)) {
      const desc = scene.description ? ` - ${scene.description}` : '';
      parts.push(`  • ${scene.name}${desc}`);
    }
  }

  // Lorebooks
  if (ctx.lorebooks.length > 0) {
    parts.push('');
    parts.push('Lore Entries:');
    for (const entry of ctx.lorebooks.slice(0, 8)) {
      const content = entry.content ? ` - ${entry.content.slice(0, 200)}` : '';
      parts.push(`  • ${entry.title}${content}`);
    }
  }

  // Agents as inhabitants
  if (ctx.world.agents.length > 0) {
    parts.push('');
    parts.push('Inhabitants:');
    for (const agent of ctx.world.agents.slice(0, 10)) {
      const bio = agent.bio ? ` - ${agent.bio}` : '';
      parts.push(`  • ${agent.name}${bio}`);
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
  ctx: RawWorldContext,
  signal?: AbortSignal,
): Promise<string> {
  const rawContext = assembleRawContext(ctx);

  try {
    const { runtime } = getPlatformClient();
    const systemPrompt = [
      'You are a visual scene designer. Given world data, produce a concise visual description',
      'optimized for 3D environment generation. Focus on:',
      '- Physical landscape, terrain, and atmospheric conditions',
      '- Architectural style and key structures',
      '- Lighting, color palette, and mood',
      '- Scale and spatial layout',
      '',
      'Output ONLY the visual description, no commentary. Keep it under 500 words.',
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

  // Fallback: use raw context directly
  return rawContext;
}

/**
 * Find the best image URL from world data for image-guided generation.
 */
export function findWorldImageUrl(ctx: RawWorldContext): string | undefined {
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
