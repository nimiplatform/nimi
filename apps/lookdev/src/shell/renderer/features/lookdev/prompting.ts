import type { LookdevItem, LookdevPolicySnapshot } from './types.js';

export function buildGenerationPrompt(item: LookdevItem, policy: LookdevPolicySnapshot): string {
  const parts = [
    'Create a portrait truth candidate for a persistent agent.',
    `Character: ${item.agentDisplayName}.`,
    item.agentConcept ? `Core concept: ${item.agentConcept}.` : '',
    item.agentDescription ? `Description: ${item.agentDescription}.` : '',
    policy.generationPolicy.promptFrame,
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
