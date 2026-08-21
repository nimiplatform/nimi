import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  NimiElectronLocalAppHostError,
  type NimiElectronLocalAppHost,
  type NimiElectronLocalAppJson,
  type NimiElectronLocalAppRecord,
} from './local-app-host.js';
import { NimiElectronShellHostError } from './types.js';

const AIC_COMMANDS = {
  textTurnStream: NIMI_STANDARD_SHELL_COMMANDS['local-app.textTurnStream'],
  scenarioExecute: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioExecute'],
  scenarioJobSubmit: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'],
  scenarioJobGet: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobGet'],
  scenarioJobSubscribe: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubscribe'],
  scenarioJobCancel: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobCancel'],
  artifactRead: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactRead'],
  artifactUpload: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactUpload'],
  voiceAssetsList: NIMI_STANDARD_SHELL_COMMANDS['local-app.voiceAssetsList'],
} as const;

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_TEXT_CANDIDATE_MESSAGES = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES = 64 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS = 4096;
const FORBIDDEN_PORTABLE_APP_AI_CONFIG_FIELDS = new Set([
  'account', 'accountid', 'accesstoken', 'authorization', 'binding', 'bindingid',
  'connectorgrant', 'connectorgrantid', 'credential', 'custody', 'custodymaterial',
  'grantid', 'owner', 'appid', 'providercredential', 'refreshtoken', 'token',
]);
const FORBIDDEN_RENDERER_FIELDS = new Set([
  'endpoint', 'authorization', 'token', 'localAppPrincipalId', 'localAppRecordId',
  'trustClass', 'provenanceRevision', 'launchLease', 'bootstrap', 'processId',
  'sessionId', 'sessionProof', 'accountId', 'grantId', 'runtimeBootEpoch',
  'registeredAppSubject', 'registrationHandle', 'sourceGeneration', 'declarationGeneration',
  'accountGeneration', 'snapshot', 'snapshotId', 'credential', 'peerProof', 'appOperationId',
  'operationId', 'appAccessDomainId', 'domainId', 'classification', 'subject', 'account',
]);

type RendererLocalAppHostMethod = Exclude<
  keyof NimiElectronLocalAppHost,
  | 'renewTechnicalSession'
  | 'conversationStreamNext' | 'conversationStreamClose'
  | 'textTurnStreamNext' | 'textTurnStreamClose'
  | 'scenarioJobStreamNext' | 'scenarioJobStreamClose'
>;

const ACTIVE_CONVERSATION_STREAMS = new WeakMap<NimiElectronLocalAppHost, Set<string>>();
const ACTIVE_SCENARIO_STREAMS = new WeakMap<NimiElectronLocalAppHost, Set<string>>();

const COMMAND_METHODS = new Map<string, RendererLocalAppHostMethod>([
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'], 'sessionStatus'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigGet'], 'aiConfigGet'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.modelConfigLocalSelectionsGet'], 'modelConfigLocalSelectionsGet'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'], 'textGenerateCandidate'],
  [AIC_COMMANDS.textTurnStream, 'textTurnSubscribe'],
  [AIC_COMMANDS.scenarioExecute, 'scenarioExecute'],
  [AIC_COMMANDS.scenarioJobSubmit, 'scenarioJobSubmit'],
  [AIC_COMMANDS.scenarioJobGet, 'scenarioJobGet'],
  [AIC_COMMANDS.scenarioJobSubscribe, 'scenarioJobSubscribe'],
  [AIC_COMMANDS.scenarioJobCancel, 'scenarioJobCancel'],
  [AIC_COMMANDS.artifactRead, 'artifactRead'],
  [AIC_COMMANDS.artifactUpload, 'artifactUpload'],
  [AIC_COMMANDS.voiceAssetsList, 'voiceAssetsList'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreList'], 'realmWorldCoreList'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreCreate'], 'realmWorldCoreCreate'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterListOwned'], 'realmPersonaCharacterListOwned'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterGetOwned'], 'realmPersonaCharacterGetOwned'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterCreate'], 'realmPersonaCharacterCreate'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterReplace'], 'realmPersonaCharacterReplace'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentReferenceList'], 'agentReferenceList'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationOpen'], 'conversationOpen'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'], 'conversationSendTurn'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationInterruptTurn'], 'conversationInterruptTurn'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSubscribe'], 'conversationSubscribe'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSnapshot'], 'conversationSnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigGet'], 'sharedAgentAIConfigGet'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigOverwrite'], 'sharedAgentAIConfigOverwrite'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentAutonomySnapshot'], 'agentAutonomySnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentUpdateAutonomy'], 'agentUpdateAutonomy'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentPresentationSnapshot'], 'agentPresentationSnapshot'],
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentCommitPresentation'], 'agentCommitPresentation'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'], 'storageReadJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'], 'storageWriteJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'], 'storageRemoveJson'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat'], 'assetStat'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetList'], 'assetList'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteOpen'], 'assetWriteOpen'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteChunk'], 'assetWriteChunk'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteCommit'], 'assetWriteCommit'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteAbort'], 'assetWriteAbort'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadOpen'], 'assetReadOpen'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadNext'], 'assetReadNext'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadClose'], 'assetReadClose'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetRemove'], 'assetRemove'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetMove'], 'assetMove'],
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetAdopt'], 'assetAdopt'],
]);

export function isElectronLocalAppCommand(command: string): boolean {
  return COMMAND_METHODS.has(command);
}

