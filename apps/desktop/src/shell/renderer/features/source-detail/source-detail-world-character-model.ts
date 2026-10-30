import type {
  CharacterProfileDialogueExemplarProjection,
  CharacterProfileInteractionProjection,
  CharacterProfileMilestoneProjection,
  CharacterProfileProjection,
  CharacterProfileRelationshipProjection,
} from '../realm-source/character-source-profile-projection.js';

export {
  readRelationshipClues,
  readRelationshipRows,
  readRelationshipTargetLabels,
} from './source-detail-world-character-relationships.js';
export {
  dedupeWorks,
  readWorldCharacterWorksFromRelationships,
} from './source-detail-world-character-works.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCharacterProfileMilestone(value: unknown): value is CharacterProfileMilestoneProjection {
  const milestone = asRecord(value);
  if (!milestone) {
    return false;
  }
  const kind = milestone.kind;
  return typeof milestone.id === 'string'
    && typeof milestone.title === 'string'
    && isNullableString(milestone.summary)
    && (milestone.sequence === null || (
      typeof milestone.sequence === 'number'
      && Number.isFinite(milestone.sequence)
    ))
    && isNullableString(milestone.timeLabel)
    && (kind === 'biography' || kind === 'entry' || kind === 'office' || kind === 'work' || kind === 'relationship')
    && typeof milestone.derived === 'boolean';
}

function isCharacterProfileRelationship(value: unknown): value is CharacterProfileRelationshipProjection {
  const relationship = asRecord(value);
  return Boolean(relationship
    && typeof relationship.id === 'string'
    && typeof relationship.type === 'string'
    && isNullableString(relationship.targetRef)
    && typeof relationship.summary === 'string');
}

function isCharacterProfileInteraction(value: unknown): value is CharacterProfileInteractionProjection | null {
  if (value === null) {
    return true;
  }
  const interaction = asRecord(value);
  return Boolean(interaction
    && isNullableString(interaction.tone)
    && isNullableString(interaction.cadence)
    && isNullableString(interaction.scenario)
    && isNullableString(interaction.greeting)
    && (interaction.meetingScenes === undefined || (
      Array.isArray(interaction.meetingScenes)
      && interaction.meetingScenes.length > 0
      && interaction.meetingScenes.every(value => {
        const scene = asRecord(value);
        return scene && ['sceneId', 'title', 'scenario', 'greeting'].every(key => typeof scene[key] === 'string' && scene[key].trim().length > 0);
      })
      && new Set(interaction.meetingScenes.map(scene => scene.sceneId)).size === interaction.meetingScenes.length
    )));
}

function isCharacterProfileDialogueExemplar(value: unknown): value is CharacterProfileDialogueExemplarProjection {
  const exemplar = asRecord(value);
  return Boolean(exemplar
    && typeof exemplar.id === 'string'
    && isNullableString(exemplar.user)
    && typeof exemplar.character === 'string');
}

function isCharacterProfileProjection(value: unknown): value is CharacterProfileProjection {
  const profile = asRecord(value);
  return Boolean(profile
    && (profile.profileLine === undefined || isNullableString(profile.profileLine))
    && (profile.narrativeSummary === undefined || isNullableString(profile.narrativeSummary))
    && (profile.drives === undefined || isStringArray(profile.drives))
    && (profile.boundaries === undefined || isStringArray(profile.boundaries))
    && isNullableString(profile.role)
    && isNullableString(profile.archetype)
    && isStringArray(profile.traits)
    && isStringArray(profile.knowledgeTopics)
    && isStringArray(profile.knowledgeConstraints)
    && isStringArray(profile.interactionModes)
    && Array.isArray(profile.milestones)
    && profile.milestones.every(isCharacterProfileMilestone)
    && Array.isArray(profile.relationshipNotes)
    && profile.relationshipNotes.every(isCharacterProfileRelationship)
    && isStringArray(profile.conversationAnchors)
    && isCharacterProfileInteraction(profile.interaction)
    && (profile.dialogueExemplars === undefined
      || (Array.isArray(profile.dialogueExemplars)
        && profile.dialogueExemplars.every(isCharacterProfileDialogueExemplar))));
}

export function readCharacterProfile(
  profileProjection: unknown,
): CharacterProfileProjection | null {
  return isCharacterProfileProjection(profileProjection) ? profileProjection : null;
}
