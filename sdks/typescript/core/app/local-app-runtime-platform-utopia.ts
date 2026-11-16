import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  canonicalString,
  decimalCursor,
  localAppError,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';

export type HabitatDaypart = 'morning' | 'day' | 'dusk' | 'night';

export type HabitatThemeTag =
  | 'seaside'
  | 'polar'
  | 'xianxia'
  | 'farming'
  | 'woodland'
  | 'mountain'
  | 'harbor'
  | 'observatory'
  | 'courtyard'
  | 'shelter';

export type HabitatPlaceArchetype =
  | 'lookout'
  | 'workshop'
  | 'garden'
  | 'waterside'
  | 'hearth'
  | 'library'
  | 'courtyard'
  | 'shelter';

export type HabitatSocialMode = 'solo' | 'co_present' | 'shared_invite';

export type HabitatSceneryKind =
  | 'clear-sky'
  | 'rain'
  | 'snowfall'
  | 'mist'
  | 'aurora'
  | 'meteor-shower'
  | 'blossom'
  | 'wildlife-visit'
  | 'tide-pooling'
  | 'harvest'
  | 'hearth-lit'
  | 'radio-signal';

export type HabitatParameterCondition = Readonly<{
  readonly parameterKey: string;
  readonly allowedValues: readonly string[];
}>;

export type HabitatParameterOption = Readonly<{
  readonly value: string;
  readonly label: string;
  readonly summary: string;
}>;

export type HabitatParameterSpec = Readonly<{
  readonly key: string;
  readonly label: string;
  readonly defaultValue: string;
  readonly options: readonly HabitatParameterOption[];
}>;

export type HabitatPersonalQuarterSpec = Readonly<{
  readonly id: 'personal-quarter';
  readonly name: string;
  readonly sensoryTraits: string;
}>;

export type HabitatPlaceSpec = Readonly<{
  readonly id: string;
  readonly name: string;
  readonly archetype: HabitatPlaceArchetype;
  readonly indoor: boolean;
  readonly sensoryTraits: string;
  readonly openWhen: readonly HabitatParameterCondition[];
}>;

export type HabitatActivitySpec = Readonly<{
  readonly id: string;
  readonly name: string;
  readonly placeIds: readonly string[];
  readonly socialMode: HabitatSocialMode;
  readonly allowedDayparts: readonly HabitatDaypart[];
  readonly when: readonly HabitatParameterCondition[];
  readonly minDurationMinutes: number;
  readonly maxDurationMinutes: number;
  readonly sceneHint: string;
}>;

export type HabitatEventPresetSpec = Readonly<{
  readonly id: string;
  readonly sceneryKind: HabitatSceneryKind;
  readonly label: string;
  readonly description: string;
  readonly placeId: string | null;
  readonly defaultDurationMinutes: number;
}>;

export type HabitatSpecV1 = Readonly<{
  readonly schemaVersion: '1.0';
  readonly habitatId: string;
  readonly title: string;
  readonly themeTag: HabitatThemeTag;
  readonly backdropSummary: string;
  readonly personalQuarter: HabitatPersonalQuarterSpec;
  readonly places: readonly HabitatPlaceSpec[];
  readonly activities: readonly HabitatActivitySpec[];
  readonly parameters: readonly HabitatParameterSpec[];
  readonly eventPresets: readonly HabitatEventPresetSpec[];
}>;

export type NimiUtopiaTime = Readonly<{ seconds: string; nanos: number }>;

export type NimiUtopiaActiveEvent = Readonly<{
  readonly eventId: string;
  readonly slot: 'preset' | 'custom';
  readonly sceneryKind: HabitatSceneryKind;
  readonly label: string;
  readonly description: string;
  readonly placeId: string | null;
  readonly startsAt: NimiUtopiaTime;
  readonly expiresAt: NimiUtopiaTime;
}>;

export type NimiUtopiaFrame = Readonly<{
  readonly activityId: string;
  readonly title: string;
  readonly habitatActivationId: string;
  readonly habitatId: string;
  readonly habitatTitle: string;
  readonly placeId: string;
  readonly placeLabel: string;
  readonly startsAt: NimiUtopiaTime;
  readonly endsAt: NimiUtopiaTime | null;
  readonly interaction: boolean;
}>;

export type NimiUtopiaResident = Readonly<{
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly displayName: string;
  readonly solitary: boolean;
  readonly current: NimiUtopiaFrame | null;
  readonly recent: NimiUtopiaFrame | null;
  readonly next: NimiUtopiaFrame | null;
}>;

export type NimiUtopiaPlaceOccupancy = Readonly<{
  readonly placeId: string;
  readonly agentHandles: readonly string[];
}>;

export type NimiUtopiaSharedState =
  | 'invited'
  | 'accepted'
  | 'active'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'invalidated'
  | 'relocated'
  | 'relocated_partial'
  | 'missed'
  | 'interrupted'
  | 'unanswered'
  | 'unavailable';

export type NimiUtopiaSharedActivity = Readonly<{
  readonly activityRef: string;
  readonly habitatActivationId: string;
  readonly habitatId: string;
  readonly habitatTitle: string;
  readonly initiatorHandle: string;
  readonly recipientHandle: string;
  readonly placeId: string;
  readonly placeLabel: string;
  readonly activityId: string;
  readonly activityLabel: string;
  readonly state: NimiUtopiaSharedState;
  readonly startsAt: NimiUtopiaTime | null;
  readonly endsAt: NimiUtopiaTime | null;
  readonly acceptedAt: NimiUtopiaTime | null;
}>;

