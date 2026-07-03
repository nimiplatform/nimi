
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  SourceDetailWorldCharacter,
  SourceDetailWorldCharacterMilestone,
} from './source-detail-model.js';
import {
  readOptionalString,
  readStringArray,
} from './source-detail-model-readers.js';
import { readWorldCharacterMilestones } from './source-detail-world-character-milestones.js';
import {
  readWorldCharacterConversationAnchors,
  readWorldCharacterInteraction,
} from './source-detail-world-character-profile.js';
import { readWorldCharacterRelationshipNotes } from './source-detail-world-character-relationships.js';

export {
  readRelationshipClues,
  readRelationshipRows,
} from './source-detail-world-character-relationships.js';
export {
  dedupeWorks,
  readWorldCharacterWorks,
  readWorldCharacterWorksFromBiography,
  readWorldCharacterWorksFromRelationships,
} from './source-detail-world-character-works.js';
export { readCareerMilestonesFromRelationships } from './source-detail-world-character-milestones.js';

export function readWorldCharacter(
  sourceCore: JsonObject | null | undefined,
  careerMilestones: readonly SourceDetailWorldCharacterMilestone[],
): SourceDetailWorldCharacter | null {
  if (!sourceCore) {
    return null;
  }
  const placement = parseOptionalJsonObject(sourceCore.placement);
  const worldCharacter: SourceDetailWorldCharacter = {
    role: readOptionalString(placement, 'role'),
    faction: readOptionalString(placement, 'faction'),
    rank: readOptionalString(placement, 'rank'),
    sceneRefs: readStringArray(placement?.sceneRefs),
    milestones: readWorldCharacterMilestones(sourceCore, careerMilestones),
    relationshipNotes: readWorldCharacterRelationshipNotes(sourceCore),
    conversationAnchors: readWorldCharacterConversationAnchors(sourceCore),
    interaction: readWorldCharacterInteraction(sourceCore),
  };
  const hasData = Boolean(
    worldCharacter.role
      || worldCharacter.faction
      || worldCharacter.rank
      || worldCharacter.sceneRefs.length
      || worldCharacter.milestones.length
      || worldCharacter.relationshipNotes.length
      || worldCharacter.conversationAnchors.length
      || worldCharacter.interaction,
  );
  return hasData ? worldCharacter : null;
}
