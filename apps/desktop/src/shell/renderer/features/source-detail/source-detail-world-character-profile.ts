import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailWorldCharacterInteraction } from './source-detail-model.js';
import {
  readOptionalString,
  readStringArray,
} from './source-detail-model-readers.js';

export function readWorldCharacterInteraction(sourceCore: JsonObject | null | undefined): SourceDetailWorldCharacterInteraction | null {
  const interaction = parseOptionalJsonObject(sourceCore?.interactionProfile)
    ?? parseOptionalJsonObject(sourceCore?.interaction);
  if (!interaction) {
    return null;
  }
  const profile = {
    tone: readOptionalString(interaction, 'tone'),
    cadence: readOptionalString(interaction, 'cadence'),
    scenario: readOptionalString(interaction, 'scenario'),
    greeting: readOptionalString(interaction, 'greeting'),
  };
  return Object.values(profile).some(Boolean) ? profile : null;
}

function appendUnique(target: string[], values: readonly string[]) {
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !target.includes(normalized)) {
      target.push(normalized);
    }
  }
}

export function readWorldCharacterConversationAnchors(sourceCore: JsonObject | null | undefined): string[] {
  const interaction = parseOptionalJsonObject(sourceCore?.interactionProfile)
    ?? parseOptionalJsonObject(sourceCore?.interaction);
  const knowledge = parseOptionalJsonObject(sourceCore?.knowledge);
  const anchors: string[] = [];
  appendUnique(anchors, readStringArray(interaction?.greetingVariants));
  appendUnique(anchors, readStringArray(interaction?.dialogueExemplars));
  appendUnique(anchors, readStringArray(knowledge?.topics).filter((topic) => topic.length <= 72));
  appendUnique(anchors, readStringArray(knowledge?.constraints));
  return anchors.slice(0, 10);
}
