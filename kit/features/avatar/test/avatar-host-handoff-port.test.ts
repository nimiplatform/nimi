import { describe, expect, it, vi } from 'vitest';
import {
  buildAvatarHostHandoffRequest,
  invokeAvatarHostHandoff,
  parseAvatarHostHandoffResult,
} from '../src/host-handoff-port.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;
const target = {
  agentHandle: AGENT_HANDLE,
  conversationAnchorId: 'anchor-1',
  avatarInstanceId: 'avatar-instance-hint-1',
  launchSource: 'zhiyu',
  committedPresentationRef: 'presentation:opaque-1',
  temporaryCustodyRef: 'custody:opaque-1',
} as const;

describe('Avatar Host handoff port', () => {
  it.each(['presence', 'launch', 'focus'] as const)('builds the exact %s mechanics request', (command) => {
    expect(buildAvatarHostHandoffRequest({ command, target })).toEqual({ command, target });
  });

  it('projects only opaque mechanic state and refs', async () => {
    const invoke = vi.fn(async () => ({
      command: 'presence',
      state: 'present',
      avatarInstanceRef: 'instance:opaque-1',
      committedPresentationRef: 'presentation:opaque-1',
      temporaryCustodyRef: 'custody:opaque-1',
    }));
    const result = await invokeAvatarHostHandoff(
      { invoke },
      buildAvatarHostHandoffRequest({ command: 'presence', target }),
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      command: 'presence',
      state: 'present',
      avatarInstanceRef: 'instance:opaque-1',
      committedPresentationRef: 'presentation:opaque-1',
      temporaryCustodyRef: 'custody:opaque-1',
    });
    expect(JSON.stringify(result)).not.toMatch(/agent|anchor|account|owner|configuration|backend|availability|reason|error/ui);
  });

  it('represents absence without deleting product capability', () => {
    expect(parseAvatarHostHandoffResult({
      command: 'presence',
      state: 'absent',
      avatarInstanceRef: null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    }, 'presence')).toEqual({
      command: 'presence',
      state: 'absent',
      avatarInstanceRef: null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    });
  });

  it.each([
    ['raw identity', { command: 'launch', target: { ...target, ownerUserId: 'owner-1' } }],
    ['configuration ref', { command: 'launch', target: { ...target, configurationRef: 'config-1' } }],
    ['product availability', { command: 'launch', target: { ...target, availability: 'ready' } }],
    ['backend command', { command: 'launch', target: { ...target, expression: 'smile' } }],
  ])('rejects %s in the common mechanics request', (_label, input) => {
    expect(() => buildAvatarHostHandoffRequest(input as never)).toThrow(/unsupported field|forbidden field/u);
  });

  it('rejects mismatched command, missing instance proof, and product/error fields in results', () => {
    expect(() => parseAvatarHostHandoffResult({
      command: 'focus', state: 'focused', avatarInstanceRef: 'instance:1',
      committedPresentationRef: null, temporaryCustodyRef: null,
    }, 'launch')).toThrow(/does not match/u);
    expect(() => parseAvatarHostHandoffResult({
      command: 'focus', state: 'focused', avatarInstanceRef: null,
      committedPresentationRef: null, temporaryCustodyRef: null,
    }, 'focus')).toThrow(/instance ref/u);
    expect(() => parseAvatarHostHandoffResult({
      command: 'presence', state: 'absent', avatarInstanceRef: null,
      committedPresentationRef: null, temporaryCustodyRef: null,
      reasonCode: 'avatar-not-running',
    }, 'presence')).toThrow(/unsupported field|forbidden field/u);
  });
});
