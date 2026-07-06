import type {
  WorldSemanticData,
  WorldSemanticLanguage,
  WorldSemanticLevel,
  WorldSemanticPowerSystem,
  WorldSemanticRealm,
  WorldSemanticRule,
  WorldSemanticSnapshotItem,
  WorldSemanticTaboo,
  WorldSemanticTimelineItem,
} from './world-detail-types.js';
import {
  asRecord,
  readBoolean,
  readNumber,
  readRecordArray,
  readString,
  readStringArray,
} from './world-detail-query-readers.js';

function toSemanticRules(raw: unknown): WorldSemanticRule[] {
  return readRecordArray(raw).map((record, index) => ({
    key: readString(record, 'key', 'id') || `rule-${index + 1}`,
    title: readString(record, 'title', 'name') || `Rule ${index + 1}`,
    value: readString(record, 'value', 'description', 'summary'),
  }));
}

function toSemanticLevels(raw: unknown): WorldSemanticLevel[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Level ${index + 1}`,
    description: readString(record, 'description') || null,
    extra: readString(record, 'breakthroughCondition', 'extra') || null,
  }));
}

function toSemanticTaboos(raw: unknown): WorldSemanticTaboo[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Taboo ${index + 1}`,
    description: readString(record, 'description') || null,
    severity: readString(record, 'severity') || null,
  }));
}

function toSemanticRealms(raw: unknown): WorldSemanticRealm[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Realm ${index + 1}`,
    description: readString(record, 'description') || null,
    accessibility: readString(record, 'accessibility') || null,
  }));
}

function toSemanticLanguages(raw: unknown): WorldSemanticLanguage[] {
  return readRecordArray(raw).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Language ${index + 1}`,
    category: readString(record, 'category') || null,
    description: readString(record, 'description') || null,
    writingSample: readString(record, 'writingSample') || null,
    spokenSample: readString(record, 'spokenSample') || null,
    isCommon: readBoolean(record.isCommon) ?? null,
  }));
}

function toWorldviewEvents(raw: unknown): WorldSemanticTimelineItem[] {
  return readRecordArray(raw).map((item, index) => ({
    id: readString(item, 'id') || `worldview-event-${index + 1}`,
    title: readString(item, 'title', 'summary') || 'Worldview event',
    summary: readString(item, 'summary') || null,
    eventType: readString(item, 'eventType') || null,
    createdAt: readString(item, 'createdAt') || null,
  }));
}

function toWorldviewSnapshots(raw: unknown): WorldSemanticSnapshotItem[] {
  return readRecordArray(raw).map((item, index) => ({
    id: readString(item, 'id') || `worldview-snapshot-${index + 1}`,
    versionLabel: readString(item, 'versionLabel', 'version') || `v${index + 1}`,
    summary: readString(item, 'summary') || null,
    createdAt: readString(item, 'createdAt') || null,
  }));
}

export function toWorldDisplaySemanticBundle(raw: unknown): WorldSemanticData {
  const bundle = asRecord(raw);
  const worldview = asRecord(bundle.worldview);
  const semanticRoot = asRecord(bundle.semantic ?? worldview ?? bundle);
  const operation = asRecord(semanticRoot.operation ?? bundle.operation);
  const geography = asRecord(semanticRoot.geography ?? bundle.geography);
  const metaphysics = asRecord(semanticRoot.metaphysics ?? bundle.metaphysics);
  const coreSystem = asRecord(semanticRoot.coreSystem ?? bundle.coreSystem);
  const languages = asRecord(semanticRoot.languages ?? worldview.languages ?? bundle.languages);
  const powerSystems: WorldSemanticPowerSystem[] = readRecordArray(coreSystem.powerSystems).map((record, index) => ({
    name: readString(record, 'name', 'title') || `Power system ${index + 1}`,
    description: readString(record, 'description') || null,
    levels: toSemanticLevels(record.levels),
    rules: readStringArray(record.rules),
  }));
  const topologyRecord = asRecord(geography.topology);
  const causalityRecord = asRecord(metaphysics.causality);
  const data: WorldSemanticData = {
    operationTitle: readString(operation, 'title') || readString(semanticRoot, 'title') || null,
    operationDescription: readString(operation, 'description') || readString(semanticRoot, 'description') || null,
    operationRules: toSemanticRules(operation.rules),
    powerSystems,
    standaloneLevels: toSemanticLevels(coreSystem.levels),
    taboos: toSemanticTaboos(coreSystem.taboos),
    topology: Object.keys(topologyRecord).length > 0
      ? {
          type: readString(topologyRecord, 'type') || null,
          boundary: readString(topologyRecord, 'boundary') || null,
          dimensions: readString(topologyRecord, 'dimensions') || null,
          realms: toSemanticRealms(topologyRecord.realms),
        }
      : null,
    causality: Object.keys(causalityRecord).length > 0
      ? {
          type: readString(causalityRecord, 'type') || null,
          karmaEnabled: readBoolean(causalityRecord.karmaEnabled) ?? null,
          fateWeight: readNumber(causalityRecord.fateWeight) ?? null,
        }
      : null,
    languages: toSemanticLanguages(languages.languages ?? languages),
    worldviewEvents: toWorldviewEvents(bundle.worldviewEvents),
    worldviewSnapshots: toWorldviewSnapshots(bundle.worldviewSnapshots),
    hasContent: false,
  };
  return {
    ...data,
    hasContent: Boolean(
      data.operationTitle
      || data.operationDescription
      || data.operationRules.length
      || data.powerSystems.length
      || data.standaloneLevels.length
      || data.taboos.length
      || data.topology
      || data.causality
      || data.languages.length
      || data.worldviewEvents.length
      || data.worldviewSnapshots.length,
    ),
  };
}
