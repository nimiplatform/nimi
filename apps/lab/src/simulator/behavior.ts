import type {
  LabSimulatorBehaviorContext,
  LabSimulatorCommandEnvelope,
  LabSimulatorInitialInput,
  LabSimulatorJsonValue,
  LabSimulatorProjectionInput,
} from './protocol.js';

const MAX_HISTORY_PER_CAPABILITY = 80;
const MAX_IMAGE_HISTORY = 80;
const MAX_PROMPT_DRAFTS = 64;
const MAX_ACTION_LOG = 128;
const MAX_EXECUTION_LOG = 128;

type JsonRecord = { readonly [key: string]: LabSimulatorJsonValue };

interface LabSimulatorScenarioData extends JsonRecord {
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
  readonly adoptionArtifacts: Readonly<Record<string, JsonRecord>>;
}

interface LabSimulatorState extends JsonRecord {
  readonly protocolRevision: 1;
  readonly scenario: LabSimulatorScenarioData;
  readonly runSequence: number;
  readonly runHistory: Readonly<Record<string, readonly JsonRecord[]>>;
  readonly imageHistory: readonly JsonRecord[];
  readonly assets: Readonly<Record<string, JsonRecord>>;
  readonly promptDrafts: Readonly<Record<string, string>>;
  readonly aiConfig: JsonRecord;
  readonly actionLog: readonly JsonRecord[];
  readonly capabilityExecutions: readonly JsonRecord[];
  readonly ecosystemReference: JsonRecord | null;
  readonly personaReference: JsonRecord | null;
}

