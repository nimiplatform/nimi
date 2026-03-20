// Relay media planner — adapted from local-chat media-planner.ts
// Changed imports to local types. Replaced getPromptLocale with 'en' default.
// Removed RuntimeRouteBinding dependency.

import { z } from 'zod';
import type { LocalChatTarget, LocalChatPromptTrace, LocalChatTurnAiClient } from '../chat-pipeline/types.js';
import type { NsfwMediaPolicy } from './nsfw-media-policy.js';
import { pt, type PromptLocale } from '../prompt/prompt-locale.js';
import type { JsonObject } from '../../shared/json.js';

export type { NsfwMediaPolicy };

export type MediaPlannerTrigger = 'user-explicit' | 'assistant-offer' | 'scene-enhancement' | 'none' | 'marker-override';

export type MediaPlannerDecision = {
  kind: 'none' | 'image' | 'video';
  trigger: Exclude<MediaPlannerTrigger, 'user-explicit' | 'marker-override'>;
  confidence: number;
  subject: string;
  scene: string;
  styleIntent: string;
  mood: string;
  hints?: {
    composition?: string;
    negativeCues?: string[];
    continuityRefs?: string[];
  };
  reason: string;
  nsfwIntent: 'none' | 'suggested';
};

export type MediaPlannerResult = {
  status: 'ok';
  decision: MediaPlannerDecision;
  traceId: string;
  routeSource: 'local' | 'cloud';
  routeModel?: string;
} | {
  status: 'failed';
  reason: string;
  traceId?: string;
};

const MEDIA_PLANNER_TIMEOUT_MS = 2500;
const MEDIA_PLANNER_MAX_TOKENS = 420;
const MEDIA_PLANNER_TEMPERATURE = 0.1;

const mediaPlannerDecisionSchema = z.object({
  kind: z.enum(['none', 'image', 'video']),
  trigger: z.enum(['assistant-offer', 'scene-enhancement', 'none']),
  confidence: z.number().min(0).max(1),
  subject: z.string().max(280).default(''),
  scene: z.string().max(320).default(''),
  styleIntent: z.string().max(240).default(''),
  mood: z.string().max(120).default(''),
  hints: z.object({
    composition: z.string().max(240).optional(),
    negativeCues: z.array(z.string().max(120)).max(6).optional(),
    continuityRefs: z.array(z.string().max(120)).max(6).optional(),
  }).optional(),
  reason: z.string().max(240).default(''),
  nsfwIntent: z.enum(['none', 'suggested']).default('none'),
});

type MediaPlannerDecisionObject = z.infer<typeof mediaPlannerDecisionSchema>;

function parseMediaPlannerDecisionObject(object: MediaPlannerDecisionObject): JsonObject {
  const result = mediaPlannerDecisionSchema.safeParse(object);
  if (!result.success) {
    throw new Error('RELAY_MEDIA_PLANNER_SCHEMA_INVALID');
  }
  const decision = result.data;
  return {
    kind: decision.kind,
    trigger: decision.kind === 'none' ? 'none' : decision.trigger,
    confidence: Number(decision.confidence),
    subject: String(decision.subject || '').trim(),
    scene: String(decision.scene || '').trim(),
    styleIntent: String(decision.styleIntent || '').trim(),
    mood: String(decision.mood || '').trim(),
    hints: decision.hints
      ? {
        ...(String(decision.hints.composition || '').trim()
          ? { composition: String(decision.hints.composition || '').trim() }
          : {}),
        ...(Array.isArray(decision.hints.negativeCues) && decision.hints.negativeCues.length > 0
          ? { negativeCues: decision.hints.negativeCues.map((value) => String(value || '').trim()).filter(Boolean) }
          : {}),
        ...(Array.isArray(decision.hints.continuityRefs) && decision.hints.continuityRefs.length > 0
          ? { continuityRefs: decision.hints.continuityRefs.map((value) => String(value || '').trim()).filter(Boolean) }
          : {}),
      }
      : undefined,
    reason: String(decision.reason || '').trim(),
    nsfwIntent: decision.nsfwIntent,
  };
}