export async function dispatchElectronLocalAppCommand(input: {
  readonly host: NimiElectronLocalAppHost | undefined;
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sendEvent?: (eventName: string, payload: NimiElectronLocalAppRecord) => void;
}): Promise<unknown> {
  const method = COMMAND_METHODS.get(input.command);
  if (!method) throw invalidPayload(input.command, 'unknown local-app operation');
  assertNoForbiddenAuthority(input.payload, input.command);
  const payload = validatePayload(method, input.payload, input.command);
  if (!input.host) throw carrierRequired(input.command);
  try {
    if (method === 'sessionStatus') return await input.host.sessionStatus();
    if (method === 'aiConfigGet') return await input.host.aiConfigGet();
    if (method === 'modelConfigLocalSelectionsGet') return await input.host.modelConfigLocalSelectionsGet();
    if (method === 'agentReferenceList') return await input.host.agentReferenceList();
    if (method === 'sharedAgentAIConfigGet') return await input.host.sharedAgentAIConfigGet();
    if (method === 'storageReadJson') return await input.host.storageReadJson(payload);
    if (method === 'storageWriteJson') return await input.host.storageWriteJson(payload);
    if (method === 'storageRemoveJson') return await input.host.storageRemoveJson(payload);
    if (method === 'assetStat') return await input.host.assetStat(payload);
    if (method === 'assetList') return await input.host.assetList(payload);
    if (method === 'assetWriteOpen') return await input.host.assetWriteOpen(payload);
    if (method === 'assetWriteChunk') return await input.host.assetWriteChunk(payload as Readonly<Record<string, unknown>>);
    if (method === 'assetWriteCommit') return await input.host.assetWriteCommit(payload);
    if (method === 'assetWriteAbort') return await input.host.assetWriteAbort(payload);
    if (method === 'assetReadOpen') return await input.host.assetReadOpen(payload);
    if (method === 'assetReadNext') return await input.host.assetReadNext(payload);
    if (method === 'assetReadClose') return await input.host.assetReadClose(payload);
    if (method === 'assetRemove') return await input.host.assetRemove(payload);
    if (method === 'assetMove') return await input.host.assetMove(payload);
    if (method === 'assetAdopt') return await input.host.assetAdopt(payload);
    if (method === 'textTurnSubscribe' || method === 'scenarioJobSubscribe') {
      const streams = activeScenarioStreams(input.host);
      if (payload.action === 'cancel') {
        const subscriptionId = String(payload.subscriptionId);
        streams.delete(subscriptionId);
        const result = method === 'textTurnSubscribe'
          ? await input.host.textTurnStreamClose({ streamId: subscriptionId })
          : await input.host.scenarioJobStreamClose({ streamId: subscriptionId });
        return { subscriptionId, closed: result.closed };
      }
      if (!input.sendEvent) throw carrierRequired(input.command);
      const opened = method === 'textTurnSubscribe'
        ? await input.host.textTurnSubscribe(payload)
        : await input.host.scenarioJobSubscribe(payload);
      const subscriptionId = String(opened.streamId);
      const eventName = `local-app-ai.${subscriptionId}`;
      streams.add(subscriptionId);
      const pumpTimer = setTimeout(() => {
        void pumpScenarioStream(
          input.host!, method, subscriptionId, eventName, input.sendEvent!, input.command,
        );
      }, 0);
      pumpTimer.unref?.();
      return { subscriptionId, eventName };
    }
    if (method === 'conversationSubscribe') {
      if (payload.action === 'cancel') {
        const subscriptionId = String(payload.subscriptionId);
        activeConversationStreams(input.host).delete(subscriptionId);
        const result = await input.host.conversationStreamClose({ streamId: subscriptionId });
        return { subscriptionId, closed: result.closed };
      }
      if (!input.sendEvent) throw carrierRequired(input.command);
      const opened = await input.host.conversationSubscribe(payload);
      const subscriptionId = String(opened.streamId);
      const eventName = `local-app-conversation.${subscriptionId}`;
      activeConversationStreams(input.host).add(subscriptionId);
      const pumpTimer = setTimeout(() => {
        void pumpConversationStream(input.host!, subscriptionId, eventName, input.sendEvent!, input.command);
      }, 0);
      pumpTimer.unref?.();
      return { subscriptionId, eventName };
    }
    return await input.host[method](payload);
  } catch (error) {
    if (error instanceof NimiElectronLocalAppHostError) throw mapHostError(error, input.command);
    throw new NimiElectronShellHostError({
      code: 'runtime-service-untrusted',
      message: 'Electron local-app carrier returned an untrusted failure',
      reasonCode: 'runtime-service-untrusted',
      actionHint: 'restart_fixed_runtime_service',
      details: { command: input.command },
    });
  }
}

