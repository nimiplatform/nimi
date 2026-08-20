import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';
import type {
  NimiGenerateTextRequest,
  NimiPortableAppAIConfig,
} from '@nimiplatform/sdk/ai';
import type {
  NimiLocalAppAssetBody,
  NimiLocalAppAssetReadResult,
  NimiLocalAppAssetRecord,
  NimiLocalAppAssetsClient,
} from '@nimiplatform/sdk/app';
import {
  NIMI_TESTING_AI_GENERATE_TEXT_METHOD,
  createNimiTestingAiModel,
  createNimiTestingHarness,
  userTextMessage,
  type NimiTestingAiMethodMap,
  type NimiTestingHostPort,
} from '@nimiplatform/sdk/testing';

import type { LabCanonicalRendererBindings } from '../renderer/contract.js';
import type { RuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { appId } from '../shell/auth/app-identity.js';
import type { LabAIConfigSummary } from '../lab/lab-ai-config.js';
import { getLabCapability } from '../lab/lab-capabilities.js';
import type { LabImageHistoryRecord } from '../lab/lab-image-history.js';
import type { LabRunHistory, LabRunHistoryRecord } from '../lab/lab-history.js';
import type {
  LabPreferences,
  LabPromptDraftKey,
  LabPromptDraftLoadResult,
  LabPromptDraftSaveResult,
} from '../lab/lab-preferences.js';
import type { LabCapabilityRunInput, LabCapabilityRunResult } from '../lab/lab-runtime.js';
import { capabilityNonSuccess } from '../lab/lab-non-success.js';
import { defaultLabPreferences } from '../lab/lab-preferences.js';
import type {
  ClaimWorldTourViewerLaunchInput,
  OpenWorldTourWindowInput,
  OpenWorldTourWindowResponse,
  ResolvedWorldTourFixture,
  ResolveWorldTourFixtureInput,
} from '../lab/world-tour/world-tour-shared.js';
import type {
  LabSimulatorJsonValue,
  LabSimulatorPrepareContext,
  LabSimulatorRouteState,
} from './protocol.js';

const MAX_COMMAND_BYTES = 262_144;
const MAX_SIMULATED_ASSET_BYTES = 32 * 1024;
const SIMULATED_ASSET_CHUNK_BYTES = 8 * 1024;
const MAX_ASSET_PATH_BYTES = 1024;
const MAX_ASSET_PATH_COMPONENTS = 32;
const MAX_ASSET_COMPONENT_BYTES = 255;
const PROMPT_DRAFT_STORAGE_KEY = 'nimiapp-lab:prompt-drafts:v1' as const;

type JsonRecord = { readonly [key: string]: LabSimulatorJsonValue };

interface LabProjection extends JsonRecord {
  readonly protocolRevision: 1;
  readonly scenario: {
    readonly generatedText: string;
    readonly runtimePlatform: JsonRecord;
    readonly aiConfigSummary: JsonRecord;
  };
  readonly runHistory: Readonly<Record<string, readonly JsonRecord[]>>;
  readonly imageHistory: readonly JsonRecord[];
  readonly assets: Readonly<Record<string, JsonRecord>>;
  readonly promptDrafts: Readonly<Record<string, string>>;
  readonly aiConfig: JsonRecord;
  readonly ecosystemReference: JsonRecord | null;
  readonly personaReference: JsonRecord | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJson(value: unknown, seen = new Set<object>()): LabSimulatorJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error('Lab Simulator input contains an invalid number.');
    return value;
  }
  if (typeof value !== 'object') throw new Error('Lab Simulator input is not JSON-compatible.');
  if (seen.has(value)) throw new Error('Lab Simulator input contains a cycle.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const normalized = normalizeJson(entry, seen);
        if (normalized === undefined) throw new Error('Lab Simulator arrays cannot contain undefined.');
        return normalized;
      });
    }
    const output: Record<string, LabSimulatorJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeJson(entry, seen);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function commandJson(value: unknown): LabSimulatorJsonValue {
  const normalized = normalizeJson(value);
  if (normalized === undefined) throw new Error('Lab Simulator command payload is empty.');
  const bytes = JSON.stringify(normalized).length;
  if (bytes > MAX_COMMAND_BYTES) throw new Error('Lab Simulator command payload exceeds the admitted bound.');
  return normalized;
}

