/**
 * `@nimiplatform/kit/core/character-card`
 *
 * Single admitted Character Card V2 parse surface. Governed authoring
 * workbenches and Desktop's lightweight RealmAgent creation both consume
 * this module — neither forks the parser nor the card type.
 */

export type {
  CharacterBook,
  CharacterBookEntry,
  TavernCardV2,
  TavernCardV2Data,
  ValidationResult,
} from './types.js';
export { parseCharacterCardV2, validateCharacterCardV2 } from './parser.js';
