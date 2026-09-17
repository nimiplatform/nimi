import type {
  LabSimulatorBehaviorContext,
  LabSimulatorCommandEnvelope,
  LabSimulatorInitialInput,
  LabSimulatorJsonValue,
  LabSimulatorProjectionInput,
} from './protocol.js';

type JsonRecord = { readonly [key: string]: LabSimulatorJsonValue };

interface LabSimulatorState extends JsonRecord {
  readonly protocolRevision: 1;
  readonly scenario: JsonRecord;
  readonly runSequence: number;
  readonly runHistory: Readonly<Record<string, readonly JsonRecord[]>>;
  readonly imageHistory: readonly JsonRecord[];
  readonly assets: Readonly<Record<string, JsonRecord>>;
  readonly promptDrafts: Readonly<Record<string, string>>;
  readonly preferences: JsonRecord | null;
  readonly aiConfig: JsonRecord;
  readonly aiConfigRevision: number;
  readonly capabilityExecutions: readonly JsonRecord[];
  readonly actionLog: readonly JsonRecord[];
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
  if (typeof value !== 'string' || !value.trim()) throw new Error(`LAB_SIMULATOR_${label}_INVALID`);
  return value;
}

function state(value: LabSimulatorJsonValue): LabSimulatorState {
  const candidate = record(value, 'STATE');
  if (candidate.protocolRevision !== 1
    || !Number.isSafeInteger(candidate.runSequence)
    || !Number.isSafeInteger(candidate.aiConfigRevision)
    || !Array.isArray(candidate.imageHistory)
    || !Array.isArray(candidate.actionLog)
    || !candidate.assets
    || typeof candidate.assets !== 'object'
    || Array.isArray(candidate.assets)
    || !Array.isArray(candidate.capabilityExecutions)) {
    throw new Error('LAB_SIMULATOR_STATE_INVALID');
  }
  return candidate as unknown as LabSimulatorState;
}

function initialAIConfig(): JsonRecord {
  return {
    owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.lab' } } },
    capabilities: [{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      route: { oneofKind: 'local', local: {} },
    }],
  };
}

function initialPreferences(): JsonRecord {
  return {
    schemaVersion: 1,
    draftPersistence: true,
    verboseConsole: false,
    historyPanel: { collapsed: true, scope: 'capability', hideFailures: false },
    lastCapabilityId: null,
  };
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
  const persona = record(reference.persona, 'PERSONA');
  return {
    protocolRevision: 1,
    ecosystemRevision: reference.ecosystemRevision,
    interactionId: reference.interactionId,
    persona: {
      accountId: text(persona.accountId, 'PERSONA_ACCOUNT'),
      userId: text(persona.userId, 'PERSONA_USER'),
      displayName: text(persona.displayName, 'PERSONA_DISPLAY_NAME'),
      role: text(persona.role, 'PERSONA_ROLE'),
      realmEnvironmentId: text(persona.realmEnvironmentId, 'PERSONA_REALM_ENVIRONMENT'),
    },
    committedAt: reference.committedAt,
  };
}

function promptDraftId(value: LabSimulatorJsonValue): string {
  const key = record(value, 'PROMPT_KEY');
  return [
    text(key.surfaceId, 'PROMPT_SURFACE'),
    text(key.capabilityId, 'PROMPT_CAPABILITY'),
    text(key.scenarioId, 'PROMPT_SCENARIO'),
  ].join(':');
}

