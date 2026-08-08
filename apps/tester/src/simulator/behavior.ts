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
  readonly ecosystemReference: JsonRecord | null;
  readonly personaReference: JsonRecord | null;
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
  const runtimePlatform = record(input.runtimePlatform, 'RUNTIME_PLATFORM');
  const aiConfigSummary = record(input.aiConfigSummary, 'AI_CONFIG_SUMMARY');
  const runtimeSummary = record(aiConfigSummary.runtime, 'AI_CONFIG_RUNTIME');
  if (runtimePlatform.status !== 'unavailable'
    || runtimePlatform.mode !== 'local-app'
    || runtimeSummary.status !== 'simulated'
    || runtimeSummary.mode !== 'simulated') {
    throw new Error('TESTER_SIMULATOR_SCENARIO_PROJECTION_INVALID');
  }
  return {
    generatedText: text(input.generatedText, 'GENERATED_TEXT'),
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
    },
  };
}

function initialConfig(): JsonRecord {
  return {
    owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.tester' } } },
    capabilities: [{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    }],
  };
}

function canonicalAIConfig(value: TesterSimulatorJsonValue): JsonRecord {
  const candidate = record(value, 'AI_CONFIG');
  if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(['capabilities', 'owner'])) {
    throw new Error('TESTER_SIMULATOR_AI_CONFIG_INVALID');
  }
  const owner = record(candidate.owner, 'AI_CONFIG_OWNER');
  const ownerVariant = record(owner.owner, 'AI_CONFIG_OWNER_VARIANT');
  const app = record(ownerVariant.app, 'AI_CONFIG_APP_OWNER');
  if (ownerVariant.oneofKind !== 'app'
    || app.appId !== 'nimi.tester'
    || !Array.isArray(candidate.capabilities)) {
    throw new Error('TESTER_SIMULATOR_AI_CONFIG_INVALID');
  }
  for (const value of candidate.capabilities) {
    const intent = record(value, 'AI_CONFIG_INTENT');
    text(intent.capabilityContract, 'AI_CONFIG_CAPABILITY');
    if (!Array.isArray(intent.requiredFeatures)) {
      throw new Error('TESTER_SIMULATOR_AI_CONFIG_INVALID');
    }
    for (const feature of intent.requiredFeatures) text(feature, 'AI_CONFIG_FEATURE');
    const route = record(intent.route, 'AI_CONFIG_ROUTE');
    if (route.oneofKind === 'local') {
      const local = record(route.local, 'AI_CONFIG_LOCAL_ROUTE');
      if (Object.keys(local).length !== 0) throw new Error('TESTER_SIMULATOR_AI_CONFIG_INVALID');
    } else if (route.oneofKind === 'cloud') {
      const cloud = record(route.cloud, 'AI_CONFIG_CLOUD_ROUTE');
      if (Object.keys(cloud).some((key) => /binding|connector.?grant|custody|grant.?id/iu.test(key))) {
        throw new Error('TESTER_SIMULATOR_AI_CONFIG_INVALID');
      }
      const implementation = record(cloud.implementation, 'AI_CONFIG_IMPLEMENTATION');
      text(implementation.implementationId, 'AI_CONFIG_IMPLEMENTATION_ID');
      text(implementation.driverId, 'AI_CONFIG_DRIVER_ID');
      text(implementation.driverDialect, 'AI_CONFIG_DRIVER_DIALECT');
    } else {
      throw new Error('TESTER_SIMULATOR_AI_CONFIG_INVALID');
    }
  }
  return candidate;
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

function personaReference(value: TesterSimulatorJsonValue): JsonRecord {
  const reference = record(value, 'PERSONA_REFERENCE');
  if (reference.protocolRevision !== 1
    || !Number.isSafeInteger(reference.ecosystemRevision)
    || typeof reference.interactionId !== 'string'
    || !reference.interactionId
    || !Number.isSafeInteger(reference.committedAt)) {
    throw new Error('TESTER_SIMULATOR_PERSONA_REFERENCE_INVALID');
  }
  const persona = record(reference.persona, 'PERSONA_REFERENCE');
  return {
    protocolRevision: 1,
    ecosystemRevision: reference.ecosystemRevision,
    interactionId: reference.interactionId,
    persona: {
      accountId: text(persona.accountId, 'PERSONA_ACCOUNT'),
      userId: text(persona.userId, 'PERSONA_USER'),
      displayName: text(persona.displayName, 'PERSONA_DISPLAY_NAME'),
      role: text(persona.role, 'PERSONA_ROLE'),
      realmEnvironmentId: text(persona.realmEnvironmentId, 'PERSONA_REALM_ENV'),
    },
    committedAt: reference.committedAt,
  };
}

export const testerSimulatorBehavior = Object.freeze({
  initialState(input: TesterSimulatorInitialInput): TesterSimulatorJsonValue {
    const scenario = scenarioData(input.moduleData);
    const shared = record(input.sharedProjection, 'SHARED_PROJECTION');
    return {
      protocolRevision: 1,
      scenario,
      runSequence: 0,
      runHistory: {},
      imageHistory: [],
      promptDrafts: {},
      aiConfig: initialConfig(),
      actionLog: [],
      capabilityExecutions: [],
      ecosystemReference: null,
      personaReference: shared.persona === undefined || shared.persona === null
        ? null
        : personaReference(shared.persona),
    };
  },

  reduce(
    currentValue: TesterSimulatorJsonValue,
    envelope: TesterSimulatorCommandEnvelope,
    context: TesterSimulatorBehaviorContext,
  ) {
    const current = state(currentValue);
    const payload = payloadRecord(envelope);
    if (envelope.type === 'tester.ecosystem.observe') {
      if (payload.protocolRevision !== 1
        || !Number.isSafeInteger(payload.ecosystemRevision)
        || typeof payload.interactionId !== 'string'
        || !Number.isSafeInteger(payload.committedAt)) {
        throw new Error('TESTER_SIMULATOR_ECOSYSTEM_REFERENCE_INVALID');
      }
      return {
        state: {
          ...current,
          ecosystemReference: {
            protocolRevision: 1,
            ecosystemRevision: payload.ecosystemRevision,
            interactionId: payload.interactionId,
            committedAt: payload.committedAt,
          },
        },
        events: [],
      };
    }
    if (envelope.type === 'tester.persona.observe') {
      return {
        state: {
          ...current,
          personaReference: personaReference(payload),
        },
        events: [],
      };
    }
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
    if (envelope.type === 'tester.history.remove') {
      const recordId = text(payload.recordId, 'HISTORY_RECORD_ID');
      const runHistory = Object.fromEntries(
        Object.entries(current.runHistory).map(([capabilityId, entries]) => [
          capabilityId,
          entries.filter((entry) => entry.id !== recordId),
        ]),
      );
      return { state: { ...current, runHistory }, events: [] };
    }
    if (envelope.type === 'tester.history.clear') {
      const capabilityId = typeof payload.capabilityId === 'string' ? payload.capabilityId : null;
      const runHistory = capabilityId === null
        ? {}
        : Object.fromEntries(
            Object.entries(current.runHistory).filter(([key]) => key !== capabilityId),
          );
      return { state: { ...current, runHistory }, events: [] };
    }
    if (envelope.type === 'tester.preferences.save') {
      return { state: current, events: [] };
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
      return { state: { ...current, aiConfig: canonicalAIConfig(payload.config) }, events: [] };
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
