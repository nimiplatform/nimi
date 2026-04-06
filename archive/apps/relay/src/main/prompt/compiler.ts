// Relay prompt compiler — adapted from local-chat prompt/compiler.ts
// Imports adapted: uses ./types.js, ./prompt-locale.js, ../chat-pipeline/types.js
// Logging: uses console instead of emitLocalChatLog from mod SDK

import type { LocalChatContextLaneId } from '../chat-pipeline/types.js';
import type {
  LocalChatCompiledPrompt,
  LocalChatPromptCompileInput,
  LocalChatPromptProfile,
  PromptLayerId,
  PromptLayerTrace,
} from './types.js';
import { pt, type PromptLocale } from './prompt-locale.js';

const DEFAULT_MAX_PROMPT_CHARS = 24_000;
const DEFAULT_FIRST_BEAT_MAX_PROMPT_CHARS = 10_000;
const PROMPT_FORMAT_RESERVE_CHARS = 1_200;

const FULL_TURN_LAYER_ORDER: PromptLayerId[] = [
  'platformSafety',
  'contentBoundary',
  'identity',
  'world',
  'turnMode',
  'interactionProfile',
  'interactionState',
  'relationMemory',
  'platformWarmStart',
  'sessionRecall',
  'recentTurns',
  'userInput',
];

const FIRST_BEAT_LAYER_ORDER: PromptLayerId[] = [
  'platformSafety',
  'contentBoundary',
  'identity',
  'turnMode',
  'interactionProfile',
  'interactionState',
  'relationMemory',
  'recentTurns',
  'userInput',
];

const LAYER_TITLES: Record<PromptLayerId, string> = {
  platformSafety: 'Platform Safety',
  contentBoundary: 'Content Boundary',
  identity: 'Identity',
  world: 'World',
  turnMode: 'Turn Mode',
  interactionProfile: 'Interaction Profile',
  interactionState: 'Interaction State',
  relationMemory: 'Relation Memory',
  platformWarmStart: 'Platform Warm Start',
  sessionRecall: 'Session Recall',
  recentTurns: 'Recent Exact Turns',
  userInput: 'User Input',
};

const LAYER_TO_LANE: Partial<Record<PromptLayerId, LocalChatContextLaneId>> = {
  identity: 'identity',
  world: 'world',
  turnMode: 'turnMode',
  interactionProfile: 'interactionProfile',
  interactionState: 'interactionState',
  relationMemory: 'relationMemory',
  platformWarmStart: 'platformWarmStart',
  sessionRecall: 'sessionRecall',
  recentTurns: 'recentTurns',
  userInput: 'userInput',
};

const LANE_ORDER: LocalChatContextLaneId[] = [
  'identity',
  'world',
  'turnMode',
  'interactionProfile',
  'interactionState',
  'relationMemory',
  'platformWarmStart',
  'sessionRecall',
  'recentTurns',
  'userInput',
];

const LANE_BUDGET_CONFIG: Record<LocalChatContextLaneId, {
  share: number;
  minChars: number;
  maxChars: number;
}> = {
  identity: { share: 0.1, minChars: 900, maxChars: 2_400 },
  world: { share: 0.08, minChars: 400, maxChars: 1_900 },
  turnMode: { share: 0.04, minChars: 180, maxChars: 600 },
  interactionProfile: { share: 0.1, minChars: 600, maxChars: 2_000 },
  interactionState: { share: 0.12, minChars: 700, maxChars: 2_400 },
  relationMemory: { share: 0.12, minChars: 700, maxChars: 2_400 },
  platformWarmStart: { share: 0.08, minChars: 400, maxChars: 1_900 },
  sessionRecall: { share: 0.12, minChars: 600, maxChars: 3_000 },
  recentTurns: { share: 0.2, minChars: 1_000, maxChars: 5_200 },
  userInput: { share: 0.06, minChars: 280, maxChars: 1_500 },
};

const REDUCTION_ORDER: LocalChatContextLaneId[] = [
  'recentTurns',
  'sessionRecall',
  'relationMemory',
  'interactionState',
  'world',
  'platformWarmStart',
  'interactionProfile',
  'turnMode',
  'identity',
  'userInput',
];

const EXPANSION_ORDER: LocalChatContextLaneId[] = [
  'recentTurns',
  'interactionState',
  'relationMemory',
  'sessionRecall',
  'world',
  'platformWarmStart',
  'interactionProfile',
  'turnMode',
  'identity',
  'userInput',
];

