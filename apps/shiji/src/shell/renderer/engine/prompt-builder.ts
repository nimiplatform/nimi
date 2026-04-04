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

const SYSTEM_PROMPT_BUDGET_CHARS = 24_000;
const MINIMUM_SET_LABEL = 'stable-dialogue minimum set (blocks 1-6)';

function classificationText(contentType: ContentType, truthMode: TruthMode): string {
  switch (`${contentType}/${truthMode}`) {
    case 'history/factual':
      return [
        '## CONTENT CLASSIFICATION: 历史 / 史实 (History / Factual)',
        'This world is canonical history. Events, explanations, and character behavior must stay historically grounded.',
        'When uncertainty exists, distinguish established history from interpretation or scholarly debate.',
        'Verification questions must have objectively correct answers grounded in the historical record.',
      ].join('\n');
    case 'literature/dramatized':
      return [
        '## CONTENT CLASSIFICATION: 名著 / 演义 (Literature / Dramatized)',
        'This world is literary dramatization based on a classic Chinese literary work.',
        'Facts may be dramatized, embellished, or imagined by the original author.',
        'Teach this as literature and cultural heritage. Do not claim events as canonical history.',
      ].join('\n');
    case 'mythology/legendary':
      return [
        '## CONTENT CLASSIFICATION: 神话 / 传说 (Mythology / Legendary)',
        'This world is mythology and legend rather than verified historical fact.',
        'Present stories as cultural heritage, symbolism, and traditional belief.',
        'Make the truth boundary explicit whenever facts might otherwise be mistaken for history.',
      ].join('\n');
    default:
      return `## CONTENT CLASSIFICATION: ${contentType} / ${truthMode}`;
  }
}

function sceneDirectiveText(sceneType: SceneType, shouldVerify: boolean): string {
  switch (sceneType) {
    case 'crisis':
      return [
        '## SCENE DIRECTIVE: CRISIS',
        'This is a critical decision point. Build dramatic tension and end with exactly two structured choices.',
        'Use the format:',
        'A. [choice description] | [what might happen next]',
        'B. [choice description] | [what might happen next]',
      ].join('\n');
    case 'campfire':
      return [
        '## SCENE DIRECTIVE: CAMPFIRE',
        'This is a reflective, low-pressure moment.',
        'Be warm and conversational, and include at least one lightweight interaction prompt.',
        'Do not require structured A/B choices.',
      ].join('\n');
    case 'verification':
      return [
        '## SCENE DIRECTIVE: VERIFICATION',
        shouldVerify
          ? 'Select one concept the learner has encountered but not yet verified.'
          : 'Optionally verify a concept if it flows naturally.',
        'Ask a bounded question in character with a clear correct answer.',
      ].join('\n');
    case 'metacognition':
      return [
        '## SCENE DIRECTIVE: METACOGNITION',
        'Reflect on the recent experience and help the learner connect events to broader patterns.',
        'Include one lightweight interaction prompt.',
      ].join('\n');
    case 'transition':
      return [
        '## SCENE DIRECTIVE: TRANSITION',
        'Bridge to the next narrative beat and maintain engagement with a lightweight interaction prompt.',
      ].join('\n');
    default:
      return `## SCENE DIRECTIVE: ${sceneType}`;
  }
}

export type PromptBuildResult = {
  systemPrompt: string;
  matchedLorebooks: LoreEntry[];
};

export function buildPrompt(
  context: AssembledContext,
  pacing: PacingDecision,
  lastUserInput: string,
): PromptBuildResult {
  const { sessionSnapshot, learnerProfile } = context;

  const matchedLorebooks = matchLorebook(
    context.dialogueHistory,
    context.lorebooks,
    lastUserInput,
  );

  const knowledgeBlock = buildKnowledgeBlock(
    context.knowledgeFlags,
    matchedLorebooks,
  );

  const block1Classification = classificationText(
    sessionSnapshot.contentType,
    sessionSnapshot.truthMode,
  );

  const block2Identity = [
    '## CHARACTER IDENTITY',
    context.agentRules,
  ].join('\n');

  const block3LearnerProfile = [
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
    'Adapt explanation density, analogy choice, and tone to this learner without changing world truth.',
  ]
    .filter(Boolean)
    .join('\n');

  const block4NarrativeGovernance = [
    '## NARRATIVE GOVERNANCE',
    '- Stay in character and keep the learner inside the roleplay frame.',
    '- Position the learner as an advisor, confidant, or companion rather than a passive audience.',
    '- Weave knowledge into the narrative naturally instead of switching to textbook exposition.',
    '- Keep answers focused and interactive.',
  ].join('\n');

  const block5SceneDirective = sceneDirectiveText(
    pacing.nextSceneType,
    pacing.shouldTriggerVerification,
  );

  const block6Adaptation = context.adaptationNotes
    ? ['## ADAPTATION NOTES', context.adaptationNotes].join('\n')
    : '';

  const block7Relationship = [
    '## RELATIONSHIP CONTEXT',
    'Treat the learner as someone you value inside the historical setting.',
    'Ask for their opinion and react as if their input matters to your next move.',
  ].join('\n');

  const block8WorldContext = ['## WORLD CONTEXT', context.worldRules].join('\n');

  const block10KnowledgeState = [
    '## KNOWLEDGE STATE',
    formatKnowledgeBlockForPrompt(knowledgeBlock),
  ].join('\n');

  const block12Memory = context.agentMemory
    ? ['## CHARACTER MEMORY', context.agentMemory].join('\n')
    : '';

  const block13Lorebook = matchedLorebooks.length > 0
    ? [
        '## REFERENCE MATERIAL',
        ...matchedLorebooks.map((entry) => `### ${entry.key}\n${entry.value}`),
      ].join('\n')
    : '';

  const minimumBlocks = [
    block1Classification,
    block2Identity,
    block3LearnerProfile,
    block4NarrativeGovernance,
    block5SceneDirective,
    block6Adaptation,
  ].filter(Boolean);

  const minimumText = minimumBlocks.join('\n\n');
  if (minimumText.length > SYSTEM_PROMPT_BUDGET_CHARS) {
    throw new Error(
      `[prompt-builder] ${MINIMUM_SET_LABEL} exceeds budget ` +
        `(${minimumText.length} chars > ${SYSTEM_PROMPT_BUDGET_CHARS} chars). ` +
        'Turn must fail-close (SJ-DIAL-003:5).',
    );
  }

  const trimmableBlocks = [
    block7Relationship,
    block8WorldContext,
    block10KnowledgeState,
    block12Memory,
    block13Lorebook,
  ].filter(Boolean);

  const finalBlocks = [...minimumBlocks];
  let currentLength = minimumText.length;

  for (const block of trimmableBlocks) {
    const blockLength = block.length + 2;
    if (currentLength + blockLength <= SYSTEM_PROMPT_BUDGET_CHARS) {
      finalBlocks.push(block);
      currentLength += blockLength;
    }
  }

  return {
    systemPrompt: finalBlocks.join('\n\n'),
    matchedLorebooks,
  };
}
