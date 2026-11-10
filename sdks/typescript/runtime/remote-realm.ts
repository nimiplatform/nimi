import { AccountReasonCode, ReasonCode, type RuntimeTypedClient } from '../core-generated/runtime-typed-client.js';
import { createNimiLocalAppWorldCoreClient } from '../core/app/local-app-runtime-platform.js';
import { createNimiLocalAppPersonaCharacterClient } from '../core/app/local-app-runtime-platform-persona-character.js';
import { createNimiError, extractNimiErrorFields } from '../types/index.js';

type Method = 'WorldCoreController_listWorldCores' | 'WorldCoreController_getWorldCore'
  | 'WorldCoreController_getWorldCreationEligibility' | 'WorldCoreController_createWorldCore' | 'WorldCoreController_replaceWorldCore'
  | 'WorldCoreController_listWorldCharacters' | 'WorldCoreController_getWorldCharacter' | 'WorldCoreController_createWorldCharacter' | 'WorldCoreController_replaceWorldCharacter'
  | 'WorldCoreController_listWorldEntities' | 'WorldCoreController_getWorldEntity' | 'WorldCoreController_createWorldEntity'
  | 'WorldCoreController_listWorldRelationships' | 'WorldCoreController_getWorldRelationship'
  | 'WorldCoreController_listPersonaCharacters' | 'WorldCoreController_getPersonaCharacter'
  | 'WorldCoreController_createPersonaCharacter' | 'WorldCoreController_replacePersonaCharacter' | 'WorldCoreController_deletePersonaCharacter';
type Request = { path: Record<string, string>; query: Record<string, string | number>; body?: unknown };

// @nimi-authority: rule.nimi.sdks.client-core.remote-runtime-carrier
// Fixed resource methods reuse native DTO validation. There is no account
// client, endpoint selector or arbitrary Realm method in the returned surface.
export function createRemoteAppRealmClients(runtime: Pick<RuntimeTypedClient, 'invokeRealmUnary'>) {
  async function invoke(methodId: Method, request: Request): Promise<unknown> {
    let response: Awaited<ReturnType<typeof runtime.invokeRealmUnary>>;
    try { response = await runtime.invokeRealmUnary({ methodId, realmBaseUrl: '', requestJson: JSON.stringify(request), timeoutMs: 30_000 }); }
    catch (error) {
      const fields = extractNimiErrorFields(error);
      throw failure(reason(fields.reasonCode || fields.code || ''), fields.actionHint);
    }
    if (!response.accepted) throw failure(reason(ReasonCode[response.reasonCode], response.accountReasonCode));
    if (response.reasonCode !== ReasonCode.ACTION_EXECUTED || response.accountReasonCode !== AccountReasonCode.ACTION_EXECUTED
      || response.productionInert || response.httpStatus < 200 || response.httpStatus >= 300 || response.errorMessage) throw failure('contract-invalid');
    try { return JSON.parse(response.responseJson); }
    catch { throw failure('contract-invalid'); }
  }
  return Object.freeze({
    worldCore: createNimiLocalAppWorldCoreClient({
      list: input => invoke('WorldCoreController_listWorldCores', { path: {}, query: { ...input } }),
      get: worldId => invoke('WorldCoreController_getWorldCore', { path: { worldId }, query: {} }),
      getCreationEligibility: () => invoke('WorldCoreController_getWorldCreationEligibility', { path: {}, query: {} }),
      create: body => invoke('WorldCoreController_createWorldCore', { path: {}, query: {}, body }),
      replace: (worldId, body) => invoke('WorldCoreController_replaceWorldCore', { path: { worldId }, query: {}, body }),
      listCharacters: (worldId, input) => invoke('WorldCoreController_listWorldCharacters', { path: { worldId }, query: { ...input } }),
      getCharacter: characterId => invoke('WorldCoreController_getWorldCharacter', { path: { characterId }, query: {} }),
      createCharacter: (worldId, body) => invoke('WorldCoreController_createWorldCharacter', { path: { worldId }, query: {}, body }),
      replaceCharacter: (characterId, body) => invoke('WorldCoreController_replaceWorldCharacter', { path: { characterId }, query: {}, body }),
      listEntities: (worldId, input) => invoke('WorldCoreController_listWorldEntities', { path: { worldId }, query: { ...input } }),
      getEntity: entityId => invoke('WorldCoreController_getWorldEntity', { path: { entityId }, query: {} }),
      createEntity: (worldId, body) => invoke('WorldCoreController_createWorldEntity', { path: { worldId }, query: {}, body }),
      listRelationships: (worldId, input) => invoke('WorldCoreController_listWorldRelationships', { path: { worldId }, query: { ...input } }),
      getRelationship: relationshipId => invoke('WorldCoreController_getWorldRelationship', { path: { relationshipId }, query: {} }),
    }),
    personaCharacter: createNimiLocalAppPersonaCharacterClient({
      listOwned: input => invoke('WorldCoreController_listPersonaCharacters', { path: {}, query: { scope: 'owned', ...input } }),
      getOwned: personaCharacterId => invoke('WorldCoreController_getPersonaCharacter', { path: { personaCharacterId }, query: {} }),
      create: body => invoke('WorldCoreController_createPersonaCharacter', { path: {}, query: {}, body }),
      replace: ({ personaCharacterId, ...body }) => invoke('WorldCoreController_replacePersonaCharacter', { path: { personaCharacterId }, query: {}, body }),
      delete: personaCharacterId => invoke('WorldCoreController_deletePersonaCharacter', { path: { personaCharacterId }, query: {} }),
    }),
  });
}

function failure(reasonCode: string, actionHint?: string) {
  return createNimiError({ message: `Realm resource operation failed: ${reasonCode}.`, reasonCode,
    actionHint: typeof actionHint === 'string' ? actionHint : 'handle_realm_resource_failure', source: 'runtime' });
}
function reason(value: string, accountReason?: AccountReasonCode): string {
  switch (value) {
    case 'LOCAL_APP_OPERATION_UNAVAILABLE': case 'LOCAL_APP_OPERATION_UNSUPPORTED': case 'SDK_RUNTIME_REMOTE_UNAVAILABLE': return 'capability-unavailable';
    case 'PROTOCOL_ENVELOPE_INVALID': return 'invalid-input';
    case 'LOCAL_APP_SNAPSHOT_UNAVAILABLE': case 'SDK_RUNTIME_CLIENT_CONTEXT_INVALID': return 'session-invalid';
    case 'PRINCIPAL_UNAUTHORIZED': case 'APP_SCOPE_FORBIDDEN': case 'LOCAL_APP_ACCESS_DENIED': return 'access-denied';
    case 'LOCAL_APP_OWNER_UNAVAILABLE': return 'owner-authority-missing';
    case 'REALM_NOT_FOUND': return 'not-found';
    case 'REALM_CONFLICT': return 'content-conflict';
    case 'REALM_RATE_LIMITED': return 'rate-limited';
    case 'REALM_UNAVAILABLE': return 'realm-unavailable';
    case 'REALM_OPERATION_FAILED': return 'upstream-failed';
    case 'APP_MESSAGE_PAYLOAD_TOO_LARGE': return 'request-too-large';
    case 'REALM_CONTRACT_INVALID': return accountReason === AccountReasonCode.BROKER_RESPONSE_TOO_LARGE ? 'response-too-large' : 'contract-invalid';
    default: return 'contract-invalid';
  }
}