function projection(context: LabSimulatorPrepareContext): LabProjection {
  const value = context.projection.get();
  if (!isRecord(value)
    || value.protocolRevision !== 1
    || !isRecord(value.scenario)
    || !isRecord(value.runHistory)
    || !Array.isArray(value.imageHistory)
    || !isRecord(value.assets)
    || !isRecord(value.promptDrafts)
    || !isRecord(value.aiConfig)
    || (value.ecosystemReference !== null && !isRecord(value.ecosystemReference))
    || (value.personaReference !== null && !isRecord(value.personaReference))) {
    throw new Error('Lab simulated projection is invalid.');
  }
  return value as unknown as LabProjection;
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
    `${name} is not modeled by the selected Lab simulation scenario.`,
    'LAB_SIMULATED_EFFECT_UNAVAILABLE',
  );
}

function unmodeledSdkMethod(name: string): never {
  throw hostError(
    `${name} is not modeled by the selected Lab simulation scenario.`,
    'LAB_SIMULATED_SDK_METHOD_UNAVAILABLE',
  );
}

async function invoke(
  context: LabSimulatorPrepareContext,
  type: string,
  payload: unknown,
): Promise<{ readonly revision: number }> {
  const result = await context.commands.invoke(type, commandJson(payload));
  if (!result.ok || !isRecord(result.value) || !Number.isSafeInteger(result.value.revision)) {
    throw hostError('The simulated Lab action was not accepted.', 'LAB_SIMULATED_ACTION_REJECTED');
  }
  return { revision: result.value.revision as number };
}

function nowIso(context: LabSimulatorPrepareContext): string {
  return new Date(context.clock.now()).toISOString();
}

function promptDraftId(key: LabPromptDraftKey): string {
  return `${key.surfaceId}:${key.capabilityId}:${key.scenarioId}`;
}

function aiConfig(value: JsonRecord): NimiPortableAppAIConfig {
  if (!isRecord(value.owner) || !Array.isArray(value.capabilities)) {
    throw new Error('Lab simulated AIConfig is invalid.');
  }
  const owner = value.owner as JsonRecord;
  const variant = owner.owner;
  if (!isRecord(variant)
    || variant.oneofKind !== 'app'
    || !isRecord(variant.app)
    || variant.app.appId !== appId) {
    throw new Error('Lab simulated AIConfig owner is invalid.');
  }
  return value as unknown as NimiPortableAppAIConfig;
}

function createAIConfigPort(context: LabSimulatorPrepareContext) {
  return Object.freeze({
    async get() {
      return aiConfig(projection(context).aiConfig);
    },
  });
}

