/**
 * Character Card V2 parser & validator.
 *
 * The parse/validate logic is single-sourced in the shared kit module
 * `@nimiplatform/nimi-kit/core/character-card`. Forge re-exports it here so
 * existing import-engine call sites stay stable while the parser is not forked.
 */

export {
  parseCharacterCardV2,
  validateCharacterCardV2,
} from '@nimiplatform/nimi-kit/core/character-card';
