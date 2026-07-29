import type { SharedAIConfigService } from '@nimiplatform/kit/features/model-config/headless';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker/runtime';
import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';
import type { NimiAIConfig, NimiAIScopeRef } from '@nimiplatform/sdk/ai';
import type { NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import {
  NIMI_TESTING_AI_GENERATE_TEXT_METHOD,
  createNimiTestingAiModel,
  createNimiTestingHarness,
  userTextMessage,
  type NimiTestingAiMethodMap,
  type NimiTestingHostPort,
} from '@nimiplatform/sdk/testing';
import type { PermissionID } from '@nimiplatform/sdk/app';

import type { TesterCanonicalRendererBindings } from '../renderer/contract.js';
import type { RuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { appId } from '../shell/auth/app-identity.js';
import type { TesterAIConfigSummary } from '../tester/tester-ai-config.js';
import { getTesterCapability } from '../tester/tester-capabilities.js';
import type { TesterAIProfileImportResult } from '../tester/tester-ai-config-store.js';
import type { TesterArtifactSaveResult } from '../tester/tester-artifact-storage.js';
import type { TesterImageHistoryRecord } from '../tester/tester-image-history.js';
import type { TesterRunHistory, TesterRunHistoryRecord } from '../tester/tester-history.js';
import type {
  TesterPromptDraftKey,
  TesterPromptDraftLoadResult,
  TesterPromptDraftSaveResult,
} from '../tester/tester-preferences.js';
import type { TesterCapabilityRunInput, TesterCapabilityRunResult } from '../tester/tester-runtime.js';
import { capabilityUnavailable } from '../tester/tester-unavailable.js';
import type {
  ClaimWorldTourViewerLaunchInput,
  OpenWorldTourWindowInput,
  OpenWorldTourWindowResponse,
  ResolvedWorldTourFixture,
  ResolveWorldTourFixtureInput,
} from '../tester/world-tour/world-tour-shared.js';
import type {
  TesterSimulatorJsonValue,
  TesterSimulatorPrepareContext,
  TesterSimulatorRouteState,
} from './protocol.js';

const MAX_COMMAND_BYTES = 262_144;
const PROMPT_DRAFT_STORAGE_KEY = 'nimiapp-tester:prompt-drafts:v1' as const;

type JsonRecord = { readonly [key: string]: TesterSimulatorJsonValue };

interface TesterProjection extends JsonRecord {
  readonly protocolRevision: 1;
  readonly scenario: {
    readonly generatedText: string;
    readonly textModel: { readonly providerId: string; readonly modelId: string };
    readonly connector: {
      readonly connectorId: string;
      readonly provider: string;
      readonly label: string;
      readonly remoteModelCatalogId: string;
      readonly providerModelId: string;
      readonly modelLabel: string;
    };
    readonly runtimePlatform: JsonRecord;
    readonly aiConfigSummary: JsonRecord;
  };
  readonly runHistory: Readonly<Record<string, readonly JsonRecord[]>>;
  readonly imageHistory: readonly JsonRecord[];
  readonly promptDrafts: Readonly<Record<string, string>>;
  readonly aiConfig: JsonRecord;
  readonly ecosystemReference: JsonRecord | null;
  readonly personaReference: JsonRecord | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJson(value: unknown, seen = new Set<object>()): TesterSimulatorJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('Tester Simulator input contains an invalid number.');
    return value;
  }
  if (typeof value !== 'object') throw new Error('Tester Simulator input is not JSON-compatible.');
  if (seen.has(value)) throw new Error('Tester Simulator input contains a cycle.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const normalized = normalizeJson(entry, seen);
        if (normalized === undefined) throw new Error('Tester Simulator arrays cannot contain undefined.');
        return normalized;
      });
    }
    const output: Record<string, TesterSimulatorJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeJson(entry, seen);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function commandJson(value: unknown): TesterSimulatorJsonValue {
  const normalized = normalizeJson(value);
  if (normalized === undefined) throw new Error('Tester Simulator command payload is empty.');
  const bytes = JSON.stringify(normalized).length;
  if (bytes > MAX_COMMAND_BYTES) throw new Error('Tester Simulator command payload exceeds the admitted bound.');
  return normalized;
}