function createAssetPort(context: LabSimulatorPrepareContext): NimiLocalAppAssetsClient {
  const stat = async (relativePath: string): Promise<NimiLocalAppAssetRecord> => {
    const path = assetPath(relativePath);
    const value = projection(context).assets[path];
    if (!value) return assetFailure('not-found', `Simulated asset does not exist: ${path}`);
    return assetRecord(value);
  };
  return Object.freeze({
    stat,
    async list(input) {
      exactKeys(input, ['prefix', 'cursor', 'pageSize']);
      const prefix = input.prefix === '' ? '' : assetPrefix(input.prefix);
      const cursor = input.cursor ?? '';
      const pageSize = input.pageSize ?? 100;
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
        return assetFailure('invalid-cursor', 'Simulated asset page is invalid.');
      }
      const offset = assetCursorOffset(cursor, prefix);
      const values = Object.entries(projection(context).assets)
        .filter(([path]) => assetMatchesPrefix(path, prefix))
        .sort(([left], [right]) => left.localeCompare(right));
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > values.length) {
        return assetFailure('invalid-cursor', 'Simulated asset cursor is invalid.');
      }
      const assets = values.slice(offset, offset + pageSize).map(([, value]) => assetRecord(value));
      const nextOffset = offset + assets.length;
      return Object.freeze({
        assets: Object.freeze(assets),
        nextCursor: nextOffset < values.length ? `sim:${nextOffset}:${encodeURIComponent(prefix)}` : '',
      });
    },
    async write(input) {
      exactKeys(input, ['relativePath', 'body', 'mediaType', 'overwrite']);
      const relativePath = assetPath(input.relativePath);
      const overwrite = optionalBoolean(input.overwrite, 'overwrite');
      if (projection(context).assets[relativePath] && !overwrite) {
        return assetFailure('already-exists', `Simulated asset already exists: ${relativePath}`);
      }
      const mediaType = input.mediaType === undefined ? '' : assetMediaType(input.mediaType);
      const body = await collectAssetBody(input.body);
      await invoke(context, 'lab.asset.write', {
        relativePath, mediaType, overwrite, sizeBytes: body.byteLength,
        sha256: await assetSha256(body), body: [...body],
      });
      return stat(relativePath);
    },
    async read(input): Promise<NimiLocalAppAssetReadResult> {
      exactKeys(input, ['relativePath', 'offset', 'length']);
      const relativePath = assetPath(input.relativePath);
      const value = projection(context).assets[relativePath];
      if (!value) return assetFailure('not-found', `Simulated asset does not exist: ${relativePath}`);
      const asset = assetRecord(value);
      const stored = assetBytes(value);
      const offset = input.offset ?? 0;
      const requestedLength = input.length;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > asset.sizeBytes
        || (requestedLength !== undefined && (!Number.isSafeInteger(requestedLength) || requestedLength <= 0))) {
        return assetFailure('invalid-range', 'Simulated asset range is invalid.');
      }
      const length = requestedLength === undefined
        ? asset.sizeBytes - offset
        : Math.min(requestedLength, asset.sizeBytes - offset);
      const body = Object.freeze({
        async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          for (let cursor = offset; cursor < offset + length; cursor += SIMULATED_ASSET_CHUNK_BYTES) {
            yield stored.slice(cursor, Math.min(cursor + SIMULATED_ASSET_CHUNK_BYTES, offset + length));
          }
        },
      });
      return Object.freeze({
        asset,
        range: Object.freeze({ offset, length, totalSize: asset.sizeBytes }),
        body,
      });
    },
    async remove(relativePath) {
      const path = assetPath(relativePath);
      const removed = Boolean(projection(context).assets[path]);
      await invoke(context, 'lab.asset.remove', { relativePath: path });
      return Object.freeze({ removed });
    },
    async move(input) {
      exactKeys(input, ['from', 'to', 'overwrite']);
      const from = assetPath(input.from);
      const to = assetPath(input.to);
      const overwrite = optionalBoolean(input.overwrite, 'overwrite');
      if (!projection(context).assets[from]) return assetFailure('not-found', `Simulated asset does not exist: ${from}`);
      if (projection(context).assets[to] && !overwrite) return assetFailure('already-exists', `Simulated asset already exists: ${to}`);
      await invoke(context, 'lab.asset.move', { from, to, overwrite });
      return stat(to);
    },
    async adoptArtifact(input) {
      exactKeys(input, ['artifactId', 'relativePath', 'overwrite']);
      const artifactId = requiredAssetText(input.artifactId, 512, 'artifactId');
      const relativePath = assetPath(input.relativePath);
      const overwrite = optionalBoolean(input.overwrite, 'overwrite');
      if (projection(context).assets[relativePath] && !overwrite) {
        return assetFailure('already-exists', `Simulated asset already exists: ${relativePath}`);
      }
      await invoke(context, 'lab.asset.adopt', { artifactId, relativePath, overwrite });
      return stat(relativePath);
    },
  });
}

function assetRecord(value: JsonRecord): NimiLocalAppAssetRecord {
  const relativePath = assetPath(value.relativePath);
  const mediaType = value.mediaType === '' ? undefined : assetMediaType(value.mediaType);
  if (!Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes as number) < 0
    || typeof value.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.sha256)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    return assetFailure('integrity-failure', 'Simulated asset metadata is invalid.');
  }
  return Object.freeze({
    relativePath, ...(mediaType === undefined ? {} : { mediaType }), sizeBytes: value.sizeBytes as number,
    sha256: value.sha256, createdAt: value.createdAt, updatedAt: value.updatedAt,
  });
}

function assetBytes(value: JsonRecord): Uint8Array {
  if (!Array.isArray(value.body) || value.body.length > MAX_SIMULATED_ASSET_BYTES
    || value.body.some((byte) => !Number.isSafeInteger(byte) || byte < 0 || byte > 255)) {
    return assetFailure('integrity-failure', 'Simulated asset body is invalid.');
  }
  const bytes = Uint8Array.from(value.body as number[]);
  if (bytes.byteLength !== value.sizeBytes) return assetFailure('integrity-failure', 'Simulated asset size is invalid.');
  return bytes;
}

