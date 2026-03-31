import type { LookdevItem, LookdevPolicySnapshot, LookdevPortraitBrief, LookdevWorldStylePack } from './types.js';

function firstSentence(value: string): string {
  return value
    .split(/[.!?。！？\n]/)
    .map((entry) => entry.trim())
    .find(Boolean) || value.trim();
}

function compactList(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join(', ');
}

export function compilePortraitBrief(input: {
  agentId: string;
  displayName: string;
  worldId: string | null;
  concept: string;
  description: string | null;
  worldStylePack: LookdevWorldStylePack;
}): LookdevPortraitBrief {
  const concept = input.concept.trim();
  const description = String(input.description || '').trim();
  const summary = firstSentence(
    description
    || concept
    || (input.worldStylePack.language === 'zh' ? `${input.displayName} 的角色设定` : `${input.displayName} world character`),
  );
  const now = new Date().toISOString();
  const mustKeepTraits = [concept, summary].filter(Boolean);
  const defaultOutfit = input.worldStylePack.language === 'zh'
    ? `${input.worldStylePack.costumeDensity}的服装表达`
    : `${input.worldStylePack.costumeDensity} costume language aligned to world role`;
  const defaultHairstyle = input.worldStylePack.language === 'zh'
    ? '清晰、稳定、便于识别轮廓的发型'
    : 'clear, readable hairstyle that supports stable silhouette recognition';

  return {
    agentId: input.agentId,
    worldId: input.worldId,
    displayName: input.displayName,
    visualRole: concept || summary || input.displayName,
    silhouette: input.worldStylePack.silhouetteDirection,
    outfit: description ? firstSentence(description) : defaultOutfit,
    hairstyle: defaultHairstyle,
    palettePrimary: input.worldStylePack.paletteDirection,
    artStyle: input.worldStylePack.artStyle,
    mustKeepTraits,
    forbiddenTraits: [...input.worldStylePack.forbiddenElements],
    sourceConfidence: concept && description ? 'derived_from_agent_truth' : 'world_style_fallback',
    updatedAt: now,
  };
}

export function buildGenerationPrompt(item: LookdevItem, policy: LookdevPolicySnapshot, worldStylePack: LookdevWorldStylePack): string {
  const brief = item.portraitBrief;
  const captureState = item.captureStateSnapshot;
  const parts = [
    'Create a portrait truth candidate for a persistent agent.',
    `Character: ${item.agentDisplayName}.`,
    `Capture mode: ${item.captureMode}.`,
    `Capture synthesis mode: ${captureState.synthesisMode}.`,
    `World style lane: ${worldStylePack.name}.`,
    `Visual era: ${worldStylePack.visualEra}.`,
    `Current brief: ${captureState.currentBrief}.`,
    `Source summary: ${captureState.sourceSummary}.`,
    `Feeling anchor: ${captureState.feelingAnchor.coreVibe}.`,
    compactList(captureState.feelingAnchor.tonePhrases) ? `Stable feeling phrases: ${compactList(captureState.feelingAnchor.tonePhrases)}.` : '',
    compactList(captureState.feelingAnchor.avoidVibe) ? `Avoid vibe: ${compactList(captureState.feelingAnchor.avoidVibe)}.` : '',
    `Effective intent: ${captureState.workingMemory.effectiveIntentSummary}.`,
    compactList(captureState.workingMemory.preserveFocus) ? `Preserve focus: ${compactList(captureState.workingMemory.preserveFocus)}.` : '',
    compactList(captureState.workingMemory.adjustFocus) ? `Adjust focus: ${compactList(captureState.workingMemory.adjustFocus)}.` : '',
    compactList(captureState.workingMemory.negativeConstraints) ? `Negative constraints: ${compactList(captureState.workingMemory.negativeConstraints)}.` : '',
    `Art style: ${brief.artStyle}.`,
    `Visual role: ${brief.visualRole}.`,
    `Silhouette: ${brief.silhouette}.`,
    `Outfit: ${brief.outfit}.`,
    `Hairstyle: ${brief.hairstyle}.`,
    `Palette direction: ${brief.palettePrimary}.`,
    compactList(brief.mustKeepTraits) ? `Must keep traits: ${compactList(brief.mustKeepTraits)}.` : '',
    compactList(brief.forbiddenTraits) ? `Forbidden traits: ${compactList(brief.forbiddenTraits)}.` : '',
    `Detail budget: ${captureState.visualIntent.detailBudget}.`,
    `Background weight: ${captureState.visualIntent.backgroundWeight}.`,
    `World material direction: ${worldStylePack.materialDirection}.`,
    `World background direction: ${worldStylePack.backgroundDirection}.`,
    `World prompt frame: ${worldStylePack.promptFrame}.`,
    policy.generationPolicy.promptFrame,
    item.captureMode === 'capture'
      ? 'This agent was explicitly selected by the operator for higher-fidelity capture refinement. Preserve identity anchors strictly.'
      : 'This agent follows the default batch lane. Keep the result clean, stable, and production-ready.',
    'The output should feel production-ready for later character development rather than a dramatic marketing shot.',
  ];
  if (item.correctionHints.length > 0) {
    parts.push(`Internal correction hints: ${item.correctionHints.join(' ')}`);
  }
  return parts.filter(Boolean).join(' ');
}

export function buildEvaluationSystemPrompt(scoreThreshold: number): string {
  return [
    'You are a strict portrait gate for batch character lookdev results.',
    'Evaluate whether the provided image is a formal anchor portrait candidate.',
    'Respond with JSON only.',
    `Passing requires all hard gates to pass and score >= ${scoreThreshold}.`,
    'JSON shape:',
    '{"passed":boolean,"score":number,"checks":[{"key":"fullBody","passed":boolean,"note":"optional"}],"summary":"string","failureReasons":["string"]}',
    'Valid check keys: fullBody, fixedFocalLength, subjectClarity, stablePose, backgroundSubordinate, lowOcclusion.',
  ].join(' ');
}
