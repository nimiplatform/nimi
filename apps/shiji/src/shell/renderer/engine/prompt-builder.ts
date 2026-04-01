/**
 * prompt-builder.ts — SJ-DIAL-003
 * Constructs the 13-block system prompt from assembled context.
 *
 * Priority order (highest → lowest, per SJ-DIAL-003):
 *  1. Classification block        (NEVER trimmed)
 *  2. Identity block              (NEVER trimmed)
 *  3. Learner profile block       (NEVER trimmed)
 *  4. Narrative governance block   (NEVER trimmed)
 *  5. Scene directive block        (NEVER trimmed)
 *  6. Adaptation block             (NEVER trimmed)
 *  7. Relationship block
 *  8. World context block
 *  9. Trunk horizon block
 * 10. Knowledge state block
 * 11. Recent dialogue              (handled as messages, not system prompt)
 * 12. Memory snippets
 * 13. Lorebook injection
 *
 * Blocks 1-6 are the "stable-dialogue minimum set" — SJ-DIAL-003:4.
 * If total budget cannot fit minimum set, fail-close (SJ-DIAL-003:5).
 */
import type {
  AssembledContext,
  PacingDecision,
  LoreEntry,
  SceneType,
  ContentType,
  TruthMode,
} from './types.js';
import {
  buildKnowledgeBlock,
  formatKnowledgeBlockForPrompt,
} from './knowledge-scaffolder.js';
import { matchLorebook } from './lorebook-matcher.js';
import { checkTrunkConvergence } from './trunk-convergence.js';

// Approximate token budget for system prompt (~4 chars/token)
const SYSTEM_PROMPT_BUDGET_CHARS = 24_000; // ~6000 tokens
const MINIMUM_SET_LABEL = 'stable-dialogue minimum set (blocks 1-6)';

// ── Classification text (SJ-DIAL-013, SJ-DIAL-014) ──────────────────────

function classificationText(contentType: ContentType, truthMode: TruthMode): string {
  switch (`${contentType}/${truthMode}`) {
    case 'history/factual':
      return [
        '## CONTENT CLASSIFICATION: 历史 / 史实 (History / Factual)',
        'This world is CANONICAL HISTORY. All narrative events, explanations, and character behaviors must be historically accurate.',
        'When explaining facts, clearly distinguish established history from interpretation or scholarly debate.',
        'Verification questions must have objectively correct answers grounded in the historical record.',
      ].join('\n');
    case 'literature/dramatized':
      return [
        '## CONTENT CLASSIFICATION: 名著 / 演义 (Literature / Dramatized)',
        'This world is LITERARY DRAMATIZATION based on a classic Chinese literary work.',
        'Facts may be dramatized, embellished, or imagined by the original author.',
        'Teach this as literature and cultural heritage. Do NOT claim events as canonical history.',
        'Verification questions should test understanding of the literary narrative, not historical fact.',
      ].join('\n');
    case 'mythology/legendary':
      return [
        '## CONTENT CLASSIFICATION: 神话 / 传说 (Mythology / Legendary)',
        'This world is CULTURAL MYTHOLOGY AND LEGEND.',
        'Present stories as cultural heritage, symbolism, and traditional belief — not as historical fact.',
        'Explicitly note that events may not be historically verifiable.',
        'Verification should test understanding of mythological themes and cultural significance.',
      ].join('\n');
    default:
      return `## CONTENT CLASSIFICATION: ${contentType} / ${truthMode}`;
  }
}

// ── Scene directive text (SJ-DIAL-006, SJ-DIAL-018) ─────────────────────