async function collectAssetBody(value: NimiLocalAppAssetBody): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const pushChunk = (chunk: Uint8Array) => {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) return assetFailure('invalid-payload', 'Simulated asset chunk is invalid.');
    size += chunk.byteLength;
    if (size > MAX_SIMULATED_ASSET_BYTES) return assetFailure('object-too-large', 'Simulated assets are bounded to 32 KiB.');
    chunks.push(new Uint8Array(chunk));
  };
  if (value instanceof Uint8Array) pushChunk(value);
  else if (typeof Blob !== 'undefined' && value instanceof Blob) pushChunk(new Uint8Array(await value.arrayBuffer()));
  else {
    const source = value as AsyncIterable<Uint8Array>;
    if (!source || typeof source !== 'object' || typeof source[Symbol.asyncIterator] !== 'function') {
      return assetFailure('invalid-payload', 'Simulated asset body is invalid.');
    }
    for await (const chunk of source) pushChunk(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

async function assetSha256(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function assetPath(value: unknown): string {
  if (typeof value !== 'string') return assetFailure('invalid-path', 'Simulated asset path is invalid.');
  const path = value;
  const components = path.split('/');
  if (!path || path.trim() !== path || !isWellFormedUnicode(path) || path.normalize('NFC') !== path
    || new TextEncoder().encode(path).byteLength > MAX_ASSET_PATH_BYTES
    || path.startsWith('/') || path.endsWith('/') || /[\\\0<>:"|?*]/u.test(path)
    || components.length > MAX_ASSET_PATH_COMPONENTS
    || components.some((component) => !validAssetComponent(component))) {
    return assetFailure('invalid-path', 'Simulated asset path is invalid.');
  }
  return path;
}

function assetPrefix(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return assetFailure('invalid-path', 'Simulated asset prefix is invalid.');
  const prefix = value;
  const trailing = prefix.endsWith('/');
  return `${assetPath(trailing ? prefix.slice(0, -1) : prefix)}${trailing ? '/' : ''}`;
}

function validAssetComponent(component: string): boolean {
  if (!component || component === '.' || component === '..'
    || new TextEncoder().encode(component).byteLength > MAX_ASSET_COMPONENT_BYTES
    || component.endsWith('.') || component.endsWith(' ') || /[\u0000-\u001f\u007f]/u.test(component)) return false;
  const base = component.split('.')[0]?.toUpperCase() ?? '';
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit > 0xdbff || index + 1 >= value.length) return false;
    const next = value.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) return false;
    index += 1;
  }
  return true;
}

function assetMatchesPrefix(path: string, prefix: string): boolean {
  if (prefix === '') return true;
  return prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix;
}

function assetCursorOffset(cursor: string, prefix: string): number {
  if (cursor === '') return 0;
  if (cursor.length > 4096) return assetFailure('invalid-cursor', 'Simulated asset cursor is invalid.');
  const match = /^sim:([0-9]+):(.*)$/u.exec(cursor);
  if (!match || match[2] !== encodeURIComponent(prefix)) {
    return assetFailure('invalid-cursor', 'Simulated asset cursor is invalid.');
  }
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || String(offset) !== match[1]) {
    return assetFailure('invalid-cursor', 'Simulated asset cursor is invalid.');
  }
  return offset;
}

function assetMediaType(value: unknown): string {
  const mediaType = requiredAssetText(value, 255, 'mediaType').toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)) return assetFailure('invalid-payload', 'Simulated media type is invalid.');
  return mediaType;
}

function requiredAssetText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || new TextEncoder().encode(value).byteLength > maximum) {
    return assetFailure('invalid-payload', `Simulated asset ${field} is invalid.`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') return assetFailure('invalid-payload', `Simulated asset ${field} is invalid.`);
  return value;
}

function exactKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    return assetFailure('invalid-payload', 'Simulated asset input is invalid.');
  }
}

function assetFailure(reasonCode: string, message: string): never {
  throw hostError(message, reasonCode);
}