function validatePayload(
  method: RendererLocalAppHostMethod,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronLocalAppRecord {
  switch (method) {
    case 'sessionStatus':
      assertExactKeys(payload, [], command);
      return {};
    case 'aiConfigGet':
    case 'modelConfigLocalSelectionsGet':
    case 'agentReferenceList':
    case 'sharedAgentAIConfigGet':
      assertExactKeys(payload, [], command);
      return {};
    case 'sharedAgentAIConfigOverwrite':
      assertExactKeys(payload, ['capabilities'], command);
      if (!Array.isArray(payload.capabilities)) {
        throw invalidPayload(command, 'capabilities is invalid');
      }
      assertNoPortableAppAIConfigFields(payload.capabilities, command);
      validateJsonValue(payload.capabilities, command, 4 * 1024 * 1024);
      return { capabilities: payload.capabilities as NimiElectronLocalAppRecord[string] };
    case 'textGenerateCandidate':
      return textCandidatePayload(payload, command);
    case 'textTurnSubscribe':
      if (payload.action === 'cancel') {
        return {
          ...identifiers(payload, ['subscriptionId'], command, new Set(), ['action', 'subscriptionId']),
          action: 'cancel',
        };
      }
      return textCandidatePayload(payload, command);
    case 'scenarioExecute':
    case 'scenarioJobSubmit':
      assertExactKeys(payload, ['spec'], command);
      validateScenarioSpec(payload.spec, command, method === 'scenarioExecute');
      return { spec: payload.spec as NimiElectronLocalAppRecord[string] };
    case 'scenarioJobGet':
      return identifiers(payload, ['jobId'], command);
    case 'scenarioJobCancel': {
      assertExactKeys(payload, ['jobId', 'reason'], command);
      const reason = typeof payload.reason === 'string' ? payload.reason : '';
      if (reason.length > 512 || reason.trim() !== reason || reason.includes('\0')) {
        throw invalidPayload(command, 'reason is invalid');
      }
      return {
        jobId: requiredText(payload.jobId, 'jobId', command, 128),
        reason,
      };
    }
    case 'scenarioJobSubscribe':
      if (payload.action === 'cancel') {
        return {
          ...identifiers(payload, ['subscriptionId'], command, new Set(), ['action', 'subscriptionId']),
          action: 'cancel',
        };
      }
      return identifiers(payload, ['jobId'], command);
    case 'artifactRead':
      return identifiers(payload, ['artifactId'], command);
    case 'artifactUpload': {
      assertExactKeys(payload, ['bytes', 'mimeType'], command);
      if (!Array.isArray(payload.bytes) || payload.bytes.length === 0 || payload.bytes.length > 32 * 1024 * 1024
        || payload.bytes.some((entry) => !Number.isInteger(entry) || Number(entry) < 0 || Number(entry) > 255)
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(payload.mimeType))) {
        throw invalidPayload(command, 'artifact upload is invalid');
      }
      return { bytes: [...payload.bytes] as NimiElectronLocalAppJson, mimeType: String(payload.mimeType) };
    }
    case 'voiceAssetsList': {
      assertExactKeys(payload, ['pageSize', 'pageToken'], command);
      const pageSize = nonNegativeInteger(payload.pageSize, command, 'pageSize');
      if (pageSize > 200 || typeof payload.pageToken !== 'string' || !/^[0-9]{0,10}$/u.test(payload.pageToken)) {
        throw invalidPayload(command, 'voice asset page is invalid');
      }
      return { pageSize, pageToken: payload.pageToken };
    }
    case 'realmWorldCoreList': {
      assertAllowedKeys(payload, ['take', 'visibility'], [], command);
      const result: Record<string, NimiElectronLocalAppRecord[string]> = {};
      if (payload.take !== undefined) result.take = nonNegativeInteger(payload.take, command, 'take');
      if (payload.visibility !== undefined) result.visibility = worldVisibility(payload.visibility, command);
      return result;
    }
    case 'realmWorldCoreCreate':
      assertAllowedKeys(payload, ['core', 'id', 'origin', 'visibility'], ['core', 'origin'], command);
      if (!isPlainRecord(payload.core) || !isPlainRecord(payload.origin)) {
        throw invalidPayload(command, 'core and origin must be objects');
      }
      assertAllowedKeys(
        payload.origin,
        ['kind', 'parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion'],
        ['kind'],
        command,
      );
      if (!['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(String(payload.origin.kind))) {
        throw invalidPayload(command, 'origin.kind is invalid');
      }
      for (const key of ['parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion']) {
        if (payload.origin[key] !== undefined) {
          requiredText(payload.origin[key], `origin.${key}`, command, MAX_IDENTIFIER_LENGTH);
        }
      }
      if (payload.id !== undefined) requiredText(payload.id, 'id', command, MAX_IDENTIFIER_LENGTH);
      if (payload.visibility !== undefined) worldVisibility(payload.visibility, command);
      validateJsonValue(payload, command, 2 * 1024 * 1024);
      return payload as NimiElectronLocalAppRecord;
    case 'realmPersonaCharacterListOwned': {
      assertAllowedKeys(payload, ['worldId', 'visibility', 'afterId', 'take'], [], command);
      const result: Record<string, NimiElectronLocalAppRecord[string]> = {};
      if (payload.worldId !== undefined) result.worldId = requiredText(payload.worldId, 'worldId', command, MAX_IDENTIFIER_LENGTH);
      if (payload.visibility !== undefined) result.visibility = personaWritableVisibility(payload.visibility, command);
      if (payload.afterId !== undefined) result.afterId = requiredText(payload.afterId, 'afterId', command, MAX_IDENTIFIER_LENGTH);
      if (payload.take !== undefined) result.take = boundedSafeInteger(payload.take, 'take', command, 1, 500);
      return result;
    }
    case 'realmPersonaCharacterGetOwned':
      return identifiers(payload, ['personaCharacterId'], command);
    case 'realmPersonaCharacterCreate':
      validatePersonaCharacterWrite(payload, false, command);
      return payload as NimiElectronLocalAppRecord;
    case 'realmPersonaCharacterReplace': {
      validatePersonaCharacterWrite(payload, true, command);
      const { personaCharacterId, ...body } = payload;
      return {
        personaCharacterId: requiredText(personaCharacterId, 'personaCharacterId', command, MAX_IDENTIFIER_LENGTH),
        body: body as NimiElectronLocalAppRecord,
      };
    }
    case 'conversationOpen':
      return identifiers(payload, ['agentHandle'], command);
    case 'conversationSendTurn': {
      assertExactKeys(payload, ['agentHandle', 'conversationAnchorId', 'requestId', 'text'], command);
      return {
        ...identifiers(payload, ['agentHandle', 'conversationAnchorId', 'requestId'], command,
          new Set(), ['agentHandle', 'conversationAnchorId', 'requestId', 'text']),
        text: requiredUtf8Text(payload.text, 'text', command, 64 * 1024),
      };
    }
    case 'conversationInterruptTurn':
      return identifiers(payload, ['agentHandle', 'conversationAnchorId'], command);
    case 'conversationSubscribe':
      if (payload.action === 'cancel') {
        return {
          ...identifiers(payload, ['subscriptionId'], command, new Set(), ['action', 'subscriptionId']),
          action: 'cancel',
        };
      }
      return identifiers(payload, ['agentHandle', 'conversationAnchorId'], command);
    case 'conversationSnapshot':
      return identifiers(payload, ['agentHandle', 'conversationAnchorId'], command);
    case 'agentAutonomySnapshot':
    case 'agentPresentationSnapshot':
      return identifiers(payload, ['agentHandle'], command);
    case 'agentUpdateAutonomy':
      assertExactKeys(payload, ['agentHandle', 'expectedAutonomyRevision', 'intent'], command);
      assertNoForbiddenAuthorityValue(payload.intent, command);
      validateJsonValue(payload.intent, command, 64 * 1024);
      return {
        agentHandle: requiredText(payload.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
        expectedAutonomyRevision: decimalRevision(
          payload.expectedAutonomyRevision,
          'expectedAutonomyRevision',
          command,
          false,
        ),
        intent: payload.intent as NimiElectronLocalAppRecord[string],
      };
    case 'agentCommitPresentation':
      assertExactKeys(payload, ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'], command);
      assertNoForbiddenAuthorityValue(payload.intent, command);
      assertNoForbiddenAuthorityValue(payload.importedAssets, command);
      validateJsonValue(payload.intent, command, 64 * 1024);
      return {
        agentHandle: requiredText(payload.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
        expectedPresentationRevision: decimalRevision(
          payload.expectedPresentationRevision,
          'expectedPresentationRevision',
          command,
          true,
        ),
        intent: payload.intent as NimiElectronLocalAppRecord[string],
        importedAssets: presentationAssetsPayload(payload.importedAssets, command),
      };
    case 'storageReadJson':
    case 'storageRemoveJson':
      return storagePathPayload(payload, command);
    case 'storageWriteJson':
      assertExactKeys(payload, ['relativePath', 'value'], command);
      validateStorageJsonValue(payload.value, command);
      return { ...storagePathPayload({ relativePath: payload.relativePath }, command), value: payload.value as NimiElectronLocalAppRecord[string] };
    case 'assetStat':
    case 'assetRemove':
      return assetPathPayload(payload, command);
    case 'assetList': {
      assertExactKeys(payload, ['prefix', 'cursor', 'pageSize'], command);
      const prefix = typeof payload.prefix === 'string' ? payload.prefix : '';
      if (prefix && !isCanonicalAssetPrefix(prefix)) throw invalidPayload(command, 'prefix is invalid');
      if (typeof payload.cursor !== 'string' || payload.cursor.length > 4096) throw invalidPayload(command, 'cursor is invalid');
      const pageSize = nonNegativeInteger(payload.pageSize, command, 'pageSize');
      if (pageSize > 500) throw invalidPayload(command, 'pageSize is invalid');
      return { prefix, cursor: payload.cursor, pageSize };
    }
    case 'assetWriteOpen': {
      assertExactKeys(payload, ['relativePath', 'mediaType', 'overwrite'], command);
      const path = assetPathPayload({ relativePath: payload.relativePath }, command);
      const mediaType = payload.mediaType === '' ? '' : validAssetMediaType(payload.mediaType, command);
      if (typeof payload.overwrite !== 'boolean') throw invalidPayload(command, 'overwrite is invalid');
      return { ...path, mediaType, overwrite: payload.overwrite };
    }
    case 'assetWriteChunk': {
      assertExactKeys(payload, ['streamId', 'bodyChunk'], command);
      const streamId = requiredText(payload.streamId, 'streamId', command, 128);
      if (!(payload.bodyChunk instanceof Uint8Array) || payload.bodyChunk.byteLength === 0
        || payload.bodyChunk.byteLength > 1024 * 1024) throw invalidPayload(command, 'bodyChunk is invalid');
      return { streamId, bodyChunk: payload.bodyChunk } as unknown as NimiElectronLocalAppRecord;
    }
    case 'assetWriteCommit':
    case 'assetWriteAbort':
    case 'assetReadNext':
    case 'assetReadClose':
      return identifiers(payload, ['streamId'], command);
    case 'assetReadOpen': {
      assertAllowedKeys(payload, ['relativePath', 'offset', 'length'], ['relativePath'], command);
      const result: Record<string, NimiElectronLocalAppJson> = { ...assetPathPayload({ relativePath: payload.relativePath }, command) };
      if (payload.offset !== undefined) result.offset = boundedSafeInteger(payload.offset, 'offset', command, 0, Number.MAX_SAFE_INTEGER);
      if (payload.length !== undefined) result.length = boundedSafeInteger(payload.length, 'length', command, 1, Number.MAX_SAFE_INTEGER);
      return result;
    }
    case 'assetMove': {
      assertExactKeys(payload, ['fromRelativePath', 'toRelativePath', 'overwrite'], command);
      if (typeof payload.overwrite !== 'boolean') throw invalidPayload(command, 'overwrite is invalid');
      return {
        fromRelativePath: assetPath(payload.fromRelativePath, 'fromRelativePath', command),
        toRelativePath: assetPath(payload.toRelativePath, 'toRelativePath', command),
        overwrite: payload.overwrite,
      };
    }
    case 'assetAdopt': {
      assertExactKeys(payload, ['artifactId', 'relativePath', 'overwrite'], command);
      if (typeof payload.overwrite !== 'boolean') throw invalidPayload(command, 'overwrite is invalid');
      return { artifactId: requiredText(payload.artifactId, 'artifactId', command, MAX_IDENTIFIER_LENGTH),
        relativePath: assetPath(payload.relativePath, 'relativePath', command), overwrite: payload.overwrite };
    }
  }
}

function textCandidatePayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronLocalAppRecord {
  assertAllowedKeys(
    payload,
    ['messages', 'temperature', 'topP', 'maxTokens', 'topK', 'presencePenalty', 'frequencyPenalty', 'stop', 'seed'],
    ['messages'],
    command,
  );
  if (!Array.isArray(payload.messages)
    || payload.messages.length === 0
    || payload.messages.length > MAX_TEXT_CANDIDATE_MESSAGES) {
    throw invalidPayload(command, 'messages is invalid');
  }
  let promptBytes = 0;
  let sawSystem = false;
  let sawUser = false;
  const messages = payload.messages.map((entry, index) => {
    if (!isPlainRecord(entry)) throw invalidPayload(command, `messages[${index}] is invalid`);
    assertExactKeys(entry, ['role', 'text'], command);
    const role = entry.role;
    if (role === 'system') {
      if (sawSystem || sawUser) throw invalidPayload(command, 'system message order is invalid');
      sawSystem = true;
    } else if (role === 'user') {
      sawUser = true;
    } else {
      throw invalidPayload(command, `messages[${index}].role is invalid`);
    }
    const text = requiredUtf8Text(
      entry.text,
      `messages[${index}].text`,
      command,
      MAX_TEXT_CANDIDATE_MESSAGE_BYTES,
    );
    promptBytes += Buffer.byteLength(role, 'utf8') + Buffer.byteLength(text, 'utf8');
    if (promptBytes > MAX_TEXT_CANDIDATE_PROMPT_BYTES) {
      throw invalidPayload(command, 'messages exceed the prompt bound');
    }
    return { role, text };
  });
  if (!sawUser) throw invalidPayload(command, 'at least one user message is required');
  const output: Record<string, NimiElectronLocalAppJson> = {
    messages: messages as unknown as NimiElectronLocalAppRecord[string],
  };
  if (payload.temperature !== undefined) output.temperature = boundedFiniteNumber(payload.temperature, 'temperature', command, 0, 2);
  if (payload.topP !== undefined) output.topP = boundedFiniteNumber(payload.topP, 'topP', command, 0, 1);
  if (payload.maxTokens !== undefined) output.maxTokens = boundedSafeInteger(payload.maxTokens, 'maxTokens', command, 0, MAX_TEXT_CANDIDATE_TOKENS);
  if (payload.topK !== undefined) output.topK = boundedSafeInteger(payload.topK, 'topK', command, 0, 2_147_483_647);
  if (payload.presencePenalty !== undefined) output.presencePenalty = boundedFiniteNumber(payload.presencePenalty, 'presencePenalty', command, -2, 2);
  if (payload.frequencyPenalty !== undefined) output.frequencyPenalty = boundedFiniteNumber(payload.frequencyPenalty, 'frequencyPenalty', command, -2, 2);
  if (payload.stop !== undefined) {
    if (!Array.isArray(payload.stop)
      || payload.stop.some((value) => typeof value !== 'string' || value.trim() === '')) {
      throw invalidPayload(command, 'stop is invalid');
    }
    output.stop = [...payload.stop];
  }
  if (payload.seed !== undefined) output.seed = boundedSafeInteger(payload.seed, 'seed', command, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  return output;
}

function validateScenarioSpec(value: unknown, command: string, execute: boolean): void {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    throw invalidPayload(command, 'scenario spec is invalid');
  }
  assertNoForbiddenAuthorityValue(value, command);
  const acceptsInlineAudio = !execute
    && (value.type === 'speech-transcribe' || value.type === 'voice-create');
  validateJsonValue(value, command, 40 * 1024 * 1024, acceptsInlineAudio);
  if (value.type === 'text-embed' && execute) {
    assertExactKeys(value, ['type', 'inputs'], command);
    if (!Array.isArray(value.inputs) || value.inputs.length === 0 || value.inputs.length > 16) {
      throw invalidPayload(command, 'embed inputs are invalid');
    }
    let total = 0;
    for (const input of value.inputs) {
      requiredUtf8Text(input, 'inputs', command, 32 * 1024);
      total += Buffer.byteLength(String(input), 'utf8');
    }
    if (total > 64 * 1024) throw invalidPayload(command, 'embed inputs exceed the prompt bound');
    return;
  }
  if (value.type === 'image-generate') {
    validateImageSpec(value, command);
    return;
  }
  if (execute) throw invalidPayload(command, 'execute scenario type is invalid');
  switch (value.type) {
    case 'video-generate': validateVideoSpec(value, command); return;
    case 'speech-synthesize': validateSpeechSynthesizeSpec(value, command); return;
    case 'speech-transcribe': validateSpeechTranscribeSpec(value, command); return;
    case 'voice-create': validateVoiceCreateSpec(value, command); return;
    default: throw invalidPayload(command, 'job scenario type is invalid');
  }
}

function validateImageSpec(value: Record<string, unknown>, command: string): void {
  assertAllowedKeys(
    value,
    ['type', 'prompt', 'negativePrompt', 'n', 'size', 'aspectRatio', 'quality', 'style', 'seed', 'referenceImages', 'referenceImageArtifactId', 'mask', 'responseFormat'],
    ['type', 'prompt', 'negativePrompt', 'size', 'aspectRatio', 'quality', 'style', 'referenceImages', 'referenceImageArtifactId', 'mask', 'responseFormat'],
    command,
  );
  requiredUtf8Text(value.prompt, 'prompt', command, 32 * 1024);
  optionalExactText(value.negativePrompt, 'negativePrompt', command, 32 * 1024);
  for (const key of ['size', 'aspectRatio', 'quality', 'style']) optionalExactText(value[key], key, command, 128);
  if (value.n !== undefined) boundedSafeInteger(value.n, 'n', command, 0, 4);
  if (value.seed !== undefined) boundedSafeInteger(value.seed, 'seed', command, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(value.referenceImages) || value.referenceImages.length > 1) {
    throw invalidPayload(command, 'referenceImages is invalid');
  }
  for (const reference of value.referenceImages) requiredHttpsUrl(reference, 'referenceImages', command);
  const referenceImageArtifactId = optionalBoundedIdentifier(
    value.referenceImageArtifactId,
    'referenceImageArtifactId',
    command,
  );
  if (referenceImageArtifactId !== '' && value.referenceImages.length !== 0) {
    throw invalidPayload(command, 'image reference carriers are mutually exclusive');
  }
  const mask = optionalExactText(value.mask, 'mask', command, 2048);
  if (mask !== '') requiredHttpsUrl(mask, 'mask', command);
  if (!['', 'b64_json', 'url'].includes(String(value.responseFormat))) {
    throw invalidPayload(command, 'responseFormat is invalid');
  }
}

function validateVideoSpec(value: Record<string, unknown>, command: string): void {
  assertExactKeys(value, ['type', 'prompt', 'negativePrompt', 'mode', 'content', 'options'], command);
  optionalExactText(value.prompt, 'prompt', command, 32 * 1024);
  optionalExactText(value.negativePrompt, 'negativePrompt', command, 32 * 1024);
  if (!['t2v', 'i2v-first-frame', 'i2v-first-last', 'i2v-reference'].includes(String(value.mode))
    || !Array.isArray(value.content) || value.content.length > 8
    || (value.prompt === '' && value.content.length === 0)) throw invalidPayload(command, 'video spec is invalid');
  for (const itemValue of value.content) {
    if (!isPlainRecord(itemValue) || typeof itemValue.type !== 'string'
      || !['prompt', 'first-frame', 'last-frame', 'reference-image', 'reference-video', 'reference-audio'].includes(String(itemValue.role))) {
      throw invalidPayload(command, 'video content is invalid');
    }
    if (itemValue.type === 'text') {
      assertExactKeys(itemValue, ['type', 'role', 'text'], command);
      requiredUtf8Text(itemValue.text, 'content.text', command, 8 * 1024);
    } else if (['image-url', 'video-url', 'audio-url'].includes(itemValue.type)) {
      assertExactKeys(itemValue, ['type', 'role', 'url'], command);
      requiredHttpsUrl(itemValue.url, 'content.url', command);
    } else if (itemValue.type === 'artifact-ref') {
      assertExactKeys(itemValue, ['type', 'role', 'artifactId'], command);
      requiredText(itemValue.artifactId, 'artifactId', command, 128);
    } else throw invalidPayload(command, 'video content type is invalid');
  }
  if (!isPlainRecord(value.options)) throw invalidPayload(command, 'video options are invalid');
  assertAllowedKeys(
    value.options,
    ['resolution', 'ratio', 'durationSec', 'frames', 'fps', 'seed', 'cameraFixed', 'watermark', 'generateAudio', 'draft', 'returnLastFrame'],
    ['resolution', 'ratio'],
    command,
  );
  optionalExactText(value.options.resolution, 'resolution', command, 64);
  optionalExactText(value.options.ratio, 'ratio', command, 64);
  if (value.options.durationSec !== undefined) boundedSafeInteger(value.options.durationSec, 'durationSec', command, 0, 600);
  if (value.options.frames !== undefined) boundedSafeInteger(value.options.frames, 'frames', command, 0, 100_000);
  if (value.options.fps !== undefined) boundedSafeInteger(value.options.fps, 'fps', command, 0, 120);
  if (value.options.seed !== undefined) boundedSafeInteger(value.options.seed, 'seed', command, -1, 4_294_967_295);
  for (const key of ['cameraFixed', 'watermark', 'generateAudio', 'draft', 'returnLastFrame']) {
    if (value.options[key] !== undefined && typeof value.options[key] !== 'boolean') throw invalidPayload(command, `${key} is invalid`);
  }
}

function validateSpeechSynthesizeSpec(value: Record<string, unknown>, command: string): void {
  assertAllowedKeys(
    value,
    ['type', 'text', 'language', 'audioFormat', 'sampleRateHz', 'speed', 'pitch', 'volume', 'emotion', 'voiceRef', 'timingMode', 'voiceRenderHints'],
    ['type', 'text', 'language', 'audioFormat', 'emotion', 'voiceRef', 'timingMode', 'voiceRenderHints'],
    command,
  );
  requiredUtf8Text(value.text, 'text', command, 32 * 1024);
  optionalExactText(value.language, 'language', command, 64);
  optionalExactText(value.audioFormat, 'audioFormat', command, 64);
  optionalExactText(value.emotion, 'emotion', command, 128);
  if (value.sampleRateHz !== undefined) boundedSafeInteger(value.sampleRateHz, 'sampleRateHz', command, 0, 192_000);
  if (!['none', 'word', 'char'].includes(String(value.timingMode))) throw invalidPayload(command, 'speech options are invalid');
  if (value.speed !== undefined) boundedFiniteNumber(value.speed, 'speed', command, 0, 4);
  if (value.pitch !== undefined) boundedFiniteNumber(value.pitch, 'pitch', command, -24, 24);
  if (value.volume !== undefined) boundedFiniteNumber(value.volume, 'volume', command, 0, 4);
  if (value.voiceRef !== null) {
    if (!isPlainRecord(value.voiceRef)) throw invalidPayload(command, 'voiceRef is invalid');
    assertExactKeys(value.voiceRef, ['type', 'id'], command);
    if (!['preset', 'voice-asset'].includes(String(value.voiceRef.type))) throw invalidPayload(command, 'voiceRef type is invalid');
    requiredText(value.voiceRef.id, 'voiceRef.id', command, 128);
  }
  if (value.voiceRenderHints !== null) {
    if (!isPlainRecord(value.voiceRenderHints)) throw invalidPayload(command, 'voiceRenderHints is invalid');
    assertExactKeys(value.voiceRenderHints, ['stability', 'similarityBoost', 'style', 'useSpeakerBoost', 'speed'], command);
    for (const key of ['stability', 'similarityBoost', 'style', 'speed']) boundedFiniteNumber(value.voiceRenderHints[key], key, command, 0, 10);
    if (typeof value.voiceRenderHints.useSpeakerBoost !== 'boolean') throw invalidPayload(command, 'useSpeakerBoost is invalid');
  }
}

function validateSpeechTranscribeSpec(value: Record<string, unknown>, command: string): void {
  assertAllowedKeys(
    value,
    ['type', 'mimeType', 'language', 'timestamps', 'diarization', 'speakerCount', 'prompt', 'audioSource', 'responseFormat'],
    ['type', 'mimeType', 'language', 'prompt', 'audioSource', 'responseFormat'],
    command,
  );
  optionalExactText(value.mimeType, 'mimeType', command, 128);
  optionalExactText(value.language, 'language', command, 64);
  optionalExactText(value.prompt, 'prompt', command, 4 * 1024);
  optionalExactText(value.responseFormat, 'responseFormat', command, 64);
  if ((value.timestamps !== undefined && typeof value.timestamps !== 'boolean')
    || (value.diarization !== undefined && typeof value.diarization !== 'boolean')
    || !isPlainRecord(value.audioSource)) throw invalidPayload(command, 'transcription spec is invalid');
  if (value.speakerCount !== undefined) boundedSafeInteger(value.speakerCount, 'speakerCount', command, 0, 32);
  if (value.audioSource.type === 'bytes') {
    assertExactKeys(value.audioSource, ['type', 'bytes'], command);
    validateInputBytes(value.audioSource.bytes, 32 * 1024 * 1024, command);
    if (value.mimeType === '') throw invalidPayload(command, 'mimeType is required for bytes');
  } else if (value.audioSource.type === 'uri') {
    assertExactKeys(value.audioSource, ['type', 'uri'], command);
    requiredHttpsUrl(value.audioSource.uri, 'audioSource.uri', command);
  } else throw invalidPayload(command, 'audioSource type is invalid');
}

function validateVoiceCreateSpec(value: Record<string, unknown>, command: string): void {
  if (value.creationSource === 'reference-audio') {
    assertExactKeys(value, ['type', 'creationSource', 'referenceAudio', 'referenceAudioMime', 'languageHints', 'preferredName', 'text'], command);
    optionalExactText(value.referenceAudioMime, 'referenceAudioMime', command, 128);
    optionalExactText(value.preferredName, 'preferredName', command, 256);
    optionalExactText(value.text, 'text', command, 32 * 1024);
    if (!Array.isArray(value.languageHints) || value.languageHints.length > 8 || !isPlainRecord(value.referenceAudio)) {
      throw invalidPayload(command, 'voice reference-audio input is invalid');
    }
    for (const hint of value.languageHints) requiredText(hint, 'languageHint', command, 64);
    if (value.referenceAudio.type === 'bytes') {
      assertExactKeys(value.referenceAudio, ['type', 'bytes'], command);
      validateInputBytes(value.referenceAudio.bytes, 20 * 1024 * 1024, command);
      if (value.referenceAudioMime === '') throw invalidPayload(command, 'referenceAudioMime is required');
    } else if (value.referenceAudio.type === 'uri') {
      assertExactKeys(value.referenceAudio, ['type', 'uri'], command);
      requiredHttpsUrl(value.referenceAudio.uri, 'referenceAudio.uri', command);
    } else throw invalidPayload(command, 'referenceAudio type is invalid');
    return;
  }
  if (value.creationSource === 'text-description') {
    assertExactKeys(value, ['type', 'creationSource', 'instructionText', 'previewText', 'language', 'preferredName'], command);
    requiredUtf8Text(value.instructionText, 'instructionText', command, 8 * 1024);
    optionalExactText(value.previewText, 'previewText', command, 8 * 1024);
    optionalExactText(value.language, 'language', command, 64);
    optionalExactText(value.preferredName, 'preferredName', command, 256);
    return;
  }
  throw invalidPayload(command, 'voice creationSource is invalid');
}

function optionalExactText(value: unknown, field: string, command: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > maxBytes) throw invalidPayload(command, `${field} is invalid`);
  return value;
}

function optionalBoundedIdentifier(value: unknown, field: string, command: string): string {
  const text = optionalExactText(value, field, command, 128);
  if (/[\u0000-\u001f\u007f]/u.test(text)) throw invalidPayload(command, `${field} is invalid`);
  return text;
}

function validateInputBytes(value: unknown, maximum: number, command: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum
    || value.some((entry) => !Number.isInteger(entry) || Number(entry) < 0 || Number(entry) > 255)) {
    throw invalidPayload(command, 'inline bytes are invalid');
  }
}

function requiredHttpsUrl(value: unknown, field: string, command: string): string {
  const text = requiredText(value, field, command, 2048);
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('invalid');
  } catch {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return text;
}

function boundedFiniteNumber(
  value: unknown,
  field: string,
  command: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return value;
}

function boundedSafeInteger(
  value: unknown,
  field: string,
  command: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return value;
}

function identifiers(
  payload: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  command: string,
  optional = new Set<string>(),
  exactKeys: readonly string[] = keys,
): NimiElectronLocalAppRecord {
  assertExactKeys(payload, exactKeys, command);
  const record: Record<string, string> = {};
  for (const key of keys) {
    const value = typeof payload[key] === 'string' ? payload[key] : '';
    if (optional.has(key) && value === '') {
      record[key] = '';
      continue;
    }
    record[key] = requiredText(payload[key], key, command, MAX_IDENTIFIER_LENGTH);
  }
  return record;
}

function storagePathPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): NimiElectronLocalAppRecord {
  assertExactKeys(payload, ['relativePath'], command);
  const relativePath = typeof payload.relativePath === 'string' ? payload.relativePath : '';
  if (!isCanonicalStoragePath(relativePath)) throw invalidPayload(command, 'relativePath is invalid');
  return { relativePath };
}

function assetPathPayload(payload: Readonly<Record<string, unknown>>, command: string): NimiElectronLocalAppRecord {
  assertExactKeys(payload, ['relativePath'], command);
  return { relativePath: assetPath(payload.relativePath, 'relativePath', command) };
}

function assetPath(value: unknown, field: string, command: string): string {
  const path = typeof value === 'string' ? value : '';
  if (!isCanonicalAssetPath(path)) throw invalidPayload(command, `${field} is invalid`);
  return path;
}

function isCanonicalAssetPath(value: string): boolean {
  const components = value.split('/');
  if (!value || value.trim() !== value || !isWellFormedUnicode(value) || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > 1024 || value.startsWith('/') || value.endsWith('/')
    || /[\\\0<>:"|?*]/u.test(value) || components.length > 32) return false;
  return components.every((segment) => {
    if (!segment || segment === '.' || segment === '..' || Buffer.byteLength(segment, 'utf8') > 255
      || segment.endsWith('.') || segment.endsWith(' ') || /[\u0000-\u001f\u007f]/u.test(segment)) return false;
    const base = segment.split('.', 1)[0]?.toUpperCase() ?? '';
    return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base);
  });
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

function isCanonicalAssetPrefix(value: string): boolean {
  return isCanonicalAssetPath(value.endsWith('/') ? value.slice(0, -1) : value);
}

function validAssetMediaType(value: unknown, command: string): string {
  const mediaType = requiredText(value, 'mediaType', command, 255);
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(mediaType)) {
    throw invalidPayload(command, 'mediaType is invalid');
  }
  return mediaType.toLowerCase();
}

function isCanonicalStoragePath(value: string): boolean {
  if (!value || value.trim() !== value || Buffer.byteLength(value, 'utf8') > 240 || !value.endsWith('.json') || value.startsWith('/') || /[\\:\0]/u.test(value)) return false;
  return value.split('/').every((segment) => {
    if (!segment || segment === '.' || segment === '..' || segment.length > 128 || segment.endsWith('.')) return false;
    const base = segment.split('.', 1)[0]?.toUpperCase() ?? '';
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)) return false;
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment);
  });
}