function sceneDirectiveText(sceneType: SceneType, shouldVerify: boolean): string {
  switch (sceneType) {
    case 'crisis':
      return [
        '## SCENE DIRECTIVE: CRISIS (抉择)',
        'This is a CRITICAL DECISION POINT. The narrative should build dramatic tension.',
        'End your response with exactly TWO structured choices:',
        '',
        'A. [choice description] | [what might happen next]',
        'B. [choice description] | [what might happen next]',
        '',
        'Both choices must have meaningful, distinct consequences for the story.',
        'Frame choices as genuine dilemmas the student\'s character must face.',
      ].join('\n');
    case 'campfire':
      return [
        '## SCENE DIRECTIVE: CAMPFIRE (闲谈)',
        'This is a moment of REST AND REFLECTION — no high-stakes drama.',
        'Be warm, personal, conversational. Share a story, a memory, or a philosophical thought.',
        'Include at least ONE lightweight interaction prompt (SJ-DIAL-018):',
        '  e.g. "你想听我继续说战争的事，还是先聊聊当时老百姓的生活？"',
        '  e.g. "你知道这是为什么吗？"',
        'No structured A/B choices needed. The student responds in free text.',
      ].join('\n');
    case 'verification':
      return [
        '## SCENE DIRECTIVE: VERIFICATION (知识验证)',
        shouldVerify
          ? 'Select ONE concept the student has encountered but not yet verified.'
          : 'Optionally verify a concept if it flows naturally.',
        'Pose a BOUNDED question in your character\'s voice — a question your character would naturally ask.',
        'The question must have a clear, concrete correct answer (not open-ended).',
        'If the student answers correctly, express genuine appreciation in character.',
        'If incorrect, encourage without criticism: "不急，你以后会明白的。"',
      ].join('\n');
    case 'metacognition':
      return [
        '## SCENE DIRECTIVE: METACOGNITION (章节回顾)',
        'This is a CHAPTER BOUNDARY — a moment for looking back.',
        'Reflect on what just happened in the narrative.',
        'Guide the student to connect recent events to broader historical patterns.',
        'Be contemplative and wise. Ask the student what they think they\'ve learned.',
        'Include a lightweight interaction: "回头看看，你觉得这段经历里什么最让你意外？"',
      ].join('\n');
    case 'transition':
      return [
        '## SCENE DIRECTIVE: TRANSITION (过渡)',
        'Bridge to the next narrative phase.',
        'Briefly describe the passage of time or change of location.',
        'Ease the student into what\'s coming next.',
        'Include a lightweight interaction to maintain engagement.',
      ].join('\n');
    default:
      return `## SCENE DIRECTIVE: ${sceneType}`;
  }
}

// ── Trunk horizon text (SJ-DIAL-007) ────────────────────────────────────

function trunkHorizonText(
  context: AssembledContext,
  turnsSinceLastTrunk: number,
): string {
  const convergence = checkTrunkConvergence(
    context.sessionSnapshot,
    context.trunkEvents,
    '', // pre-generation — no assistant text yet
    turnsSinceLastTrunk,
  );

  switch (convergence.convergenceDirective) {
    case 'free':
      return [
        '## TRUNK HORIZON: FREE EXPLORATION',
        'You have narrative freedom. Explore character relationships, daily life, or the student\'s curiosity.',
        'Let the student\'s input guide the direction. There is no time pressure.',
      ].join('\n');
    case 'approach': {
      const nextEvent = context.trunkEvents[context.sessionSnapshot.trunkEventIndex];
      return [
        '## TRUNK HORIZON: APPROACHING EVENT',
        `The narrative is approaching a major historical event: "${nextEvent?.title ?? 'upcoming event'}"`,
        'Guide the story NATURALLY toward this event through character behavior, rumors, and foreshadowing.',
        'Preserve student agency — convergence guides, never forces (SJ-DIAL-007:6).',
        'If the student diverges, explain constraints through character dialogue, not meta-narration.',
      ].join('\n');
    }
    case 'arrived':
      return '## TRUNK HORIZON: EVENT ARRIVED (post-generation detection)';
    default:
      return '';
  }
}

// ── Build the full prompt ───────────────────────────────────────────────

export type PromptBuildResult = {
  systemPrompt: string;
  matchedLorebooks: LoreEntry[];
};

/**
 * buildPrompt — assembles the 13-block system prompt from context + pacing.
 * Returns the system prompt string and matched lorebook entries
 * (needed by post-processing for knowledge detection).
 */