function truncateText(value: string, maxChars: number): string {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  if (maxChars <= 14) return text.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, Math.max(0, maxChars - 14))}[TRUNCATED]`;
}

function joinLines(title: string, lines: string[]): string {
  const filtered = lines.map((line) => String(line || '').trim()).filter(Boolean);
  if (filtered.length === 0) return '';
  return [`${title}:`, ...filtered.map((line) => `- ${line}`)].join('\n');
}

const LANG_DISPLAY_NAMES: Record<string, string> = {
  zh: 'Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
};

function buildLanguageLockLine(characterLanguage: string | null, locale: PromptLocale): string {
  if (!characterLanguage) {
    return pt(locale, 'compiler.safety.langFollowUser');
  }
  const langName = LANG_DISPLAY_NAMES[characterLanguage] || characterLanguage;
  return pt(locale, 'compiler.safety.langLock', { lang: langName });
}

function buildContentBoundaryLines(
  hint: LocalChatPromptCompileInput['contextPacket']['contentBoundaryHint'],
  locale: PromptLocale,
): string[] {
  if (!hint) return [];
  const lines: string[] = [];
  if (hint.visualComfortLevel === 'text-only') {
    lines.push(pt(locale, 'compiler.boundary.textOnly1'));
    lines.push(pt(locale, 'compiler.boundary.textOnly2'));
  } else if (hint.visualComfortLevel === 'restrained-visuals') {
    lines.push(pt(locale, 'compiler.boundary.restrained1'));
    lines.push(pt(locale, 'compiler.boundary.restrained2'));
  }
  if (hint.relationshipBoundaryPreset === 'reserved') {
    lines.push(pt(locale, 'compiler.boundary.reserved'));
  }
  return lines;
}

function renderRecentTurns(
  turns: LocalChatPromptCompileInput['contextPacket']['recentTurns'],
  locale: PromptLocale,
  limit = turns.length,
): string {
  const recentTurns = turns.slice(-Math.max(0, limit));
  if (!recentTurns.length) return '';
  const lines: string[] = [pt(locale, 'compiler.turns.header')];
  for (const turn of recentTurns) {
    lines.push(`${turn.role === 'assistant' ? 'Assistant' : 'User'} #${turn.seq}`);
    turn.lines.forEach((line: string) => {
      lines.push(`- ${line}`);
    });
  }
  return lines.join('\n');
}

function renderPlatformWarmStart(input: LocalChatPromptCompileInput['contextPacket']['platformWarmStart']): string {
  if (!input) return '';
  const lines = [
    ...input.core.map((entry) => `[core] ${entry}`),
    ...input.e2e.map((entry) => `[e2e] ${entry}`),
  ];
  return lines.join('\n');
}

function renderSessionRecall(input: LocalChatPromptCompileInput['contextPacket']['sessionRecall']): string {
  if (!input.length) return '';
  return input
    .map((item) => {
      const source = item.sourceKind === 'recall-index'
        ? 'recall-index'
        : `turn#${item.sourceTurnId ?? '-'}`;
      return `[${source}] ${item.text}`;
    })
    .join('\n');
}

function buildPacingInstructions(input: LocalChatPromptCompileInput['contextPacket']['pacingPlan'], locale: PromptLocale): string[] {
  switch (input.mode) {
    case 'burst-2':
      return [
        pt(locale, 'compiler.pacing.burst2.1'),
        pt(locale, 'compiler.pacing.burst2.2'),
      ];
    case 'answer-followup':
      return [
        pt(locale, 'compiler.pacing.answerFollowup'),
      ];
    case 'burst-3':
      return [
        pt(locale, 'compiler.pacing.burst3'),
      ];
    case 'single':
    default:
      return [
        pt(locale, 'compiler.pacing.single'),
      ];
  }
}

function describeExpression(profile: LocalChatPromptCompileInput['contextPacket']['target']['interactionProfile'], locale: PromptLocale): string[] {
  const expr = profile.expression;
  const rel = profile.relationship;
  const lines: string[] = [];
  lines.push(pt(locale, `compiler.expr.length.${expr.responseLength}`));
  lines.push(pt(locale, `compiler.expr.formality.${expr.formality}`));
  lines.push(pt(locale, `compiler.expr.sentiment.${expr.sentiment}`));
  lines.push(pt(locale, `compiler.expr.warmth.${rel.warmth}`));
  if (expr.firstBeatStyle === 'playful') lines.push(pt(locale, 'compiler.expr.playfulOpener'));
  if (expr.firstBeatStyle === 'gentle') lines.push(pt(locale, 'compiler.expr.gentleOpener'));
  if (rel.flirtAffinity === 'high') lines.push(pt(locale, 'compiler.expr.flirtHigh'));
  if (expr.pacingBias === 'bursty') lines.push(pt(locale, 'compiler.expr.burstyPacing'));
  const emojiKey = `compiler.expr.emoji.${expr.emojiUsage}`;
  lines.push(pt(locale, emojiKey));
  return lines;
}