function validateStorageJsonValue(value: unknown, command: string): void {
  validateJsonValue(value, command, 256 * 1024);
}

function validateJsonValue(
  value: unknown,
  command: string,
  maxBytes: number,
  compactByteArrays = false,
): void {
  const state = { nodes: 0, ancestors: new Set<object>() };
  const compactedByteArrays = new WeakSet<object>();
  const visit = (entry: unknown, depth = 0): void => {
    state.nodes += 1;
    if (depth > 32 || state.nodes > 100_000) {
      throw invalidPayload(command, 'value exceeds structural bounds');
    }
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number' && Number.isFinite(entry)) return;
    if (!entry || typeof entry !== 'object' || state.ancestors.has(entry)) {
      throw invalidPayload(command, 'value is not JSON-compatible');
    }
    state.ancestors.add(entry);
    if (Array.isArray(entry)) {
      const isByteArray = compactByteArrays
        && entry.length > 0
        && entry.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255);
      if (isByteArray) {
        compactedByteArrays.add(entry);
      } else {
        for (const item of entry) visit(item, depth + 1);
      }
    } else if (Object.getPrototypeOf(entry) === Object.prototype) {
      for (const item of Object.values(entry as Record<string, unknown>)) visit(item, depth + 1);
    } else {
      throw invalidPayload(command, 'value is not JSON-compatible');
    }
    state.ancestors.delete(entry);
  };
  visit(value);
  const encoded = JSON.stringify(value, compactByteArrays
    ? (_key, entry: unknown) => (
        entry && typeof entry === 'object' && compactedByteArrays.has(entry)
          ? `[inline-bytes:${(entry as readonly unknown[]).length}]`
          : entry
      )
    : undefined);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw invalidPayload(command, 'value exceeds the JSON document bound');
  }
}

