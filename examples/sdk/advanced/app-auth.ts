/**
 * Local-app authorization lifecycle for a renderer launched by `nimi-app dev`.
 * Pass the Kit `createNimiLocalAppStandardShellSurface()` result from the app
 * shell; authority material never enters this module.
 */

import {
  createNimiAppRuntimePlatformClient,
  type NimiAppRuntimePlatformStandardShell,
} from '@nimiplatform/sdk/app';

const OPEN_CONVERSATION_OPERATION = 'runtime_agent.conversation.open';

export async function runAppAuthorizationLifecycle(
  standardShell: NimiAppRuntimePlatformStandardShell,
): Promise<void> {
  const app = createNimiAppRuntimePlatformClient({ standardShell });
  const session = await app.auth.status();
  if (!session.sessionBound) {
    throw new Error(`${session.reasonCode}: ${session.actionHint}`);
  }

  // Bounded inventory is available to the session without granting a concrete
  // operation. It does not expose a principal, token, grant id, or transport.
  const inventory = await app.agent.listInventory();
  const agent = inventory.localAgents.find((candidate) => candidate.sourceReady);
  if (!agent) {
    throw new Error('No source-ready Runtime Agent is available for this example.');
  }

  const resourceRef = `agent:${agent.localAgentRef}`;
  const permissionInput = {
    operationId: OPEN_CONVERSATION_OPERATION,
    resourceRef,
  };
  const posture = await app.permissions.posture(permissionInput);

  if (posture.state !== 'granted') {
    const request = posture.state === 'pending'
      ? posture
      : await app.permissions.request({
        ...permissionInput,
        purpose: 'Open or resume this Runtime-owned Agent conversation',
      });
    console.log('approval required:', request.state, request.reasonCode, request.actionHint);
    console.log('Approve the exact operation and resource in Desktop, then run this flow again.');
    return;
  }

  // The posture check is only UX guidance. Runtime still enforces the current
  // account, process-bound session, exact grant, and resource at this call.
  const conversation = await app.agent.openConversation({
    agentId: agent.localAgentRef,
    requestedAnchorDisposition: 'create-or-resume',
  });
  const conversationAnchorId = conversation.anchor?.conversationAnchorId;
  if (!conversationAnchorId) {
    throw new Error('Runtime returned no conversation anchor.');
  }
  console.log('owner-enforced conversation:', conversationAnchorId);
}