function projection(context: TesterSimulatorPrepareContext): TesterProjection {
  const value = context.projection.get();
  if (!isRecord(value)
    || value.protocolRevision !== 1
    || !isRecord(value.scenario)
    || !isRecord(value.runHistory)
    || !Array.isArray(value.imageHistory)
    || !isRecord(value.promptDrafts)
    || !isRecord(value.aiConfig)
    || (value.ecosystemReference !== null && !isRecord(value.ecosystemReference))
    || (value.personaReference !== null && !isRecord(value.personaReference))) {
    throw new Error('Tester simulated projection is invalid.');
  }
  return value as unknown as TesterProjection;
}

function hostError(message: string, reasonCode: string): Error & { readonly code: string; readonly reasonCode: string } {
  return Object.assign(new Error(message), { code: reasonCode, reasonCode });
}

function effectForbidden<TValue>(): NimiRendererHostResult<TValue> {
  return { ok: false, error: { disposition: 'effect-forbidden' } };
}

function diagnosticFailure(): NimiRendererHostResult<{ readonly recorded: boolean }> {
  return { ok: false, error: { disposition: 'host-unavailable' } };
}

function unmodeledEffect(name: string): never {
  throw hostError(
    `${name} is not modeled by the selected Tester simulation scenario.`,
    'TESTER_SIMULATED_EFFECT_UNAVAILABLE',
  );
}

function unmodeledSdkMethod(name: string): never {
  throw hostError(
    `${name} is not modeled by the selected Tester simulation scenario.`,
    'TESTER_SIMULATED_SDK_METHOD_UNAVAILABLE',
  );
}

async function invoke(
  context: TesterSimulatorPrepareContext,
  type: string,
  payload: unknown,
): Promise<{ readonly revision: number }> {
  const result = await context.commands.invoke(type, commandJson(payload));
  if (!result.ok || !isRecord(result.value) || !Number.isSafeInteger(result.value.revision)) {
    throw hostError('The simulated Tester action was not accepted.', 'TESTER_SIMULATED_ACTION_REJECTED');
  }
  return { revision: result.value.revision as number };
}

function nowIso(context: TesterSimulatorPrepareContext): string {
  return new Date(context.clock.now()).toISOString();
}

function promptDraftId(key: TesterPromptDraftKey): string {
  return `${key.surfaceId}:${key.capabilityId}:${key.scenarioId}`;
}

function aiConfig(value: JsonRecord): NimiAIConfig {
  if (!isRecord(value.scopeRef) || !isRecord(value.capabilities)) {
    throw new Error('Tester simulated AIConfig is invalid.');
  }
  return value as unknown as NimiAIConfig;
}

function simulatedModelProvider(context: TesterSimulatorPrepareContext): RouteModelPickerDataProvider {
  return Object.freeze({
    async listLocalModels() {
      return [];
    },
    async listConnectors() {
      const connector = projection(context).scenario.connector;
      return [{
        connectorId: connector.connectorId,
        provider: connector.provider,
        providerLabel: connector.label,
        label: connector.label,
        status: 'ready',
      }];
    },
    async listConnectorModels(connectorId: string) {
      const connector = projection(context).scenario.connector;
      if (connectorId !== connector.connectorId) return [];
      return [{
        modelId: connector.providerModelId,
        remoteModelCatalogId: connector.remoteModelCatalogId,
        providerModelId: connector.providerModelId,
        provider: connector.provider,
        modelLabel: connector.modelLabel,
        available: true,
        capabilities: ['text.generate'],
      }];
    },
  });
}