function assertNoPortableAppAIConfigFields(value: unknown, command: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPortableAppAIConfigFields(entry, command);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
    if (FORBIDDEN_PORTABLE_APP_AI_CONFIG_FIELDS.has(normalized)) {
      throw invalidPayload(command, `portable App AIConfig field ${key} is forbidden`);
    }
    assertNoPortableAppAIConfigFields(entry, command);
  }
}

function assertNoForbiddenAuthorityValue(value: unknown, command: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoForbiddenAuthorityValue(entry, command);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_RENDERER_FIELDS.has(key)) {
      throw invalidPayload(command, `renderer authority field ${key} is forbidden`);
    }
    assertNoForbiddenAuthorityValue(entry, command);
  }
}

function presentationAssetsPayload(
  value: unknown,
  command: string,
): NimiElectronLocalAppRecord[string] {
  if (!Array.isArray(value) || value.length > 2) {
    throw invalidPayload(command, 'importedAssets is invalid');
  }
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw invalidPayload(command, `importedAssets[${index}] is invalid`);
    }
    assertExactKeys(entry, ['role', 'fileName', 'mediaType', 'content', 'sha256'], command);
    if (entry.role !== 'avatar' && entry.role !== 'background') {
      throw invalidPayload(command, `importedAssets[${index}].role is invalid`);
    }
    if (!Array.isArray(entry.content)
      || entry.content.length === 0
      || entry.content.length > 64 * 1024 * 1024
      || entry.content.some((byte) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255)) {
      throw invalidPayload(command, `importedAssets[${index}].content is invalid`);
    }
    return {
      role: entry.role,
      fileName: requiredText(entry.fileName, `importedAssets[${index}].fileName`, command, 512),
      mediaType: requiredText(entry.mediaType, `importedAssets[${index}].mediaType`, command, 512),
      content: entry.content,
      sha256: requiredText(entry.sha256, `importedAssets[${index}].sha256`, command, 512),
    };
  }) as NimiElectronLocalAppRecord[string];
}

