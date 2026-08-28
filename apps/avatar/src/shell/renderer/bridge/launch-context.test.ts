import { describe, expect, it } from 'vitest';
import { parseAvatarLaunchContext } from './launch-context.js';

const baseLaunchContext = {
  agentHandle: `agent_ref_${'a'.repeat(43)}`,
  conversationAnchorId: 'anchor-1',
  avatarInstanceId: 'instance-1',
  launchSource: 'desktop-agent-chat',
};

describe('parseAvatarLaunchContext', () => {
  it('accepts only the canonical renderer launch projection', () => {
    expect(parseAvatarLaunchContext(baseLaunchContext)).toEqual(baseLaunchContext);
  });

  it('rejects raw Agent identity and authority sidebands', () => {
    for (const field of [
      'agentId', 'agent_id', 'ownerUserId', 'runtimeSourceRef', 'localAgentRef',
      'subjectUserId', 'accountId', 'jwt', 'accessToken',
    ]) {
      expect(() => parseAvatarLaunchContext({
        ...baseLaunchContext,
        [field]: 'forbidden',
      })).toThrow(new RegExp(`forbidden field: ${field}`));
    }
  });

  it('rejects parallel backend and materialization truth', () => {
    for (const field of [
      'avatarPackage', 'avatarAssetRef', 'backendCapabilityProfileRef',
      'materializationRef', 'manifestPath', 'runtimeAppId',
    ]) {
      expect(() => parseAvatarLaunchContext({
        ...baseLaunchContext,
        [field]: 'opaque-ref',
      })).toThrow(new RegExp(`forbidden field: ${field}`));
    }
  });
});
