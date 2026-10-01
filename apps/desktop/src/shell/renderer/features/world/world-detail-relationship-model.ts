import type { WorldCharacter, WorldDetailData } from './world-detail-types.js';

// World detail's people explorer presents World characters from explicit Realm
// fields only. WorldCharacter carries no typed relationship records, so no
// relationship edge, kinship node, or clue is built from traits, topics, bio,
// or names; the explorer offers neutral browsing over every character and the
// explicit profile of the selected one.
export type WorldRelationshipExplorerModel = {
  readonly center: WorldCharacter | null;
  readonly people: readonly WorldCharacter[];
  readonly summary: {
    // The World's explicit relationship statistic; null when the World does not
    // publish one.
    readonly relationshipCount: number | null;
  };
};

function chooseCenterCharacter(
  characters: readonly WorldCharacter[],
  preferredCenterId?: string | null,
): WorldCharacter | null {
  const preferred = preferredCenterId
    ? characters.find((character) => character.id === preferredCenterId)
    : undefined;
  return preferred
    ?? characters.find((character) => character.importance === 'PRIMARY')
    ?? characters[0]
    ?? null;
}

export function buildWorldRelationshipExplorerModel({
  world,
  characters,
  preferredCenterId,
}: {
  readonly world: WorldDetailData;
  readonly characters: readonly WorldCharacter[];
  readonly preferredCenterId?: string | null;
}): WorldRelationshipExplorerModel {
  return {
    center: chooseCenterCharacter(characters, preferredCenterId),
    people: characters,
    summary: {
      relationshipCount: typeof world.relationshipCount === 'number' && Number.isFinite(world.relationshipCount)
        ? world.relationshipCount
        : null,
    },
  };
}

// Other characters that share an explicit role, faction, or rank value with the
// center. Equality of explicit fields is the only grouping signal.
export function sameIdentityCharacters(
  center: WorldCharacter,
  characters: readonly WorldCharacter[],
  limit = 4,
): WorldCharacter[] {
  const sharesField = (left: string | null | undefined, right: string | null | undefined) => {
    const value = left?.trim();
    return Boolean(value && value === right?.trim());
  };
  return characters
    .filter((character) => character.id !== center.id)
    .filter((character) => (
      sharesField(center.role, character.role)
      || sharesField(center.faction, character.faction)
      || sharesField(center.rank, character.rank)
    ))
    .slice(0, limit);
}