function assertNoForbiddenAuthority(payload: Readonly<Record<string, unknown>>, command: string): void {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_RENDERER_FIELDS.has(key)) {
      throw invalidPayload(command, `renderer authority field ${key} is forbidden`);
    }
  }
}

function assertExactKeys(payload: Readonly<Record<string, unknown>>, keys: readonly string[], command: string): void {
  if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify([...keys].sort())) {
    throw invalidPayload(command, `payload fields must be exactly ${keys.join(', ') || '<empty>'}`);
  }
}

function assertAllowedKeys(
  payload: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  command: string,
): void {
  const keys = Object.keys(payload);
  if (keys.some((key) => !allowedKeys.includes(key))
    || requiredKeys.some((key) => !Object.hasOwn(payload, key))) {
    throw invalidPayload(command, `payload fields must be limited to ${allowedKeys.join(', ')}`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function nonNegativeInteger(value: unknown, command: string, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return value;
}

function worldVisibility(value: unknown, command: string): 'private' | 'unlisted' | 'public' | 'system' {
  if (value !== 'private' && value !== 'unlisted' && value !== 'public' && value !== 'system') {
    throw invalidPayload(command, 'visibility is invalid');
  }
  return value;
}

function personaWritableVisibility(value: unknown, command: string): 'private' | 'unlisted' | 'public' {
  if (value !== 'private' && value !== 'unlisted' && value !== 'public') {
    throw invalidPayload(command, 'visibility is invalid');
  }
  return value;
}

function requiredText(value: unknown, field: string, command: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return normalized;
}

function decimalRevision(value: unknown, field: string, command: string, allowZero: boolean): string {
  if (typeof value !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || (!allowZero && value === '0')) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return value;
}

function requiredUtf8Text(value: unknown, field: string, command: string, maxBytes: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw invalidPayload(command, `${field} is invalid`);
  }
  return normalized;
}

function activeConversationStreams(host: NimiElectronLocalAppHost): Set<string> {
  let streams = ACTIVE_CONVERSATION_STREAMS.get(host);
  if (!streams) {
    streams = new Set();
    ACTIVE_CONVERSATION_STREAMS.set(host, streams);
  }
  return streams;
}

function activeScenarioStreams(host: NimiElectronLocalAppHost): Set<string> {
  let streams = ACTIVE_SCENARIO_STREAMS.get(host);
  if (!streams) {
    streams = new Set();
    ACTIVE_SCENARIO_STREAMS.set(host, streams);
  }
  return streams;
}

async function pumpScenarioStream(
  host: NimiElectronLocalAppHost,
  method: 'textTurnSubscribe' | 'scenarioJobSubscribe',
  subscriptionId: string,
  eventName: string,
  sendEvent: (eventName: string, payload: NimiElectronLocalAppRecord) => void,
  command: string,
): Promise<void> {
  const streams = activeScenarioStreams(host);
  try {
    while (streams.has(subscriptionId)) {
      const next = method === 'textTurnSubscribe'
        ? await host.textTurnStreamNext({ streamId: subscriptionId })
        : await host.scenarioJobStreamNext({ streamId: subscriptionId });
      if (!streams.has(subscriptionId)) return;
      if (next.completed === true) {
        streams.delete(subscriptionId);
        sendEvent(eventName, { subscriptionId, eventType: 'completed' });
        return;
      }
      sendEvent(eventName, { subscriptionId, eventType: 'next', event: next.event ?? null });
    }
  } catch (error) {
    if (!streams.delete(subscriptionId)) return;
    const mapped = error instanceof NimiElectronLocalAppHostError
      ? mapHostError(error, command)
      : new NimiElectronShellHostError({
          code: 'runtime-service-untrusted',
          message: 'Electron local-app AI stream returned an untrusted failure',
          reasonCode: 'runtime-service-untrusted',
          actionHint: 'restart_fixed_runtime_service',
          details: { command },
        });
    sendEvent(eventName, {
      subscriptionId,
      eventType: 'error',
      error: {
        code: mapped.code,
        reasonCode: mapped.reasonCode,
        actionHint: mapped.actionHint,
        source: mapped.source,
        details: { command, retryable: error instanceof NimiElectronLocalAppHostError && error.retryable },
      },
    });
  } finally {
    if (!streams.has(subscriptionId)) {
      const close = method === 'textTurnSubscribe' ? host.textTurnStreamClose : host.scenarioJobStreamClose;
      await close.call(host, { streamId: subscriptionId }).catch(() => undefined);
    }
  }
}

async function pumpConversationStream(
  host: NimiElectronLocalAppHost,
  subscriptionId: string,
  eventName: string,
  sendEvent: (eventName: string, payload: NimiElectronLocalAppRecord) => void,
  command: string,
): Promise<void> {
  const streams = activeConversationStreams(host);
  try {
    while (streams.has(subscriptionId)) {
      const next = await host.conversationStreamNext({ streamId: subscriptionId });
      if (!streams.has(subscriptionId)) return;
      if (next.completed === true) {
        streams.delete(subscriptionId);
        sendEvent(eventName, { subscriptionId, eventType: 'completed' });
        return;
      }
      sendEvent(eventName, { subscriptionId, eventType: 'next', event: next.event ?? null });
    }
  } catch (error) {
    if (!streams.delete(subscriptionId)) return;
    const mapped = error instanceof NimiElectronLocalAppHostError
      ? mapHostError(error, command)
      : new NimiElectronShellHostError({
          code: 'runtime-service-untrusted',
          message: 'Electron local-app stream returned an untrusted failure',
          reasonCode: 'runtime-service-untrusted',
          actionHint: 'restart_fixed_runtime_service',
          details: { command },
        });
    sendEvent(eventName, {
      subscriptionId,
      eventType: 'error',
      error: {
        code: mapped.code,
        reasonCode: mapped.reasonCode,
        actionHint: mapped.actionHint,
        source: mapped.source,
        details: { command, retryable: error instanceof NimiElectronLocalAppHostError && error.retryable },
      },
    });
  } finally {
    if (!streams.has(subscriptionId)) {
      await host.conversationStreamClose({ streamId: subscriptionId }).catch(() => undefined);
    }
  }
}

function mapHostError(error: NimiElectronLocalAppHostError, command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: standardCode(error.reasonCode),
    message: error.reasonCode,
    reasonCode: error.reasonCode,
    actionHint: actionHint(error.reasonCode),
    source: error.reasonCode === 'protected-carrier-required' ? 'electron' : 'runtime',
    details: {
      command,
      retryable: error.retryable,
      ...(Object.keys(error.reasonMetadata).length > 0
        ? { reasonMetadata: error.reasonMetadata }
        : {}),
    },
  });
}