function createSdkFacade(context: LabSimulatorPrepareContext) {
  const port = {
      async invoke(methodId: string, request: NimiGenerateTextRequest) {
        if (methodId !== NIMI_TESTING_AI_GENERATE_TEXT_METHOD) {
          return { ok: false, error: { disposition: 'unsupported' } };
        }
        await invoke(context, 'lab.capability.execute', {
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
  const model = createNimiTestingAiModel({ harness });
  const configPort = createAIConfigPort(context);
  const assetPort = createAssetPort(context);

  async function execute(input: LabCapabilityRunInput): Promise<LabCapabilityRunResult> {
    const capability = getLabCapability(input.capabilityId);
    if (input.capabilityId !== 'text.generate') {
      return capabilityNonSuccess(
        capability,
        'sdk-method-unavailable',
        'This capability has no admitted Simulator fixture, State Engine result model, and visible interaction proof.',
      );
    }
    const result = await model.generateText({
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
        simulated: true,
      },
    };
  }

  return Object.freeze({
    runCapability: execute,
    async listLocalAppVoiceAssets() {
      return Object.freeze([]);
    },
    async uploadLocalAppArtifact() {
      return unmodeledSdkMethod('Local App artifact upload');
    },
    aiConfig: configPort,
    modelConfig: Object.freeze({
      async localSelections() {
        return Object.freeze([]);
      },
    }),
    storage: Object.freeze({ assets: assetPort }),
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
  context: LabSimulatorPrepareContext,
  kind: string,
  subject: string,
  details: unknown,
): Promise<{ readonly revision: number }> {
  return invoke(context, 'lab.action.record', { kind, subject, details });
}

function createCommandPort(context: LabSimulatorPrepareContext) {
  return Object.freeze({
    async nextRunIdentity() {
      const accepted = await invoke(context, 'lab.run.allocate', {});
      return { runId: `lab-run-${accepted.revision}`, createdAt: nowIso(context) };
    },
    async appendRunHistory(historyRecord: LabRunHistoryRecord) {
      await invoke(context, 'lab.history.append', { record: historyRecord });
      return projection(context).runHistory as unknown as LabRunHistory;
    },
    async removeRunHistory(recordId: string) {
      await invoke(context, 'lab.history.remove', { recordId });
      return projection(context).runHistory as unknown as LabRunHistory;
    },
    async clearRunHistory(input: { readonly capabilityId?: string }) {
      await invoke(context, 'lab.history.clear', { capabilityId: input.capabilityId ?? null });
      return projection(context).runHistory as unknown as LabRunHistory;
    },
    async appendImageHistory(imageRecord: LabImageHistoryRecord) {
      await invoke(context, 'lab.image-history.append', { record: imageRecord });
      return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
    },
    async removeImageHistory(runId: string) {
      await invoke(context, 'lab.image-history.remove', { runId });
      return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
    },
    async clearImageHistory(input: { readonly capabilityId?: string }) {
      await invoke(context, 'lab.image-history.clear', { capabilityId: input.capabilityId ?? null });
      return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
    },
    async savePreferences(preferences: LabPreferences) {
      await invoke(context, 'lab.preferences.save', { preferences });
    },
    async savePromptDraft(key: LabPromptDraftKey, prompt: string, enabled: boolean): Promise<LabPromptDraftSaveResult> {
      try {
        await invoke(context, 'lab.prompt.save', { key, prompt, enabled });
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
        throw hostError('The Simulator local-app unavailability projection is invalid.', 'LAB_SIMULATED_SESSION_INVALID');
      }
      return { state: 'unavailable', sessionBound: false };
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

export function createLabSimulatorBindings(
  context: LabSimulatorPrepareContext,
): LabCanonicalRendererBindings {
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
  if (!cleanupRegistration.ok) throw new Error('LAB_SIMULATOR_ROUTE_CLEANUP_REJECTED');
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
          return projection(context).scenario.aiConfigSummary as unknown as LabAIConfigSummary;
        },
        async runHistory() {
          return projection(context).runHistory as unknown as LabRunHistory;
        },
        async imageHistory() {
          return projection(context).imageHistory as unknown as readonly LabImageHistoryRecord[];
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
          return defaultLabPreferences();
        },
        promptDraft(key: LabPromptDraftKey, enabled: boolean): LabPromptDraftLoadResult {
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
          if (eventType === 'lab.ecosystem.reference-updated') {
            ecosystemListeners.add(listener);
            return () => ecosystemListeners.delete(listener);
          }
          if (eventType === 'lab.persona.reference-updated') {
            personaListeners.add(listener);
            return () => personaListeners.delete(listener);
          }
          throw hostError('Lab event is not declared in this scenario.', 'LAB_SIMULATED_EVENT_UNDECLARED');
        },
      }),
    },
    route: Object.freeze({
      get: () => currentRoute,
      subscribe(listener: () => void) {
        routeListeners.add(listener);
        return () => routeListeners.delete(listener);
      },
      async navigate(next: LabSimulatorRouteState) {
        const result = await context.route.navigate(next);
        if (!result.ok) throw hostError('The simulated route update was rejected.', 'LAB_SIMULATED_ROUTE_REJECTED');
      },
    }),
    clock: Object.freeze({ now: () => context.clock.now() }),
    surfaceLifecycle: context.kit.surfaceLifecycle,
  });
}
