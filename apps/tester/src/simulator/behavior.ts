import { testerCapabilities } from '../tester/tester-capabilities.js';
import type {
  TesterSimulatorBehaviorContext,
  TesterSimulatorCommandEnvelope,
  TesterSimulatorInitialInput,
  TesterSimulatorJsonValue,
  TesterSimulatorProjectionInput,
} from './protocol.js';

const MAX_HISTORY_PER_CAPABILITY = 80;
const MAX_IMAGE_HISTORY = 80;
const MAX_PROMPT_DRAFTS = 64;
const MAX_ACTION_LOG = 128;
const MAX_EXECUTION_LOG = 128;

type JsonRecord = { readonly [key: string]: TesterSimulatorJsonValue };

interface TesterSimulatorScenarioData extends JsonRecord {
  readonly generatedText: string;
  readonly textModel: {
    readonly providerId: string;
    readonly modelId: string;
  };
  readonly connector: {
    readonly connectorId: string;
    readonly provider: string;
    readonly label: string;
    readonly remoteModelCatalogId: string;
    readonly providerModelId: string;
    readonly modelLabel: string;
  };
  readonly runtimePlatform: {
    readonly status: 'unavailable';
    readonly mode: 'local-app';
    readonly reasonCode: string;
    readonly message: string;
    readonly actionHint: string;
  };
  readonly aiConfigSummary: {
    readonly runtime: {
      readonly status: 'simulated';
      readonly mode: 'simulated';
      readonly detail: string;
    };
    readonly schedulingOwner: 'runtime';
    readonly providerCatalogSurface: 'sdk.runtime.listNimiRuntimeRouteOptions';
    readonly appLocalProviderDefaults: false;
  };
}

interface TesterSimulatorState extends JsonRecord {
  readonly protocolRevision: 1;
  readonly scenario: TesterSimulatorScenarioData;
  readonly runSequence: number;
  readonly runHistory: Readonly<Record<string, readonly JsonRecord[]>>;
  readonly imageHistory: readonly JsonRecord[];
  readonly promptDrafts: Readonly<Record<string, string>>;
  readonly aiConfig: JsonRecord;
  readonly actionLog: readonly JsonRecord[];
  readonly capabilityExecutions: readonly JsonRecord[];
}