export type NimiUtopiaRelocationSummary = Readonly<{
  readonly fromHabitatId: string;
  readonly fromHabitatTitle: string;
  readonly toHabitatId: string;
  readonly toHabitatTitle: string;
  readonly relocatedAt: NimiUtopiaTime;
}>;

export type NimiUtopiaSnapshot = Readonly<{
  readonly revision: string;
  readonly observedAt: NimiUtopiaTime;
  readonly habitatActivationId: string;
  readonly contentDigest: string;
  readonly timezone: string;
  readonly publicParticipation: boolean;
  readonly habitat: HabitatSpecV1;
  readonly parameterValues: Readonly<Record<string, string>>;
  readonly openPlaceIds: readonly string[];
  readonly activeEvents: readonly NimiUtopiaActiveEvent[];
  readonly lastRelocation: NimiUtopiaRelocationSummary | null;
  readonly residents: readonly NimiUtopiaResident[];
  readonly occupancy: readonly NimiUtopiaPlaceOccupancy[];
  readonly sharedActivities: readonly NimiUtopiaSharedActivity[];
}>;

export type NimiUtopiaEventMutation =
  | { readonly kind: 'trigger-preset'; readonly presetId: string; readonly durationMinutes?: number }
  | {
      readonly kind: 'put-custom';
      readonly sceneryKind: HabitatSceneryKind;
      readonly label: string;
      readonly description: string;
      readonly placeId?: string | null;
      readonly durationMinutes: number;
    }
  | { readonly kind: 'clear-event'; readonly eventId: string };

export type NimiUtopiaUpdateIntent =
  | {
      readonly kind: 'activate-habitat';
      readonly habitat: HabitatSpecV1;
      readonly initialParameters?: Readonly<Record<string, string>>;
      readonly timezone?: string;
    }
  | { readonly kind: 'restore-default'; readonly timezone?: string }
  | {
      readonly kind: 'apply-tuning';
      readonly parameters?: Readonly<Record<string, string>>;
      readonly event?: NimiUtopiaEventMutation;
    }
  | { readonly kind: 'set-public-participation'; readonly enabled: boolean }
  | { readonly kind: 'set-solitude'; readonly agentHandle: string; readonly solitary: boolean }
  | { readonly kind: 'set-timezone'; readonly timezone: string };

export type NimiUtopiaSettingsUpdate = Readonly<{
  readonly expectedRevision: string;
  readonly intent: NimiUtopiaUpdateIntent;
}>;

export type NimiUtopiaMutationAck = Readonly<{
  readonly revision: string;
  readonly habitatActivationId: string;
  readonly habitatId: string;
  readonly habitatTitle: string;
  readonly contentDigest: string;
  readonly timezone: string;
  readonly publicParticipation: boolean;
  readonly parameterValues: Readonly<Record<string, string>>;
  readonly openPlaceIds: readonly string[];
  readonly activeEvents: readonly NimiUtopiaActiveEvent[];
}>;

export type NimiLocalAppUtopiaShell = Readonly<{
  snapshot: () => Promise<unknown>;
  update: (input: NimiUtopiaSettingsUpdate) => Promise<unknown>;
}>;

export type NimiLocalAppUtopiaClient = Readonly<{
  snapshot: () => Promise<NimiUtopiaSnapshot>;
  update: (input: NimiUtopiaSettingsUpdate) => Promise<NimiUtopiaMutationAck>;
}>;

const utf8Encoder = new TextEncoder();

const HABITAT_DAYPARTS = new Set<HabitatDaypart>(['morning', 'day', 'dusk', 'night']);
const HABITAT_THEME_TAGS = new Set<HabitatThemeTag>([
  'seaside', 'polar', 'xianxia', 'farming', 'woodland',
  'mountain', 'harbor', 'observatory', 'courtyard', 'shelter',
]);
const HABITAT_ARCHETYPES = new Set<HabitatPlaceArchetype>([
  'lookout', 'workshop', 'garden', 'waterside',
  'hearth', 'library', 'courtyard', 'shelter',
]);
const HABITAT_SOCIAL_MODES = new Set<HabitatSocialMode>(['solo', 'co_present', 'shared_invite']);
const HABITAT_SCENERY_KINDS = new Set<HabitatSceneryKind>([
  'clear-sky', 'rain', 'snowfall', 'mist',
  'aurora', 'meteor-shower', 'blossom', 'wildlife-visit',
  'tide-pooling', 'harvest', 'hearth-lit', 'radio-signal',
]);
const UTOPIA_SHARED_STATES = new Set<NimiUtopiaSharedState>([
  'invited', 'accepted', 'active', 'completed',
  'declined', 'expired', 'invalidated',
  'relocated', 'relocated_partial',
  'missed', 'interrupted', 'unanswered', 'unavailable',
]);

const NAMESPACED_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u;
const LOCAL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHORT_NOUN_FORBIDDEN_RE = /[\u0000-\u001f\u007f.!?。！？;；:：\r\n\t<>[\]{}]/u;
const DISPLAY_SUMMARY_FORBIDDEN_RE = /[\u0000-\u001f\u007f]/u;
const BACKDROP_FORBIDDEN_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const AGENT_HANDLE_RE = /^agent_ref_[\w-]{43}$/u;

