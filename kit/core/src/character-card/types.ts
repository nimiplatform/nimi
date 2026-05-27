/**
 * Character Card V2 — shared types.
 *
 * Mirrors the Character Card V2 spec
 * (https://github.com/malfoyslastname/character-card-spec-v2).
 *
 * This is the single admitted Character Card type surface shared by governed
 * authoring workbenches and Desktop's lightweight RealmAgent creation. Neither
 * consumer forks the parser or the card shape.
 */

export type CharacterBookEntry = {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: string;
};

export type CharacterBook = {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
};

export type TavernCardV2Data = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book?: CharacterBook;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
};

export type TavernCardV2 = {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: TavernCardV2Data;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};
