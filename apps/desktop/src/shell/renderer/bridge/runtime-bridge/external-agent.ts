import { listenTauri } from '@runtime/tauri-api';
import { hasTauriInvoke } from './env';
import { invoke, invokeChecked } from './invoke';
import { parseOptionalJsonObject } from './shared.js';
import {
  parseExternalAgentActionDescriptors,
  parseExternalAgentGatewayStatus,
  parseExternalAgentIssueTokenResult,
  parseExternalAgentTokenRecordList,
  type ExternalAgentActionDescriptor,
  type ExternalAgentActionExecutionCompletion,
  type ExternalAgentActionExecutionRequest,
  type ExternalAgentGatewayStatus,
  type ExternalAgentIssueTokenPayload,
  type ExternalAgentIssueTokenResult,
  type ExternalAgentRevokeTokenPayload,
  type ExternalAgentTokenRecord,
} from './types';

type TauriEventUnsubscribe = () => void;
type TauriListenResult = Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

const EXTERNAL_AGENT_ACTION_REQUEST_EVENT = 'external-agent://action-request';

function resolveTauriEventListen(): ((eventName: string, handler: (event: { payload: unknown }) => void) => TauriListenResult) | null {
  if (!hasTauriInvoke()) {
    return null;
  }
  return listenTauri;
}

export async function issueExternalAgentToken(
  payload: ExternalAgentIssueTokenPayload,
): Promise<ExternalAgentIssueTokenResult> {
  if (!hasTauriInvoke()) {
    throw new Error('external_agent_issue_token requires Tauri runtime');
  }
  return invokeChecked('external_agent_issue_token', { payload }, parseExternalAgentIssueTokenResult);
}

export async function revokeExternalAgentToken(payload: ExternalAgentRevokeTokenPayload): Promise<void> {
  if (!hasTauriInvoke()) return;
  await invoke('external_agent_revoke_token', { payload });
}

export async function listExternalAgentTokens(): Promise<ExternalAgentTokenRecord[]> {
  if (!hasTauriInvoke()) {
    return [];
  }
  return invokeChecked('external_agent_list_tokens', {}, parseExternalAgentTokenRecordList);
}

export async function syncExternalAgentActionDescriptors(
  descriptors: ExternalAgentActionDescriptor[],
): Promise<ExternalAgentActionDescriptor[]> {
  if (!hasTauriInvoke()) {
    return descriptors;
  }
  return invokeChecked(
    'external_agent_sync_action_descriptors',
    { payload: { descriptors } },
    parseExternalAgentActionDescriptors,
  );
}

export async function completeExternalAgentExecution(
  payload: ExternalAgentActionExecutionCompletion,
): Promise<void> {
  if (!hasTauriInvoke()) return;
  await invoke('external_agent_complete_execution', { payload });
}

export async function getExternalAgentGatewayStatus(): Promise<ExternalAgentGatewayStatus> {
  if (!hasTauriInvoke()) {
    return {
      enabled: false,
      bindAddress: '127.0.0.1:0',
      issuer: 'local',
      actionCount: 0,
    };
  }
  return invokeChecked('external_agent_gateway_status', {}, parseExternalAgentGatewayStatus);
}

function parseExecutionRequest(value: unknown): ExternalAgentActionExecutionRequest {
  const record = parseOptionalJsonObject(value) || {};
  const contextRaw = parseOptionalJsonObject(record.context) || {};
  const mode = String(contextRaw.mode || '').trim() === 'autonomous' ? 'autonomous' : 'delegated';
  const phaseRaw = String(record.phase || '').trim();
  const phase: 'dry-run' | 'verify' | 'commit' = phaseRaw === 'verify'
    ? 'verify'
    : phaseRaw === 'commit'
      ? 'commit'
      : record.dryRun
        ? 'dry-run'
        : 'commit';
  return {
    executionId: String(record.executionId || '').trim(),
    actionId: String(record.actionId || '').trim(),
    phase,
    input: parseOptionalJsonObject(record.input) || {},
    context: {
      principalId: String(contextRaw.principalId || '').trim(),
      principalType: 'external-agent',
      mode,
      subjectAccountId: String(contextRaw.subjectAccountId || '').trim(),
      issuer: String(contextRaw.issuer || '').trim() || undefined,
      authTokenId: String(contextRaw.authTokenId || '').trim() || undefined,
      traceId: String(contextRaw.traceId || '').trim(),
      userAccountId: String(contextRaw.userAccountId || '').trim() || undefined,
      externalAccountId: String(contextRaw.externalAccountId || '').trim() || undefined,
      delegationChain: Array.isArray(contextRaw.delegationChain)
        ? contextRaw.delegationChain.map((item) => String(item || '').trim()).filter(Boolean)
        : undefined,
    },
    idempotencyKey: String(record.idempotencyKey || '').trim() || undefined,
    verifyTicket: String(record.verifyTicket || '').trim() || undefined,
  };
}

export async function subscribeExternalAgentActionExecuteRequests(
  listener: (request: ExternalAgentActionExecutionRequest) => void,
): Promise<() => void> {
  const listen = resolveTauriEventListen();
  if (!listen) {
    return () => {};
  }

  const unsubscribe = await Promise.resolve(listen(EXTERNAL_AGENT_ACTION_REQUEST_EVENT, (event) => {
    listener(parseExecutionRequest(event.payload));
  }));
  if (typeof unsubscribe === 'function') {
    return unsubscribe;
  }
  return () => {};
}