function standardCode(reasonCode: string) {
  switch (reasonCode) {
    case 'capability-unavailable': return 'capability-unavailable' as const;
    case 'invalid-input': return 'invalid-input' as const;
    case 'session-invalid': return 'session-invalid' as const;
    case 'access-denied': return 'access-denied' as const;
    case 'owner-authority-missing': return 'owner-authority-missing' as const;
    case 'content-conflict': return 'content-conflict' as const;
    case 'realm-unavailable': return 'realm-unavailable' as const;
    case 'rate-limited': return 'rate-limited' as const;
    case 'upstream-failed': return 'upstream-failed' as const;
    case 'contract-invalid': return 'contract-invalid' as const;
    case 'request-too-large': return 'request-too-large' as const;
    case 'response-too-large': return 'response-too-large' as const;
    case 'protected-carrier-required': return 'protected-carrier-required' as const;
    case 'runtime-service-unavailable': return 'runtime-service-unavailable' as const;
    case 'runtime-service-untrusted': return 'runtime-service-untrusted' as const;
    case 'runtime-service-error-unclassified': return 'runtime-service-error-unclassified' as const;
    case 'runtime-service-repair-required': return 'runtime-service-repair-required' as const;
    case 'runtime-unauthenticated': return 'runtime-unauthenticated' as const;
    case 'invalid-payload':
    case 'ai-config-invalid':
    case 'ai-voice-input-invalid':
    case 'ai-voice-workflow-unsupported':
    case 'ai-voice-asset-expired':
    case 'ai-voice-target-model-mismatch':
    case 'ai-voice-job-not-cancellable': return 'invalid-payload' as const;
    case 'invalid-path': return 'invalid-path' as const;
    case 'not-found':
    case 'ai-config-not-found':
    case 'ai-voice-asset-not-found':
    case 'ai-voice-job-not-found': return 'not-found' as const;
    case 'ai-config-persistence-unavailable': return 'runtime-service-unavailable' as const;
    case 'resource-exhausted': return 'resource-exhausted' as const;
    default: return 'runtime-permission-denied' as const;
  }
}