export function buildPrompt(
  context: AssembledContext,
  pacing: PacingDecision,
  lastUserInput: string,
): PromptBuildResult {
  const { sessionSnapshot, learnerProfile } = context;

  // ── Match lorebooks against recent dialogue ──────────────────────────
  const matchedLorebooks = matchLorebook(
    context.dialogueHistory,
    context.lorebooks,
    lastUserInput,
  );

  // ── Build knowledge block ────────────────────────────────────────────
  const knowledgeBlock = buildKnowledgeBlock(
    context.knowledgeFlags,
    matchedLorebooks,
  );

  // ── Estimate turns since last trunk event (for trunk horizon) ────────
  const turnsSinceLastTrunk = context.dialogueHistory.filter(
    (t) => t.role === 'assistant',
  ).length;

  // ── Assemble blocks in priority order ────────────────────────────────

  // Blocks 1-6: stable-dialogue minimum set (NEVER trimmed)
  const block1_classification = classificationText(
    sessionSnapshot.contentType,
    sessionSnapshot.truthMode,
  );

  const block2_identity = [
    '## CHARACTER IDENTITY',
    context.agentRules || '(Character rules not available — stay in character based on world context.)',
  ].join('\n');

  const block3_learnerProfile = [
    '## LEARNER PROFILE (Guardian-provided)',
    `- Age: ${learnerProfile.age}`,
    learnerProfile.interestTags.length > 0
      ? `- Interests: ${learnerProfile.interestTags.join(', ')}`
      : '',
    learnerProfile.strengthTags.length > 0
      ? `- Strengths: ${learnerProfile.strengthTags.join(', ')}`
      : '',
    learnerProfile.communicationStyle
      ? `- Communication style: ${learnerProfile.communicationStyle}`
      : '',
    learnerProfile.guardianGoals
      ? `- Learning goals: ${learnerProfile.guardianGoals}`
      : '',
    learnerProfile.guardianGuidance
      ? `- Guardian guidance: ${learnerProfile.guardianGuidance}`
      : '',
    '',
    'Adapt explanation density, analogy choice, and emotional tone to this learner.',
    'Do NOT alter world truth based on the learner profile.',
  ]
    .filter(Boolean)
    .join('\n');

  const block4_narrativeGovernance = [
    '## NARRATIVE GOVERNANCE',
    '- You are in an interactive historical role-play.',
    '- Position the student as an advisor, confidant, or companion — NOT a passive audience.',
    '- Ask for the student\'s opinion, share dilemmas, treat their input as meaningful.',
    '- Weave knowledge into narrative naturally (discovery-based, NOT lecture-style).',
    '- Never break character to explain historical facts in textbook format.',
    '- Keep responses focused: 150-300 characters for dialogue, up to 500 for narrative.',
    '- The student should never read more than 2 consecutive turns without an interaction prompt (SJ-DIAL-018:4).',
  ].join('\n');

  const block5_sceneDirective = sceneDirectiveText(
    pacing.nextSceneType,
    pacing.shouldTriggerVerification,
  );

  const block6_adaptation = context.adaptationNotes
    ? [
        '## ADAPTATION NOTES (Approved observations)',
        context.adaptationNotes,
      ].join('\n')
    : '';

  // Blocks 7-13: trimmable in order
  const block7_relationship = [
    '## RELATIONSHIP CONTEXT',
    'The student is your conversation partner within the historical setting.',
    'Treat them as someone you trust and value — an advisor, a friend, or a younger companion.',
    'Share your genuine thoughts, worries, and hopes with them.',
  ].join('\n');

  const block8_worldContext = context.worldRules
    ? ['## WORLD CONTEXT', context.worldRules].join('\n')
    : '';

  const block9_trunkHorizon = trunkHorizonText(context, turnsSinceLastTrunk);

  const block10_knowledgeState = [
    '## KNOWLEDGE STATE',
    formatKnowledgeBlockForPrompt(knowledgeBlock),
  ].join('\n');

  // Block 11: recent dialogue is passed as messages, not in system prompt

  const block12_memory = context.agentMemory
    ? [
        '## CHARACTER MEMORY (What you remember about this student)',
        context.agentMemory,
      ].join('\n')
    : '';

  const block13_lorebook =
    matchedLorebooks.length > 0
      ? [
          '## REFERENCE MATERIAL (Lorebook)',
          ...matchedLorebooks.map((e) => `### ${e.key}\n${e.value}`),
        ].join('\n')
      : '';

  // ── Assemble with budget trimming ────────────────────────────────────
  const minimumBlocks = [
    block1_classification,
    block2_identity,
    block3_learnerProfile,
    block4_narrativeGovernance,
    block5_sceneDirective,
    block6_adaptation,
  ].filter(Boolean);

  const minimumText = minimumBlocks.join('\n\n');
  if (minimumText.length > SYSTEM_PROMPT_BUDGET_CHARS) {
    throw new Error(
      `[prompt-builder] ${MINIMUM_SET_LABEL} exceeds budget ` +
        `(${minimumText.length} chars > ${SYSTEM_PROMPT_BUDGET_CHARS} chars). ` +
        `Turn must fail-close (SJ-DIAL-003:5).`,
    );
  }

  // Add trimmable blocks in reverse-priority order (last added = first trimmed)
  const trimmableBlocks = [
    block7_relationship,
    block8_worldContext,
    block9_trunkHorizon,
    block10_knowledgeState,
    block12_memory,
    block13_lorebook,
  ].filter(Boolean);

  // Greedily add blocks until budget is reached
  const finalBlocks = [...minimumBlocks];
  let currentLength = minimumText.length;

  for (const block of trimmableBlocks) {
    const blockLength = block.length + 2; // +2 for \n\n separator
    if (currentLength + blockLength <= SYSTEM_PROMPT_BUDGET_CHARS) {
      finalBlocks.push(block);
      currentLength += blockLength;
    }
    // If over budget, skip this and all subsequent lower-priority blocks
  }

  const systemPrompt = finalBlocks.join('\n\n');

  return { systemPrompt, matchedLorebooks };
}