function failMode(isInput: boolean, field: string): never {
  if (isInput) {
    localAppError(`Invalid Utopia input field: ${field}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'fix_utopia_input');
  }
  return localAppProjectionError(field);
}

function codePoints(value: string): number {
  return [...value].length;
}

function utf8Bytes(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function checkRevision(value: unknown, isInput: boolean): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value) || value.length > 20
    || (value.length === 20 && value > '18446744073709551615')) {
    failMode(isInput, 'Utopia revision');
  }
  return decimalCursor(value, 'Utopia revision');
}

function checkBoolean(value: unknown, field: string, isInput: boolean): boolean {
  if (typeof value !== 'boolean') failMode(isInput, field);
  return value;
}

function checkIntRange(value: unknown, min: number, max: number, field: string, isInput: boolean): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    failMode(isInput, field);
  }
  return value;
}

function checkNamespacedId(value: unknown, field: string, isInput: boolean): string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 64 || !NAMESPACED_ID_RE.test(value)) {
    failMode(isInput, field);
  }
  return value;
}

function checkLocalSlug(value: unknown, field: string, isInput: boolean): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 32 || !LOCAL_SLUG_RE.test(value)) {
    failMode(isInput, field);
  }
  return value;
}

function checkShortNounLabel(value: unknown, field: string, isInput: boolean): string {
  if (typeof value !== 'string' || value.trim() !== value || !value
    || SHORT_NOUN_FORBIDDEN_RE.test(value) || codePoints(value) > 16 || utf8Bytes(value) > 48) {
    failMode(isInput, field);
  }
  return value;
}

function checkDisplaySummary(value: unknown, field: string, isInput: boolean, allowEmpty = true): string {
  if (typeof value !== 'string') failMode(isInput, field);
  if (value === '') {
    if (!allowEmpty) failMode(isInput, field);
    return '';
  }
  if (value.trim() !== value || DISPLAY_SUMMARY_FORBIDDEN_RE.test(value)
    || codePoints(value) > 120 || utf8Bytes(value) > 480) {
    failMode(isInput, field);
  }
  return value;
}

function checkBackdropProse(value: unknown, field: string, isInput: boolean): string {
  if (typeof value !== 'string' || value.trim() !== value || !value
    || BACKDROP_FORBIDDEN_RE.test(value) || codePoints(value) > 240 || utf8Bytes(value) > 960) {
    failMode(isInput, field);
  }
  return value;
}

function checkTimezone(value: unknown, field: string, isInput: boolean): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 64
    || /[\u0000-\u0020\u007f-\uffff]/u.test(value)) {
    failMode(isInput, field);
  }
  return value;
}

function checkEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string, isInput: boolean): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) failMode(isInput, field);
  return value as T;
}

function checkExactObject(value: unknown, keys: readonly string[], field: string, isInput: boolean): Record<string, unknown> {
  if (isInput) {
    const record = asRecord(value);
    if (!record) failMode(true, field);
    assertExactKeys(record, keys, field);
    for (const key of keys) {
      if (!(key in record)) failMode(true, `${field}.${key}`);
    }
    return record;
  }
  assertExactProjectionKeys(value, keys, field);
  return value;
}

function checkArray<T>(
  value: unknown,
  min: number,
  max: number,
  field: string,
  isInput: boolean,
  item: (entry: unknown, index: number) => T,
): readonly T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) failMode(isInput, field);
  return Object.freeze(value.map((entry, index) => item(entry, index)));
}

function checkConditions(
  value: unknown,
  paramOptions: ReadonlyMap<string, ReadonlySet<string>>,
  field: string,
  isInput: boolean,
): readonly HabitatParameterCondition[] {
  const seenKeys = new Set<string>();
  return checkArray(value, 0, 4, field, isInput, (entry) => {
    const record = checkExactObject(entry, ['parameterKey', 'allowedValues'], field, isInput);
    const parameterKey = checkLocalSlug(record.parameterKey, `${field}.parameterKey`, isInput);
    const allowedSet = paramOptions.get(parameterKey);
    if (!allowedSet || seenKeys.has(parameterKey)) failMode(isInput, `${field}.parameterKey`);
    seenKeys.add(parameterKey);
    const seenVals = new Set<string>();
    const allowedValues = checkArray(record.allowedValues, 1, 5, `${field}.allowedValues`, isInput, (rawVal) => {
      const val = checkLocalSlug(rawVal, `${field}.allowedValues`, isInput);
      if (!allowedSet.has(val) || seenVals.has(val)) failMode(isInput, `${field}.allowedValues`);
      seenVals.add(val);
      return val;
    });
    return Object.freeze({ parameterKey, allowedValues });
  });
}

// @nimi-authority: rule.nimi.runtime.agent-life.utopia-settings
// @nimi-authority: rule.nimi.sdks.feature-clients.utopia
export function validateHabitatSpecV1(value: unknown, isInput = true): HabitatSpecV1 {
  const root = checkExactObject(
    value,
    [
      'schemaVersion', 'habitatId', 'title', 'themeTag', 'backdropSummary',
      'personalQuarter', 'places', 'activities', 'parameters', 'eventPresets',
    ],
    'HabitatSpecV1',
    isInput,
  );
  if (root.schemaVersion !== '1.0') failMode(isInput, 'HabitatSpecV1.schemaVersion');
  if (isInput) {
    const encoded = JSON.stringify(root);
    if (typeof encoded !== 'string' || utf8Bytes(encoded) > 16_384) {
      failMode(true, 'HabitatSpecV1 byte size');
    }
  }
  const habitatId = checkNamespacedId(root.habitatId, 'HabitatSpecV1.habitatId', isInput);
  const title = checkShortNounLabel(root.title, 'HabitatSpecV1.title', isInput);
  const themeTag = checkEnum(root.themeTag, HABITAT_THEME_TAGS, 'HabitatSpecV1.themeTag', isInput);
  const backdropSummary = checkBackdropProse(root.backdropSummary, 'HabitatSpecV1.backdropSummary', isInput);

  const pqRec = checkExactObject(root.personalQuarter, ['id', 'name', 'sensoryTraits'], 'HabitatSpecV1.personalQuarter', isInput);
  if (pqRec.id !== 'personal-quarter') failMode(isInput, 'HabitatSpecV1.personalQuarter.id');
  const personalQuarter: HabitatPersonalQuarterSpec = Object.freeze({
    id: 'personal-quarter',
    name: checkShortNounLabel(pqRec.name, 'HabitatSpecV1.personalQuarter.name', isInput),
    sensoryTraits: checkDisplaySummary(pqRec.sensoryTraits, 'HabitatSpecV1.personalQuarter.sensoryTraits', isInput),
  });

  const paramOptions = new Map<string, ReadonlySet<string>>();
  const parameters = checkArray(root.parameters, 0, 4, 'HabitatSpecV1.parameters', isInput, (entry) => {
    const rec = checkExactObject(entry, ['key', 'label', 'defaultValue', 'options'], 'HabitatParameterSpec', isInput);
    const key = checkLocalSlug(rec.key, 'HabitatParameterSpec.key', isInput);
    if (paramOptions.has(key)) failMode(isInput, 'HabitatParameterSpec.key');
    const label = checkShortNounLabel(rec.label, 'HabitatParameterSpec.label', isInput);
    const optionValues = new Set<string>();
    const options = checkArray(rec.options, 2, 5, 'HabitatParameterSpec.options', isInput, (optEntry) => {
      const optRec = checkExactObject(optEntry, ['value', 'label', 'summary'], 'HabitatParameterOption', isInput);
      const optValue = checkLocalSlug(optRec.value, 'HabitatParameterOption.value', isInput);
      if (optionValues.has(optValue)) failMode(isInput, 'HabitatParameterOption.value');
      optionValues.add(optValue);
      return Object.freeze({
        value: optValue,
        label: checkShortNounLabel(optRec.label, 'HabitatParameterOption.label', isInput),
        summary: checkDisplaySummary(optRec.summary, 'HabitatParameterOption.summary', isInput),
      });
    });
    const defaultValue = checkLocalSlug(rec.defaultValue, 'HabitatParameterSpec.defaultValue', isInput);
    if (!optionValues.has(defaultValue)) failMode(isInput, 'HabitatParameterSpec.defaultValue');
    paramOptions.set(key, optionValues);
    return Object.freeze({ key, label, defaultValue, options });
  });

  const placeIdsSet = new Set<string>();
  const places = checkArray(root.places, 1, 8, 'HabitatSpecV1.places', isInput, (entry) => {
    const rec = checkExactObject(entry, ['id', 'name', 'archetype', 'indoor', 'sensoryTraits', 'openWhen'], 'HabitatPlaceSpec', isInput);
    const id = checkLocalSlug(rec.id, 'HabitatPlaceSpec.id', isInput);
    if (id === 'personal-quarter' || placeIdsSet.has(id)) failMode(isInput, 'HabitatPlaceSpec.id');
    placeIdsSet.add(id);
    return Object.freeze({
      id,
      name: checkShortNounLabel(rec.name, 'HabitatPlaceSpec.name', isInput),
      archetype: checkEnum(rec.archetype, HABITAT_ARCHETYPES, 'HabitatPlaceSpec.archetype', isInput),
      indoor: checkBoolean(rec.indoor, 'HabitatPlaceSpec.indoor', isInput),
      sensoryTraits: checkDisplaySummary(rec.sensoryTraits, 'HabitatPlaceSpec.sensoryTraits', isInput),
      openWhen: checkConditions(rec.openWhen, paramOptions, 'HabitatPlaceSpec.openWhen', isInput),
    });
  });

  const activityIdsSet = new Set<string>();
  let hasAllDayPersonalFallback = false;
  const activities = checkArray(root.activities, 2, 24, 'HabitatSpecV1.activities', isInput, (entry) => {
    const rec = checkExactObject(
      entry,
      ['id', 'name', 'placeIds', 'socialMode', 'allowedDayparts', 'when', 'minDurationMinutes', 'maxDurationMinutes', 'sceneHint'],
      'HabitatActivitySpec',
      isInput,
    );
    const id = checkLocalSlug(rec.id, 'HabitatActivitySpec.id', isInput);
    if (activityIdsSet.has(id)) failMode(isInput, 'HabitatActivitySpec.id');
    activityIdsSet.add(id);
    const seenPlaces = new Set<string>();
    const placeIds = checkArray(rec.placeIds, 1, 4, 'HabitatActivitySpec.placeIds', isInput, (rawPlace) => {
      const pid = checkLocalSlug(rawPlace, 'HabitatActivitySpec.placeIds', isInput);
      if ((pid !== 'personal-quarter' && !placeIdsSet.has(pid)) || seenPlaces.has(pid)) {
        failMode(isInput, 'HabitatActivitySpec.placeIds');
      }
      seenPlaces.add(pid);
      return pid;
    });
    const socialMode = checkEnum(rec.socialMode, HABITAT_SOCIAL_MODES, 'HabitatActivitySpec.socialMode', isInput);
    if (seenPlaces.has('personal-quarter') && (placeIds.length !== 1 || socialMode !== 'solo')) {
      failMode(isInput, 'HabitatActivitySpec.personalQuarterIsolation');
    }
    const seenDayparts = new Set<HabitatDaypart>();
    const allowedDayparts = checkArray(rec.allowedDayparts, 1, 4, 'HabitatActivitySpec.allowedDayparts', isInput, (rawDp) => {
      const dp = checkEnum(rawDp, HABITAT_DAYPARTS, 'HabitatActivitySpec.allowedDayparts', isInput);
      if (seenDayparts.has(dp)) failMode(isInput, 'HabitatActivitySpec.allowedDayparts');
      seenDayparts.add(dp);
      return dp;
    });
    const when = checkConditions(rec.when, paramOptions, 'HabitatActivitySpec.when', isInput);
    const minDurationMinutes = checkIntRange(rec.minDurationMinutes, 15, 240, 'HabitatActivitySpec.minDurationMinutes', isInput);
    const maxDurationMinutes = checkIntRange(rec.maxDurationMinutes, minDurationMinutes, 240, 'HabitatActivitySpec.maxDurationMinutes', isInput);
    const sceneHint = checkDisplaySummary(rec.sceneHint, 'HabitatActivitySpec.sceneHint', isInput);

    if (placeIds.length === 1 && placeIds[0] === 'personal-quarter'
      && socialMode === 'solo' && when.length === 0 && allowedDayparts.length === 4) {
      hasAllDayPersonalFallback = true;
    }

    return Object.freeze({
      id,
      name: checkShortNounLabel(rec.name, 'HabitatActivitySpec.name', isInput),
      placeIds,
      socialMode,
      allowedDayparts,
      when,
      minDurationMinutes,
      maxDurationMinutes,
      sceneHint,
    });
  });

  if (!hasAllDayPersonalFallback) {
    failMode(isInput, 'HabitatSpecV1.personalQuarterAllDayFallback');
  }

  const presetIdsSet = new Set<string>();
  const eventPresets = checkArray(root.eventPresets, 0, 8, 'HabitatSpecV1.eventPresets', isInput, (entry) => {
    const rec = checkExactObject(
      entry,
      ['id', 'sceneryKind', 'label', 'description', 'placeId', 'defaultDurationMinutes'],
      'HabitatEventPresetSpec',
      isInput,
    );
    const id = checkLocalSlug(rec.id, 'HabitatEventPresetSpec.id', isInput);
    if (presetIdsSet.has(id)) failMode(isInput, 'HabitatEventPresetSpec.id');
    presetIdsSet.add(id);
    let placeId: string | null = null;
    if (rec.placeId !== null) {
      const pid = checkLocalSlug(rec.placeId, 'HabitatEventPresetSpec.placeId', isInput);
      if (!placeIdsSet.has(pid)) failMode(isInput, 'HabitatEventPresetSpec.placeId');
      placeId = pid;
    }
    return Object.freeze({
      id,
      sceneryKind: checkEnum(rec.sceneryKind, HABITAT_SCENERY_KINDS, 'HabitatEventPresetSpec.sceneryKind', isInput),
      label: checkShortNounLabel(rec.label, 'HabitatEventPresetSpec.label', isInput),
      description: checkDisplaySummary(rec.description, 'HabitatEventPresetSpec.description', isInput),
      placeId,
      defaultDurationMinutes: checkIntRange(rec.defaultDurationMinutes, 30, 720, 'HabitatEventPresetSpec.defaultDurationMinutes', isInput),
    });
  });

  return Object.freeze({
    schemaVersion: '1.0',
    habitatId,
    title,
    themeTag,
    backdropSummary,
    personalQuarter,
    places,
    activities,
    parameters,
    eventPresets,
  });
}

function projectTimestampRequired(value: unknown, field: string): NimiUtopiaTime {
  const result = projectTimestamp(value, field);
  if (!result) localAppProjectionError(field);
  return Object.freeze(result);
}

function projectBoundedText(value: unknown, field: string, optional = false, maxBytes = 256): string {
  const result = canonicalString(value, field);
  if ((!optional && !result) || utf8Bytes(result) > maxBytes || result.includes('\0')) {
    localAppProjectionError(field);
  }
  return result;
}

function checkParameterRecord(
  value: unknown,
  field: string,
  isInput: boolean,
  maxEntries = 4,
): Readonly<Record<string, string>> {
  const record = asRecord(value);
  if (!record) failMode(isInput, field);
  const entries = Object.entries(record);
  if (entries.length > maxEntries) failMode(isInput, field);
  const out: Record<string, string> = {};
  for (const [key, rawVal] of entries) {
    out[checkLocalSlug(key, `${field}.key`, isInput)] = checkLocalSlug(rawVal, `${field}.${key}`, isInput);
  }
  return Object.freeze(out);
}

function projectActiveEvent(value: unknown): NimiUtopiaActiveEvent {
  assertExactProjectionKeys(
    value,
    ['eventId', 'slot', 'sceneryKind', 'label', 'description', 'placeId', 'startsAt', 'expiresAt'],
    'Utopia active event',
  );
  if (value.slot !== 'preset' && value.slot !== 'custom') localAppProjectionError('Utopia active event slot');
  return Object.freeze({
    eventId: projectBoundedText(value.eventId, 'Utopia eventId', false, 64),
    slot: value.slot,
    sceneryKind: checkEnum(value.sceneryKind, HABITAT_SCENERY_KINDS, 'Utopia sceneryKind', false),
    label: checkShortNounLabel(value.label, 'Utopia event label', false),
    description: checkDisplaySummary(value.description, 'Utopia event description', false),
    placeId: value.placeId === null ? null : checkLocalSlug(value.placeId, 'Utopia event placeId', false),
    startsAt: projectTimestampRequired(value.startsAt, 'Utopia event startsAt'),
    expiresAt: projectTimestampRequired(value.expiresAt, 'Utopia event expiresAt'),
  });
}

function projectFrame(value: unknown): NimiUtopiaFrame | null {
  if (value === null) return null;
  assertExactProjectionKeys(
    value,
    [
      'activityId', 'title', 'habitatActivationId', 'habitatId', 'habitatTitle',
      'placeId', 'placeLabel', 'startsAt', 'endsAt', 'interaction',
    ],
    'Utopia frame',
  );
  return Object.freeze({
    activityId: projectBoundedText(value.activityId, 'Utopia frame activityId', true, 64),
    title: projectBoundedText(value.title, 'Utopia frame title', false, 64),
    habitatActivationId: projectBoundedText(value.habitatActivationId, 'Utopia frame habitatActivationId', true, 64),
    habitatId: projectBoundedText(value.habitatId, 'Utopia frame habitatId', true, 64),
    habitatTitle: projectBoundedText(value.habitatTitle, 'Utopia frame habitatTitle', true, 64),
    placeId: projectBoundedText(value.placeId, 'Utopia frame placeId', true, 64),
    placeLabel: projectBoundedText(value.placeLabel, 'Utopia frame placeLabel', true, 64),
    startsAt: projectTimestampRequired(value.startsAt, 'Utopia frame startsAt'),
    endsAt: value.endsAt === null ? null : projectTimestampRequired(value.endsAt, 'Utopia frame endsAt'),
    interaction: checkBoolean(value.interaction, 'Utopia frame interaction', false),
  });
}

function projectRelocation(value: unknown): NimiUtopiaRelocationSummary | null {
  if (value === null) return null;
  assertExactProjectionKeys(
    value,
    ['fromHabitatId', 'fromHabitatTitle', 'toHabitatId', 'toHabitatTitle', 'relocatedAt'],
    'Utopia relocation summary',
  );
  return Object.freeze({
    fromHabitatId: projectBoundedText(value.fromHabitatId, 'Utopia fromHabitatId', false, 64),
    fromHabitatTitle: projectBoundedText(value.fromHabitatTitle, 'Utopia fromHabitatTitle', false, 64),
    toHabitatId: projectBoundedText(value.toHabitatId, 'Utopia toHabitatId', false, 64),
    toHabitatTitle: projectBoundedText(value.toHabitatTitle, 'Utopia toHabitatTitle', false, 64),
    relocatedAt: projectTimestampRequired(value.relocatedAt, 'Utopia relocatedAt'),
  });
}

function projectOpenPlaceIds(raw: unknown): readonly string[] {
  return checkArray(raw, 0, 8, 'Utopia openPlaceIds', false, (id) => {
    const slug = checkLocalSlug(id, 'Utopia openPlaceId', false);
    if (slug === 'personal-quarter') localAppProjectionError('Utopia openPlaceId personal-quarter');
    return slug;
  });
}

function projectSnapshot(value: unknown): NimiUtopiaSnapshot {
  assertExactProjectionKeys(
    value,
    [
      'revision', 'observedAt', 'habitatActivationId', 'contentDigest', 'timezone',
      'publicParticipation', 'habitat', 'parameterValues', 'openPlaceIds',
      'activeEvents', 'lastRelocation', 'residents', 'occupancy', 'sharedActivities',
    ],
    'Utopia snapshot',
  );
  const contentDigest = projectBoundedText(value.contentDigest, 'Utopia contentDigest', false, 72);
  if (!/^sha256:[0-9a-f]{64}$/u.test(contentDigest)) localAppProjectionError('Utopia contentDigest');

  const seenResidentHandles = new Set<string>();
  const seenOccupancyPlaces = new Set<string>();
  const seenSharedRefs = new Set<string>();

  return Object.freeze({
    revision: checkRevision(value.revision, false),
    observedAt: projectTimestampRequired(value.observedAt, 'Utopia observedAt'),
    habitatActivationId: projectBoundedText(value.habitatActivationId, 'Utopia habitatActivationId', false, 64),
    contentDigest,
    timezone: checkTimezone(value.timezone, 'Utopia timezone', false),
    publicParticipation: checkBoolean(value.publicParticipation, 'Utopia publicParticipation', false),
    habitat: validateHabitatSpecV1(value.habitat, false),
    parameterValues: checkParameterRecord(value.parameterValues, 'Utopia parameterValues', false, 4),
    openPlaceIds: projectOpenPlaceIds(value.openPlaceIds),
    activeEvents: checkArray(value.activeEvents, 0, 2, 'Utopia activeEvents', false, projectActiveEvent),
    lastRelocation: projectRelocation(value.lastRelocation),
    residents: checkArray(value.residents, 0, Number.MAX_SAFE_INTEGER, 'Utopia residents', false, (row) => {
      assertExactProjectionKeys(row, ['agentHandle', 'displayName', 'solitary', 'current', 'recent', 'next'], 'Utopia resident');
      const handle = projectBoundedText(row.agentHandle, 'Utopia Agent handle', false, 64);
      if (!AGENT_HANDLE_RE.test(handle) || seenResidentHandles.has(handle)) {
        localAppProjectionError('Utopia Agent handle');
      }
      seenResidentHandles.add(handle);
      return Object.freeze({
        agentHandle: handle as NimiLocalAppAgentHandle,
        displayName: projectBoundedText(row.displayName, 'Utopia display name', false, 256),
        solitary: checkBoolean(row.solitary, 'Utopia solitude', false),
        current: projectFrame(row.current),
        recent: projectFrame(row.recent),
        next: projectFrame(row.next),
      });
    }),
    occupancy: checkArray(value.occupancy, 0, 8, 'Utopia occupancy', false, (row) => {
      assertExactProjectionKeys(row, ['placeId', 'agentHandles'], 'Utopia occupancy');
      const placeId = checkLocalSlug(row.placeId, 'Utopia occupancy placeId', false);
      if (placeId === 'personal-quarter' || seenOccupancyPlaces.has(placeId)) {
        localAppProjectionError('Utopia occupancy placeId');
      }
      seenOccupancyPlaces.add(placeId);
      const seenOccupantHandles = new Set<string>();
      return Object.freeze({
        placeId,
        agentHandles: checkArray(row.agentHandles, 1, Number.MAX_SAFE_INTEGER, 'Utopia occupants', false, (rawHandle) => {
          const handle = projectBoundedText(rawHandle, 'Utopia occupant handle', false, 64);
          if (!AGENT_HANDLE_RE.test(handle) || seenOccupantHandles.has(handle)) {
            localAppProjectionError('Utopia occupant handle');
          }
          seenOccupantHandles.add(handle);
          return handle;
        }),
      });
    }),
    sharedActivities: checkArray(value.sharedActivities, 0, Number.MAX_SAFE_INTEGER, 'Utopia sharedActivities', false, (row) => {
      assertExactProjectionKeys(
        row,
        [
          'activityRef', 'habitatActivationId', 'habitatId', 'habitatTitle',
          'initiatorHandle', 'recipientHandle', 'placeId', 'placeLabel',
          'activityId', 'activityLabel', 'state', 'startsAt', 'endsAt', 'acceptedAt',
        ],
        'Utopia shared activity',
      );
      const activityRef = projectBoundedText(row.activityRef, 'Utopia activityRef', false, 64);
      if (seenSharedRefs.has(activityRef)) localAppProjectionError('Utopia activityRef');
      seenSharedRefs.add(activityRef);
      const initiatorHandle = projectBoundedText(row.initiatorHandle, 'Utopia initiatorHandle', true, 64);
      const recipientHandle = projectBoundedText(row.recipientHandle, 'Utopia recipientHandle', true, 64);
      if ((initiatorHandle && !AGENT_HANDLE_RE.test(initiatorHandle))
        || (recipientHandle && !AGENT_HANDLE_RE.test(recipientHandle))) {
        localAppProjectionError('Utopia shared handle');
      }
      return Object.freeze({
        activityRef,
        habitatActivationId: projectBoundedText(row.habitatActivationId, 'Utopia shared habitatActivationId', true, 64),
        habitatId: projectBoundedText(row.habitatId, 'Utopia shared habitatId', true, 64),
        habitatTitle: projectBoundedText(row.habitatTitle, 'Utopia shared habitatTitle', true, 64),
        initiatorHandle,
        recipientHandle,
        placeId: projectBoundedText(row.placeId, 'Utopia shared placeId', false, 64),
        placeLabel: projectBoundedText(row.placeLabel, 'Utopia shared placeLabel', false, 64),
        activityId: projectBoundedText(row.activityId, 'Utopia shared activityId', false, 64),
        activityLabel: projectBoundedText(row.activityLabel, 'Utopia shared activityLabel', false, 64),
        state: checkEnum(row.state, UTOPIA_SHARED_STATES, 'Utopia shared state', false),
        startsAt: row.startsAt === null ? null : projectTimestampRequired(row.startsAt, 'Utopia shared startsAt'),
        endsAt: row.endsAt === null ? null : projectTimestampRequired(row.endsAt, 'Utopia shared endsAt'),
        acceptedAt: row.acceptedAt === null ? null : projectTimestampRequired(row.acceptedAt, 'Utopia shared acceptedAt'),
      });
    }),
  });
}

function projectMutationAck(value: unknown): NimiUtopiaMutationAck {
  assertExactProjectionKeys(
    value,
    [
      'revision', 'habitatActivationId', 'habitatId', 'habitatTitle', 'contentDigest',
      'timezone', 'publicParticipation', 'parameterValues', 'openPlaceIds', 'activeEvents',
    ],
    'Utopia mutation ack',
  );
  const contentDigest = projectBoundedText(value.contentDigest, 'Utopia contentDigest', false, 72);
  if (!/^sha256:[0-9a-f]{64}$/u.test(contentDigest)) localAppProjectionError('Utopia contentDigest');

  return Object.freeze({
    revision: checkRevision(value.revision, false),
    habitatActivationId: projectBoundedText(value.habitatActivationId, 'Utopia habitatActivationId', false, 64),
    habitatId: checkNamespacedId(value.habitatId, 'Utopia habitatId', false),
    habitatTitle: checkShortNounLabel(value.habitatTitle, 'Utopia habitatTitle', false),
    contentDigest,
    timezone: checkTimezone(value.timezone, 'Utopia timezone', false),
    publicParticipation: checkBoolean(value.publicParticipation, 'Utopia publicParticipation', false),
    parameterValues: checkParameterRecord(value.parameterValues, 'Utopia parameterValues', false, 4),
    openPlaceIds: projectOpenPlaceIds(value.openPlaceIds),
    activeEvents: checkArray(value.activeEvents, 0, 2, 'Utopia activeEvents', false, projectActiveEvent),
  });
}

function normalizeEventMutationInput(value: unknown): NimiUtopiaEventMutation {
  const rec = asRecord(value);
  if (!rec || typeof rec.kind !== 'string') failMode(true, 'Utopia event mutation');
  switch (rec.kind) {
    case 'trigger-preset': {
      assertExactKeys(rec, ['kind', 'presetId', 'durationMinutes'], 'Utopia trigger-preset event');
      const presetId = checkLocalSlug(rec.presetId, 'Utopia event.presetId', true);
      if (rec.durationMinutes === undefined) {
        return { kind: 'trigger-preset', presetId };
      }
      return {
        kind: 'trigger-preset',
        presetId,
        durationMinutes: checkIntRange(rec.durationMinutes, 30, 720, 'Utopia event.durationMinutes', true),
      };
    }
    case 'put-custom': {
      assertExactKeys(rec, ['kind', 'sceneryKind', 'label', 'description', 'placeId', 'durationMinutes'], 'Utopia put-custom event');
      const sceneryKind = checkEnum(rec.sceneryKind, HABITAT_SCENERY_KINDS, 'Utopia event.sceneryKind', true);
      const label = checkShortNounLabel(rec.label, 'Utopia event.label', true);
      const description = checkDisplaySummary(rec.description, 'Utopia event.description', true);
      const durationMinutes = checkIntRange(rec.durationMinutes, 30, 720, 'Utopia event.durationMinutes', true);
      if (rec.placeId === undefined || rec.placeId === null) {
        return { kind: 'put-custom', sceneryKind, label, description, durationMinutes };
      }
      const placeId = checkLocalSlug(rec.placeId, 'Utopia event.placeId', true);
      if (placeId === 'personal-quarter') failMode(true, 'Utopia event.placeId');
      return { kind: 'put-custom', sceneryKind, label, description, placeId, durationMinutes };
    }
    case 'clear-event': {
      assertExactKeys(rec, ['kind', 'eventId'], 'Utopia clear-event');
      const eventId = typeof rec.eventId === 'string' && rec.eventId.trim() === rec.eventId
        && rec.eventId.length >= 1 && rec.eventId.length <= 64 && !rec.eventId.includes('\0')
        ? rec.eventId
        : failMode(true, 'Utopia event.eventId');
      return { kind: 'clear-event', eventId };
    }
    default:
      return failMode(true, 'Utopia event mutation kind');
  }
}

function normalizeUpdateIntentInput(value: unknown): NimiUtopiaUpdateIntent {
  const rec = asRecord(value);
  if (!rec || typeof rec.kind !== 'string') failMode(true, 'Utopia update intent');
  switch (rec.kind) {
    case 'activate-habitat': {
      assertExactKeys(rec, ['kind', 'habitat', 'initialParameters', 'timezone'], 'Utopia activate-habitat');
      const habitat = validateHabitatSpecV1(rec.habitat, true);
      const out: {
        kind: 'activate-habitat';
        habitat: HabitatSpecV1;
        initialParameters?: Readonly<Record<string, string>>;
        timezone?: string;
      } = { kind: 'activate-habitat', habitat };
      if (rec.initialParameters !== undefined) {
        out.initialParameters = checkParameterRecord(rec.initialParameters, 'Utopia initialParameters', true, 4);
      }
      if (rec.timezone !== undefined) {
        out.timezone = checkTimezone(rec.timezone, 'Utopia timezone', true);
      }
      return out;
    }
    case 'restore-default': {
      assertExactKeys(rec, ['kind', 'timezone'], 'Utopia restore-default');
      if (rec.timezone === undefined) {
        return { kind: 'restore-default' };
      }
      return { kind: 'restore-default', timezone: checkTimezone(rec.timezone, 'Utopia timezone', true) };
    }
    case 'apply-tuning': {
      assertExactKeys(rec, ['kind', 'parameters', 'event'], 'Utopia apply-tuning');
      const parameters = rec.parameters === undefined
        ? undefined
        : checkParameterRecord(rec.parameters, 'Utopia tuning parameters', true, 4);
      const event = rec.event === undefined ? undefined : normalizeEventMutationInput(rec.event);
      const hasParams = parameters !== undefined && Object.keys(parameters).length > 0;
      if (!hasParams && !event) failMode(true, 'Utopia empty apply-tuning');
      return {
        kind: 'apply-tuning',
        ...(parameters !== undefined ? { parameters } : {}),
        ...(event !== undefined ? { event } : {}),
      };
    }
    case 'set-public-participation': {
      assertExactKeys(rec, ['kind', 'enabled'], 'Utopia set-public-participation');
      return {
        kind: 'set-public-participation',
        enabled: checkBoolean(rec.enabled, 'Utopia enabled', true),
      };
    }
    case 'set-solitude': {
      assertExactKeys(rec, ['kind', 'agentHandle', 'solitary'], 'Utopia set-solitude');
      const agentHandle = typeof rec.agentHandle === 'string' && AGENT_HANDLE_RE.test(rec.agentHandle)
        ? rec.agentHandle
        : failMode(true, 'Utopia agentHandle');
      return {
        kind: 'set-solitude',
        agentHandle,
        solitary: checkBoolean(rec.solitary, 'Utopia solitary', true),
      };
    }
    case 'set-timezone': {
      assertExactKeys(rec, ['kind', 'timezone'], 'Utopia set-timezone');
      return {
        kind: 'set-timezone',
        timezone: checkTimezone(rec.timezone, 'Utopia timezone', true),
      };
    }
    default:
      return failMode(true, 'Utopia update intent kind');
  }
}

// @nimi-authority: rule.nimi.sdks.feature-clients.utopia
export function createNimiLocalAppUtopiaClient(shell: NimiLocalAppUtopiaShell): NimiLocalAppUtopiaClient {
  return Object.freeze({
    snapshot: async () => projectSnapshot(await shell.snapshot()),
    async update(input: NimiUtopiaSettingsUpdate): Promise<NimiUtopiaMutationAck> {
      assertExactKeys(input, ['expectedRevision', 'intent'], 'Utopia settings update');
      const expectedRevision = checkRevision(input.expectedRevision, true);
      const intent = normalizeUpdateIntentInput(input.intent);
      return projectMutationAck(await shell.update({ expectedRevision, intent }));
    },
  });
}