function record(value: TesterSimulatorJsonValue, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`TESTER_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function text(value: TesterSimulatorJsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`TESTER_SIMULATOR_${label}_INVALID`);
  }
  return value;
}

function scenarioData(value: TesterSimulatorJsonValue): TesterSimulatorScenarioData {
  const input = record(value, 'SCENARIO_DATA');
  const model = record(input.textModel, 'TEXT_MODEL');
  const connector = record(input.connector, 'CONNECTOR');
  const runtimePlatform = record(input.runtimePlatform, 'RUNTIME_PLATFORM');
  const aiConfigSummary = record(input.aiConfigSummary, 'AI_CONFIG_SUMMARY');
  const runtimeSummary = record(aiConfigSummary.runtime, 'AI_CONFIG_RUNTIME');
  if (runtimePlatform.status !== 'unavailable'
    || runtimePlatform.mode !== 'local-app'
    || aiConfigSummary.schedulingOwner !== 'runtime'
    || aiConfigSummary.providerCatalogSurface !== 'sdk.runtime.listNimiRuntimeRouteOptions'
    || aiConfigSummary.appLocalProviderDefaults !== false
    || runtimeSummary.status !== 'simulated'
    || runtimeSummary.mode !== 'simulated') {
    throw new Error('TESTER_SIMULATOR_SCENARIO_PROJECTION_INVALID');
  }
  return {
    generatedText: text(input.generatedText, 'GENERATED_TEXT'),
    textModel: {
      providerId: text(model.providerId, 'MODEL_PROVIDER'),
      modelId: text(model.modelId, 'MODEL_ID'),
    },
    connector: {
      connectorId: text(connector.connectorId, 'CONNECTOR_ID'),
      provider: text(connector.provider, 'CONNECTOR_PROVIDER'),
      label: text(connector.label, 'CONNECTOR_LABEL'),
      remoteModelCatalogId: text(connector.remoteModelCatalogId, 'REMOTE_MODEL_CATALOG_ID'),
      providerModelId: text(connector.providerModelId, 'PROVIDER_MODEL_ID'),
      modelLabel: text(connector.modelLabel, 'MODEL_LABEL'),
    },
    runtimePlatform: {
      status: 'unavailable',
      mode: 'local-app',
      reasonCode: text(runtimePlatform.reasonCode, 'RUNTIME_PLATFORM_REASON_CODE'),
      message: text(runtimePlatform.message, 'RUNTIME_PLATFORM_MESSAGE'),
      actionHint: text(runtimePlatform.actionHint, 'RUNTIME_PLATFORM_ACTION_HINT'),
    },
    aiConfigSummary: {
      runtime: {
        status: 'simulated',
        mode: 'simulated',
        detail: text(runtimeSummary.detail, 'RUNTIME_DETAIL'),
      },
      schedulingOwner: 'runtime',
      providerCatalogSurface: 'sdk.runtime.listNimiRuntimeRouteOptions',
      appLocalProviderDefaults: false,
    },
  };
}

function initialConfig(scenario: TesterSimulatorScenarioData): JsonRecord {
  const targetRefs: Record<string, TesterSimulatorJsonValue> = {};
  for (const capability of testerCapabilities) {
    if (!capability.runtimeBindingCapabilityId) continue;
    targetRefs[capability.runtimeBindingCapabilityId] = {
      kind: 'cloud-connector',
      connectorId: scenario.connector.connectorId,
      remoteModelCatalogId: scenario.connector.remoteModelCatalogId,
      providerModelId: scenario.connector.providerModelId,
      provider: scenario.connector.provider,
    };
  }
  return {
    scopeRef: { kind: 'app', ownerId: 'nimi.tester', surfaceId: 'app-lab' },
    capabilities: { targetRefs, selectedParams: {} },
    profileOrigin: null,
  };
}

function state(value: TesterSimulatorJsonValue): TesterSimulatorState {
  const candidate = record(value, 'STATE');
  if (candidate.protocolRevision !== 1) throw new Error('TESTER_SIMULATOR_STATE_REVISION_INVALID');
  return candidate as TesterSimulatorState;
}

function appendBounded<T>(values: readonly T[], value: T, limit: number): readonly T[] {
  return [...values, value].slice(-limit);
}

function payloadRecord(envelope: TesterSimulatorCommandEnvelope): JsonRecord {
  return record(envelope.payload, 'COMMAND_PAYLOAD');
}

export const testerSimulatorBehavior = Object.freeze({
  initialState(input: TesterSimulatorInitialInput): TesterSimulatorJsonValue {
    const scenario = scenarioData(input.moduleData);
    return {
      protocolRevision: 1,
      scenario,
      runSequence: 0,
      runHistory: {},
      imageHistory: [],
      promptDrafts: {},
      aiConfig: initialConfig(scenario),
      actionLog: [],
      capabilityExecutions: [],
    };
  },

  reduce(
    currentValue: TesterSimulatorJsonValue,
    envelope: TesterSimulatorCommandEnvelope,
    context: TesterSimulatorBehaviorContext,
  ) {
    const current = state(currentValue);
    const payload = payloadRecord(envelope);
    if (envelope.type === 'tester.run.allocate') {
      return { state: { ...current, runSequence: current.runSequence + 1 }, events: [] };
    }
    if (envelope.type === 'tester.capability.execute') {
      const execution = {
        capabilityId: text(payload.capabilityId, 'CAPABILITY_ID'),
        promptLength: typeof payload.prompt === 'string' ? payload.prompt.length : 0,
        attachmentCount: typeof payload.attachmentCount === 'number' ? payload.attachmentCount : 0,
        logicalTime: context.now,
      };
      return {
        state: {
          ...current,
          capabilityExecutions: appendBounded(current.capabilityExecutions, execution, MAX_EXECUTION_LOG),
        },
        events: [],
      };
    }
    if (envelope.type === 'tester.history.append') {
      const historyRecord = record(payload.record, 'HISTORY_RECORD');
      const capabilityId = text(historyRecord.capabilityId, 'HISTORY_CAPABILITY_ID');
      const prior = current.runHistory[capabilityId] ?? [];
      return {
        state: {
          ...current,
          runHistory: {
            ...current.runHistory,
            [capabilityId]: [historyRecord, ...prior.filter((entry) => entry.id !== historyRecord.id)]
              .slice(0, MAX_HISTORY_PER_CAPABILITY),
          },
        },
        events: [],
      };
    }
    if (envelope.type === 'tester.image-history.append') {
      const imageRecord = record(payload.record, 'IMAGE_HISTORY_RECORD');
      const linkageId = text(
        typeof imageRecord.runId === 'string' ? imageRecord.runId : imageRecord.id,
        'IMAGE_HISTORY_ID',
      );
      return {
        state: {
          ...current,
          imageHistory: [
            imageRecord,
            ...current.imageHistory.filter((entry) => (entry.runId ?? entry.id) !== linkageId),
          ].slice(0, MAX_IMAGE_HISTORY),
        },
        events: [],
      };
    }
    if (envelope.type === 'tester.prompt.save') {
      const key = record(payload.key, 'PROMPT_KEY');
      const draftId = [key.surfaceId, key.capabilityId, key.scenarioId].map((entry) => text(entry, 'PROMPT_KEY_PART')).join(':');
      const next = { ...current.promptDrafts };
      if (payload.enabled === true) next[draftId] = typeof payload.prompt === 'string' ? payload.prompt : '';
      else delete next[draftId];
      const entries = Object.entries(next).slice(-MAX_PROMPT_DRAFTS);
      return { state: { ...current, promptDrafts: Object.fromEntries(entries) }, events: [] };
    }
    if (envelope.type === 'tester.action.record') {
      const action = {
        kind: text(payload.kind, 'ACTION_KIND'),
        subject: typeof payload.subject === 'string' ? payload.subject : '',
        details: payload.details ?? null,
        logicalTime: context.now,
      };
      return {
        state: { ...current, actionLog: appendBounded(current.actionLog, action, MAX_ACTION_LOG) },
        events: [],
      };
    }
    if (envelope.type === 'tester.ai-config.update') {
      return { state: { ...current, aiConfig: record(payload.config, 'AI_CONFIG') }, events: [] };
    }
    throw new Error(`TESTER_SIMULATOR_COMMAND_UNDECLARED:${envelope.type}`);
  },

  project(
    currentValue: TesterSimulatorJsonValue,
    instance: TesterSimulatorProjectionInput,
  ): TesterSimulatorJsonValue {
    const current = state(currentValue);
    return {
      ...current,
      route: {
        pathname: instance.route.pathname,
        search: instance.route.search.map((entry) => ({ key: entry.key, value: entry.value })),
        fragment: instance.route.fragment,
      },
      surfaceId: instance.surfaceId,
    };
  },
});
