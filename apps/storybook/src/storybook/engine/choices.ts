// Generated choices, the default Play progression path. Play is choice-primary:
// the engine must always offer at least one choice on a non-ending node so an
// ordinary user can progress WITHOUT typing. Free-text input stays optional and
// is never required by this default path.
//
// Authored choices win. When a non-ending node has no authored choices, the
// engine synthesizes a deterministic "continue" choice toward the next node so
// the run never stalls. Richer AI-generated choices may augment these later, but
// the deterministic default never depends on AI being available.

import { mintId } from './ids.js';
import { type Choice, type PlayableChapter, type StoryNode } from './run.js';
import { type ValidationFinding } from './failure.js';

const CONTINUE_LABEL = '继续';

function nextSequentialNode(chapter: PlayableChapter, node: StoryNode): StoryNode | null {
  const index = chapter.nodes.findIndex((candidate) => candidate.id === node.id);
  if (index < 0 || index + 1 >= chapter.nodes.length) return null;
  return chapter.nodes[index + 1] ?? null;
}

/**
 * The choices a player can pick right now. Always non-empty for a non-ending node
 * that has a viable next step, so the default loop never forces free-text.
 */
export function generateChoicesForNode(chapter: PlayableChapter, node: StoryNode): Choice[] {
  if (node.isEnding) return [];
  if (node.choices.length > 0) return node.choices;
  const next = nextSequentialNode(chapter, node);
  if (!next) return [];
  return [
    {
      id: mintId('choice'),
      label: CONTINUE_LABEL,
      targetNodeId: next.id,
      source: 'generated',
    },
  ];
}

/** A free-text steer is always optional: this returns false for every node. */
export function requiresFreeText(_node: StoryNode): boolean {
  return false;
}

/** Wrap a player's free-text steer as an optional choice-equivalent input. */
export function freeTextChoice(text: string): Choice {
  return { id: mintId('choice'), label: text, source: 'free-text' };
}

/**
 * Fail-closed check: every non-ending node reachable from the chapter start must
 * yield at least one generated/authored choice, or the default Play loop would
 * dead-end and force the user to type.
 */
export function validateDefaultProgression(chapter: PlayableChapter): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const byId = new Map(chapter.nodes.map((node) => [node.id, node]));
  const reachable = new Set<string>();
  const queue: string[] = [chapter.startNodeId];
  while (queue.length) {
    const id = queue.shift() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = byId.get(id);
    if (!node) {
      findings.push({ code: 'chapter_graph_unreachable', message: `Chapter "${chapter.id}" references unknown node "${id}".`, pointers: [`chapter:${chapter.id}`] });
      continue;
    }
    if (node.isEnding) continue;
    const choices = generateChoicesForNode(chapter, node);
    if (choices.length === 0) {
      findings.push({
        code: 'choices_missing_for_default_progression',
        message: `Node "${node.id}" is not an ending but offers no choices — the default (no-typing) Play loop would stall here.`,
        pointers: [`node:${node.id}`],
      });
      continue;
    }
    for (const choice of choices) {
      if (choice.targetNodeId) queue.push(choice.targetNodeId);
    }
  }
  return findings;
}