export const labSimulatorBehavior = Object.freeze({
  initialState(input: LabSimulatorInitialInput): LabSimulatorJsonValue {
    const scenario = record(input.moduleData, 'SCENARIO_DATA');
    const shared = record(input.sharedProjection, 'SHARED_PROJECTION');
    return {
      protocolRevision: 1,
      scenario,
      runSequence: 0,
      runHistory: {},
      imageHistory: [],
      assets: {},
      promptDrafts: {},
      preferences: initialPreferences(),
      aiConfig: initialAIConfig(),
      aiConfigRevision: 1,
      capabilityExecutions: [],
      actionLog: [],
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
    const payload = record(envelope.payload, 'COMMAND_PAYLOAD');
    if (envelope.type === 'lab.ecosystem.observe') {
      if (payload.protocolRevision !== 1
        || !Number.isSafeInteger(payload.ecosystemRevision)
        || typeof payload.interactionId !== 'string'
        || !payload.interactionId
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
      return { state: { ...current, personaReference: personaReference(payload) }, events: [] };
    }
    if (envelope.type === 'lab.run.allocate') {
      return { state: { ...current, runSequence: current.runSequence + 1 }, events: [] };
    }
    if (envelope.type === 'lab.capability.execute') {
      const capabilityId = text(payload.capabilityId, 'CAPABILITY');
      if (capabilityId !== 'text.generate') throw new Error('LAB_SIMULATOR_CAPABILITY_UNDECLARED');
      const execution = {
        capabilityId,
        promptLength: typeof payload.prompt === 'string' ? payload.prompt.length : 0,
        logicalTime: context.now,
      };
      return {
        state: {
          ...current,
          capabilityExecutions: [...current.capabilityExecutions, execution].slice(-64),
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.ai-config.overwrite') {
      if (payload.expectedRevision !== String(current.aiConfigRevision)
        || !Array.isArray(payload.capabilities)) {
        throw new Error('LAB_SIMULATOR_AI_CONFIG_REVISION_CONFLICT');
      }
      return {
        state: {
          ...current,
          aiConfig: { ...current.aiConfig, capabilities: payload.capabilities },
          aiConfigRevision: current.aiConfigRevision + 1,
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.history.append') {
      const historyRecord = record(payload.record, 'HISTORY_RECORD');
      const capabilityId = text(historyRecord.capabilityId, 'HISTORY_CAPABILITY');
      const prior = current.runHistory[capabilityId] ?? [];
      return {
        state: {
          ...current,
          runHistory: {
            ...current.runHistory,
            [capabilityId]: [...prior.filter((entry) => entry.id !== historyRecord.id), historyRecord].slice(-100),
          },
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.history.remove') {
      const recordId = text(payload.recordId, 'HISTORY_RECORD_ID');
      return {
        state: {
          ...current,
          runHistory: Object.fromEntries(Object.entries(current.runHistory).map(([key, values]) => [
            key,
            values.filter((entry) => entry.id !== recordId),
          ])),
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.history.clear') {
      const capabilityId = payload.capabilityId;
      if (capabilityId !== null && typeof capabilityId !== 'string') {
        throw new Error('LAB_SIMULATOR_HISTORY_SCOPE_INVALID');
      }
      if (!capabilityId) return { state: { ...current, runHistory: {} }, events: [] };
      const next = { ...current.runHistory };
      delete next[capabilityId];
      return { state: { ...current, runHistory: next }, events: [] };
    }
    if (envelope.type === 'lab.image-history.append') {
      const imageRecord = record(payload.record, 'IMAGE_HISTORY_RECORD');
      text(imageRecord.runId, 'IMAGE_HISTORY_RUN_ID');
      return {
        state: {
          ...current,
          imageHistory: [
            ...current.imageHistory.filter((entry) => entry.id !== imageRecord.id),
            imageRecord,
          ].slice(-100),
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.image-history.remove') {
      const runId = text(payload.runId, 'IMAGE_HISTORY_RUN_ID');
      return {
        state: { ...current, imageHistory: current.imageHistory.filter((entry) => entry.runId !== runId) },
        events: [],
      };
    }
    if (envelope.type === 'lab.image-history.clear') {
      const capabilityId = payload.capabilityId;
      if (capabilityId !== null && typeof capabilityId !== 'string') {
        throw new Error('LAB_SIMULATOR_IMAGE_HISTORY_SCOPE_INVALID');
      }
      return {
        state: {
          ...current,
          imageHistory: capabilityId
            ? current.imageHistory.filter((entry) => entry.capabilityId !== capabilityId)
            : [],
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.asset.write') {
      const relativePath = text(payload.relativePath, 'ASSET_PATH');
      const existing = current.assets[relativePath];
      if (existing && payload.overwrite !== true) throw new Error('LAB_SIMULATOR_ASSET_ALREADY_EXISTS');
      if (!Array.isArray(payload.body)
        || !Number.isSafeInteger(payload.sizeBytes)
        || payload.body.length !== payload.sizeBytes
        || typeof payload.sha256 !== 'string'
        || typeof payload.mediaType !== 'string') {
        throw new Error('LAB_SIMULATOR_ASSET_INVALID');
      }
      const timestamp = new Date(context.now).toISOString();
      return {
        state: {
          ...current,
          assets: {
            ...current.assets,
            [relativePath]: {
              relativePath,
              mediaType: payload.mediaType,
              sizeBytes: payload.sizeBytes,
              sha256: payload.sha256,
              body: payload.body,
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
      const from = text(payload.from, 'ASSET_FROM');
      const to = text(payload.to, 'ASSET_TO');
      const source = current.assets[from];
      if (!source) throw new Error('LAB_SIMULATOR_ASSET_NOT_FOUND');
      if (current.assets[to] && payload.overwrite !== true) throw new Error('LAB_SIMULATOR_ASSET_ALREADY_EXISTS');
      const assets = { ...current.assets };
      delete assets[from];
      assets[to] = { ...source, relativePath: to, updatedAt: new Date(context.now).toISOString() };
      return { state: { ...current, assets }, events: [] };
    }
    if (envelope.type === 'lab.asset.adopt') {
      const relativePath = text(payload.relativePath, 'ASSET_PATH');
      const artifactId = text(payload.artifactId, 'ARTIFACT_ID');
      const artifacts = record(current.scenario.adoptionArtifacts ?? null, 'ADOPTION_ARTIFACTS');
      const source = record(artifacts[artifactId] ?? null, 'ADOPTION_ARTIFACT');
      if (current.assets[relativePath] && payload.overwrite !== true) throw new Error('LAB_SIMULATOR_ASSET_ALREADY_EXISTS');
      const timestamp = new Date(context.now).toISOString();
      return {
        state: {
          ...current,
          assets: {
            ...current.assets,
            [relativePath]: {
              ...source,
              relativePath,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.action.record') {
      const kind = text(payload.kind, 'ACTION_KIND');
      const channel = text(payload.channel, 'ACTION_CHANNEL');
      return {
        state: {
          ...current,
          actionLog: [...current.actionLog, {
            kind,
            channel,
            details: payload.details ?? null,
            logicalTime: context.now,
          }].slice(-128),
        },
        events: [],
      };
    }
    if (envelope.type === 'lab.preferences.save') {
      return { state: { ...current, preferences: record(payload.preferences, 'PREFERENCES') }, events: [] };
    }
    if (envelope.type === 'lab.prompt.save') {
      const id = promptDraftId(payload.key ?? null);
      if (typeof payload.prompt !== 'string' || typeof payload.enabled !== 'boolean') {
        throw new Error('LAB_SIMULATOR_PROMPT_INVALID');
      }
      const promptDrafts = { ...current.promptDrafts };
      if (payload.enabled) promptDrafts[id] = payload.prompt;
      else delete promptDrafts[id];
      return { state: { ...current, promptDrafts }, events: [] };
    }
    throw new Error(`LAB_SIMULATOR_COMMAND_UNDECLARED:${envelope.type}`);
  },
  project(
    currentValue: LabSimulatorJsonValue,
    instance: LabSimulatorProjectionInput,
  ): LabSimulatorJsonValue {
    return {
      ...state(currentValue),
      surfaceId: instance.surfaceId,
      route: {
        pathname: instance.route.pathname,
        search: instance.route.search.map(({ key, value }) => ({ key, value })),
        fragment: instance.route.fragment,
      },
    };
  },
});