function createAIConfigService(
  context: TesterSimulatorPrepareContext,
  scopeRef: NimiAIScopeRef,
): SharedAIConfigService {
  const requireScope = (candidate: NimiAIScopeRef): void => {
    if (candidate.kind !== scopeRef.kind
      || candidate.ownerId !== scopeRef.ownerId
      || candidate.surfaceId !== scopeRef.surfaceId) {
      throw hostError('The requested AIConfig scope is outside this Tester surface.', 'TESTER_SIMULATED_AI_SCOPE_MISMATCH');
    }
  };
  return Object.freeze({
    aiConfig: Object.freeze({
      get(candidate: NimiAIScopeRef) {
        requireScope(candidate);
        return aiConfig(projection(context).aiConfig);
      },
      async update(candidate: NimiAIScopeRef, next: NimiAIConfig) {
        requireScope(candidate);
        await invoke(context, 'tester.ai-config.update', { config: next });
      },
      subscribe(candidate: NimiAIScopeRef, listener: (next: NimiAIConfig) => void) {
        requireScope(candidate);
        return context.projection.subscribe(() => listener(aiConfig(projection(context).aiConfig)));
      },
    }),
    aiProfile: Object.freeze({
      async list() {
        return [];
      },
      async previewApply() {
        throw hostError('No simulated AI profile is selected by this scenario.', 'TESTER_SIMULATED_AI_PROFILE_UNAVAILABLE');
      },
      async apply() {
        throw hostError('No simulated AI profile is selected by this scenario.', 'TESTER_SIMULATED_AI_PROFILE_UNAVAILABLE');
      },
    }),
  });
}

function createSdkFacade(context: TesterSimulatorPrepareContext) {
  const scopeRef: NimiAIScopeRef = Object.freeze({ kind: 'app', ownerId: appId, surfaceId: 'app-lab' });
  const modelProvider = simulatedModelProvider(context);
  const port = {
      async invoke(methodId: string, request: NimiGenerateTextRequest) {
        if (methodId !== NIMI_TESTING_AI_GENERATE_TEXT_METHOD) {
          return { ok: false, error: { disposition: 'unsupported' } };
        }
        await invoke(context, 'tester.capability.execute', {
          capabilityId: 'text.generate',
          prompt: request.messages.map((message) => JSON.stringify(message.content)).join('\n'),
          scenarioId: null,
          attachmentCount: 0,
          directive: null,
        });
        return {
          ok: true,
          value: {
            text: projection(context).scenario.generatedText,
            finishReason: 'stop',
            usage: { promptTokens: 18, completionTokens: 12, totalTokens: 30 },
          },
        };
      },
      async openStream() {
        return { ok: false, error: { disposition: 'unsupported' } };
      },
    } as NimiTestingHostPort<NimiTestingAiMethodMap>;
  const harness = createNimiTestingHarness<NimiTestingAiMethodMap>({
    opaqueTraceSeed: '7'.repeat(64),
    methods: [{ id: NIMI_TESTING_AI_GENERATE_TEXT_METHOD, kind: 'unary' }],
    port,
  });
  const modelProjection = projection(context).scenario.textModel;
  const model = createNimiTestingAiModel({ model: modelProjection, harness });
  const configService = createAIConfigService(context, scopeRef);

  async function execute(input: TesterCapabilityRunInput): Promise<TesterCapabilityRunResult> {
    const capability = getTesterCapability(input.capabilityId);
    if (input.capabilityId !== 'text.generate') {
      return capabilityUnavailable(
        capability,
        'sdk-method-unavailable',
        'This capability has no admitted Simulator fixture, State Engine result model, and visible interaction proof.',
      );
    }
    const result = await model.generateText({
      model: model.model,
      messages: [userTextMessage([input.directive, input.prompt].filter(Boolean).join('\n'))],
    });
    return {
      ok: true,
      capabilityId: input.capabilityId,
      capabilityLabel: capability.label,
      message: 'Completed through the SDK testing facade against simulated State Engine data.',
      output: {
        kind: 'text',
        text: result.text,
        finishReason: result.finishReason,
        inputTokens: result.usage?.promptTokens,
        outputTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
        streamed: false,
      },
      trace: {
        modelResolved: model.model.modelId,
        routeDecision: 'simulated-scenario',
      },
    };
  }

  return Object.freeze({
    runCapability: execute,
    aiConfig: Object.freeze({
      service: configService,
      scopeRef,
      async requireAdmission() {
        return aiConfig(projection(context).aiConfig);
      },
      importProfileJson(_rawJson: string): TesterAIProfileImportResult {
        return {
          ok: false,
          errors: ['This scenario does not admit AIProfile import.'],
          message: 'Profile import is unavailable in the selected simulation scenario.',
          reasonCode: 'TESTER_LOCAL_APP_AI_CONFIG_UNAVAILABLE',
          actionHint: 'await_local_app_ai_config_operation_admission',
        };
      },
      modelPickerProvider: () => modelProvider,
      modelPickerProviderCache: () => modelProvider,
    }),
    settings: Object.freeze({
      async notificationUnread() {
        return unmodeledSdkMethod('Notification unread projection');
      },
      async notifications() {
        return unmodeledSdkMethod('Notification list projection');
      },
      async requestDataExport() {
        return unmodeledSdkMethod('Account data export');
      },
      async creatorEligibility() {
        return unmodeledSdkMethod('Creator eligibility projection');
      },
      async humanChats() {
        return unmodeledSdkMethod('Human chat projection');
      },
      async groupChats() {
        return unmodeledSdkMethod('Group chat projection');
      },
    }),
  });
}