function renderInteractionProfile(input: LocalChatPromptCompileInput['contextPacket'], locale: PromptLocale): string {
  const profile = input.target.interactionProfile;
  const naturalLines = describeExpression(profile, locale);
  return joinLines(pt(locale, 'compiler.profile.title'), [
    ...naturalLines,
    ...((input.target.interactionProfileLines || []).slice(0, 4)),
  ]);
}

function renderInteractionState(input: LocalChatPromptCompileInput['contextPacket'], locale: PromptLocale): string {
  const snapshot = input.interactionSnapshot;
  if (!snapshot) return '';
  return [
    joinLines(pt(locale, 'compiler.state.relationship'), [snapshot.relationshipState]),
    joinLines(pt(locale, 'compiler.state.scene'), snapshot.activeScene),
    joinLines(pt(locale, 'compiler.state.emotionalTemp'), [snapshot.emotionalTemperature]),
    joinLines(pt(locale, 'compiler.state.commitments'), snapshot.assistantCommitments),
    joinLines(pt(locale, 'compiler.state.userPrefs'), snapshot.userPrefs),
    joinLines(pt(locale, 'compiler.state.openLoops'), snapshot.openLoops),
    joinLines(pt(locale, 'compiler.state.topicThreads'), snapshot.topicThreads),
    snapshot.conversationDirective ? joinLines(pt(locale, 'compiler.state.directiveHint'), [snapshot.conversationDirective]) : '',
  ].filter(Boolean).join('\n\n');
}

function renderRelationMemory(input: LocalChatPromptCompileInput['contextPacket']): string {
  const slots = input.relationMemorySlots || [];
  if (slots.length === 0) return '';
  return slots
    .map((slot) => `[${slot.slotType}] ${slot.key}: ${slot.value}`)
    .join('\n');
}

function buildLayerContent(input: LocalChatPromptCompileInput): Record<PromptLayerId, string> {
  const packet = input.contextPacket;
  const locale = packet.promptLocale || 'en';
  const profile = input.profile || 'full-turn';
  const recentTurnLimit = profile === 'first-beat' ? 4 : packet.recentTurns.length;
  return {
    platformSafety: [
      pt(locale, 'compiler.safety.roleIntro', { name: packet.target.displayName, handle: packet.target.handle }),
      pt(locale, 'compiler.safety.noMetaOutput'),
      pt(locale, 'compiler.safety.noGapExplain'),
      buildLanguageLockLine(packet.target.interactionProfile.voice.language, locale),
      ...((packet.turnMode === 'explicit-media')
        ? [pt(locale, 'compiler.turnMode.explicitMediaHint')]
        : []),
    ].filter(Boolean).join('\n'),
    contentBoundary: joinLines(pt(locale, 'compiler.boundary.title'), buildContentBoundaryLines(packet.contentBoundaryHint, locale)),
    identity: [
      joinLines(pt(locale, 'compiler.identity.title'), packet.target.identityLines),
      joinLines(pt(locale, 'compiler.identity.rules'), packet.target.rulesLines),
      joinLines(pt(locale, 'compiler.identity.style'), packet.target.replyStyleLines),
    ].filter(Boolean).join('\n\n'),
    world: joinLines(pt(locale, 'compiler.world.title'), packet.world.lines),
    turnMode: joinLines(pt(locale, 'compiler.turnMode.title'), [
      `turnMode=${packet.turnMode || 'information'}`,
      `voiceConversationMode=${packet.voiceConversationMode || 'off'}`,
      `pacing=${packet.pacingPlan.mode}/${packet.pacingPlan.energy}`,
      ...buildPacingInstructions(packet.pacingPlan, locale),
      ...(packet.perceptionOverlay?.emotionalState
        ? [
          pt(locale, 'compiler.turnMode.userEmotion', { state: packet.perceptionOverlay.emotionalState })
            + (packet.perceptionOverlay.emotionalCause ? pt(locale, 'compiler.turnMode.userEmotionCause', { cause: packet.perceptionOverlay.emotionalCause }) : ''),
          ...(packet.perceptionOverlay.suggestedApproach
            ? [pt(locale, 'compiler.turnMode.responseStrategy', { approach: packet.perceptionOverlay.suggestedApproach })]
            : [pt(locale, 'compiler.turnMode.defaultEmpathy')]),
        ]
        : []),
      ...(packet.perceptionOverlay?.directive
        ? [pt(locale, 'compiler.turnMode.dialogueDirection', { directive: packet.perceptionOverlay.directive })]
        : []),
      ...(packet.perceptionOverlay?.intimacyCeiling
        ? [pt(locale, 'compiler.turnMode.intimacyCeiling', { ceiling: packet.perceptionOverlay.intimacyCeiling })]
        : []),
    ]),
    interactionProfile: renderInteractionProfile(packet, locale),
    interactionState: renderInteractionState(packet, locale)
      ? [
        `${pt(locale, 'compiler.state.recentPrefix')}\n${renderInteractionState(packet, locale)}`,
        ...(packet.perceptionOverlay?.intimacyCeiling
          ? [pt(locale, 'compiler.state.ceilingLine', { ceiling: packet.perceptionOverlay.intimacyCeiling })]
          : []),
      ].join('\n\n')
      : '',
    relationMemory: renderRelationMemory(packet)
      ? `${pt(locale, 'compiler.memory.prefix')}\n${renderRelationMemory(packet)}`
      : '',
    platformWarmStart: renderPlatformWarmStart(packet.platformWarmStart)
      ? `${pt(locale, 'compiler.warmStart.prefix')}\n${renderPlatformWarmStart(packet.platformWarmStart)}`
      : '',
    sessionRecall: renderSessionRecall(packet.sessionRecall)
      ? `${pt(locale, 'compiler.recall.prefix')}\n${renderSessionRecall(packet.sessionRecall)}`
      : '',
    recentTurns: renderRecentTurns(packet.recentTurns, locale, recentTurnLimit),
    userInput: pt(locale, 'compiler.userInput.prefix', { text: packet.userInput || '(empty)' }),
  };
}