function validatePersonaCharacterWrite(
  payload: Readonly<Record<string, unknown>>,
  replace: boolean,
  command: string,
): void {
  const allowed = replace
    ? ['personaCharacterId', 'baseContentHash', 'worldId', 'visibility', 'origin', 'profile']
    : ['worldId', 'visibility', 'origin', 'profile'];
  assertAllowedKeys(payload, allowed, allowed, command);
  if (replace) {
    requiredText(payload.personaCharacterId, 'personaCharacterId', command, MAX_IDENTIFIER_LENGTH);
    if (typeof payload.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(payload.baseContentHash)) {
      throw invalidPayload(command, 'baseContentHash is invalid');
    }
  }
  requiredText(payload.worldId, 'worldId', command, MAX_IDENTIFIER_LENGTH);
  personaWritableVisibility(payload.visibility, command);
  if (!isPlainRecord(payload.origin) || !isPlainRecord(payload.profile)) {
    throw invalidPayload(command, 'origin and profile must be objects');
  }
  if (Object.hasOwn(payload.profile, 'profileHash') || Object.hasOwn(payload.profile, 'profileCoverage')) {
    throw invalidPayload(command, 'profile contains output-only fields');
  }
  validateJsonValue(payload, command, 2 * 1024 * 1024);
}

function actionHint(reasonCode: string): string {
  switch (reasonCode) {
    case 'protected-carrier-required': return 'install_verified_electron_protected_carrier';
    case 'runtime-service-unavailable': return 'start_fixed_runtime_service';
    case 'runtime-service-error-unclassified': return 'inspect_runtime_service_error';
    case 'runtime-service-repair-required': return 'repair_fixed_runtime_service';
    case 'runtime-unauthenticated': return 'open_request_empty_local_app_session';
    default: return 'refresh_local_app_runtime_projection';
  }
}

function carrierRequired(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'protected-carrier-required',
    message: 'Electron local-app operation requires the native protected carrier',
    reasonCode: 'protected-carrier-required',
    actionHint: 'install_verified_electron_protected_carrier',
    details: { command },
  });
}

function invalidPayload(command: string, reason: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: `Electron local-app payload is invalid: ${reason}`,
    reasonCode: 'invalid-payload',
    actionHint: 'send_only_declared_local_app_operation_fields',
    details: { command },
  });
}
