/**
 * Import Feature — Shared Types
 *
 * Defines the canonical types for the two import pipelines:
 * 1. Character Card V2 JSON import
 * 2. Novel text progressive extraction
 *
 * Draft shapes align with backend CreateWorldRuleDto / CreateAgentRuleDto.
 */

// ── Enum mirrors (string unions matching Prisma enums) ────────

export type WorldRuleDomain =
  | 'AXIOM'
  | 'PHYSICS'
  | 'SOCIETY'
  | 'ECONOMY'
  | 'CHARACTER'
  | 'NARRATIVE'
  | 'META';

export type RuleCategory =
  | 'CONSTRAINT'
  | 'MECHANISM'
  | 'DEFINITION'
  | 'RELATION'
  | 'POLICY';

export type RuleHardness = 'HARD' | 'FIRM' | 'SOFT' | 'AESTHETIC';

export type WorldRuleScope =
  | 'WORLD'
  | 'REGION'
  | 'FACTION'
  | 'INDIVIDUAL'
  | 'SCENE';

export type AgentRuleLayer = 'DNA' | 'BEHAVIORAL' | 'RELATIONAL' | 'CONTEXTUAL';

export type AgentRuleScope = 'SELF' | 'DYAD' | 'GROUP' | 'WORLD';

export type RuleProvenance =
  | 'SEED'
  | 'CREATOR'
  | 'MOJING_MERGED'
  | 'RENDER_BACKFLOW'
  | 'WORLD_STUDIO'
  | 'SYSTEM';

export type AgentRuleProvenance =
  | 'CREATOR'
  | 'WORLD_INHERITED'
  | 'NARRATIVE_EMERGED'
  | 'SYSTEM';

// ── Draft shapes (align with backend DTOs) ────────────────────

export type LocalWorldRuleDraft = {
  ruleKey: string;
  title: string;
  statement: string;
  domain: WorldRuleDomain;
  category: RuleCategory;
  hardness: RuleHardness;
  scope: WorldRuleScope;
  provenance: RuleProvenance;
  structured?: Record<string, unknown>;
  dependsOn?: string[];
  conflictsWith?: string[];
  overrides?: string;
  priority?: number;
  sourceRef?: string;
  reasoning?: string;
};

export type LocalAgentRuleDraft = {
  ruleKey: string;
  title: string;
  statement: string;
  layer: AgentRuleLayer;
  category: RuleCategory;
  hardness: RuleHardness;
  scope?: AgentRuleScope;
  importance?: number;
  structured?: Record<string, unknown>;
  worldRuleRef?: string;
  dependsOn?: string[];
  conflictsWith?: string[];
  priority?: number;
  provenance: AgentRuleProvenance;
  sourceRef?: string;
  reasoning?: string;
};

// ── Import result (shared output of both pipelines) ───────────

export type LocalAgentRuleBundle = {
  characterName: string;
  rules: LocalAgentRuleDraft[];
};

export type ImportMetadata = {
  sourceType: 'character_card' | 'novel';
  sourceFile: string;
  importedAt: string;
  version: string;
};

export type LocalImportResult = {
  worldRules: LocalWorldRuleDraft[];
  agentRules: LocalAgentRuleBundle[];
  metadata: ImportMetadata;
};

export type ChapterChunkRecord = {
  index: number;
  title: string;
  text: string;
};

// ── Character Card V2 Types ───────────────────────────────────

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

// ── Character Card Validation ─────────────────────────────────

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type LorebookClassification = {
  entryIndex: number;
  entryName: string;
  type: 'world' | 'agent';
  domain?: WorldRuleDomain;
  reasoning: string;
};

export type CharacterBookManifestEntry = {
  entryIndex: number;
  entryName: string;
  entry: CharacterBookEntry;
  classification: LorebookClassification;
  classificationSource: 'llm' | 'fallback' | 'user_override';
};

export type CharacterCardSourceManifest = {
  sourceType: 'character_card';
  sourceFile: string;
  importedAt: string;
  rawJson: string;
  rawCard: Record<string, unknown>;
  normalizedCard: TavernCardV2;
  unknownRootFields: Record<string, unknown>;
  unknownDataFields: Record<string, unknown>;
  cardExtensions: Record<string, unknown>;
  characterBookExtensions: Record<string, unknown>;
  characterBookEntries: CharacterBookManifestEntry[];
};

// ── Novel Import Types ────────────────────────────────────────

export type NovelImportState =
  | 'IDLE'
  | 'FILE_LOADED'
  | 'CHUNKING'
  | 'EXTRACTING'
  | 'CHAPTER_REVIEW'
  | 'ACCUMULATING'
  | 'PAUSED'
  | 'CONFLICT_CHECK'
  | 'FINAL_REVIEW'
  | 'PUBLISHING';