function summarizeWorld(target: LocalChatTarget): string {
  const worldName = String(target.worldName || '').trim();
  return worldName || '-';
}

function summarizeTarget(target: LocalChatTarget): string {
  const bio = String(target.bio || '').trim();
  const identity = `${target.displayName} (@${target.handle})`;
  return bio ? `${identity} - ${bio}` : identity;
}

function formatPromptTraceHints(trace: LocalChatPromptTrace | null | undefined): string {
  if (!trace) return '-';
  return [
    `segments=${trace.planSegments ?? '-'}`,
    `parse=${trace.segmentParseMode || '-'}`,
    `nsfw=${trace.nsfwPolicy || '-'}`,
  ].join(', ');
}

function buildMediaPlannerPrompt(input: {
  userText: string;
  assistantText: string;
  target: LocalChatTarget;
  nsfwPolicy: NsfwMediaPolicy;
  imageReady: boolean;
  videoReady: boolean;
  imageDependencyStatus: string;
  videoDependencyStatus: string;
  recentMediaSummary: string;
  promptTrace: LocalChatPromptTrace | null;
  visualAnchorSummary: string;
  recentTurnSummary: string;
  continuitySummary: string;
  promptLocale?: PromptLocale;
}): string {
  const locale = input.promptLocale || 'en';
  return [
    pt(locale, 'planner.role'),
    pt(locale, 'planner.task'),
    pt(locale, 'planner.require'),
    pt(locale, 'planner.rulesHeader'),
    pt(locale, 'planner.rule1'),
    pt(locale, 'planner.rule2'),
    pt(locale, 'planner.rule3'),
    pt(locale, 'planner.rule4'),
    pt(locale, 'planner.rule5'),
    pt(locale, 'planner.rule6'),
    pt(locale, 'planner.rule7'),
    '',
    pt(locale, 'planner.outputFormat'),
    '{"kind":"none|image|video","trigger":"assistant-offer|scene-enhancement|none","confidence":0.0,"subject":"string","scene":"string","styleIntent":"string","mood":"string","hints":{"composition":"string?","negativeCues":["string"],"continuityRefs":["string"]},"reason":"string","nsfwIntent":"none|suggested"}',
    '',
    pt(locale, 'planner.targetSummary', { value: summarizeTarget(input.target) }),
    pt(locale, 'planner.worldSummary', { value: summarizeWorld(input.target) }),
    pt(locale, 'planner.visualAnchor', { value: input.visualAnchorSummary || '-' }),
    pt(locale, 'planner.userInput', { value: input.userText || '-' }),
    pt(locale, 'planner.assistantText', { value: input.assistantText || '-' }),
    pt(locale, 'planner.recentTurns', { value: input.recentTurnSummary || '-' }),
    pt(locale, 'planner.continuity', { value: input.continuitySummary || '-' }),
    pt(locale, 'planner.diagnostics', { value: formatPromptTraceHints(input.promptTrace) }),
    pt(locale, 'planner.nsfwPolicy', { value: input.nsfwPolicy }),
    pt(locale, 'planner.imageReady', { ready: input.imageReady ? 'yes' : 'no', status: input.imageDependencyStatus }),
    pt(locale, 'planner.videoReady', { ready: input.videoReady ? 'yes' : 'no', status: input.videoDependencyStatus }),
    pt(locale, 'planner.recentMedia', { value: input.recentMediaSummary }),
    '',
    pt(locale, 'planner.decisionHeader'),
    pt(locale, 'planner.decisionOffer'),
    pt(locale, 'planner.decisionScene'),
    pt(locale, 'planner.decisionNone'),
    pt(locale, 'planner.decisionSubject'),
    pt(locale, 'planner.decisionSceneDesc'),
    pt(locale, 'planner.decisionStyle'),
    pt(locale, 'planner.decisionMood'),
  ].join('\n');
}

function normalizeReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const reasonCode = (error
    && typeof error === 'object'
    && 'reasonCode' in error) ? String((error as {
    reasonCode?: unknown;
  }).reasonCode || '').trim() : '';
  if (reasonCode) return reasonCode;
  return String(error || 'RELAY_MEDIA_PLANNER_FAILED');
}

export async function planMediaTurn(input: {
  aiClient: Pick<LocalChatTurnAiClient, 'generateObject'>;
  userText: string;
  assistantText: string;
  target: LocalChatTarget;
  worldId?: string | null;
  nsfwPolicy: NsfwMediaPolicy;
  imageReady: boolean;
  videoReady: boolean;
  imageDependencyStatus: string;
  videoDependencyStatus: string;
  recentMediaSummary: string;
  promptTrace: LocalChatPromptTrace | null;
  visualAnchorSummary: string;
  recentTurnSummary: string;
  continuitySummary: string;
  promptLocale?: PromptLocale;
}): Promise<MediaPlannerResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, MEDIA_PLANNER_TIMEOUT_MS);
  try {
    const result = await input.aiClient.generateObject<MediaPlannerDecisionObject>({
      prompt: buildMediaPlannerPrompt({
        userText: input.userText,
        assistantText: input.assistantText,
        target: input.target,
        nsfwPolicy: input.nsfwPolicy,
        imageReady: input.imageReady,
        videoReady: input.videoReady,
        imageDependencyStatus: input.imageDependencyStatus,
        videoDependencyStatus: input.videoDependencyStatus,
        recentMediaSummary: input.recentMediaSummary,
        promptTrace: input.promptTrace,
        visualAnchorSummary: input.visualAnchorSummary,
        recentTurnSummary: input.recentTurnSummary,
        continuitySummary: input.continuitySummary,
        promptLocale: input.promptLocale,
      }),
      maxTokens: MEDIA_PLANNER_MAX_TOKENS,
      temperature: MEDIA_PLANNER_TEMPERATURE,
      agentId: input.target.id,
    });
    const rawObject = parseMediaPlannerDecisionObject(result.object);
    const decisionResult = mediaPlannerDecisionSchema.safeParse(rawObject);
    if (!decisionResult.success) {
      return {
        status: 'failed',
        reason: 'RELAY_MEDIA_PLANNER_SCHEMA_INVALID',
        traceId: String(result.traceId || '').trim() || undefined,
      };
    }
    const decision = decisionResult.data;
    return {
      status: 'ok',
      decision: {
        kind: decision.kind,
        trigger: decision.kind === 'none' ? 'none' : decision.trigger,
        confidence: decision.confidence,
        subject: String(decision.subject || '').trim(),
        scene: String(decision.scene || '').trim(),
        styleIntent: String(decision.styleIntent || '').trim(),
        mood: String(decision.mood || '').trim(),
        hints: decision.hints
          ? {
            ...(String(decision.hints.composition || '').trim()
              ? { composition: String(decision.hints.composition || '').trim() }
              : {}),
            ...(Array.isArray(decision.hints.negativeCues) && decision.hints.negativeCues.length > 0
              ? { negativeCues: decision.hints.negativeCues.map((value) => String(value || '').trim()).filter(Boolean) }
              : {}),
            ...(Array.isArray(decision.hints.continuityRefs) && decision.hints.continuityRefs.length > 0
              ? { continuityRefs: decision.hints.continuityRefs.map((value) => String(value || '').trim()).filter(Boolean) }
              : {}),
          }
          : undefined,
        reason: String(decision.reason || '').trim(),
        nsfwIntent: decision.nsfwIntent,
      },
      traceId: String(result.traceId || '').trim(),
      routeSource: 'cloud',
      routeModel: undefined,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: normalizeReason(error),
      traceId: (error
        && typeof error === 'object'
        && 'traceId' in error) ? String((error as {
        traceId?: unknown;
      }).traceId || '').trim() || undefined : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}
