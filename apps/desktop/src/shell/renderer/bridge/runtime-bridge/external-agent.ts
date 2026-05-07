import { hasTauriInvoke } from './env';
import { invoke, invokeChecked } from './invoke';
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
      status: 'unavailable',
      reasonCode: 'EXTERNAL_AGENT_GATEWAY_UNAVAILABLE',
    };
  }
  return invokeChecked('external_agent_gateway_status', {}, parseExternalAgentGatewayStatus);
}

export async function subscribeExternalAgentActionExecuteRequests(
  _listener: (request: ExternalAgentActionExecutionRequest) => void,
): Promise<() => void> {
  return () => {};
}