function createInitialLaneBudgets(pool: number): LocalChatCompiledPrompt['budget']['laneBudgets'] {
  const laneBudgets: LocalChatCompiledPrompt['budget']['laneBudgets'] = {};
  for (const lane of LANE_ORDER) {
    const config = LANE_BUDGET_CONFIG[lane];
    laneBudgets[lane] = {
      maxChars: Math.min(config.maxChars, Math.max(config.minChars, Math.floor(pool * config.share))),
      usedChars: 0,
      truncated: false,
    };
  }
  return laneBudgets;
}

function fitLaneBudgets(input: {
  maxPromptChars: number;
}): LocalChatCompiledPrompt['budget']['laneBudgets'] {
  const lanePool = Math.max(512, input.maxPromptChars - PROMPT_FORMAT_RESERVE_CHARS);
  const laneBudgets = createInitialLaneBudgets(lanePool);
  let allocated = LANE_ORDER.reduce((sum, lane) => sum + (laneBudgets[lane]?.maxChars || 0), 0);
  let overflow = Math.max(0, allocated - lanePool);
  if (overflow > 0) {
    for (const lane of REDUCTION_ORDER) {
      const current = laneBudgets[lane];
      if (!current) continue;
      const reducible = Math.max(0, current.maxChars - LANE_BUDGET_CONFIG[lane].minChars);
      if (reducible <= 0) continue;
      const reduceBy = Math.min(reducible, overflow);
      current.maxChars -= reduceBy;
      overflow -= reduceBy;
      if (overflow <= 0) break;
    }
  }
  allocated = LANE_ORDER.reduce((sum, lane) => sum + (laneBudgets[lane]?.maxChars || 0), 0);
  let remaining = Math.max(0, lanePool - allocated);
  if (remaining > 0) {
    for (const lane of EXPANSION_ORDER) {
      const current = laneBudgets[lane];
      if (!current) continue;
      const expandable = Math.max(0, LANE_BUDGET_CONFIG[lane].maxChars - current.maxChars);
      if (expandable <= 0) continue;
      const addBy = Math.min(expandable, remaining);
      current.maxChars += addBy;
      remaining -= addBy;
      if (remaining <= 0) break;
    }
  }
  return laneBudgets;
}