function record(value: LabSimulatorJsonValue, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`LAB_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function text(value: LabSimulatorJsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`LAB_SIMULATOR_${label}_INVALID`);
  }
  return value;
}

function scenarioData(value: LabSimulatorJsonValue): LabSimulatorScenarioData {
  const input = record(value, 'SCENARIO_DATA');
  const runtimePlatform = record(input.runtimePlatform, 'RUNTIME_PLATFORM');
  const aiConfigSummary = record(input.aiConfigSummary, 'AI_CONFIG_SUMMARY');
  const runtimeSummary = record(aiConfigSummary.runtime, 'AI_CONFIG_RUNTIME');
  const adoptionArtifacts = record(input.adoptionArtifacts, 'ADOPTION_ARTIFACTS');
  if (runtimePlatform.status !== 'unavailable'
    || runtimePlatform.mode !== 'local-app'
    || runtimeSummary.status !== 'simulated'
    || runtimeSummary.mode !== 'simulated') {
    throw new Error('LAB_SIMULATOR_SCENARIO_PROJECTION_INVALID');
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
    adoptionArtifacts: Object.fromEntries(Object.entries(adoptionArtifacts).map(([artifactId, value]) => [
      text(artifactId, 'ADOPTION_ARTIFACT_ID'),
      assetValue(record(value, 'ADOPTION_ARTIFACT'), '', false),
    ])),
  };
}

function assetValue(value: JsonRecord, relativePath: string, requirePath = true): JsonRecord {
  const body = value.body;
  if ((requirePath && (!relativePath || relativePath.includes('..')))
    || typeof value.mediaType !== 'string'
    || !Number.isSafeInteger(value.sizeBytes)
    || (value.sizeBytes as number) < 0
    || typeof value.sha256 !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(value.sha256)
    || !Array.isArray(body)
    || body.length !== value.sizeBytes
    || body.some((byte) => !Number.isSafeInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('LAB_SIMULATOR_ASSET_INVALID');
  }
  return {
    relativePath,
    mediaType: value.mediaType,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    body,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}

function initialConfig(): JsonRecord {
  return {
    owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.lab' } } },
    capabilities: [{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    }],
  };
}

function state(value: LabSimulatorJsonValue): LabSimulatorState {
  const candidate = record(value, 'STATE');
  if (candidate.protocolRevision !== 1) throw new Error('LAB_SIMULATOR_STATE_REVISION_INVALID');
  return candidate as LabSimulatorState;
}

function appendBounded<T>(values: readonly T[], value: T, limit: number): readonly T[] {
  return [...values, value].slice(-limit);
}

function payloadRecord(envelope: LabSimulatorCommandEnvelope): JsonRecord {
  return record(envelope.payload, 'COMMAND_PAYLOAD');
}

function personaReference(value: LabSimulatorJsonValue): JsonRecord {
  const reference = record(value, 'PERSONA_REFERENCE');
  if (reference.protocolRevision !== 1
    || !Number.isSafeInteger(reference.ecosystemRevision)
    || typeof reference.interactionId !== 'string'
    || !reference.interactionId
    || !Number.isSafeInteger(reference.committedAt)) {
    throw new Error('LAB_SIMULATOR_PERSONA_REFERENCE_INVALID');
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

export const labSimulatorBehavior = Object.freeze({
  initialState(input: LabSimulatorInitialInput): LabSimulatorJsonValue {
    const scenario = scenarioData(input.moduleData);
    const shared = record(input.sharedProjection, 'SHARED_PROJECTION');
    return {
      protocolRevision: 1,
      scenario,
      runSequence: 0,
      runHistory: {},
      imageHistory: [],
      assets: {},
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
    currentValue: LabSimulatorJsonValue,
    envelope: LabSimulatorCommandEnvelope,
    context: LabSimulatorBehaviorContext,
  ) {
    const current = state(currentValue);
    const payload = payloadRecord(envelope);
    if (envelope.type === 'lab.ecosystem.observe') {
      if (payload.protocolRevision !== 1
        || !Number.isSafeInteger(payload.ecosystemRevision)
        || typeof payload.interactionId !== 'string'
        || !Number.isSafeInteger(payload.committedAt)) {
        throw new Error('LAB_SIMULATOR_ECOSYSTEM_REFERENCE_INVALID');
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
    if (envelope.type === 'lab.persona.observe') {
      return {
        state: {
          ...current,
          personaReference: personaReference(payload),
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.run.allocate') {
      return { state: { ...current, runSequence: current.runSequence + 1 }, events: [] };
    }
    if (envelope.type === 'lab.capability.execute') {
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
    if (envelope.type === 'lab.history.append') {
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
    if (envelope.type === 'lab.history.remove') {
      const recordId = text(payload.recordId, 'HISTORY_RECORD_ID');
      const runHistory = Object.fromEntries(
        Object.entries(current.runHistory).map(([capabilityId, entries]) => [
          capabilityId,
          entries.filter((entry) => entry.id !== recordId),
        ]),
      );
      return { state: { ...current, runHistory }, events: [] };
    }
    if (envelope.type === 'lab.history.clear') {
      const capabilityId = typeof payload.capabilityId === 'string' ? payload.capabilityId : null;
      const runHistory = capabilityId === null
        ? {}
        : Object.fromEntries(
            Object.entries(current.runHistory).filter(([key]) => key !== capabilityId),
          );
      return { state: { ...current, runHistory }, events: [] };
    }
    if (envelope.type === 'lab.preferences.save') {
      return { state: current, events: [] };
    }
    if (envelope.type === 'lab.image-history.append') {
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
    if (envelope.type === 'lab.image-history.remove') {
      const runId = text(payload.runId, 'IMAGE_HISTORY_ID');
      return {
        state: {
          ...current,
          imageHistory: current.imageHistory.filter((entry) => (entry.runId ?? entry.id) !== runId),
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.image-history.clear') {
      const capabilityId = typeof payload.capabilityId === 'string' ? payload.capabilityId : null;
      return {
        state: {
          ...current,
          imageHistory: capabilityId === null
            ? []
            : current.imageHistory.filter((entry) => entry.capabilityId !== capabilityId),
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.asset.write') {
      const relativePath = text(payload.relativePath, 'ASSET_PATH');
      const existing = current.assets[relativePath];
      if (existing && payload.overwrite !== true) throw new Error('LAB_SIMULATOR_ASSET_ALREADY_EXISTS');
      const timestamp = new Date(context.now).toISOString();
      const next = assetValue(payload, relativePath);
      return {
        state: {
          ...current,
          assets: {
            ...current.assets,
            [relativePath]: {
              ...next,
              createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : timestamp,
              updatedAt: timestamp,
            },
          },
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.asset.remove') {
      const relativePath = text(payload.relativePath, 'ASSET_PATH');
      const assets = { ...current.assets };
      delete assets[relativePath];
      return { state: { ...current, assets }, events: [] };
    }
    if (envelope.type === 'lab.asset.move') {
      const from = text(payload.from, 'ASSET_FROM_PATH');
      const to = text(payload.to, 'ASSET_TO_PATH');
      const source = current.assets[from];
      if (!source) throw new Error('LAB_SIMULATOR_ASSET_NOT_FOUND');
      if (current.assets[to] && payload.overwrite !== true) throw new Error('LAB_SIMULATOR_ASSET_ALREADY_EXISTS');
      const assets = { ...current.assets };
      delete assets[from];
      assets[to] = { ...source, relativePath: to, updatedAt: new Date(context.now).toISOString() };
      return { state: { ...current, assets }, events: [] };
    }
    if (envelope.type === 'lab.asset.adopt') {
      const artifactId = text(payload.artifactId, 'ASSET_ARTIFACT_ID');
      const relativePath = text(payload.relativePath, 'ASSET_PATH');
      const source = current.scenario.adoptionArtifacts[artifactId];
      if (!source) throw new Error('LAB_SIMULATOR_ARTIFACT_UNAVAILABLE');
      const existing = current.assets[relativePath];
      if (existing && payload.overwrite !== true) throw new Error('LAB_SIMULATOR_ASSET_ALREADY_EXISTS');
      const timestamp = new Date(context.now).toISOString();
      const adopted = assetValue(source, relativePath);
      return {
        state: {
          ...current,
          assets: {
            ...current.assets,
            [relativePath]: {
              ...adopted,
              createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : timestamp,
              updatedAt: timestamp,
            },
          },
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.prompt.save') {
      const key = record(payload.key, 'PROMPT_KEY');
      const draftId = [key.surfaceId, key.capabilityId, key.scenarioId].map((entry) => text(entry, 'PROMPT_KEY_PART')).join(':');
      const next = { ...current.promptDrafts };
      if (payload.enabled === true) next[draftId] = typeof payload.prompt === 'string' ? payload.prompt : '';
      else delete next[draftId];
      const entries = Object.entries(next).slice(-MAX_PROMPT_DRAFTS);
      return { state: { ...current, promptDrafts: Object.fromEntries(entries) }, events: [] };
    }
    if (envelope.type === 'lab.action.record') {
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
    throw new Error(`LAB_SIMULATOR_COMMAND_UNDECLARED:${envelope.type}`);
  },

  project(
    currentValue: LabSimulatorJsonValue,
    instance: LabSimulatorProjectionInput,
  ): LabSimulatorJsonValue {
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
