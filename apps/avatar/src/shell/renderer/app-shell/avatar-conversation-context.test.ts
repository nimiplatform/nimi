import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAvatarConversationContext } from './avatar-conversation-context.js';
import { type NimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/runtime/generated';

const OWNER_USER_ID = 'account-runtime';
const REALM_AGENT_ID = 'agent-e2e-alpha';
const LOCAL_AGENT_REF = `local-agent:${OWNER_USER_ID}:${REALM_AGENT_ID}`;

describe('resolveAvatarConversationContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('prefers Runtime registered Avatar live-instance binding over opening a new anchor', async () => {
    const open = vi.fn();
    const resolveAvatarLiveInstance = vi.fn().mockResolvedValue({
      binding: {
        avatarInstanceId: 'instance-1',
        conversationAnchorId: 'anchor-desktop-current',
        localAgentRef: LOCAL_AGENT_REF,
        ownerUserId: OWNER_USER_ID,
        realmAgentId: REALM_AGENT_ID,
      },
      snapshot: {
        anchor: {
          conversationAnchorId: 'anchor-desktop-current',
          agentId: LOCAL_AGENT_REF,
          subjectUserId: OWNER_USER_ID,
        },
      },
    });
    const runtimeAgent = {
      anchors: {
        open,
        resolveAvatarLiveInstance,
        getSnapshot: vi.fn(),
      },
    } as unknown as NimiRuntimeAgentConsumeClient;

    const resolved = await resolveAvatarConversationContext({
      runtimeAgent,
      accountId: OWNER_USER_ID,
      ownerUserId: OWNER_USER_ID,
      realmAgentId: REALM_AGENT_ID,
      localAgentRef: LOCAL_AGENT_REF,
      avatarInstanceId: 'instance-1',
    });

    expect(resolved).toEqual({
      conversationAnchorId: 'anchor-desktop-current',
      subjectUserId: OWNER_USER_ID,
      recovered: true,
    });
    expect(open).not.toHaveBeenCalled();
    expect(resolveAvatarLiveInstance).toHaveBeenCalledWith({
      ownerUserId: OWNER_USER_ID,
      realmAgentId: REALM_AGENT_ID,
      localAgentRef: LOCAL_AGENT_REF,
      avatarInstanceId: 'instance-1',
    });
  });

  it('fails closed on registered live-instance binding permission errors', async () => {
    const open = vi.fn();
    const resolveAvatarLiveInstance = vi.fn().mockRejectedValue(Object.assign(new Error('permission denied'), {
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
    }));
    const runtimeAgent = {
      anchors: {
        open,
        resolveAvatarLiveInstance,
        getSnapshot: vi.fn(),
      },
    } as unknown as NimiRuntimeAgentConsumeClient;

    await expect(resolveAvatarConversationContext({
      runtimeAgent,
      accountId: OWNER_USER_ID,
      ownerUserId: OWNER_USER_ID,
      realmAgentId: REALM_AGENT_ID,
      localAgentRef: LOCAL_AGENT_REF,
      avatarInstanceId: 'instance-1',
    })).rejects.toMatchObject({ reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED });
    expect(open).not.toHaveBeenCalled();
  });
});
