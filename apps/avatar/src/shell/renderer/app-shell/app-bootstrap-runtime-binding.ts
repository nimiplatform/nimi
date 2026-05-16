import {
  decodeAvatarPackageHandoff,
  type RuntimeAvatarPackageHandoff,
} from '@nimiplatform/sdk/runtime';
import {
  AccountCallerMode,
  ScopedAppBindingPurpose,
  type AccountCaller,
  type Runtime,
  type RuntimeScopedBindingAttachment,
} from '@nimiplatform/sdk/runtime/browser';
import { readNormalizedString } from './app-bootstrap-helpers.js';

const AVATAR_FIRST_PARTY_APP_INSTANCE_ID = 'nimi.avatar.local-first-party';
const AVATAR_FIRST_PARTY_DEVICE_ID = 'local-first-party-device';
const LOCAL_AGENT_REF_PREFIX = 'local-agent:';

export function createAvatarAccountCaller(appId: string): AccountCaller {
  return {
    appId,
    appInstanceId: AVATAR_FIRST_PARTY_APP_INSTANCE_ID,
    deviceId: AVATAR_FIRST_PARTY_DEVICE_ID,
    mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    scopes: [],
  };
}

export async function issueAvatarRuntimeScopedBinding(input: {
  runtime: Runtime;
  accountCaller: AccountCaller;
  runtimeAppId: string;
  avatarInstanceId: string;
  localAgentRef: string;
  conversationAnchorId: string;
}): Promise<RuntimeScopedBindingAttachment> {
  const relation = {
    bindingId: '',
    runtimeAppId: input.runtimeAppId,
    appInstanceId: AVATAR_FIRST_PARTY_APP_INSTANCE_ID,
    windowId: input.avatarInstanceId,
    avatarInstanceId: input.avatarInstanceId,
    agentId: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    worldId: '',
    purpose: ScopedAppBindingPurpose.AVATAR_INTERACTION_CONSUME,
    scopes: [
      'runtime.agent.turn.read',
      'runtime.agent.state.read',
      'runtime.agent.presentation.read',
    ],
    state: 0,
    reasonCode: 0,
  };
  const issued = await input.runtime.account.issueScopedAppBinding({
    caller: input.accountCaller,
    relation,
    ttlSeconds: 600,
  });
  if (!issued.accepted || !issued.bindingId || !issued.relation) {
    throw new Error(`Avatar runtime scoped binding rejected: ${issued.accountReasonCode || issued.reasonCode || 'unknown'}`);
  }
  return {
    bindingId: issued.bindingId,
    bindingHandle: issued.bindingCarrier || '',
    runtimeAppId: issued.relation.runtimeAppId,
    appInstanceId: issued.relation.appInstanceId,
    windowId: issued.relation.windowId,
    avatarInstanceId: issued.relation.avatarInstanceId,
    localAgentRef: issued.relation.agentId,
    conversationAnchorId: issued.relation.conversationAnchorId,
    worldId: issued.relation.worldId,
  };
}

export function resolveLaunchAgentIdentity(input: {
  agentId: string;
  accountId: string;
}): {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
} {
  const agentId = readNormalizedString(input.agentId);
  const accountId = readNormalizedString(input.accountId);
  if (!agentId) {
    throw new Error('avatar launch context is missing agentId');
  }
  if (!accountId) {
    throw new Error('Runtime account projection is required before resolving Avatar launch agent identity');
  }
  const ownerUserId = accountId;
  if (agentId.startsWith(LOCAL_AGENT_REF_PREFIX)) {
    const [, selectedOwnerUserId, selectedRealmAgentId, ...extra] = agentId.split(':');
    if (!selectedOwnerUserId || !selectedRealmAgentId || extra.length > 0) {
      throw new Error('avatar launch agentId local-agent selector is malformed');
    }
    if (selectedOwnerUserId !== ownerUserId) {
      throw new Error('avatar launch agentId does not match Runtime account projection');
    }
    return {
      ownerUserId,
      realmAgentId: selectedRealmAgentId,
      localAgentRef: agentId,
    };
  }
  const realmAgentId = agentId;
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef: `${LOCAL_AGENT_REF_PREFIX}${ownerUserId}:${realmAgentId}`,
  };
}

export async function resolveRuntimeAvatarPackageHandoff(input: {
  runtime: Runtime;
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  avatarInstanceId: string;
}): Promise<RuntimeAvatarPackageHandoff & { materializationRef: string }> {
  const handoff = decodeAvatarPackageHandoff(
    await input.runtime.avatarPackage.resolveLaunchProjection({
      accountId: input.accountId,
      ownerUserId: input.ownerUserId,
      realmAgentId: input.realmAgentId,
      localAgentRef: input.localAgentRef,
      avatarInstanceId: input.avatarInstanceId,
    }),
  );
  if (!handoff.materializationRef) {
    throw new Error('Runtime Avatar package handoff is missing materializationRef');
  }
  return {
    ...handoff,
    materializationRef: handoff.materializationRef,
  };
}