function recordAction(
  context: TesterSimulatorPrepareContext,
  kind: string,
  subject: string,
  details: unknown,
): Promise<{ readonly revision: number }> {
  return invoke(context, 'tester.action.record', { kind, subject, details });
}

function createCommandPort(context: TesterSimulatorPrepareContext) {
  return Object.freeze({
    async nextRunIdentity() {
      const accepted = await invoke(context, 'tester.run.allocate', {});
      return { runId: `tester-run-${accepted.revision}`, createdAt: nowIso(context) };
    },
    async appendRunHistory(historyRecord: TesterRunHistoryRecord) {
      await invoke(context, 'tester.history.append', { record: historyRecord });
      return projection(context).runHistory as unknown as TesterRunHistory;
    },
    async appendImageHistory(imageRecord: TesterImageHistoryRecord) {
      await invoke(context, 'tester.image-history.append', { record: imageRecord });
      return projection(context).imageHistory as unknown as readonly TesterImageHistoryRecord[];
    },
    async saveArtifact(input: { readonly filename: string; readonly mimeType?: string; readonly dataUrl: string }): Promise<TesterArtifactSaveResult> {
      return unmodeledEffect(`Artifact save (${input.filename})`);
    },
    async savePromptDraft(key: TesterPromptDraftKey, prompt: string, enabled: boolean): Promise<TesterPromptDraftSaveResult> {
      try {
        await invoke(context, 'tester.prompt.save', { key, prompt, enabled });
        return {
          status: {
            state: enabled ? 'ready' : 'disabled',
            storageKey: PROMPT_DRAFT_STORAGE_KEY,
            message: enabled ? 'Prompt draft saved in simulated ecosystem state.' : 'Prompt draft persistence is disabled.',
          },
        };
      } catch (error) {
        return {
          status: {
            state: 'write-error',
            storageKey: PROMPT_DRAFT_STORAGE_KEY,
            message: 'Prompt draft was not committed to simulated ecosystem state.',
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    async copyText(_value: string) {
      return effectForbidden<{ readonly copied: boolean }>();
    },
    async exportText(_input: { readonly filename: string; readonly body: string }) {
      return effectForbidden<{ readonly filename: string }>();
    },
    async exportArtifact(_input: { readonly filename: string; readonly url: string }) {
      return effectForbidden<{ readonly filename: string }>();
    },
    async resolveWorldTourFixture(input: ResolveWorldTourFixtureInput): Promise<ResolvedWorldTourFixture> {
      return unmodeledEffect(`World Tour fixture resolution (${input.manifestPath ?? 'default'})`);
    },
    async openWorldTourWindow(input: OpenWorldTourWindowInput): Promise<OpenWorldTourWindowResponse> {
      return unmodeledEffect(`World Tour window open (${input.manifestPath})`);
    },
    async claimWorldTourViewerLaunch(input: ClaimWorldTourViewerLaunchInput): Promise<ResolvedWorldTourFixture> {
      return unmodeledEffect(`World Tour viewer claim (${input.manifestPath})`);
    },
    async saveWorldTourViewerPreset(input: { readonly manifestPath: string; readonly presetJson: string }) {
      return unmodeledEffect(`World Tour preset save (${input.manifestPath})`);
    },
    async localAppSessionStatus() {
      const runtimePlatform = projection(context).scenario.runtimePlatform;
      if (runtimePlatform.status !== 'unavailable' || runtimePlatform.mode !== 'local-app') {
        throw hostError('The Simulator local-app unavailability projection is invalid.', 'TESTER_SIMULATED_SESSION_INVALID');
      }
      return { state: 'unavailable', sessionBound: false };
    },
    async localAppPermissionStatus(_permissionId: PermissionID) {
      return { posture: 'unavailable', canRequest: false, agents: [], detail: 'Permission is unavailable in the selected simulation.' };
    },
    async localAppPermissionRequest(input: { readonly permissionId: PermissionID; readonly reason: string }) {
      await recordAction(context, 'permission-request', input.permissionId, { reason: input.reason, admitted: false });
      throw hostError('Reserved permission request rejected by the simulated host.', 'TESTER_SIMULATED_PERMISSION_UNAVAILABLE');
    },
    async localAppConversationJourney() {
      return unmodeledEffect('Local-app conversation journey');
    },
    async localAppConversationSnapshot() {
      return unmodeledEffect('Local-app conversation snapshot');
    },
    async localAppStorageRoundTrip(input: { readonly relativePath: string; readonly value: Readonly<Record<string, string | number>> }) {
      return unmodeledEffect(`App-private storage round trip (${input.relativePath})`);
    },
    async runtimeLog(input: Readonly<Record<string, unknown>>) {
      try {
        await recordAction(context, 'telemetry-runtime', 'runtime-log', input);
        return { ok: true as const, value: { recorded: true } };
      } catch {
        return diagnosticFailure();
      }
    },
    async rendererLog(input: Readonly<Record<string, unknown>>) {
      try {
        await recordAction(context, 'telemetry-renderer', 'renderer-log', input);
        return { ok: true as const, value: { recorded: true } };
      } catch {
        return diagnosticFailure();
      }
    },
  });
}

export function createTesterSimulatorBindings(
  context: TesterSimulatorPrepareContext,
): TesterCanonicalRendererBindings {
  let currentRoute = context.route.get();
  const routeListeners = new Set<() => void>();
  const unsubscribeRoute = context.route.subscribe((route) => {
    currentRoute = route;
    for (const listener of routeListeners) listener();
  });
  const ecosystemListeners = new Set<(payload: unknown) => void>();
  const personaListeners = new Set<(payload: unknown) => void>();
  let observedEcosystemRevision = 0;
  let observedPersonaKey: string | null = null;
  const unsubscribeProjection = context.projection.subscribe(() => {
    const value = projection(context);
    const reference = value.ecosystemReference;
    if (reference && Number.isSafeInteger(reference.ecosystemRevision)) {
      const revision = reference.ecosystemRevision as number;
      if (revision > observedEcosystemRevision) {
        observedEcosystemRevision = revision;
        const payload = Object.freeze({
          ecosystemRevision: revision,
        });
        for (const listener of ecosystemListeners) listener(payload);
      }
    }
    const personaReference = value.personaReference;
    const personaKey = personaReference && typeof personaReference.interactionId === 'string'
      ? personaReference.interactionId
      : null;
    if (personaReference && personaKey && personaKey !== observedPersonaKey) {
      observedPersonaKey = personaKey;
      const persona = isRecord(personaReference.persona) ? personaReference.persona : null;
      if (persona && typeof persona.displayName === 'string' && typeof persona.userId === 'string') {
        const payload = Object.freeze({
          displayName: persona.displayName,
          userId: persona.userId,
          role: typeof persona.role === 'string' ? persona.role : '',
        });
        for (const listener of personaListeners) listener(payload);
      }
    }
  });
  const cleanupRegistration = context.cleanup.add(() => {
    routeListeners.clear();
    unsubscribeRoute();
    unsubscribeProjection();
    ecosystemListeners.clear();
    personaListeners.clear();
  });
  if (!cleanupRegistration.ok) throw new Error('TESTER_SIMULATOR_ROUTE_CLEANUP_REJECTED');
  const sdk = createSdkFacade(context);
  const commands = createCommandPort(context);
  return createNimiCanonicalRendererHostBindings({
    scope: context.kit.scope,
    capabilities: context.kit.capabilities,
    localization: context.kit.localization,
    kit: context.kit,
    sdk,
    app: {
      projection: Object.freeze({
        async runtimePlatform() {
          return projection(context).scenario.runtimePlatform as unknown as RuntimePlatformProjection;
        },
        async aiConfigSummary() {
          return projection(context).scenario.aiConfigSummary as unknown as TesterAIConfigSummary;
        },
        async runHistory() {
          return projection(context).runHistory as unknown as TesterRunHistory;
        },
        ecosystemReference() {
          const reference = projection(context).ecosystemReference;
          if (!reference || !Number.isSafeInteger(reference.ecosystemRevision)) {
            return null;
          }
          return Object.freeze({
            ecosystemRevision: reference.ecosystemRevision as number,
          });
        },
        personaReference() {
          const reference = projection(context).personaReference;
          if (!reference || !isRecord(reference.persona)
            || typeof reference.persona.displayName !== 'string'
            || typeof reference.persona.userId !== 'string') {
            return null;
          }
          return Object.freeze({
            displayName: reference.persona.displayName,
            userId: reference.persona.userId,
            role: typeof reference.persona.role === 'string' ? reference.persona.role : '',
          });
        },
        preferences() {
          return { schemaVersion: 1 as const, draftPersistence: true, verboseConsole: false };
        },
        promptDraft(key: TesterPromptDraftKey, enabled: boolean): TesterPromptDraftLoadResult {
          if (!enabled) {
            return { prompt: null, status: { state: 'disabled', storageKey: PROMPT_DRAFT_STORAGE_KEY, message: 'Prompt draft persistence is disabled.' } };
          }
          const prompt = projection(context).promptDrafts[promptDraftId(key)] ?? null;
          return {
            prompt,
            status: {
              state: prompt === null ? 'defaulted' : 'ready',
              storageKey: PROMPT_DRAFT_STORAGE_KEY,
              message: prompt === null ? 'No simulated prompt draft exists.' : 'Simulated prompt draft loaded.',
            },
          };
        },
      }),
      commands,
      events: Object.freeze({
        subscribe(eventType: string, listener: (payload: unknown) => void): () => void {
          if (eventType === 'tester.ecosystem.reference-updated') {
            ecosystemListeners.add(listener);
            return () => ecosystemListeners.delete(listener);
          }
          if (eventType === 'tester.persona.reference-updated') {
            personaListeners.add(listener);
            return () => personaListeners.delete(listener);
          }
          throw hostError('Tester event is not declared in this scenario.', 'TESTER_SIMULATED_EVENT_UNDECLARED');
        },
      }),
    },
    route: Object.freeze({
      get: () => currentRoute,
      subscribe(listener: () => void) {
        routeListeners.add(listener);
        return () => routeListeners.delete(listener);
      },
      async navigate(next: TesterSimulatorRouteState) {
        const result = await context.route.navigate(next);
        if (!result.ok) throw hostError('The simulated route update was rejected.', 'TESTER_SIMULATED_ROUTE_REJECTED');
      },
    }),
    clock: Object.freeze({ now: () => context.clock.now() }),
    surfaceLifecycle: context.kit.surfaceLifecycle,
  });
}
