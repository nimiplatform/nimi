import { getPlatformClient } from '@nimiplatform/sdk';
import { getCurrentLocale } from '@renderer/i18n/index.js';
import { parseContinuationBeat, parseStoryOpening } from './moment-parser.js';
import { buildContinuationPrompt, buildContinuationSystemPrompt, buildOpeningSystemPrompt, buildOpeningTextPrompt } from './moment-prompts.js';
import type { MomentRuntimeTargetOption } from './runtime-targets.js';
import type { MomentContinuationBeat, MomentPlayState, MomentRelationState, MomentSeed, MomentSession, MomentStoryOpening } from './types.js';

export const MOMENT_MIN_BEATS = 2;
export const MOMENT_MAX_BEATS = 4;

export function deriveMomentPlayState(beatIndex: number, sealed: boolean): MomentPlayState {
  if (sealed || beatIndex >= MOMENT_MAX_BEATS) {
    return 'sealed';
  }
  if (beatIndex >= MOMENT_MIN_BEATS) {
    return 'sealing';
  }
  return 'open';
}

export function deriveMomentRelationState(session: Pick<MomentSession, 'opening' | 'turns'>): MomentRelationState {
  return session.turns.at(-1)?.relationState || session.opening.relationState;
}

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() || `moment-${Date.now()}`;
}

export async function generateStoryOpening(input: {
  seed: MomentSeed;
  textTarget: MomentRuntimeTargetOption;
  visionTarget?: MomentRuntimeTargetOption;
}): Promise<{ opening: MomentStoryOpening; usedVision: boolean }> {
  const locale = getCurrentLocale();
  const runtime = getPlatformClient().runtime;
  const seed = input.seed;
  const promptText = buildOpeningTextPrompt(seed, locale);

  if (seed.mode === 'image') {
    const visionTarget = input.visionTarget;
    if (!visionTarget?.modelId || !seed.imageDataUrl) {
      throw new Error('MOMENT_VISION_TARGET_REQUIRED');
    }
    const response = await runtime.ai.text.generate({
      model: visionTarget.modelId,
      ...(visionTarget.connectorId ? { connectorId: visionTarget.connectorId } : {}),
      route: visionTarget.route,
      system: buildOpeningSystemPrompt(locale),
      input: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', imageUrl: seed.imageDataUrl, detail: 'auto' },
          ],
        },
      ],
      temperature: 0.7,
      maxTokens: 1_400,
    });

    return {
      opening: parseStoryOpening(response.text, response.trace?.traceId),
      usedVision: true,
    };
  }

  const response = await runtime.ai.text.generate({
    model: input.textTarget.modelId,
    ...(input.textTarget.connectorId ? { connectorId: input.textTarget.connectorId } : {}),
    route: input.textTarget.route,
    system: buildOpeningSystemPrompt(locale),
    input: promptText,
    temperature: 0.72,
    maxTokens: 1_200,
  });

  return {
    opening: parseStoryOpening(response.text, response.trace?.traceId),
    usedVision: false,
  };
}

export async function continueMoment(input: {
  session: MomentSession;
  userLine: string;
  textTarget: MomentRuntimeTargetOption;
}): Promise<MomentContinuationBeat> {
  const locale = getCurrentLocale();
  const runtime = getPlatformClient().runtime;

  const response = await runtime.ai.text.generate({
    model: input.textTarget.modelId,
    ...(input.textTarget.connectorId ? { connectorId: input.textTarget.connectorId } : {}),
    route: input.textTarget.route,
    system: buildContinuationSystemPrompt(locale),
    input: buildContinuationPrompt({
      opening: input.session.opening,
      turns: input.session.turns,
      userLine: input.userLine,
    }),
    temperature: 0.72,
    maxTokens: 1_000,
  });

  return parseContinuationBeat(response.text, {
    userLine: input.userLine,
    traceId: response.trace?.traceId,
  });
}

export function createMomentSession(input: {
  seed: MomentSeed;
  opening: MomentStoryOpening;
  textTarget: MomentRuntimeTargetOption;
  visionTarget?: MomentRuntimeTargetOption;
}): MomentSession {
  return {
    sessionId: createSessionId(),
    createdAt: new Date().toISOString(),
    seed: input.seed,
    opening: input.opening,
    turns: [],
    beatIndex: 0,
    relationState: input.opening.relationState,
    playState: 'open',
    sealed: false,
    textTarget: {
      key: input.textTarget.key,
      route: input.textTarget.route,
      connectorId: input.textTarget.connectorId,
      modelId: input.textTarget.modelId,
      provider: input.textTarget.provider,
      modelLabel: input.textTarget.modelLabel,
    },
    ...(input.visionTarget
      ? {
          visionTarget: {
            key: input.visionTarget.key,
            route: input.visionTarget.route,
            connectorId: input.visionTarget.connectorId,
            modelId: input.visionTarget.modelId,
            provider: input.visionTarget.provider,
            modelLabel: input.visionTarget.modelLabel,
          },
        }
      : {}),
  };
}