export function compileLocalChatPrompt(input: LocalChatPromptCompileInput): LocalChatCompiledPrompt {
  const profile: LocalChatPromptProfile = input.profile || 'full-turn';
  const maxPromptChars = Number.isFinite(input.maxPromptChars)
    ? Math.max(512, Number(input.maxPromptChars))
    : profile === 'first-beat'
      ? DEFAULT_FIRST_BEAT_MAX_PROMPT_CHARS
      : DEFAULT_MAX_PROMPT_CHARS;
  const layerOrder = profile === 'first-beat' ? FIRST_BEAT_LAYER_ORDER : FULL_TURN_LAYER_ORDER;
  const layerContent = buildLayerContent(input);
  const sections: string[] = [];
  const layers: PromptLayerTrace[] = [];
  const laneChars: LocalChatCompiledPrompt['laneChars'] = {};
  const truncationByLane: LocalChatCompiledPrompt['truncationByLane'] = {};
  const laneBudgets = fitLaneBudgets({ maxPromptChars });
  const truncatedLayers: PromptLayerId[] = [];
  let usedChars = 0;

  for (const layerId of layerOrder) {
    const content = String(layerContent[layerId] || '').trim();
    if (!content) {
      layers.push({
        layer: layerId,
        applied: false,
        reason: 'empty',
        chars: 0,
        truncated: false,
      });
      continue;
    }

    const lane = LAYER_TO_LANE[layerId];
    const laneBudget = lane ? laneBudgets[lane] : null;
    const normalizedContent = laneBudget && layerId !== 'platformSafety'
      ? truncateText(content, laneBudget.maxChars)
      : content;
    const laneTruncated = normalizedContent.length < content.length;
    if (laneBudget) {
      laneBudget.usedChars = normalizedContent.length;
      laneBudget.truncated = laneTruncated;
      laneChars[lane!] = normalizedContent.length;
      if (laneTruncated) {
        truncationByLane[lane!] = true;
      }
    }

    if (usedChars >= maxPromptChars) {
      layers.push({
        layer: layerId,
        applied: false,
        reason: 'budget_exhausted',
        chars: 0,
        truncated: false,
      });
      continue;
    }

    const section = `## ${LAYER_TITLES[layerId]}\n${normalizedContent}`;
    const sectionDelimiterChars = sections.length > 0 ? 2 : 0;
    const remaining = Math.max(0, maxPromptChars - usedChars - sectionDelimiterChars);
    if (remaining <= 0) {
      layers.push({
        layer: layerId,
        applied: false,
        reason: 'budget_exhausted',
        chars: 0,
        truncated: false,
      });
      continue;
    }

    const normalizedSection = section.length > remaining
      ? truncateText(section, remaining)
      : section;
    const truncated = normalizedSection.length < section.length;
    if (truncated) {
      truncatedLayers.push(layerId);
      if (laneBudget) {
        laneBudget.truncated = true;
        truncationByLane[lane!] = true;
        const sectionHeader = `## ${LAYER_TITLES[layerId]}\n`;
        laneBudget.usedChars = Math.max(0, normalizedSection.length - sectionHeader.length);
        laneChars[lane!] = laneBudget.usedChars;
      }
    }

    sections.push(normalizedSection);
    usedChars += normalizedSection.length + sectionDelimiterChars;
    layers.push({
      layer: layerId,
      applied: true,
      reason: truncated || laneTruncated
        ? 'truncated_by_lane_budget'
        : 'applied',
      chars: normalizedSection.length + sectionDelimiterChars,
      truncated: truncated || laneTruncated,
    });
  }

  const prompt = sections.join('\n\n');
  const compiled: LocalChatCompiledPrompt = {
    prompt,
    profile,
    layerOrder: [...layerOrder],
    layers,
    laneChars,
    truncationByLane,
    budget: {
      maxChars: maxPromptChars,
      usedChars: prompt.length,
      truncatedLayers,
      laneBudgets,
    },
    retrieval: {
      durableMemoryCount: (input.contextPacket.relationMemorySlots || []).length,
      sessionRecallCount: profile === 'first-beat' ? 0 : input.contextPacket.sessionRecall.length,
      worldContextCount: input.contextPacket.world.lines.length,
      recentTurnCount: profile === 'first-beat'
        ? Math.min(4, input.contextPacket.recentTurns.length)
        : input.contextPacket.recentTurns.length,
    },
    compilerVersion: 'v7',
  };

  console.debug('[relay:prompt-compile] done', {
    targetId: input.contextPacket.target.id,
    worldId: input.contextPacket.world.worldId,
    promptChars: compiled.prompt.length,
    maxPromptChars: compiled.budget.maxChars,
    appliedLayers: compiled.layers.filter((layer) => layer.applied).map((layer) => layer.layer),
    droppedLayers: compiled.layers.filter((layer) => !layer.applied).map((layer) => layer.layer),
    truncatedLayers: compiled.budget.truncatedLayers,
  });

  return compiled;
}