export type NovelImportMode = 'auto' | 'manual';

export type ConflictResolution =
  | 'KEEP_PREVIOUS'
  | 'USE_NEW'
  | 'MERGE'
  | 'UNRESOLVED';

export type ConflictEntry = {
  ruleKind: 'WORLD' | 'AGENT';
  ruleKey: string;
  characterName?: string;
  previousStatement: string;
  newStatement: string;
  previousHardness: RuleHardness;
  newHardness: RuleHardness;
  chapterIndex: number;
  resolution: ConflictResolution;
  mergedStatement?: string;
};

export type DiscoveredCharacter = {
  name: string;
  aliases: string[];
  firstAppearance: number;
  description: string;
};

export type ChapterExtractionArtifact = {
  chapterIndex: number;
  chapterTitle: string;
  worldRules: LocalWorldRuleDraft[];
  agentRules: LocalAgentRuleBundle[];
  newCharacters: DiscoveredCharacter[];
  contradictions: ConflictEntry[];
  chapterSummary: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  error?: string;
};

export type NovelAccumulatorState = {
  sourceFile: string;
  totalChapters: number;
  processedChapters: number;
  worldRules: Record<string, LocalWorldRuleDraft>;
  agentRulesByCharacter: Record<string, Record<string, LocalAgentRuleDraft>>;
  worldRuleLineage: Record<string, RuleLineageEntry[]>;
  agentRuleLineageByCharacter: Record<string, Record<string, RuleLineageEntry[]>>;
  characters: Record<string, DiscoveredCharacter>;
  conflicts: ConflictEntry[];
  chapterArtifacts: ChapterExtractionArtifact[];
};

export type RuleLineageEntry = {
  ruleKind: 'WORLD' | 'AGENT';
  ruleKey: string;
  characterName?: string;
  chapterIndex: number;
  chapterTitle: string;
  action: 'ADDED' | 'AUTO_RESOLVED' | 'USER_RESOLVED' | 'CONFLICT_RECORDED';
  resolution: ConflictResolution;
  statement: string;
  sourceRef: string;
};

export type NovelSourceManifest = {
  sourceType: 'novel';
  sourceFile: string;
  importedAt: string;
  sourceText: string;
  chapterChunks: ChapterChunkRecord[];
};

// ── LLM Extraction Output (structured JSON from LLM) ─────────

export type LlmWorldRuleExtraction = {
  ruleKey?: string;
  title: string;
  statement: string;
  domain: WorldRuleDomain;
  category: RuleCategory;
  hardness: RuleHardness;
  scope: WorldRuleScope;
  subjectKey?: string;
  semanticSlot?: string;
};

export type LlmAgentRuleExtraction = {
  characterName: string;
  ruleKey?: string;
  title: string;
  statement: string;
  layer: AgentRuleLayer;
  category: RuleCategory;
  hardness: RuleHardness;
  scope: AgentRuleScope;
  importance: number;
  semanticSlot?: string;
};

export type LlmCharacterExtraction = {
  name: string;
  aliases: string[];
  description: string;
};

export type LlmContradictionExtraction = {
  ruleKey: string;
  previousStatement: string;
  newStatement: string;
  reason: string;
};

export type LlmChapterExtractionResult = {
  worldRules: LlmWorldRuleExtraction[];
  agentRules: LlmAgentRuleExtraction[];
  newCharacters: LlmCharacterExtraction[];
  contradictions: LlmContradictionExtraction[];
  chapterSummary: string;
};

// ── Import Session Store Types ────────────────────────────────

export type CardImportStep =
  | 'IDLE'
  | 'PARSED'
  | 'MAPPED'
  | 'REVIEWING'
  | 'PUBLISHING';

export type CardImportState = {
  card: TavernCardV2 | null;
  sourceManifest: CharacterCardSourceManifest | null;
  validation: ValidationResult | null;
  mappedAgentRules: LocalAgentRuleDraft[];
  mappedWorldRules: LocalWorldRuleDraft[];
  step: CardImportStep;
};

export type NovelImportStoreState = {
  machineState: NovelImportState;
  mode: NovelImportMode;
  sourceManifest: NovelSourceManifest | null;
  accumulator: NovelAccumulatorState | null;
  currentChapterResult: ChapterExtractionArtifact | null;
  progress: { current: number; total: number };
  error: string | null;
};

export type ImportSessionState = {
  sessionId: string;
  sessionType: 'character_card' | 'novel' | null;
  cardImport: CardImportState;
  novelImport: NovelImportStoreState;
  targetWorldId: string | null;
  targetWorldName: string | null;
};
