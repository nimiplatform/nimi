// Knowledge base — re-exports all generated modules
// Run `pnpm generate:knowledge-base` to regenerate from YAML sources.

export { REMINDER_RULES, REMINDER_DOMAINS } from './gen/reminder-rules.gen.js';
export type { ReminderRule, ReminderDomain, ReminderCategory, ReminderPriority, ReminderVisibility, ActionType } from './gen/reminder-rules.gen.js';

export { MILESTONE_CATALOG, MILESTONE_DOMAINS } from './gen/milestone-catalog.gen.js';
export type { Milestone, MilestoneDomain } from './gen/milestone-catalog.gen.js';

export { SENSITIVE_PERIODS } from './gen/sensitive-periods.gen.js';
export type { SensitivePeriod } from './gen/sensitive-periods.gen.js';

export { OBSERVATION_MODES, OBSERVATION_DIMENSIONS, FRAMEWORK_LAYERS, DIMENSION_IDS } from './gen/observation-framework.gen.js';
export type { ObservationMode, ObservationModeId, ObservationDimension, FrameworkLayer } from './gen/observation-framework.gen.js';

export { GROWTH_STANDARDS, GROWTH_TYPE_IDS, REFERENCE_RANGES } from './gen/growth-standards.gen.js';
export type { GrowthStandard, GrowthTypeId, CurveType } from './gen/growth-standards.gen.js';

export { NURTURE_MODES, NURTURE_MODE_IDS } from './gen/nurture-modes.gen.js';
export type { NurtureModeConfig, NurtureModeId } from './gen/nurture-modes.gen.js';

export { KNOWLEDGE_SOURCES, REVIEWED_DOMAINS, NEEDS_REVIEW_DOMAINS } from './gen/knowledge-source-readiness.gen.js';
export type { KnowledgeSource, KnowledgeSourceStatus } from './gen/knowledge-source-readiness.gen.js';
